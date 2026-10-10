/**
 * Offline capability stubs for fat mode.
 *
 * Fat mode renders with no API and no auth, so any capability the surface
 * declares (entities, navigation, persistence) must be satisfied locally.
 * These factories provide in-memory / no-op implementations:
 *
 *   - `createOfflineEntityFacade()` — a real `createEntityFacade()` backed by
 *     the in-memory `StaticConnector`, optionally seeded with entity defs +
 *     records. CRUD happens entirely in memory.
 *   - `createOfflineNavigationProvider()` — a `navigation` CapabilityProvider
 *     whose links resolve to in-page anchors (no router).
 *   - `staticDataSources()` — turns a record-map of inline data into
 *     `platform/persistence` static data sources for the DataBoundSurfaceRenderer.
 *
 * @module @pwfabric/embed/capabilities-stub
 */

import { createEntityFacade, StaticConnector } from '@pwfabric/runtime'
import type { EntityFacade, CapabilityProvider } from '@pwfabric/runtime'
import type { EntityDefinition } from '@pwfabric/runtime'

// ============================================================
// ENTITY FACADE (in-memory CRUD)
// ============================================================

export interface OfflineEntitySeed {
  /** Entity definition to register. */
  readonly definition: EntityDefinition
  /** Initial records to load into the static connector. */
  readonly records?: readonly Record<string, unknown>[]
}

/**
 * Build an entity facade wired to a single in-memory `StaticConnector`.
 * All CRUD performed by the surface happens in memory and is lost on reload —
 * exactly what an offline embed wants.
 */
export function createOfflineEntityFacade(seeds?: readonly OfflineEntitySeed[]): EntityFacade {
  const connector = new StaticConnector('offline')
  const facade = createEntityFacade()
  // Register the single static connector under its name.
  facade.connectors.register(connector)

  if (seeds) {
    for (const seed of seeds) {
      facade.registerEntity(seed.definition, connector.name)
      if (seed.records) {
        for (const record of seed.records) {
          // Fire-and-forget seed — the static connector resolves synchronously
          // enough for a first render, and errors here are non-fatal.
          void connector.create(seed.definition.id, record)
        }
      }
    }
  }

  return facade
}

// ============================================================
// NAVIGATION (no-op / in-page)
// ============================================================

/**
 * A `navigation` capability provider for offline rendering. There is no
 * router, so navigation is reduced to in-page anchors / `window.location`.
 * The provider exposes a `data` payload the navigation-aware blocks read.
 */
export function createOfflineNavigationProvider(
  options: { readonly basePath?: string } = {}
): CapabilityProvider {
  const basePath = options.basePath ?? ''
  return {
    type: 'navigation',
    data: {
      mode: 'offline',
      basePath,
      /** Resolve a href against the base path; absolute/anchor hrefs pass through. */
      resolve(href: string): string {
        if (/^([a-z]+:)?\/\//i.test(href) || href.startsWith('#')) return href
        return `${basePath}${href}`
      },
      /** No-op push — offline embeds have no history stack. */
      push(): void {
        /* intentionally inert */
      },
    },
  }
}

// ============================================================
// STATIC DATA SOURCES
// ============================================================

/**
 * Convert a map of `{ sourceId: data }` into the `platform/persistence`
 * capability config shape (static data sources) that the
 * DataBoundSurfaceRenderer consumes. Use this to inline mock/fixture data into
 * a fat embed so REST-bound blocks render without a backend.
 */
export function staticPersistenceCapability(
  data: Readonly<Record<string, unknown>>,
  initialState?: Record<string, unknown>
): CapabilityProvider & { capability: string; config: Record<string, unknown> } {
  const dataSources = Object.entries(data).map(([id, staticData]) => ({
    id,
    kind: 'static' as const,
    staticData,
  }))
  return {
    type: 'data',
    capability: 'platform/persistence',
    config: {
      dataSources,
      ...(initialState ? { initialState } : {}),
    },
  } as CapabilityProvider & { capability: string; config: Record<string, unknown> }
}
