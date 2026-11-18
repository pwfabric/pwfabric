/**
 * Data-Bound Surface Renderer
 *
 * Wrapper component that resolves dataSources, state, and {{expression}} props
 * before passing concrete values to the existing SurfaceRenderer.
 *
 * Architecture (post-refactor):
 *   Surface JSON (dataSources + state + {{expr}} in props)
 *     -> DataBoundSurfaceRenderer
 *       -> DataCapabilityProvider (creates DataService instance)
 *         -> DataBoundInner
 *           -> useSurfaceData: maps SurfaceDataSourceDefinition → DataSourceDefinition,
 *              registers with DataService, fetches via DataService, manages React state
 *     -> SurfaceRenderer (unchanged)
 *       -> Block components (unchanged)
 *
 * Backward compatible: if no dataSources, passes through with zero overhead.
 *
 * @module @pwfabric/runtime/render/DataBoundSurfaceRenderer
 */

import * as React from 'react'
import { SurfaceRenderer } from './renderer.js'
import { literalPropsOf, resolveBlockExpressions } from './resolve-expressions.js'
import { useDynamicBlocks } from './dynamic-artifact-context.js'
import { readableUrl, urlSchemeOf, type LinkHref } from './links.js'
import { endpointMissingPathValue, resolveEndpoint } from './endpoint.js'
import { resolveQueryState } from './query-state.js'
import { dataSourceCacheKey, type SurfaceDataCache } from './data-cache.js'
import { DataCapabilityProvider, useDataService } from '../data/DataCapabilityProvider.js'
import type {
  DataBoundSurfaceRendererProps,
  SurfaceDataSourceDefinition,
  SurfaceAction,
  RuntimeBehavior,
  WriteAction,
  AuthAction,
  SurfaceAuthHost,
  SurfaceAuthState,
} from './data-binding-types.js'
import type {
  SurfaceEvent,
  SurfaceRendererProps,
  RenderableSurface,
  BlockInteractionMode,
} from './types.js'
import type { Block } from '@pwfabric/core'
import type { DataSourceDefinition } from '../data/types.js'
import { createEntityDataSource } from '../entity/entity-datasource.js'
import { aggregateThrough } from '../entity/aggregate.js'
import { SurfaceDataContext, SurfaceLinkHrefContext } from './surface-data-context.js'
import { createSourceWriter } from './source-writer.js'
import { resolveValueIn } from './resolve-expressions.js'
import { writeFailureDetail, writeFailureFields, writeFailureReason } from '../forms/form-write-target.js'
import type { EntityFacade } from '../entity/facade.js'
import type { EntityAggregate, EntityQuery, EntityTypeId } from '../entity/types.js'
import type { SurfaceConnectionsValue } from '../connectors/types.js'
import { PLATFORM_PERSISTENCE_CAPABILITY_ID } from '@pwfabric/contracts'
import { isCapability } from '../capability/type-mapping.js'
import { writeOnlySourceIds } from './write-only-sources.js'
import { failureCodeOf, sourceFailureReason, type SourceFailureCode, type SourceFailureReason } from './source-failure.js'
import { applyEntityQuery } from '../entity/apply-query.js'
import { documentAddress, type SurfaceAddress } from './address.js'
import { useNotFoundReport, useUrlStateSync } from './address-sync.js'
import { useAppMessage } from './app-messages.js'

// ============================================================
// extract dataSources + initialState from persistence config
// ============================================================

/**
 * consolidated these two seeds under the platform/persistence
 * capability config. DataBoundSurfaceRenderer is the sole consumer.
 */
function extractPersistenceSeeds(surface: {
  readonly capabilities?: RenderableSurface['capabilities']
}): {
  dataSources: readonly SurfaceDataSourceDefinition[] | undefined
  initialState: Readonly<Record<string, unknown>> | undefined
  behaviors: readonly RuntimeBehavior[] | undefined
  urlState: readonly string[] | undefined
} {
  const binding = surface.capabilities?.find(
    (c) => isCapability(c, PLATFORM_PERSISTENCE_CAPABILITY_ID)
  )
  const cfg = binding?.config as
    | {
        dataSources?: readonly SurfaceDataSourceDefinition[]
        initialState?: Readonly<Record<string, unknown>>
        behaviors?: readonly RuntimeBehavior[]
        urlState?: readonly string[]
      }
    | undefined
  return {
    dataSources: cfg?.dataSources,
    initialState: cfg?.initialState,
    // Declared behaviors (shipped by a pattern / authored in JSON). The
    // renderer merges these with host-provided behaviors (the host's store) so a pack
    // can carry its own controls without the host knowing about them.
    behaviors: cfg?.behaviors,
    // State keys that live in the page's address (render/address-sync.ts).
    urlState: Array.isArray(cfg?.urlState) ? cfg.urlState.filter((k): k is string => typeof k === 'string' && k !== '') : undefined,
  }
}

/**
 * A source's `fallback`, as the source's query would have cut it (see
 * source-failure: bound only when nothing is connected to serve the source).
 * A list is filtered, sorted and paged like live rows, so a detail page
 * filtering `id eq <x>` shows that record or none — never the first sample.
 * Anything else (an aggregate's `{ value }`) is bound as written.
 */
function fallbackRows(fallback: unknown, query: EntityQuery | undefined): unknown {
  if (!query || !Array.isArray(fallback)) return fallback
  return applyEntityQuery(fallback as Record<string, unknown>[], query).items
}

/**
 * A surface whose ONLY dynamic behaviour is writing (platform/entities
 * formBindings, no persistence dataSources) still needs the full data-bound
 * path: the form→entity bridge dispatches statusKeys through setState and the
 * success/error UI hangs off `visibleWhen: "{{state.x}}"` — both live in
 * DataBoundInner's state machinery. Before this check, such a surface fell
 * into the zero-overhead passthrough where visibleWhen was never evaluated
 * and, worse, submits were silently lost (proven live against a real
 * SharePoint list: two submits on a formBindings-only page never reached the
 * connector; adding any read source made the identical form work).
 */
function hasEntityFormBindings(surface: {
  readonly capabilities?: RenderableSurface['capabilities']
}): boolean {
  const entityCap = surface.capabilities?.find((c) => isCapability(c, 'platform/entities'))
  const formBindings = (entityCap?.config as { formBindings?: readonly unknown[] } | undefined)
    ?.formBindings
  return Array.isArray(formBindings) && formBindings.length > 0
}

/**
 * The actions a block's `action` prop names, in order.
 *
 * One action or a list of them (`[setState step, setState stepError '']`) —
 * a wizard's "Next" has to move the step AND clear the previous step's error
 * in one click. Anything that is not a surface action (a form's `action` is
 * its submit URL string) names none.
 */
export function blockActionsOf(value: unknown): readonly SurfaceAction[] {
  if (Array.isArray(value)) return value.filter(isSurfaceAction)
  return isSurfaceAction(value) ? [value] : []
}

/**
 * THE IDENTITY THE PAGE READS when the host gives none: nobody signed in, no
 * way in. `{{__auth.signedIn}}` is then false rather than unresolved, in an
 * editor preview as on a published page without sign-in.
 */
const SIGNED_OUT: SurfaceAuthState = Object.freeze({
  signedIn: false,
  user: null,
  methods: Object.freeze([]) as readonly string[],
  registration: 'closed',
  error: null,
})

const AUTH_ACTION_TYPES: ReadonlySet<string> = new Set(['auth:signIn', 'auth:register', 'auth:signOut'])

/** An `auth:*` action (data-binding-types `AuthAction`) — the host's to perform, never the runtime's. */
export function isAuthAction(value: unknown): value is AuthAction {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  if (typeof obj.type !== 'string' || !AUTH_ACTION_TYPES.has(obj.type)) return false
  return obj.method === undefined || typeof obj.method === 'string'
}

/**
 * Hand an `auth:*` action to the host, with the values of the form whose
 * submit fired it. Without a host that acts on it, it does nothing — said
 * once in the console, so a dead "Sign in" is findable.
 */
