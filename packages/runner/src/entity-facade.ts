/**
 * Entity facade wiring — adapted from an earlier React useEntityFacade.ts +
 * extractEntityTypes.ts pair, framework-free: a plain builder called per route instead of a
 * React hook, with the connections read from the pwpack's `connections.json`
 * at runtime instead of a compiled-in import.
 *
 * Registers one EntityDefinition per requested {entityType, connector} pair
 * with a passthrough schema — EntityStore.query() never validates against it
 * (only create/update do).
 *
 * @module @pwfabric/runner/entity-facade
 */

import { z } from 'zod'
import type { EntityConnector, EntityDefinition, EntityFacade, EntityTypeId } from '@pwfabric/runtime'

/**
 * Runtime VALUE access goes through the embed-seeded global, NOT a named
 * import: the import-map shim files are hand-maintained partial lists, and a
 * missing named export fails the WHOLE runner module at link time (observed
 * live: `createEntityFacade` absent from `shims/runtime.mjs` blanked every
 * page). `embed.js` seeds the FULL runtime namespace on
 * `globalThis.__pwfabric_runtime`, so property access is both complete and
 * shim-proof. Types still come from the real package (erased at build).
 */
function runtimeNs(): Record<string, unknown> {
  return (
    (globalThis as { __pwfabric_runtime?: Record<string, unknown> }).__pwfabric_runtime ?? {}
  )
}

type FacadeWithWiring = EntityFacade & {
  readonly registry: { register: (def: EntityDefinition) => void }
  readonly connectors: { register: (connector: EntityConnector) => void }
}

type CreateEntityFacade = (options?: { registry?: unknown; store?: unknown }) => FacadeWithWiring

type CreateDeclaredConnector = (options: {
  name: string
  declaration: unknown
  config: Record<string, unknown>
  getAccessToken: () => Promise<string | null>
}) => EntityConnector

/**
 * Resolved off the embed-seeded global for the SAME reason `createEntityFacade`
 * is (see the note above): the import-map shims are a hand-maintained partial
 * list, and a missing named export fails this whole module at link time.
 */
function createDeclared(options: Parameters<CreateDeclaredConnector>[0]): EntityConnector {
  const fn = runtimeNs()['createDeclaredConnector']
  if (typeof fn !== 'function') {
    throw new Error('__pwfabric_runtime.createDeclaredConnector is missing — the runtime is too old')
  }
  return (fn as CreateDeclaredConnector)(options)
}

function resolveCreateEntityFacade(): CreateEntityFacade | null {
  const fn = runtimeNs()['createEntityFacade']
  return typeof fn === 'function' ? (fn as CreateEntityFacade) : null
}
import type { PwappConnections, PwappEngineManifest, SurfaceReceipt } from './types.js'

// ============================================================
// BINDING EXTRACTION (port of extractEntityTypes.ts)
// ============================================================

export interface EntityBinding {
  readonly entityType: string
  /** Which registered connector resolves this entityType. */
  readonly connector: string
}

/**
 * The connection a source falls back to when it names none.
 *
 * A NAME, not an engine: since the runner holds no vendor code at all,
 * and this string only says which declared connection to look for.
 */
const DEFAULT_CONNECTOR = 'graph-lists'

/**
 * Reads which real entityTypes a surface needs from its native
 * `platform/persistence` capability's `config.dataSources` (READ side) and
 * its `platform/entities` capability's `config.formBindings` (WRITE side —
 * form-only pages declare no read dataSources but EntityStore.create refuses
 * unregistered types). `connector` is a free-form extra field on the config;
 * missing defaults to `graph-lists`.
 */
/**
 * Does this entry name that capability, however it spelled itself?
 *
 * Both spellings occur: the short form (`persistence`, `navigation`,
 * `entities`) and the long one. The plan layer's contract types the short one;
 * the registry and the pack's capability atoms use the long one. A raw
 * comparison to `'platform/…'` would find no data source on a short-form
 * receipt, build no facade, and the published app would draw empty panels.
 *
 * RESOLVED OFF THE GLOBAL, not imported — the same law as `createDeclared` and
 * `createEntityFacade` above: the import-map shims are a hand-maintained
 * partial list, and one missing named export fails this whole module at link
 * time. An older runtime without the resolver degrades to exactly today's
 * behaviour rather than throwing.
 */
