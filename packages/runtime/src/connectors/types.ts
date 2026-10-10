/**
 * Connector Engine Types
 *
 * Platform-side vocabulary for CONNECTOR/PROVIDER atom engines. Two
 * consumption paths, ONE engine source:
 *
 * 1. dataSource path — a surface dataSource `{kind:'entity', entityType,
 *    connector:'graph-lists'}` routes through a `ConnectorEngineRegistry`:
 *    when a loaded engine is registered under that connection name the read
 *    goes through it (constructed with the world connection's config);
 *    absent engine/config keeps today's behavior (default facade or honest
 *    empty + `__errors` context), never a crash.
 * 2. engine-bridge path — pack blocks get their connections/config from the
 *    runtime-provided connections context (`SurfaceConnectionsContext`).
 *    On the platform the value comes from the project's connections doc +
 *    world connector rows; in the runner the existing `connections.json`
 *    path is unchanged. Single dialect — the source differs, the shape
 *    doesn't (mirrors the runner's `PwappConnection`).
 *
 * @module @pwfabric/runtime/connectors/types
 */

import type { EntityAggregate, EntityTypeId, EntityQuery } from '../entity/types.js'
import type { ConnectorAggregateResult, ConnectorQueryResult } from '../entity/connector.js'

// ============================================================
// ENGINE DESCRIPTOR (what the loader consumes)
// ============================================================

/**
 * Atom kinds that ship a connector engine bundle. `connector` = dynamic
 * data engine (e.g. graph-lists); `provider` = fixed-enum provider motor
 * facet (e.g. the single Graph motor behind graph-mail/graph-users/…).
 */
export type ConnectorEngineKind = 'connector' | 'provider'

/**
 * Descriptor for a loadable connector-engine atom bundle. Mirrors
 * `DynamicBlockDescriptor` with the AtomRef `bundleUrl`
 * vocabulary: the publish pipeline uploads the ESM bundle and stamps its
 * SHA-256 — integrity is verified BEFORE evaluation (security boundary,
 * same law as block bundles).
 */
export interface ConnectorEngineDescriptor {
  /** Atom id of the engine (e.g. 'graph-lists', 'microsoft-graph-motor'). */
  readonly id: string
  readonly kind: ConnectorEngineKind
  /** CDN URL of the ESM bundle produced by the publish pipeline. */
  readonly bundleUrl: string
  /** SHA-256 of the bundle bytes (bare hex or SRI `sha256-<base64>`). */
  readonly integrity: string
  readonly version?: string
}

// ============================================================
// ENGINE MODULE CONVENTION (what a bundle exports)
// ============================================================

/**
 * Per-call access-token supplier handed to an engine at construction —
 * exactly the signature the existing engines already take
 * (GraphListConnector / createGraphConnector). Re-invoked on every request
 * so token rotation is transparent. Resolving to `null` means
 * unauthenticated — engines degrade honestly (anon/empty), they do not
 * throw at construction time.
 */
export type ConnectorAccessTokenHook = () => Promise<string | null>

/**
 * Factory a connector-engine bundle must export. The wrapper convention
 * (mirror of the block bundle's `Component` + `definition`) is a stable
 * `createConnector` named export; `default` is accepted as fallback.
 */
export type ConnectorEngineFactory = (
  getAccessToken: ConnectorAccessTokenHook,
  config: Readonly<Record<string, unknown>>
) => unknown

/** Module shape of an evaluated connector-engine bundle. */
export interface ConnectorEngineModule {
  readonly createConnector?: ConnectorEngineFactory
  readonly default?: ConnectorEngineFactory
}

/**
 * Minimal read contract every constructed engine must satisfy — the surface
 * dataSource path only lists records. Engines that additionally implement
 * the full `EntityConnector` interface can be registered into an
 * `EntityFacade` (`facade.connectors.register(engine)`) for the write path.
 */