function performAuthAction(
  auth: SurfaceAuthHost | undefined,
  action: AuthAction,
  values: Readonly<Record<string, unknown>> | undefined
): void {
  if (!auth?.onAction) {
    console.warn(`[surface] "${action.type}" needs a host that signs visitors in; this one does not`)
    return
  }
  auth.onAction(action, values ? { values } : {})
}

/** The field values a form's submit event carries (`payload.values`), or undefined. */
function eventValues(event: SurfaceEvent): Readonly<Record<string, unknown>> | undefined {
  const values = (event.payload as { values?: unknown } | undefined)?.values
  return values && typeof values === 'object' && !Array.isArray(values)
    ? (values as Readonly<Record<string, unknown>>)
    : undefined
}

/**
 * Does any block read the visitor's identity (`{{me.*}}`, `{{__auth.*}}`)?
 * Such a page needs the data-bound path even with no source: the passthrough
 * resolves no expression, and the greeting would read "Welcome, {{me.name}}".
 */
const READS_AUTH = /\{\{[^}]*\b(?:me|__auth)\b/
function blockTreeReadsAuth(blocks: readonly Block[] | undefined): boolean {
  if (!blocks || blocks.length === 0) return false
  return READS_AUTH.test(JSON.stringify(blocks))
}

function blockTreeHasAction(blocks: readonly Block[] | undefined): boolean {
  if (!blocks) return false
  for (const block of blocks) {
    if (blockActionsOf(block.props?.action).length > 0) return true
    if (blockTreeHasAction(block.children)) return true
  }
  return false
}

/**
 * Does any block carry a condition or a repeat the renderer has to evaluate?
 *
 * `visibleWhen`/`if` and `repeat` are resolved ONLY on the data-bound path.
 * A static page — no source, no state, no action — takes this path too: on
 * the passthrough a condition would never be read, so the shell's empty
 * brand logo would draw as "⊟ <name> logo", and a thank-you gated on
 * `{{state.submitted}}` would show before anything was submitted.
 * An empty condition string is no condition, as in resolveBlock.
 */
function blockTreeHasCondition(blocks: readonly Block[] | undefined): boolean {
  if (!blocks) return false
  for (const block of blocks) {
    const b = block as { visibleWhen?: unknown; if?: unknown; repeat?: unknown }
    for (const expr of [b.visibleWhen, b.if, b.repeat]) {
      if (typeof expr === 'string' && expr.trim()) return true
    }
    if (blockTreeHasCondition(block.children)) return true
  }
  return false
}

/**
 * Does this surface need the data-bound path — state, expression resolution,
 * the action dispatcher — or can it go straight to SurfaceRenderer?
 *
 * ONE ANSWER FOR EVERY HOST. The renderer's own passthrough check and embed's
 * `needsDataBoundRenderer` used to disagree: embed counted `initialState`, the
 * renderer did not. So a wizard page carrying nothing but `initialState` and
 * buttons with `action` props reached the renderer, fell into the passthrough,
 * and there `visibleWhen` was never evaluated, `repeat` never expanded and no
 * `action` was ever dispatched — the buttons were dead. A block `action` alone
 * needs the path too: it is dispatched nowhere else. So does a block
 * `visibleWhen`/`if`/`repeat` (see blockTreeHasCondition).
 *
 * Host-provided behaviors are a prop, not part of the surface, and are
 * checked by the renderer on top of this.
 */
export function surfaceNeedsDataBinding(surface: {
  readonly blocks?: readonly Block[]
  readonly capabilities?: RenderableSurface['capabilities']
}): boolean {
  const { dataSources, initialState, behaviors } = extractPersistenceSeeds(surface)
  return (
    Boolean(dataSources && dataSources.length > 0) ||
    initialState !== undefined ||
    Boolean(behaviors && behaviors.length > 0) ||
    hasEntityFormBindings(surface) ||
    blockTreeHasAction(surface.blocks) ||
    blockTreeHasCondition(surface.blocks) ||
    blockTreeReadsAuth(surface.blocks)
  )
}

// ============================================================
// TYPES
// ============================================================

interface SourceData {
  readonly data: unknown
  readonly loading: boolean
  /** The internal detail of the last failure (logged, never bound as written). */
  readonly error: string | null
  /** Why the last fetch failed — `__errorCodes.<id>`; null when it did not. */
  readonly errorCode?: SourceFailureCode | null
  /** HTTP status of the last answer; null for a network failure or a non-HTTP kind. */
  readonly status?: number | null
  /** The envelope `returns` unwrapped the list from (`total`, `skip`, `limit` …). */
  readonly meta?: Readonly<Record<string, unknown>> | null
  /** Not fetched: a required path value of the endpoint is empty. */
  readonly idle?: boolean
  /** The resolved request `data` answered (see requestKeyOf). */
  readonly key?: string
}

// ============================================================
// SURFACE → RUNTIME SOURCE MAPPING
// ============================================================

/**
 * Maps a JSON-safe SurfaceDataSourceDefinition to a runtime DataSourceDefinition.
 * Returns null for 'state' kind (handled locally via React state, not DataService).
 */
function mapSurfaceSourceToDefinition(
  source: SurfaceDataSourceDefinition,
  currentState: Record<string, unknown>
): DataSourceDefinition | null {
  switch (source.kind) {
    case 'static':
      return {
        id: source.id,
        kind: 'static',
        staticData: source.staticData,
        // A static source's query was dropped here, so its rows were bound
        // unsorted and unfiltered. Resolved like a rest source's.
        ...(source.query
          ? { query: resolveQueryState(source.query, currentState) as EntityQuery }
          : {}),
      }
    case 'state':
      // State sources read from React state, not managed by DataService
      return null
    case 'rest': {
      if (!source.endpoint) return null
      // `{{state.x}}` placeholders resolve against current state, each value
      // URL-encoded in a mixed endpoint — see resolveEndpoint for why.
      const endpoint = resolveEndpoint(source.endpoint, currentState)
      return {
        id: source.id,
        kind: 'rest' as const,
        endpoint,
        method: source.method ?? 'GET',
        ...(source.headers ? { headers: source.headers } : {}),
        // carry the identity the source names. This branch
        // copied endpoint/method/headers and stopped, so a rest source could
        // declare an identity the fetch would never see.
        ...(source.authProviderRef ? { authProviderRef: source.authProviderRef } : {}),
        // Same omission class as the line above: the source says where its
        // list is and the definition has to carry it, or `fetchRest` hands the
        // binding context a whole JSON body.
        ...(source.returns !== undefined ? { returns: source.returns } : {}),
        // The entity branch resolves `{{state.x}}` inside the query and hands
        // it to the facade; a rest source declared the same query and lost it
        // here. Resolved the same way, applied by the data service after the
        // fetch.
        ...(source.query
          ? { query: resolveQueryState(source.query, currentState) as EntityQuery }
          : {}),
      }
    }
    default:
      return null
  }
}

// ============================================================
// useSurfaceData HOOK
// ============================================================

/**
 * Manages data source fetching, state, and auto-refresh for a data-bound surface.
 *
 * Delegates fetch mechanics to DataService via context.
 * Keeps React state management and expression resolution locally.
 */
interface SurfaceDataResult {
  expressionData: Record<string, unknown>
  surfaceState: Record<string, unknown>
  initialLoaded: boolean
  setStateValue: (key: string, value: unknown) => void
  refreshSource: (sourceId: string) => Promise<void>
  fetchAllSources: () => Promise<void>
}

/** What one fetch of one source came to. */
type FetchOutcome =
  | { readonly kind: 'ok'; readonly data: unknown; readonly status: number | null; readonly meta: Readonly<Record<string, unknown>> | null }
  | {
      readonly kind: 'error'
      /** The internal detail — for the console, never the page. */
      readonly message: string
      readonly code: SourceFailureCode
      readonly status: number | null
      /** Only for `unconnected`: the fallback rows, cut by the query. */
      readonly fallback?: { readonly data: unknown }
    }

/** JSON of a source DEFINITION, computed once per definition object. */
const definitionJsonCache = new WeakMap<object, string>()
let unserialisable = 0

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined'
  } catch {
    // A value that cannot be serialised can never be proven unchanged.
    return `#unserialisable-${++unserialisable}`
  }
}