function capabilityIs(entry: { capability?: string } | null | undefined, id: string): boolean {
  const declared = entry?.capability
  if (typeof declared !== 'string') return false
  const canon = runtimeNs()['canonicalCapabilityId']
  if (typeof canon !== 'function') return declared === id
  const fn = canon as (v: string) => string | null
  const want = fn(id)
  return want !== null && fn(declared) === want
}

export function extractEntityTypes(surface: {
  readonly capabilities?: SurfaceReceipt['capabilities']
}): readonly EntityBinding[] {
  const binding = surface.capabilities?.find((c) => capabilityIs(c, 'platform/persistence'))
  const dataSources =
    (binding?.config?.dataSources as
      | readonly { id?: string; kind?: string; entityType?: string; connector?: string }[]
      | undefined) ?? []

  const seen = new Set<string>()
  const bindings: EntityBinding[] = []
  const add = (entityType: string | undefined, connector: string): void => {
    if (!entityType) return
    const key = `${connector}:${entityType}`
    if (seen.has(key)) return
    seen.add(key)
    bindings.push({ entityType, connector })
  }

  for (const d of dataSources) {
    if (d.kind !== 'entity' || !d.entityType) continue
    add(d.entityType, d.connector ?? DEFAULT_CONNECTOR)
  }

  /**
   * A form names a SOURCE now, so its write type is resolved through the
   * source list rather than read off the binding.
   *
   * A binding pointing at a `rest` source registers nothing here on purpose:
   * that write goes over HTTP and needs no entity registration. Only a
   * platform-backed source has a type for the store to know about.
   */
  const entitiesCap = surface.capabilities?.find((c) => capabilityIs(c, 'platform/entities'))
  const formBindings =
    (entitiesCap?.config?.formBindings as
      | readonly { sourceId?: string; connector?: string }[]
      | undefined) ?? []
  const sourceById = new Map(
    dataSources
      .filter((d): d is { id: string; kind?: string; entityType?: string; connector?: string } =>
        typeof (d as { id?: unknown }).id === 'string'
      )
      .map((d) => [d.id, d])
  )
  for (const fb of formBindings) {
    if (!fb.sourceId) continue
    const source = sourceById.get(fb.sourceId)
    if (source?.kind !== 'entity') continue
    add(source.entityType, fb.connector ?? source.connector ?? DEFAULT_CONNECTOR)
  }

  return bindings
}

// ============================================================
// FACADE BUILDER (adapted from useEntityFacade.ts)
// ============================================================

function minimalEntityDefinition(entityType: string): EntityDefinition {
  return {
    id: entityType as EntityTypeId,
    name: entityType,
    fields: [],
    relations: [],
    primaryKey: 'id',
    schema: z.object({}).passthrough(),
  }
}

/**
 * Builds a private, route-local EntityFacade from the pwpack's DECLARED
 * connections.
 *
 * The runner holds no engine of its own. Every engine arrives as a
 * declaration on the connection (built by `createDeclaredConnector`) or as a
 * bundle the registry loads, so a new API is a connection record rather than
 * code in the runner.
 *
 * A connection with NO declaration is skipped with a warning and its blocks
 * fall back to the renderer's anon/empty behaviour. That divergence is
 * deliberate and unchanged: the runner keeps rendering the page rather than
 * killing the whole app over a data-wiring gap. Never fake data here.
 *
 * Returns undefined when no binding could be wired (caller then omits
 * `entityFacade` so embed's offline stub logic applies unchanged).
 */
