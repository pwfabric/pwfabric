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
import { resolveBlockExpressions } from './resolve-expressions.js'
import { endpointMissingPathValue, resolveEndpoint } from './endpoint.js'
import { resolveQueryState } from './query-state.js'
import { dataSourceCacheKey, type SurfaceDataCache } from './data-cache.js'
import { DataCapabilityProvider, useDataService } from '../data/DataCapabilityProvider.js'
import type {
  DataBoundSurfaceRendererProps,
  SurfaceDataSourceDefinition,
  SurfaceAction,
  RuntimeBehavior,
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
import { SurfaceDataContext } from './surface-data-context.js'
import type { EntityFacade } from '../entity/facade.js'
import type { EntityAggregate, EntityQuery, EntityTypeId } from '../entity/types.js'
import type { SurfaceConnectionsValue } from '../connectors/types.js'
import { PLATFORM_PERSISTENCE_CAPABILITY_ID } from '@pwfabric/contracts'
import { isCapability } from '../capability/type-mapping.js'
import { writeOnlySourceIds } from './write-only-sources.js'

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
} {
  const binding = surface.capabilities?.find(
    (c) => isCapability(c, PLATFORM_PERSISTENCE_CAPABILITY_ID)
  )
  const cfg = binding?.config as
    | {
        dataSources?: readonly SurfaceDataSourceDefinition[]
        initialState?: Readonly<Record<string, unknown>>
        behaviors?: readonly RuntimeBehavior[]
      }
    | undefined
  return {
    dataSources: cfg?.dataSources,
    initialState: cfg?.initialState,
    // Declared behaviors (shipped by a pattern / authored in JSON). The
    // renderer merges these with host-provided behaviors (the host's store) so a pack
    // can carry its own controls without the host knowing about them.
    behaviors: cfg?.behaviors,
  }
}

/**
 * A source that could not be served but declares a `fallback`: the caller
 * binds `data` AND records `message` under `__errors.<id>`, so the surface
 * renders honestly (sample data + error flag) instead of empty or crashed.
 */
class SourceFallback extends Error {
  constructor(
    message: string,
    readonly data: unknown
  ) {
    super(message)
    this.name = 'SourceFallback'
  }
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
    blockTreeHasCondition(surface.blocks)
  )
}

// ============================================================
// TYPES
// ============================================================

interface SourceData {
  readonly data: unknown
  readonly loading: boolean
  readonly error: string | null
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
  | { readonly kind: 'error'; readonly message: string; readonly status: number | null; readonly fallback?: { readonly data: unknown } }

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
  const [sourceData, setSourceData] = React.useState<Record<string, SourceData>>(() => {
    if (!dataCache || !dataSources) return {}
    const seeded: Record<string, SourceData> = {}
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
        status,
        // fallback declared → bind it; the error stays visible next to it
        ...(err instanceof SourceFallback ? { fallback: { data: err.data } } : {}),
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
        // connection (or no registry at all) falls through to today's
        // default facade path.
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
        // Any failure below binds `fallback` (when declared) and still reports
        // the error — see SourceFallback.
        const fail = (message: string): never => {
          if (source.fallback !== undefined) throw new SourceFallback(message, source.fallback)
          throw new Error(message)
        }
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
                  return fail(agg.error)
                }
                const res = await engine.query(entityType, (query ?? {}) as EntityQuery)
                if (res.success) return { kind: 'ok', data: res.result.items, status: null, meta: null }
                return fail(res.error)
              }
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
              return fail(`Connector '${source.connector}' is not connected`)
            }
          }

          const facade = entityFacadeRef.current
          if (!facade) {
            return source.fallback !== undefined
              ? fail('No entity facade available')
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
                return fail(err instanceof Error ? err.message : String(err))
              }
            }
            // A facade from before `resolveAggregate` lists; the rows it
            // returns are reduced here, same as a list-only engine.
            const viaList = await aggregateThrough(
              { query: async (t, q) => ({ success: true, result: await facade.resolveBinding(t, q) }) },
              entityType,
              aggregate
            )
            if (!viaList.success) return fail(viaList.error)
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
            return fail(err instanceof Error ? err.message : String(err))
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
      return failed(new Error(result.error.message), result.error.status ?? null)
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
            outcome = { kind: 'error', message: err instanceof Error ? err.message : String(err), status: null }
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
    // Per-source error messages — `{{__errors.<sourceId>}}` — so a block can
    // distinguish "fetch failed" from "fetched, genuinely empty" instead of
    // showing a false empty-state. The value is the error MESSAGE string
    // (truthy check + tooltip content in one binding); null when healthy.
    const errorMap: Record<string, string | null> = {}
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
      const error = entry?.error ?? null
      errorMap[source.id] = error
      if (error) anyError = true
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
    obj.type === 'navigate'
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
  const stripped = url.replace(/[^!-~]/g, '')
  if (stripped === '') return false
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(stripped)
  if (!scheme) return true // relative path / query / hash / protocol-relative
  const s = (scheme[1] ?? '').toLowerCase()
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
  const { surface, onEvent, behaviors: hostBehaviors, onNavigateAction, dataServiceConfig, ...rest } = props
  const { blocks, appearance, capabilities } = surface
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

  // Nothing dynamic — no sources, no state, no behaviors, no form bindings, no
  // block action: pass through directly (zero overhead). Write-only surfaces
  // (formBindings without any read source) and state-only wizards must NOT
  // take it — see surfaceNeedsDataBinding() and hasEntityFormBindings().
  if (!hasBehaviors && !surfaceNeedsDataBinding(surface)) {
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
    return onEvent ? (
      <SurfaceRenderer surface={passthrough} onEvent={onEvent} {...rest} />
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
  const { expressionData, initialLoaded, setStateValue, refreshSource, fetchAllSources } =
    useSurfaceData(dataSources, initialState, interactionMode, entityFacade, connections, dataCache, writeOnly)

  // Resolve expressions in blocks
  const resolvedBlocks = React.useMemo(
    () => resolveBlockExpressions(blocks as Block[], expressionData),
    [blocks, expressionData]
  )

  // Shared action dispatcher — handles all six action types
  const dispatchAction = React.useCallback(
    (action: SurfaceAction) => {
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
      }
    },
    [setStateValue, refreshSource, fetchAllSources, onNavigateAction]
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
          dispatchAction(action)
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
          blockActionsOf(findBlockAction(resolvedBlocks, event.blockId)).forEach(dispatchAction)
        }

        // Execute stored behaviors whose trigger matches this canonical event.
        if (behaviors && behaviors.length > 0) {
          for (const b of behaviors) {
            if (canonicalizeEventType(b.event) !== fired) continue
            if (b.targetBlockId && b.targetBlockId !== event.blockId) continue
            b.actions.forEach(dispatchAction)
          }
        }
      }

      // Forward to original handler — a pure notification, always fires (the
      // host decides what side-effects, if any, to run).
      onEvent?.(event)
    },
    [interactionMode, onEvent, dispatchAction, resolvedBlocks, behaviors]
  )

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
          Loading data...
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
      <SurfaceRenderer surface={resolvedSurface} onEvent={handleEvent} {...rendererProps} />
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