function definitionJson(source: SurfaceDataSourceDefinition): string {
  let json = definitionJsonCache.get(source)
  if (json === undefined) {
    json = safeJson(source)
    definitionJsonCache.set(source, json)
  }
  return json
}

/** A REST source whose required path value is empty is not fetched. */
function isIdleSource(source: SurfaceDataSourceDefinition, state: Readonly<Record<string, unknown>>): boolean {
  return source.kind === 'rest' && Boolean(source.endpoint) && endpointMissingPathValue(source.endpoint as string, state)
}

/**
 * EVERYTHING THAT DECIDES WHAT A SOURCE FETCHES, AS ONE STRING.
 *
 * The definition itself plus whatever it reads from state, RESOLVED: the REST
 * address, the query with its `{{state.*}}` placeholders filled in, a state
 * source's value. A source is refetched when — and only when — this changes.
 *
 * Refetching every source on every `setState` would make a search box writing
 * `state.searchDraft` on each keystroke refetch the product list AND the
 * cart, flashing both loading states, and a menu toggle refetch the whole
 * page. Dependency tracking on the resolved request is exact where
 * key-name extraction is not: `{{state.a ? state.b : state.c}}` depends on `c`
 * only while `a` is false, and the resolved value knows that.
 */
function requestKeyOf(source: SurfaceDataSourceDefinition, state: Readonly<Record<string, unknown>>): string {
  const def = definitionJson(source)
  switch (source.kind) {
    case 'rest': {
      if (!source.endpoint) return def
      if (isIdleSource(source, state)) return `${def}|idle`
      const query = source.query ? safeJson(resolveQueryState(source.query, state)) : ''
      return `${def}|${resolveEndpoint(source.endpoint, state)}|${query}`
    }
    case 'entity': {
      const query = source.query ? safeJson(resolveQueryState(source.query, state)) : ''
      // The resolved aggregate too: a counter whose filter reads
      // `{{state.status}}` must ask again when the status changes.
      const aggregate = source.aggregate ? safeJson(resolveQueryState(source.aggregate, state)) : ''
      return `${def}|${query}|${aggregate}`
    }
    case 'state':
      return `${def}|${safeJson(state[source.id])}`
    case 'static':
      // A query reading `{{state.x}}` re-applies when x changes.
      return source.query ? `${def}|${safeJson(resolveQueryState(source.query, state))}` : def
    default:
      return def
  }
}