/**
 * Carry a DECLARED engine from `engines/manifest.json` onto its connection.
 *
 * THE SEAM. `buildEntityFacade` reads a declaration off the connection, as
 * `def.engine`. The assembler writes it into the engine manifest instead —
 * in the contract's own words, "the engine travels IN the manifest". Both are
 * defensible; having both would lose the declaration in the browser, because
 * `run-app` is the only place holding both documents and it turns the
 * manifest into registry bindings carrying `moduleUrl` and `integrity`.
 *
 * The manifest is the source and the connection is the destination: the
 * manifest is what publishing resolved, the connection is what the facade
 * reads. A connection that already carries its own engine keeps it — a
 * document that states something specific is not overruled by a general one.
 *
 * A manifest entry naming a connection the document never declared is NOT
 * invented here. It would arrive with no config, and its templates would
 * resolve to a request for `{baseUrl}`.
 */
export function withDeclaredEngines(
  connections: PwappConnections | null | undefined,
  manifest: PwappEngineManifest | null | undefined
): PwappConnections | null | undefined {
  if (!connections || !manifest || manifest.length === 0) return connections
  const declared = new Map<string, unknown>()
  for (const e of manifest) {
    if (e.engine !== undefined) declared.set(e.connection, e.engine)
  }
  if (declared.size === 0) return connections
  return {
    ...connections,
    connections: (connections.connections ?? []).map((c) => {
      const engine = declared.get(c.name)
      if (engine === undefined || (c as { engine?: unknown }).engine !== undefined) return c
      return { ...c, engine }
    }),
  }
}

/**
 * Does any shipped engine state that it needs NO identity?
 *
 * Behind `bridge && session` alone — a PKCE bridge and a live sign-in — the
 * entity facade would serve Microsoft Graph, which cannot answer without a
 * delegated token, but not a public API, which is what a plain REST
 * connection usually is: such an app has no door, therefore no bridge,
 * therefore no data path at all.
 *
 * Read from the declaration, never guessed. A BUNDLED engine is a module that
 * has told us nothing about its needs, so it stays behind the gate.
 */
/**
 * The facade and the registry must agree about which engines exist.
 *
 * `buildEntityFacade` constructs a DECLARED engine (a manifest entry carrying
 * `engine`, no bundle) itself and caches it; the registry only ever learns
 * BUNDLED engines through `configure`. `DataBoundSurfaceRenderer` asks the
 * registry first, and a source whose connector it reports `unregistered` —
 * while carrying a `fallback` — is drawn from the fallback without the facade
 * ever being consulted: a form would write to SharePoint through the facade
 * while the list reads never leave the page. Mirroring what the facade built
 * makes the two answer alike.
 *
 * Returns the names it registered; already-known connections are left alone.
 */
export function mirrorDeclaredEngines(
  registry:
    | { getStatus(connection: string): { state: string }; register(connection: string, engine: never): void }
    | null
    | undefined,
  cache: ReadonlyMap<string, EntityConnector>
): string[] {
  if (!registry) return []
  const mirrored: string[] = []
  for (const [name, instance] of cache) {
    if (registry.getStatus(name).state !== 'unregistered') continue
    registry.register(name, instance as never)
    mirrored.push(name)
  }
  return mirrored
}

export function needsNoIdentity(manifest: PwappEngineManifest | null | undefined): boolean {
  return (manifest ?? []).some(
    (e) => (e.engine as { auth?: { type?: string } } | undefined)?.auth?.type === 'none'
  )
}

/**
 * A bundled engine answers to ITS OWN name — `microsoft.users` says
 * `name: "graph"` — while the receipt binds entity types to the CONNECTION
 * name (`graph-users`). Registering the engine as it is and then binding by
 * connection name would throw `Connector 'graph-users' is not registered` out
 * of `registerEntity`, and that one throw would blank the whole page. The
 * connection name is the address the receipt uses; the engine
 * is delegated to under it. Same-named engines pass through untouched.
 */
export function aliasConnector(instance: EntityConnector, name: string): EntityConnector {
  if (instance.name === name) return instance
  return {
    name,
    type: instance.type,
    create: (t, d) => instance.create(t, d),
    read: (t, i) => instance.read(t, i),
    update: (t, i, d) => instance.update(t, i, d),
    delete: (t, i) => instance.delete(t, i),
    query: (t, q) => instance.query(t, q),
  }
}

