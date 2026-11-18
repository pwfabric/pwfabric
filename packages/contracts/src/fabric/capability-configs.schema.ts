/**
 * The zod schemas of `capability-configs.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { dataSourceSchema, surfaceBehaviorSchema } from './surface-schema.schema.js'

/**
 * Config shape for the `platform/persistence` capability binding.
 *
 * consolidated the former `surface.dataSources` and
 * `surface.initialState` root fields into this config so the capability
 * owns its own declarative seed payload:
 *
 *   - `dataSources` — REST/static/state source declarations; DataService
 * registers these at render time (atom-aware loader).
 *   - `initialState` — StateStore baseline values read by the
 *     surface-scoped state manager.
 *   - `cacheTtl` / `maxRetries` / `timeout` / `persistenceEnabled` /
 *     `storageKey` — pre-existing DataService runtime parameters.
 */
export const persistenceCapabilityConfigSchema = z
  .object({
    // Declarative seed payload (moved off surface root)
    dataSources: z.array(dataSourceSchema).optional(),
    initialState: z.record(z.string(), z.unknown()).optional(),
    // State keys that live in the page's address query: seeded from it on
    // load and written back (replacing the history entry) when they change,
    // so a reload or a shared link keeps them (data-protocol, envelope §4).
    urlState: z.array(z.string().min(1)).optional(),
    // Declared event→action behaviors (see surfaceBehaviorSchema). Merged
    // with host-provided (world DB) behaviors by DataBoundSurfaceRenderer.
    behaviors: z.array(surfaceBehaviorSchema).optional(),

    // Pre-existing DataService runtime parameters
    defaultCacheTtl: z.number().int().nonnegative().optional(),
    maxRetries: z.number().int().nonnegative().optional(),
    timeout: z.number().int().positive().optional(),
    persistenceEnabled: z.boolean().optional(),
    storageKey: z.string().optional(),
  })
  .passthrough()