function useSurfaceData(
  dataSources: readonly SurfaceDataSourceDefinition[] | undefined,
  initialState: Readonly<Record<string, unknown>> | undefined,
  interactionMode: BlockInteractionMode = 'live',
  entityFacade?: EntityFacade,
  connections?: SurfaceConnectionsValue,
  dataCache?: SurfaceDataCache,
  /** Sources only a form writes to (see write-only-sources): settled, never fetched. */
  writeOnly?: ReadonlySet<string>
): SurfaceDataResult {
  const dataService = useDataService()
  const writeOnlyRef = React.useRef(writeOnly)
  writeOnlyRef.current = writeOnly
  const dataCacheRef = React.useRef(dataCache)
  dataCacheRef.current = dataCache

  // State store
  const [surfaceState, setSurfaceState] = React.useState<Record<string, unknown>>(() => ({
    ...initialState,
  }))

  // Source data store — seeded from the host's cache when it has yesterday's
  // rows for a source, so the first frame is not an empty table. The seed is
  // marked loading: the fetch that follows is what makes it today's.
  //
  // A STATIC source is in the receipt already, so its rows are in the FIRST
  // frame (its query applied, as the data service applies it). Bound one tick
  // later through the data service, a static list was drawn empty and then
  // filled, pushing everything under it down after the page had painted.
  const [sourceData, setSourceData] = React.useState<Record<string, SourceData>>(() => {
    if (!dataSources) return {}
    const seeded: Record<string, SourceData> = {}
    for (const source of dataSources) {
      if (source.kind !== 'static') continue
      const state = initialState ?? {}
      const rows = source.staticData
      const data =
        source.query && Array.isArray(rows)
          ? applyEntityQuery(rows as Record<string, unknown>[], resolveQueryState(source.query, state) as EntityQuery).items
          : rows
      seeded[source.id] = { data, loading: false, error: null, key: requestKeyOf(source, state) }
    }
    if (!dataCache) return seeded
    for (const source of dataSources) {
      const key = dataSourceCacheKey(source, initialState ?? {})
      if (!key) continue
      const hit = dataCache.get(key)
      if (hit !== undefined) {
        seeded[source.id] = { data: hit, loading: true, error: null, key: requestKeyOf(source, initialState ?? {}) }
      }
    }
    return seeded
  })
  // Track whether initial fetch is complete. A page whose every fetched
  // source came out of the cache counts as loaded: the gate has nothing to
  // wait for that the visitor has not already seen.
  const [initialLoaded, setInitialLoaded] = React.useState(() => {
    if (!dataCache || !dataSources) return false
    const fetched = dataSources.filter((s) => dataSourceCacheKey(s, initialState ?? {}) !== undefined)
    return fetched.length > 0 && fetched.every((s) => dataCache.get(dataSourceCacheKey(s, initialState ?? {})!) !== undefined)
  })

  // Stable ref to current state for use in fetch callbacks
  const stateRef = React.useRef(surfaceState)
  stateRef.current = surfaceState

  // Stable ref to sources
  const sourcesRef = React.useRef(dataSources)
  sourcesRef.current = dataSources

  // Stable ref to the entity facade (kind:'entity' sources query through it)
  const entityFacadeRef = React.useRef(entityFacade)
  entityFacadeRef.current = entityFacade

  // Stable ref to the connections context (kind:'entity'
  // sources with a `connector` route through the engine registry)
  const connectionsRef = React.useRef(connections)
  connectionsRef.current = connections

  /** The request each source was last fetched (or marked idle) for. */
  const requestKeysRef = React.useRef<Record<string, string>>({})
  /** The in-flight fetch of each source — a newer one aborts it. */
  const controllersRef = React.useRef(new Map<string, AbortController>())

  // ---- setState action ----
  // Writing the value a key already holds changes nothing, so it renders
  // nothing and fetches nothing.
  const setStateValue = React.useCallback((key: string, value: unknown) => {
    setSurfaceState((prev) => {
      if (prev[key] === value) return prev
      return { ...prev, [key]: value }
    })
  }, [])

  // ---- (Re-)register a source's definition for the current state ----
  // Registered even when the source is idle, so a form or a behavior writing
  // to it through the data service still finds it.
  const registerSource = React.useCallback(
    (source: SurfaceDataSourceDefinition, state: Record<string, unknown>) => {
      if (dataService.hasSource(source.id)) dataService.unregisterSource(source.id)
      const definition = mapSurfaceSourceToDefinition(source, state)
      if (definition) dataService.registerSource(definition)
    },
    [dataService]
  )

  // ---- Fetch a single source ----
  const fetchSource = React.useCallback(
    async (
      source: SurfaceDataSourceDefinition,
      state: Record<string, unknown>,
      signal: AbortSignal
    ): Promise<FetchOutcome> => {
      const failed = (err: unknown, status: number | null = null): FetchOutcome => ({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        code: failureCodeOf(err, status),
        status,
      })

      // State sources read from React state directly
      if (source.kind === 'state') {
        return { kind: 'ok', data: state[source.id], status: null, meta: null }
      }

      // Entity sources list records via the platform/entities facade.
      // Returns the items array so {{<id>}} binds directly to the list (e.g. a
      // table's `data`). Refreshed by refreshAll after a form→entity create.
      if (source.kind === 'entity') {
        if (!source.entityType) return { kind: 'ok', data: [], status: null, meta: null }

        // A source that names a `connector` routes through the
        // host-provided engine registry when that connection is registered
        // there. Registered-but-failed surfaces the reason as an honest
        // per-source error (`__errors.<id>`), never a crash; an unregistered
        // connection (or no registry at all) falls through to the
        // host's entity facade path.
        // `{{state.x}}` inside the query resolves against CURRENT state, so
        // a pagination block writing `state.page` or a segmented-control
        // writing `state.severity` reaches `query.pagination` / `query.filter`.
        // Before this, only REST endpoints saw state; connector queries went raw.
        const query = source.query ? (resolveQueryState(source.query, state) as EntityQuery) : undefined
        // An AGGREGATE source asks for one number, never the rows. Its
        // filter resolves against state like `query` does, and the answer
        // binds `{ fn, field?, value, count }` (`{{<id>.value}}`), exempt
        // from the list wrap below. A counter on an intake collection is
        // allowed what a list of it is not, and a public one no longer hands
        // every row to a stranger so the page can count them.
        const aggregate = source.aggregate
          ? (resolveQueryState(source.aggregate, state) as unknown as EntityAggregate)
          : undefined
        const entityType = source.entityType as EntityTypeId
        // A REAL failure binds no rows, whatever `fallback` says
        // (source-failure). The code travels with the detail.
        const fail = (message: string, code?: SourceFailureCode): FetchOutcome => ({
          kind: 'error',
          message,
          code: code ?? 'error',
          status: typeof code === 'number' ? code : null,
        })
        // NOTHING IS CONNECTED to serve this source: the one case its
        // `fallback` is bound, cut by its query.
        const unconnected = (message: string): FetchOutcome => ({
          kind: 'error',
          message,
          code: 'unconnected',
          status: null,
          fallback: { data: fallbackRows(source.fallback, query) },
        })
        try {
          const engines = connectionsRef.current?.engines
          if (source.connector && engines) {
            const status = engines.getStatus(source.connector)
            if (status.state !== 'unregistered') {
              const engine = await engines.resolve(source.connector)
              if (engine) {
                if (aggregate) {
                  const agg = await aggregateThrough(engine, entityType, aggregate)
                  if (agg.success) return { kind: 'ok', data: agg.result, status: null, meta: null }
                  return fail(agg.error, agg.code)
                }
                const res = await engine.query(entityType, (query ?? {}) as EntityQuery)
                if (res.success) return { kind: 'ok', data: res.result.items, status: null, meta: null }
                return fail(res.error, res.code)
              }
              // A configured connection whose engine could not be built: a
              // real failure, not a missing connection.
              const failedStatus = engines.getStatus(source.connector)
              return fail(
                failedStatus.state === 'failed'
                  ? failedStatus.reason
                  : `Connector engine '${source.connector}' unavailable`
              )
            }
            // Declared connector, nothing registered: a pattern shipped without
            // its connection. With a fallback this is the "sample data" path;
            // without one, today's facade route stays.
            if (source.fallback !== undefined) {
              return unconnected(`Connector '${source.connector}' is not connected`)
            }
          }

          const facade = entityFacadeRef.current
          if (!facade) {
            return source.fallback !== undefined
              ? unconnected('No entity facade available')
              : {
                  kind: 'ok',
                  data: aggregate
                    ? { fn: aggregate.fn, ...(aggregate.field ? { field: aggregate.field } : {}), value: null, count: 0 }
                    : [],
                  status: null,
                  meta: null,
                }
          }
          if (aggregate) {
            if (typeof facade.resolveAggregate === 'function') {
              // A count that cannot be served is an error, not a 0: bind
              // `fallback` and report it, same as a failed list.
              try {
                const agg = await facade.resolveAggregate(entityType, aggregate)
                return { kind: 'ok', data: agg, status: null, meta: null }
              } catch (err) {
                return failed(err)
              }
            }
            // A facade from before `resolveAggregate` lists; the rows it
            // returns are reduced here, same as a list-only engine.
            const viaList = await aggregateThrough(
              { query: async (t, q) => ({ success: true, result: await facade.resolveBinding(t, q) }) },
              entityType,
              aggregate
            )
            if (!viaList.success) return fail(viaList.error, viaList.code)
            return { kind: 'ok', data: viaList.result, status: null, meta: null }
          }
          const eds = createEntityDataSource(facade, {
            id: source.id,
            entityType: source.entityType as EntityTypeId,
            ...(query ? { query } : {}),
          })
          try {
            const result = await eds.fetch()
            return { kind: 'ok', data: result.items, status: null, meta: null }
          } catch (err) {
            return failed(err)
          }
        } catch (err) {
          return failed(err)
        }
      }

      // Everything else goes through the DataService, registered for THIS state.
      registerSource(source, state)
      const result = await dataService.fetchData(source.id, {
        signal,
        ...(source.headers ? { headers: source.headers } : {}),
      })
      if (result.success) {
        return {
          kind: 'ok',
          data: result.data,
          status: result.metadata.status ?? null,
          meta: result.metadata.envelope ?? null,
        }
      }
      // A refused read (401/403), a 404, a 500 or no answer at all is a REAL
      // failure: no rows, whatever `fallback` says (source-failure). The page
      // shows its own state from `__errorCodes.<id>`.
      const { error } = result
      return {
        kind: 'error',
        message: error.message,
        code:
          error.status !== undefined
            ? error.status
            : error.type === 'timeout'
              ? 'network'
              : failureCodeOf(error.cause),
        status: error.status ?? null,
      }
    },
    [dataService, registerSource]
  )

  // ---- Fetch a set of sources for the current state ----
  const fetchSources = React.useCallback(
    async (sources: readonly SurfaceDataSourceDefinition[]) => {
      const state = stateRef.current
      const idle: SurfaceDataSourceDefinition[] = []
      const writeOnlySettled: SurfaceDataSourceDefinition[] = []
      const jobs: { source: SurfaceDataSourceDefinition; controller: AbortController; key: string }[] = []
      for (const source of sources) {
        controllersRef.current.get(source.id)?.abort()
        controllersRef.current.delete(source.id)
        const key = requestKeyOf(source, state)
        requestKeysRef.current[source.id] = key
        if (isIdleSource(source, state)) {
          idle.push(source)
          registerSource(source, state)
          continue
        }
        // A form's write target nothing reads: no list request — not on
        // mount, not after a submit's refreshAll. Still registered, so the
        // form's write through the data service finds it.
        if (writeOnlyRef.current?.has(source.id) === true) {
          writeOnlySettled.push(source)
          registerSource(source, state)
          continue
        }
        const controller = new AbortController()
        controllersRef.current.set(source.id, controller)
        jobs.push({ source, controller, key })
      }

      // Idle sources settle at once: no data, not loading, no error. The data
      // of whatever was shown before belongs to another request, so it goes.
      // Fetched sources show their loading flag and keep their data until the
      // answer arrives (a filter change does not blank the list meanwhile).
      setSourceData((prev) => {
        const next = { ...prev }
        for (const source of idle) {
          next[source.id] = { data: null, loading: false, error: null, status: null, meta: null, idle: true, key: requestKeysRef.current[source.id] as string }
        }
        for (const source of writeOnlySettled) {
          next[source.id] = { data: null, loading: false, error: null, status: null, meta: null, key: requestKeysRef.current[source.id] as string }
        }
        for (const { source } of jobs) {
          const p = prev[source.id]
          next[source.id] = {
            data: p?.data ?? null,
            loading: true,
            error: null,
            status: p?.status ?? null,
            meta: p?.meta ?? null,
            ...(p?.key !== undefined ? { key: p.key } : {}),
          }
        }
        return next
      })

      await Promise.all(
        jobs.map(async ({ source, controller, key }) => {
          let outcome: FetchOutcome
          try {
            outcome = await fetchSource(source, state, controller.signal)
          } catch (err) {
            outcome = {
              kind: 'error',
              message: err instanceof Error ? err.message : String(err),
              code: failureCodeOf(err),
              status: null,
            }
          }
          if (outcome.kind === 'error' && outcome.code !== 'unconnected' && !controller.signal.aborted) {
            // The detail is the developer's, so it goes to the console; the
            // page binds a sentence and a code.
            console.warn(`[surface] source "${source.id}" could not be served (${String(outcome.code)}): ${outcome.message}`)
          }
          if (controller.signal.aborted) return
          controllersRef.current.delete(source.id)
          setSourceData((prev) => {
            const next = { ...prev }
            if (outcome.kind === 'ok') {
              next[source.id] = { data: outcome.data, loading: false, error: null, status: outcome.status, meta: outcome.meta, key }
            } else {
              const p = prev[source.id]
              // ON ERROR, DATA FROM ANOTHER REQUEST IS CLEARED: a search
              // for cart 999 must not leave cart 1 on screen under the error.
              // The SAME request failing again (a refresh, a poll) keeps its
              // last good answer — that answer is still the right record.
              const keep = p?.key === key
              next[source.id] = {
                data: outcome.fallback ? outcome.fallback.data : keep ? (p?.data ?? null) : null,
                loading: false,
                error: outcome.message,
                errorCode: outcome.code,
                status: outcome.status,
                meta: keep ? (p?.meta ?? null) : null,
                ...(keep ? { key } : {}),
              }
            }
            return next
          })
          if (outcome.kind === 'ok') {
            const cacheKey = dataSourceCacheKey(source, state)
            if (cacheKey) dataCacheRef.current?.set(cacheKey, outcome.data)
          }
        })
      )

      // A pass whose every fetch was superseded settles nothing; the pass
      // that superseded it will.
      if (jobs.length > 0 && jobs.every((j) => j.controller.signal.aborted)) return
      setInitialLoaded(true)
    },
    [fetchSource, registerSource]
  )

  // ---- Fetch every source (refreshAll) ----
  const fetchAllSources = React.useCallback(async () => {
    const sources = sourcesRef.current
    if (!sources || sources.length === 0) {
      setInitialLoaded(true)
      return
    }
    await fetchSources(sources)
  }, [fetchSources])

  // ---- Refresh a single source ----
  const refreshSource = React.useCallback(
    async (sourceId: string) => {
      const source = sourcesRef.current?.find((s) => s.id === sourceId)
      if (!source) return
      await fetchSources([source])
    },
    [fetchSources]
  )

  // ---- Initial fetch + refetch of the sources whose request changed ----
  React.useEffect(() => {
    const sources = dataSources ?? []
    const present = new Set(sources.map((s) => s.id))
    for (const id of Object.keys(requestKeysRef.current)) {
      if (present.has(id)) continue
      delete requestKeysRef.current[id]
      controllersRef.current.get(id)?.abort()
      controllersRef.current.delete(id)
      if (dataService.hasSource(id)) dataService.unregisterSource(id)
    }
    if (sources.length === 0) {
      setInitialLoaded(true)
      return
    }
    const changed = sources.filter((s) => requestKeyOf(s, surfaceState) !== requestKeysRef.current[s.id])
    if (changed.length > 0) void fetchSources(changed)
  }, [dataSources, surfaceState, fetchSources, dataService])

  // ---- Unmount: abort what is in flight, forget what was fetched ----
  // Forgetting matters under StrictMode's mount → unmount → mount: the second
  // mount must fetch again, not believe the aborted first pass succeeded.
  React.useEffect(() => {
    const controllers = controllersRef.current
    return () => {
      for (const controller of controllers.values()) controller.abort()
      controllers.clear()
      requestKeysRef.current = {}
      for (const source of sourcesRef.current ?? []) {
        if (dataService.hasSource(source.id)) dataService.unregisterSource(source.id)
      }
    }
  }, [dataService])

  // ---- Auto-refresh intervals ----
  React.useEffect(() => {
    // Inert (editor/preview): never start auto-refresh timers.
    if (!dataSources || interactionMode === 'inert') return

    const intervals: ReturnType<typeof setInterval>[] = []

    for (const source of dataSources) {
      if (source.refreshInterval && source.refreshInterval > 0) {
        const interval = setInterval(() => {
          void refreshSource(source.id)
        }, source.refreshInterval)
        intervals.push(interval)
      }
    }

    return () => {
      for (const interval of intervals) {
        clearInterval(interval)
      }
    }
  }, [dataSources, refreshSource, interactionMode])

  // ---- Build expression context ----
  const expressionData = React.useMemo(() => {
    const ctx: Record<string, unknown> = { state: surfaceState }
    // Per-source loading flags for skeleton UIs: `{{__loading.<sourceId>}}` /
    // `{{__anyLoading}}`. A declared source with no sourceData entry yet has
    // not even started its first fetch (the fetch effect runs after first
    // paint) — report it as loading so a skeleton shows from frame one
    // instead of flashing the block's empty state. `state`-kind sources read
    // synchronously from React state and are never "loading".
    const loadingMap: Record<string, boolean> = {}
    let anyLoading = false
    // Per-source errors — `{{__errors.<sourceId>}}` — so a block can
    // distinguish "fetch failed" from "fetched, genuinely empty" instead of
    // showing a false empty-state. The value is a reason code (truthy; the
    // page writes its own words for it); null when healthy. The HTTP status
    // is `{{__errorCodes.<sourceId>}}` (source-failure).
    const errorMap: Record<string, SourceFailureReason | null> = {}
    const errorCodeMap: Record<string, SourceFailureCode | null> = {}
    let anyError = false
    // `{{__status.<id>}}` — the HTTP status of the last answer (200, 404, …);
    // null for a network failure, an idle source or a non-HTTP kind.
    // `{{__notFound.<id>}}` — status 404, so "no such order" and "connection
    // error" can be told apart. `{{__idle.<id>}}` — a REST source
    // not fetched because a required path value is empty.
    // `{{__meta.<id>}}` — the envelope `returns` unwrapped the list from
    // (`total`, `skip`, `limit` …); null when there is none.
    const statusMap: Record<string, number | null> = {}
    const notFoundMap: Record<string, boolean> = {}
    const idleMap: Record<string, boolean> = {}
    const metaMap: Record<string, Readonly<Record<string, unknown>> | null> = {}
    for (const source of dataSources ?? []) {
      const entry = sourceData[source.id]
      const loading =
        source.kind === 'state' || writeOnly?.has(source.id) === true ? false : entry ? entry.loading : true
      loadingMap[source.id] = loading
      if (loading) anyLoading = true
      const code = entry?.error ? (entry.errorCode ?? 'error') : null
      errorMap[source.id] = code === null ? null : sourceFailureReason(code)
      errorCodeMap[source.id] = code
      if (code !== null) anyError = true
      const status = entry?.status ?? null
      statusMap[source.id] = status
      notFoundMap[source.id] = status === 404
      idleMap[source.id] = entry?.idle === true
      metaMap[source.id] = entry?.meta ?? null
    }
    /**
     * A LIST SOURCE ALWAYS BINDS AS A LIST.
     *
     * The entity path returns `result.items` — an array. The rest path
     * returned the whole JSON body, or, since `returns` landed, the plucked
     * value. So the same block bound to `{{data.Product}}` received an array
     * from our store and an object from anyone else's, and swapping a model
     * from platform to a connection quietly changed what every bound block
     * got. One shape.
     *
     * `static` and `state` are the documented exceptions and stay untouched:
     * a state source is routinely a scalar, and wrapping it would break every
     * shipped surface that reads one.
     */
    const LIST_KINDS = new Set(['rest', 'entity', 'graphql'])
    const kindById = new Map((dataSources ?? []).map((s) => [s.id, s.kind]))
    // An AGGREGATE source is one number, not a list of one: wrapping
    // `{ value }` into `[{ value }]` would still read through the single-
    // element fallthrough, but `.length` would lie and `count` would hide.
    // Entity-only: that is the one branch that reads `aggregate`; a rest
    // source carrying the key still fetches a list and binds as one.
    const aggregateIds = new Set(
      (dataSources ?? []).filter((s) => s.kind === 'entity' && s.aggregate !== undefined).map((s) => s.id)
    )
    for (const [key, value] of Object.entries(sourceData)) {
      const listy = LIST_KINDS.has(kindById.get(key) ?? '') && !aggregateIds.has(key)
      ctx[key] =
        listy && value.data != null && !Array.isArray(value.data) ? [value.data] : value.data
    }
    ctx['__loading'] = loadingMap
    ctx['__anyLoading'] = anyLoading
    ctx['__errors'] = errorMap
    ctx['__errorCodes'] = errorCodeMap
    ctx['__anyError'] = anyError
    ctx['__status'] = statusMap
    ctx['__notFound'] = notFoundMap
    ctx['__idle'] = idleMap
    ctx['__meta'] = metaMap
    return ctx
  }, [surfaceState, sourceData, dataSources, writeOnly])

  return {
    expressionData,
    surfaceState,
    initialLoaded,
    setStateValue,
    refreshSource,
    fetchAllSources,
  }
}