export async function buildEntityFacade(
  bindings: readonly EntityBinding[],
  connections: PwappConnections | null | undefined,
  getAccessToken: () => Promise<string | null>,
  connectorCache?: Map<string, EntityConnector>,
  /**
   * The host's engine registry, when one exists.
   *
   * A connection's engine arrives in ONE OF TWO forms and this facade serves
   * both. A DECLARED engine is built here from its data. A BUNDLED engine is a
   * module the registry loads and verifies, and the facade has no loader of its
   * own — so it asks the registry rather than reimplementing it.
   *
   * Without it an app whose `graph-lists` engine is bundled would be refused
   * for want of a declaration, and every panel would fall to the anon path
   * with one honest warning and no data.
   */
  engines?: { resolve: (connection: string) => Promise<unknown> } | null
): Promise<EntityFacade | undefined> {
  if (bindings.length === 0) return undefined

  const createFacade = resolveCreateEntityFacade()
  if (!createFacade) {
    console.warn(
      '[pwapp] __pwfabric_runtime.createEntityFacade is missing — data sources will render the anonymous fallback'
    )
    return undefined
  }

  const defs = connections?.connections ?? []
  const facade = createFacade()
  const usedConnections = new Set(bindings.map((b) => b.connector))
  const registered = new Set<string>()

  for (const def of defs) {
    if (!usedConnections.has(def.name)) continue
    let instance = connectorCache?.get(def.name)
    if (!instance) {
      const declaration = (def as { engine?: unknown }).engine
      if (declaration) {
        try {
          instance = createDeclared({
            name: def.name,
            declaration: declaration as never,
            config: (def.config ?? {}) as Record<string, unknown>,
            getAccessToken,
          })
        } catch (err) {
          // A declaration naming an unknown transform throws at construction —
          // report it and keep the page alive, same law as every other gap here.
          console.warn(`[pwapp] connection "${def.name}": its engine could not be constructed: ${String(err)}`)
          usedConnections.delete(def.name)
          continue
        }
      } else if (engines) {
        // Bundled: the registry already loaded and verified the module. Asking
        // it is the whole point — the facade owns no loader and must not grow
        // one.
        const resolved = (await engines.resolve(def.name)) as EntityConnector | null
        if (!resolved) {
          console.warn(
            `[pwapp] connection "${def.name}": its engine could not be resolved — its blocks render the anonymous fallback`
          )
          usedConnections.delete(def.name)
          continue
        }
        instance = aliasConnector(resolved, def.name)
      } else {
        console.warn(
          `[pwapp] connection "${def.name}" carries neither an engine declaration nor a loaded engine — its blocks render the anonymous fallback`
        )
        usedConnections.delete(def.name)
        continue
      }
      connectorCache?.set(def.name, instance)
    }
    try {
      facade.connectors.register(instance)
    } catch (err) {
      // One connection's fault stays that connection's: its blocks draw the
      // anon fallback, the rest of the page renders. Before this, the throw
      // escaped `route()` and the visitor saw nothing at all.
      console.warn(`[pwapp] connection "${def.name}" could not be registered — its blocks render the anonymous fallback: ${String(err)}`)
      usedConnections.delete(def.name)
      continue
    }
    registered.add(def.name)
    usedConnections.delete(def.name)
  }

  if (usedConnections.size > 0) {
    console.warn(
      `[pwapp] connection(s) the receipts use are not registered in connections.json: ${[...usedConnections].join(', ')}`
    )
  }

  let any = false
  for (const { entityType, connector } of bindings) {
    if (!registered.has(connector)) continue
    try {
      facade.registerEntity(minimalEntityDefinition(entityType), connector)
      any = true
    } catch (err) {
      console.warn(`[pwapp] "${entityType}" → "${connector}" could not be bound — anonymous fallback: ${String(err)}`)
    }
  }
  return any ? facade : undefined
}
