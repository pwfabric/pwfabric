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

import type { z } from 'zod'
import type { persistenceCapabilityConfigSchema } from './capability-configs.schema.js'

// ============================================================
// PLATFORM/PERSISTENCE CONFIG
// ============================================================

export type PersistenceCapabilityConfig = z.infer<typeof persistenceCapabilityConfigSchema>

// ============================================================
// CAPABILITY ID — PERSISTENCE (canonical string)
// ============================================================

/**
 * Canonical capability id for the persistence system. Used when looking
 * up the binding that owns `dataSources` + `initialState`.
 */
export const PLATFORM_PERSISTENCE_CAPABILITY_ID = 'platform/persistence' as const