// ============================================================
// canonicalizeEventType
// ============================================================

/**
 * Normalize a stored behavior trigger string to canonical colon form.
 * - Already has `:` → return lowercased/trimmed as-is
 * - Has `.` → replace first `.` with `:`
 * - Otherwise → return trimmed lowercased (best-effort; won't match well-formed events)
 */
export function canonicalizeEventType(raw: string): string {
  const s = raw.trim().toLowerCase()
  if (s.includes(':')) return s
  if (s.includes('.')) return s.replace('.', ':')
  return s
}

// ============================================================
// behaviorTargets
// ============================================================

/**
 * Whether a behavior aimed at `targetBlockId` hears an event from `blockId`.
 *
 * A block inside a `repeat` is drawn once per row, each copy with the id
 * `<id>--<index>` (`<id>--<outer>--<inner>` in a nested repeat) — the id the
 * event carries. The receipt can only name the TEMPLATE id; matching it
 * exactly meant a behavior aimed at a repeated block never fired. The
 * template id names every copy; a copy id still names that one copy.
 */
export function behaviorTargets(targetBlockId: string, blockId: string): boolean {
  if (blockId === targetBlockId) return true
  if (!blockId.startsWith(`${targetBlockId}--`)) return false
  return /^(--\d+)+$/.test(blockId.slice(targetBlockId.length))
}

