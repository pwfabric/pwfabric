/**
 * Connector Engine Registry
 *
 * Connection name → constructed engine instance. Owns the load-and-
 * construct lifecycle: `configure()` declares the world's connections
 * (which engine bundle serves each name + per-connection config), and
 * `resolve()` lazily loads the bundle via `ConnectorModuleLoader` and
 * constructs the engine ONCE with `(getAccessToken, config)` — the exact
 * signature the existing engines (GraphListConnector, the Graph motor)
 * already take.
 *
 * Auth seam: the access-token hook handed to each engine closes over an
 * injectable resolver. By default the resolver answers
 * `null` — engines behave as unauthenticated and degrade honestly. A host
 * plugs the AuthRegistry in via `setAccessTokenResolver` (or the factory
 * option) without another core change.
 *
 * Error isolation: `resolve()` NEVER throws. A failed load or construction
 * marks the entry `failed` with the reason (`getStatus`) and resolves
 * `null`; consumers surface the reason (e.g. into the `__errors` context)
 * instead of crashing the surface.
 *
 * @module @pwfabric/runtime/connectors/engine-registry
 */

import { ConnectorModuleLoader, type ConnectorModuleLoaderImpl } from './module-loader.js'
import type {
  ConnectorAccessTokenResolver,
  ConnectorConnectionBinding,
  ConnectorEngine,
  ConnectorEngineRegistry,
  ConnectorEngineStatus,
} from './types.js'

// ============================================================
// HELPERS
// ============================================================

/** Duck-check the minimal read contract every engine must satisfy. */
function isConnectorEngine(value: unknown): value is ConnectorEngine {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { query?: unknown }).query === 'function'
  )
}

/** Default token resolver — unauthenticated until a host installs one. */
const NULL_TOKEN_RESOLVER: ConnectorAccessTokenResolver = async () => null

interface RegistryEntry {
  readonly binding: ConnectorConnectionBinding | null
  engine: ConnectorEngine | null
  pending: Promise<ConnectorEngine | null> | null
  failure: string | null
}

// ============================================================
// REGISTRY IMPLEMENTATION
// ============================================================

export class DefaultConnectorEngineRegistry implements ConnectorEngineRegistry {
  private readonly entries = new Map<string, RegistryEntry>()
  private readonly loader: ConnectorModuleLoaderImpl
  private tokenResolver: ConnectorAccessTokenResolver

  constructor(options?: {
    readonly loader?: ConnectorModuleLoaderImpl
    readonly getAccessToken?: ConnectorAccessTokenResolver
  }) {
    this.loader = options?.loader ?? ConnectorModuleLoader
    this.tokenResolver = options?.getAccessToken ?? NULL_TOKEN_RESOLVER
  }

  configure(bindings: readonly ConnectorConnectionBinding[]): void {
    // Replace semantics: drop entries whose binding disappeared, keep
    // constructed engines whose binding is unchanged (identity by
    // connection + descriptor + config reference equality is too strict —
    // a reconfigure resets the entry so config changes take effect).
    this.entries.clear()
    for (const binding of bindings) {
      this.entries.set(binding.connection, {
        binding,
        engine: null,
        pending: null,
        failure: null,
      })
    }
  }

  register(connection: string, engine: ConnectorEngine): void {
    this.entries.set(connection, { binding: null, engine, pending: null, failure: null })
  }

  async resolve(connection: string): Promise<ConnectorEngine | null> {
    const entry = this.entries.get(connection)
    if (!entry) return null
    if (entry.engine) return entry.engine
    if (entry.failure !== null) return null // sticky until reconfigure/clear
    if (entry.pending) return entry.pending
    if (!entry.binding) return null

    const binding = entry.binding
    const construct = async (): Promise<ConnectorEngine | null> => {
      try {
        const factory = await this.loader.load(binding.descriptor)
        // The hook closes over `this.tokenResolver` so a later
        // setAccessTokenResolver takes effect on the NEXT token
        // request without reconstructing engines.
        const getAccessToken = async (): Promise<string | null> =>
          this.tokenResolver(binding)
        const engine: unknown = factory(getAccessToken, binding.config ?? {})
        if (!isConnectorEngine(engine)) {
          throw new Error(
            `Engine for connection '${binding.connection}' does not expose query() — ` +
              `not a usable connector engine`
          )
        }
        entry.engine = engine
        return engine
      } catch (err) {
        entry.failure = err instanceof Error ? err.message : String(err)
        return null
      } finally {
        entry.pending = null
      }
    }

    entry.pending = construct()
    return entry.pending
  }

  getStatus(connection: string): ConnectorEngineStatus {
    const entry = this.entries.get(connection)
    if (!entry) return { state: 'unregistered' }
    if (entry.engine) return { state: 'ready' }
    if (entry.failure !== null) return { state: 'failed', reason: entry.failure }
    return { state: 'pending' }
  }

  setAccessTokenResolver(resolver: ConnectorAccessTokenResolver): void {
    this.tokenResolver = resolver
  }

  list(): readonly string[] {
    return Array.from(this.entries.keys())
  }

  clear(): void {
    this.entries.clear()
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a connector engine registry. One per world/host render context —
 * deliberately NOT a singleton (per-connection config is world state).
 */
export function createConnectorEngineRegistry(options?: {
  readonly loader?: ConnectorModuleLoaderImpl
  readonly getAccessToken?: ConnectorAccessTokenResolver
}): ConnectorEngineRegistry {
  return new DefaultConnectorEngineRegistry(options)
}
