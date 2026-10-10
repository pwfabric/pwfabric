/**
 * Capability Config Schemas
 *
 * Canonical Zod schemas for the config payload attached to each
 * capability binding on a surface.
 *
 * `surface.dataSources` + `surface.initialState` root fields
 * retired. Those concerns are now owned by `platform/persistence`
 * capability config. This module holds the per-capability config
 * schemas so validators, composer, and studio tooling share a single
 * source of truth.
 *
 * @module @pwfabric/contracts/fabric/capability-configs
 */

import { z } from 'zod'
import { dataSourceSchema, surfaceBehaviorSchema } from './surface-schema.js'

// ============================================================
// PLATFORM/PERSISTENCE CONFIG
// ============================================================

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
    initialState: z.record(z.unknown()).optional(),
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

export type PersistenceCapabilityConfig = z.infer<typeof persistenceCapabilityConfigSchema>

// ============================================================
// CAPABILITY ID — PERSISTENCE (canonical string)
// ============================================================

/**
 * Canonical capability id for the persistence system. Used when looking
 * up the binding that owns `dataSources` + `initialState`.
 */
export const PLATFORM_PERSISTENCE_CAPABILITY_ID = 'platform/persistence' as const