// ============================================================
// isSurfaceAction
// ============================================================

export function isSurfaceAction(value: unknown): value is SurfaceAction {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    obj.type === 'setState' ||
    obj.type === 'refresh' ||
    obj.type === 'refreshAll' ||
    obj.type === 'showBlock' ||
    obj.type === 'hideBlock' ||
    obj.type === 'navigate' ||
    obj.type === 'write' ||
    isAuthAction(value)
  )
}

/**
 * Guard the `navigate` action against XSS: only http(s) absolute URLs and
 * relative/anchor URLs may be navigated to. A scheme like `javascript:`,
 * `data:`, or `vbscript:` is rejected so a stored behavior cannot execute
 * script in a published-surface visitor's context. Control characters are
 * stripped first to defeat `java\tscript:`-style scheme smuggling.
 */
export function isSafeNavigateUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  if (readableUrl(url) === '') return false
  const s = urlSchemeOf(url)
  if (s === null) return true // relative path / query / hash / protocol-relative
  return s === 'http' || s === 'https'
}

// ============================================================
// DataBoundSurfaceRenderer COMPONENT
// ============================================================

/**
 * Data-bound surface renderer.
 *
 * If nothing on the surface is dynamic (see surfaceNeedsDataBinding), renders
 * SurfaceRenderer directly (zero overhead).
 * Otherwise, wraps with DataCapabilityProvider for DataService context, then
 * fetches data, manages state, resolves expressions, and intercepts events.
 */