export interface ConnectorEngine {
  readonly name?: string
  query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult>
  /** Optional: an engine that can count server-side; absent = list and reduce. */
  aggregate?(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<ConnectorAggregateResult>
}

// ============================================================
// CONNECTION BINDING (registry configuration unit)
// ============================================================

/**
 * One configured connection: a connector engine bound to this world with
 * per-connection config. `connection` is the connection NAME the surface
 * dialect references (`dataSources[].connector`); `descriptor` says which
 * engine bundle serves it; `config` is the world connection's config
 * (never credential values — auth law).
 */
export interface ConnectorConnectionBinding {
  readonly connection: string
  readonly descriptor: ConnectorEngineDescriptor
  readonly config?: Readonly<Record<string, unknown>>
  /** Auth binding BY NAME — resolved by the token resolver. */
  readonly authProviderRef?: string
}

/**
 * Injectable token resolver — the registry derives each engine's
 * `ConnectorAccessTokenHook` from this. By default the
 * resolver answers `null` (engines behave as unauthenticated); a host plugs
 * the AuthRegistry in through `setAccessTokenResolver` without another
 * core change.
 */
export type ConnectorAccessTokenResolver = (
  binding: ConnectorConnectionBinding
) => Promise<string | null>

// ============================================================
// REGISTRY (name → engine instance)
// ============================================================

/** Lifecycle state of a connection's engine inside the registry. */
export type ConnectorEngineStatus =
  | { readonly state: 'unregistered' }
  | { readonly state: 'pending' }
  | { readonly state: 'ready' }
  | { readonly state: 'failed'; readonly reason: string }

/**
 * Registry of connection name → constructed engine instance. Distinct from
 * the entity system's `ConnectorRegistry`, which manages
 * `EntityConnector` instances INSIDE one facade — this registry owns
 * loading + constructing engines from atom bundles, world-wide.
 */
export interface ConnectorEngineRegistry {
  /** Declare the world's connections (replaces the current set). */
  configure(bindings: readonly ConnectorConnectionBinding[]): void

  /** Register an already-constructed engine directly (host/in-process). */
  register(connection: string, engine: ConnectorEngine): void

  /**
   * Resolve the engine for a connection name — loads the bundle and
   * constructs the engine on first use, then answers from cache. NEVER
   * throws: a failed load/construction marks the entry `failed` (with
   * reason) and resolves `null` so consumers degrade honestly.
   */
  resolve(connection: string): Promise<ConnectorEngine | null>

  /** Current lifecycle state of a connection (sync, for honest UI/errors). */
  getStatus(connection: string): ConnectorEngineStatus

  /** Swap the token resolver (the auth-registry seam). Existing constructed
   * engines keep their hook — it closes over the resolver reference, so a
   * swap takes effect on the next token request, not the next construction. */
  setAccessTokenResolver(resolver: ConnectorAccessTokenResolver): void

  /** Configured/registered connection names. */
  list(): readonly string[]

  /** Drop all bindings, instances, and failure states. */
  clear(): void
}

// ============================================================
// SURFACE CONNECTIONS CONTEXT VALUE (single dialect)
// ============================================================

/**
 * One connection as blocks/the renderer see it. Shape-compatible with the
 * runner's `PwappConnection` (`connections.json` entry) — single dialect,
 * different source (platform: project connections doc + world connector
 * rows; runner: connections.json).
 */
export interface SurfaceConnection {
  readonly name: string
  /** Connector engine (atom) id serving this connection. */
  readonly connector?: string
  readonly config?: Readonly<Record<string, unknown>>
  /** World row status when known (e.g. 'active' | 'pending'). */
  readonly status?: string
  readonly authProviderRef?: string
}

/**
 * Value carried by `SurfaceConnectionsContext` and the renderer's
 * `connections` prop. `engines` may be null when the host provides the
 * connections doc for bridge blocks but no loaded engines (yet).
 */
export interface SurfaceConnectionsValue {
  readonly connections: readonly SurfaceConnection[]
  readonly engines: ConnectorEngineRegistry | null
  /**
   * the same live token the engine registry is constructed
   * with, reachable by the data path.
   *
   * The registry already closes over a resolver, but it keeps it private, so a
   * `rest` data source sitting beside an engine-backed one had no route to the
   * identity the app was already signed in with. Exposed here, both paths draw
   * on one bridge instead of the REST half having none.
   */
  readonly getAccessToken?: ConnectorAccessTokenResolver
}