export function DataBoundSurfaceRenderer(props: DataBoundSurfaceRendererProps): React.ReactElement {
  const { surface, onEvent, behaviors: hostBehaviors, onNavigateAction, onTitle, onDescription, dataServiceConfig, identity: auth, ...rest } = props
  const { blocks, appearance, capabilities, title, description } = surface
  // dataSources + initialState + declared behaviors live under platform/persistence config
  const { dataSources, initialState, behaviors: declaredBehaviors } = extractPersistenceSeeds(surface)
  // Declared (JSON) first, host (its store) after — same id in both: host wins.
  const behaviors = React.useMemo<readonly RuntimeBehavior[] | undefined>(() => {
    if (!declaredBehaviors?.length) return hostBehaviors
    if (!hostBehaviors?.length) return declaredBehaviors
    const hostIds = new Set(hostBehaviors.map((b) => b.id))
    return [...declaredBehaviors.filter((b) => !hostIds.has(b.id)), ...hostBehaviors]
  }, [declaredBehaviors, hostBehaviors])
  const hasBehaviors = Boolean(behaviors && behaviors.length > 0)
  const dataBound = hasBehaviors || surfaceNeedsDataBinding(surface)

  // A page with nothing dynamic still has a title; one with expressions in it
  // is resolved by DataBoundInner, against what has loaded.
  const literalTitle =
    !dataBound && typeof title === 'string' && title.trim() && !title.includes('{{') ? title : undefined
  React.useEffect(() => {
    if (!dataBound) onTitle?.(literalTitle)
  }, [dataBound, literalTitle, onTitle])
  const literalDescription =
    !dataBound && typeof description === 'string' && description.trim() && !description.includes('{{') ? description : undefined
  React.useEffect(() => {
    if (!dataBound) onDescription?.(literalDescription)
  }, [dataBound, literalDescription, onDescription])

  // Nothing dynamic — no sources, no state, no behaviors, no form bindings, no
  // block action: pass through directly (zero overhead). Write-only surfaces
  // (formBindings without any read source) and state-only wizards must NOT
  // take it — see surfaceNeedsDataBinding() and hasEntityFormBindings().
  if (!dataBound) {
    const passthrough: RenderableSurface = {
      // `id` FORWARDED, not dropped. SurfaceRenderer derives its scope from
      // `surface.id`: with an id the per-surface rules key off the attribute
      // VALUE (`[data-pw-surface="<id>"]`), without one they fall back to the
      // value-less `[data-pw-surface]` and every surface in a document shares
      // them. Rebuilding the surface object here silently erased the id, so the
      // scoping degraded on this path while looking correct in the source.
      ...(surface.id !== undefined ? { id: surface.id } : {}),
      blocks,
      ...(appearance !== undefined ? { appearance } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
    }
    // A static page still has the shell's account control, whose event
    // carries its `auth:*` action (`payload.action`): handed to the host here
    // as the data-bound path's dispatcher would.
    const passthroughEvent =
      auth?.onAction && rest.interactionMode !== 'inert'
        ? (event: SurfaceEvent): void => {
            const action = (event.payload as { action?: unknown } | undefined)?.action
            if (isAuthAction(action)) performAuthAction(auth, action, eventValues(event))
            onEvent?.(event)
          }
        : onEvent
    return passthroughEvent ? (
      <SurfaceRenderer surface={passthrough} onEvent={passthroughEvent} {...rest} />
    ) : (
      <SurfaceRenderer surface={passthrough} {...rest} />
    )
  }

  // Wrap with DataCapabilityProvider to provide DataService context
  return (
    <DataCapabilityProvider {...(dataServiceConfig ? { config: dataServiceConfig } : {})}>
      {onEvent ? (
        <DataBoundInner
          {...(surface.id !== undefined ? { surfaceId: surface.id } : {})}
          blocks={blocks}
          dataSources={dataSources ?? []}
          initialState={initialState}
          appearance={appearance}
          capabilities={capabilities}
          {...(behaviors !== undefined ? { behaviors } : {})}
          {...(onNavigateAction !== undefined ? { onNavigateAction } : {})}
          {...(title !== undefined ? { title } : {})}
          {...(onTitle !== undefined ? { onTitle } : {})}
          {...(description !== undefined ? { description } : {})}
          {...(onDescription !== undefined ? { onDescription } : {})}
          {...(auth !== undefined ? { auth } : {})}
          onEvent={onEvent}
          rendererProps={rest}
        />
      ) : (
        <DataBoundInner
          {...(surface.id !== undefined ? { surfaceId: surface.id } : {})}
          blocks={blocks}
          dataSources={dataSources ?? []}
          initialState={initialState}
          appearance={appearance}
          capabilities={capabilities}
          {...(behaviors !== undefined ? { behaviors } : {})}
          {...(onNavigateAction !== undefined ? { onNavigateAction } : {})}
          {...(title !== undefined ? { title } : {})}
          {...(onTitle !== undefined ? { onTitle } : {})}
          {...(description !== undefined ? { description } : {})}
          {...(onDescription !== undefined ? { onDescription } : {})}
          {...(auth !== undefined ? { auth } : {})}
          rendererProps={rest}
        />
      )}
    </DataCapabilityProvider>
  )
}

// ============================================================
// DataBoundInner (split to allow hooks — needs DataCapabilityProvider ancestor)
// ============================================================

interface DataBoundInnerProps {
  /** The surface's scope id — threaded through because this component receives
   * the surface DECOMPOSED into pieces, and `id` was never one of the pieces.
   * Without it the rebuilt surface below has no id and SurfaceRenderer falls
   * back to the value-less `[data-pw-surface]` scope. */
  surfaceId?: string
  blocks: readonly Block[]
  dataSources: readonly SurfaceDataSourceDefinition[]
  initialState: Readonly<Record<string, unknown>> | undefined
  appearance?: RenderableSurface['appearance']
  capabilities?: RenderableSurface['capabilities']
  onEvent?: (event: SurfaceEvent) => void
  behaviors?: readonly RuntimeBehavior[]
  onNavigateAction?: (url: string) => boolean
  title?: string
  onTitle?: (title: string | undefined) => void
  description?: string
  onDescription?: (description: string | undefined) => void
  auth?: SurfaceAuthHost
  rendererProps: Omit<SurfaceRendererProps, 'surface' | 'onEvent'>
}

function DataBoundInner({
  surfaceId,
  blocks,
  dataSources,
  initialState,
  appearance,
  capabilities,
  onEvent,
  behaviors,
  onNavigateAction,
  title,
  onTitle,
  description,
  onDescription,
  auth,
  rendererProps,
}: DataBoundInnerProps): React.ReactElement {
  const interactionMode = rendererProps.interactionMode ?? 'live'
  const entityFacade = (rendererProps as { entityFacade?: EntityFacade }).entityFacade
  // Same pass-through route as entityFacade: declared on
  // DataBoundSurfaceRendererProps, travels inside rendererProps.
  const loadingStrategy =
    (rendererProps as { loadingStrategy?: 'gate' | 'immediate' }).loadingStrategy ?? 'gate'
  // Connections context travels the same pass-through route
  // (declared on SurfaceRendererProps, so it also reaches SurfaceRenderer's
  // SurfaceConnectionsContext provider via the rendererProps spread below).
  const connections = (rendererProps as { connections?: SurfaceConnectionsValue }).connections
  const dataCache = (rendererProps as { dataCache?: SurfaceDataCache }).dataCache
  const linkHref = (rendererProps as { linkHref?: LinkHref }).linkHref
  const locale = (rendererProps as { locale?: string }).locale
  // Keyed by the ids, so a re-render that changes nothing hands useSurfaceData
  // the same set (its expression context depends on it).
  const writeOnlyKey = React.useMemo(
    () => [...writeOnlySourceIds({ blocks, dataSources, capabilities, behaviors })].sort().join('\n'),
    [blocks, dataSources, capabilities, behaviors]
  )
  const writeOnly = React.useMemo<ReadonlySet<string>>(
    () => new Set(writeOnlyKey === '' ? [] : writeOnlyKey.split('\n')),
    [writeOnlyKey]
  )
  const { expressionData: pageData, surfaceState, initialLoaded, setStateValue, refreshSource, fetchAllSources } =
    useSurfaceData(dataSources, initialState, interactionMode, entityFacade, connections, dataCache, writeOnly)
  // WHO IS SIGNED IN, beside the page's data: `{{__auth.*}}` and its shorthand
  // `{{me.*}}` (= `__auth.user`). The host's state, read-only — no source
  // fetches it and no action writes it.
  const authState = auth?.state ?? SIGNED_OUT
  const expressionData = React.useMemo<Record<string, unknown>>(
    () => ({ ...pageData, __auth: authState, me: authState.user }),
    [pageData, authState]
  )
  // The page scope as bound NOW, for actions resolved at dispatch time.
  const expressionDataRef = React.useRef(expressionData)
  expressionDataRef.current = expressionData

  // THE TITLE OF THIS RECORD'S PAGE. `{{dish.0.name}}` is the dish once it
  // has loaded; until then (or when it resolves to nothing) the host shows
  // its own. A title an expression could not resolve stays unreported rather
  // than putting braces in the tab.
  const resolveText = React.useCallback(
    (template: string | undefined): string | undefined => {
      if (typeof template !== 'string' || !template.trim()) return undefined
      const value = resolveValueIn(template, expressionData, locale ? { locale } : {})
      if (value === undefined || value === null) return undefined
      const text = String(value).trim()
      return text === '' || text.includes('{{') ? undefined : text
    },
    [expressionData, locale]
  )
  const resolvedTitle = React.useMemo(() => resolveText(title), [resolveText, title])
  React.useEffect(() => {
    onTitle?.(resolvedTitle)
  }, [resolvedTitle, onTitle])
  // The page's description, the same way (its <meta name="description">).
  const resolvedDescription = React.useMemo(() => resolveText(description), [resolveText, description])
  React.useEffect(() => {
    onDescription?.(resolvedDescription)
  }, [resolvedDescription, onDescription])

  // The `write` action's way to a source — the same one a form binding uses.
  const dataService = useDataService()
  const writeRecord = React.useMemo(
    () => createSourceWriter({ dataSources, entityFacade, dataService }),
    [dataSources, entityFacade, dataService]
  )

  /**
   * THE WRITE ACTION: one record created, updated or deleted, the page state
   * driven through its lifecycle like a form's, and every source fetched
   * again afterwards so what the page shows is what the server now holds. The
   * server decides whether the caller may (access rules); a refusal is a
   * failed write: its reason code, the refused fields and the detail.
   */
  const runWrite = React.useCallback(
    async (action: WriteAction) => {
      const sk = action.statusKeys
      if (sk?.loading) setStateValue(sk.loading, true)
      if (sk?.success) setStateValue(sk.success, false)
      if (sk?.error) setStateValue(sk.error, false)
      if (sk?.reason) setStateValue(sk.reason, '')
      if (sk?.fields) setStateValue(sk.fields, [])
      if (sk?.detail) setStateValue(sk.detail, '')
      const id = action.id === undefined || action.id === null || action.id === '' ? undefined : String(action.id)
      const result = await writeRecord(action.sourceId, {
        op: action.op,
        ...(id !== undefined ? { id } : {}),
        ...(action.values ? { values: action.values } : {}),
      })
      if (sk?.loading) setStateValue(sk.loading, false)
      if (result.success) {
        if (sk?.success) setStateValue(sk.success, true)
        await fetchAllSources()
        return
      }
      if (sk?.error) setStateValue(sk.error, true)
      if (sk?.reason) setStateValue(sk.reason, writeFailureReason(result.error))
      if (sk?.fields) setStateValue(sk.fields, writeFailureFields(result.error))
      const detail = writeFailureDetail(result.error)
      if (sk?.detail) setStateValue(sk.detail, detail)
      console.warn(`[surface] write to "${action.sourceId}" failed: ${detail}`)
    },
    [writeRecord, setStateValue, fetchAllSources]
  )

  // The page's address (render/address.ts): its declared `urlState` keys are
  // written back there, and a record source that finds nothing says so.
  const hostAddress = (rendererProps as { address?: SurfaceAddress }).address
  const ownAddress = React.useMemo(() => hostAddress ?? documentAddress(), [hostAddress])
  const urlState = React.useMemo(() => extractPersistenceSeeds({ capabilities }).urlState, [capabilities])
  useUrlStateSync(urlState, surfaceState, ownAddress, interactionMode)
  useNotFoundReport(dataSources, expressionData, ownAddress, interactionMode)

  // The props each block's manifest declares `bindable: false` stay as
  // written; the descriptors the host handed the renderer carry them.
  const { blocks: descriptors } = useDynamicBlocks()
  const literalProps = React.useMemo(() => literalPropsOf(descriptors.values()), [descriptors])

  // Resolve expressions in blocks
  const resolvedBlocks = React.useMemo(
    () =>
      resolveBlockExpressions(blocks as Block[], expressionData, undefined, {
        literalProps,
        ...(linkHref ? { linkHref } : {}),
        ...(locale ? { locale } : {}),
      }),
    [blocks, expressionData, linkHref, literalProps, locale]
  )

  // Shared action dispatcher. `values` are the fields of the form whose
  // submit fired the action — an `auth:*` action hands them to the host.
  const dispatchAction = React.useCallback(
    (action: SurfaceAction, values?: Readonly<Record<string, unknown>>) => {
      switch (action.type) {
        case 'setState':
          setStateValue(action.key, action.value)
          break
        case 'refresh':
          refreshSource(action.sourceId)
          break
        case 'refreshAll':
          fetchAllSources()
          break
        case 'showBlock':
          setStateValue('__show:' + action.blockId, true)
          break
        case 'hideBlock':
          setStateValue('__show:' + action.blockId, false)
          break
        case 'navigate':
          // Give the host a chance to handle this in place first (e.g. a
          // connected-preview mode swapping to a sibling page) before falling
          // through to a real hard navigation.
          if (onNavigateAction?.(action.url)) break
          if (isSafeNavigateUrl(action.url)) {
            window.location.assign(action.url)
          } else {
            console.warn('[surface] blocked unsafe navigate URL:', action.url)
          }
          break
        case 'write':
          void runWrite(action)
          break
        case 'auth:signIn':
        case 'auth:register':
        case 'auth:signOut':
          performAuthAction(auth, action, values)
          break
      }
    },
    [setStateValue, refreshSource, fetchAllSources, onNavigateAction, runWrite, auth]
  )

  /**
   * A BEHAVIOR'S ACTIONS ARE RESOLVED AT DISPATCH, against the page scope as
   * it is when the event fires: `{ navigate, url: "/dish?id={{state.dish}}" }`
   * goes to that dish, `{ setState, value: "{{state.count + 1}}" }` writes the
   * number. They used to pass as written, so the braces went into the URL and
   * into state. A block's own `action` prop needs none of this: it is
   * resolved with the block's other props (inside a repeat, per row).
   */
  const resolveBehaviorAction = React.useCallback(
    (action: SurfaceAction): SurfaceAction =>
      resolveValueIn(action, expressionDataRef.current, {
        ...(linkHref ? { linkHref } : {}),
        ...(locale ? { locale } : {}),
      }) as SurfaceAction,
    [linkHref, locale]
  )

  // Event interceptor
  const handleEvent = React.useCallback(
    (event: SurfaceEvent) => {
      // Inert (editor/preview): skip block-dispatched surface actions (state
      // mutations / data refreshes) so the surface doesn't mutate its own state
      // while authoring. `onEvent` is a pure notification and STILL fires below
      // — only the real data side-effects are gated.
      if (interactionMode !== 'inert') {
        // Check if the event payload contains a surface action
        const payload = event.payload as Record<string, unknown> | undefined
        const action = payload?.action

        if (isSurfaceAction(action)) {
          dispatchAction(action, eventValues(event))
        }

        // `canonicalType` is normally stamped by the bus bridge (renderer.tsx's
        // busOnEvent), but some deployed block bundles still call
        // `context.onEvent` directly (the pre-bus legacy path) — for those,
        // `canonicalType` is absent. Block-scoped click events reaching here
        // always mean a real click occurred, so treat a canonicalType-less
        // 'click' as 'block:click' rather than silently dropping it.
        const fired = event.canonicalType ?? (event.type === 'click' && event.blockId ? 'block:click' : '')

        // A block's own `action` prop (one action or a list, run in order) is
        // what its CLICK does — and only its click. It used to run on every
        // event the block emitted, so a block that also reported hover, focus
        // or a value change would have fired its click action on each of them.
        // Looked up in the RESOLVED tree, so a repeat clone (`id--N`) carries
        // its own row's values.
        if (fired === 'block:click') {
          blockActionsOf(findBlockAction(resolvedBlocks, event.blockId)).forEach((a) => dispatchAction(a))
        }

        // Execute stored behaviors whose trigger matches this canonical event.
        if (behaviors && behaviors.length > 0) {
          for (const b of behaviors) {
            if (canonicalizeEventType(b.event) !== fired) continue
            if (b.targetBlockId && !behaviorTargets(b.targetBlockId, event.blockId)) continue
            for (const action of b.actions) dispatchAction(resolveBehaviorAction(action), eventValues(event))
          }
        }
      }

      // Forward to original handler — a pure notification, always fires (the
      // host decides what side-effects, if any, to run).
      onEvent?.(event)
    },
    [interactionMode, onEvent, dispatchAction, resolvedBlocks, behaviors, resolveBehaviorAction]
  )

  // The gate's one word is the app's (`ui.loading`), like every word a
  // visitor reads (envelope §2).
  const loadingLabel = useAppMessage('ui.loading', 'Loading…')

  // Loading state — 'gate' strategy only (the historical default): the whole
  // block tree is withheld until the first fetch pass settles. 'immediate'
  // skips this and renders the tree at once; unresolved bindings evaluate to
  // undefined and fill in per source (see loadingStrategy prop docs).
  if (!initialLoaded && loadingStrategy !== 'immediate') {
    return (
      <div
        data-surface-loading
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '48px',
          // Theme-tokened with the old hardcoded values as fallbacks, so the
          // gate no longer paints light-theme blue on a dark-themed surface.
          color: 'var(--pw-color-text-muted, #666)',
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid var(--pw-color-border, #e5e7eb)',
              borderTopColor: 'var(--pw-color-primary, #3b82f6)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto 12px',
            }}
          />
          {loadingLabel}
        </div>
      </div>
    )
  }

  const resolvedSurface: RenderableSurface = {
    // See the passthrough branch above — same reason, same one-line omission.
    ...(surfaceId !== undefined ? { id: surfaceId } : {}),
    blocks: resolvedBlocks,
    ...(appearance !== undefined ? { appearance } : {}),
    ...(capabilities !== undefined ? { capabilities } : {}),
  }
  return (
    // What is bound right now, for the providers under SurfaceRenderer that
    // must act on it — the form writer decides create-vs-update from the
    // record a source has loaded, and could not see one before this.
    <SurfaceDataContext.Provider value={expressionData}>
      <SurfaceLinkHrefContext.Provider value={linkHref ?? null}>
        {/* A split shell's selection is page state too (`state.<selectionKey>`). */}
        <SurfaceRenderer surface={resolvedSurface} onEvent={handleEvent} {...rendererProps} onSelection={setStateValue} />
      </SurfaceLinkHrefContext.Provider>
    </SurfaceDataContext.Provider>
  )
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Find the action prop of a block by ID in the resolved block tree.
 */
function findBlockAction(blocks: readonly Block[], blockId: string): unknown {
  for (const block of blocks) {
    if (block.id === blockId) {
      return block.props?.action
    }
    if (block.children) {
      const found = findBlockAction(block.children, blockId)
      if (found !== undefined) return found
    }
  }
  return undefined
}
