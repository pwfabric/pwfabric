/**
 * Capability Module — Canonical 4-Capability Registry
 *
 * ## Single Source of Truth
 *
 * `platform-capabilities.ts` is the canonical source for all platform
 * capabilities. Everything below is derived from `platformCapabilities`
 * or re-exported from siblings. Add/remove a capability there — this file
 * and all consumers stay in sync automatically.
 *
 * ## Canonical Count: 4
 *
 * - platform/persistence (data + state, merger)
 * - platform/entities (schema-driven entity CRUD; canonical form write path)
 * - platform/navigation (renamed from routing)
 * - platform/interaction (event-driven rules, replaces behaviors)
 *
 * ## Removed (historical)
 *
 * - platform/auth — phantom capability
 * - ai/content, ai/style, ai/compose, ai/spawn — facade layer
 * - platform/analytics, platform/seo, platform/i18n — Tier 3 deferred
 * - platform/routing — renamed to platform/navigation
 * - platform/input — hard cutover; form writes via platform/entities
 *
 * @module @pwfabric/runtime/capability
 */

import { platformCapabilities } from './platform-capabilities.js'

// ============================================================
// CANONICAL CAPABILITY EXPORTS (SOURCE OF TRUTH)
// ============================================================

export {
  persistenceCapability,
  entitiesCapability,
  navigationCapability,
  interactionCapability,
  platformCapabilities,
  registerPlatformCapabilities,
} from './platform-capabilities.js'

// ============================================================
// DERIVED CANONICAL CONSTANTS (from platformCapabilities)
// ============================================================

/**
 * Canonical capability IDs — derived from the `platformCapabilities` array.
 *
 * Drift-proof: if `platformCapabilities` changes, this updates automatically.
 * Consumers should import this constant rather than hardcoding the list.
 */
export const CANONICAL_CAPABILITY_IDS: readonly string[] = platformCapabilities.map((c) => c.id)

/**
 * Canonical capability count. Should remain 4 until a governance-approved
 * change adds/removes a capability (dropped platform/input).
 */
export const CAPABILITY_COUNT: number = platformCapabilities.length

// ============================================================
// TYPE MAPPING (starter short-form ↔ full IDs)
//
// Translates between the short-form capability types and the full IDs.
// ============================================================

export {
  CAPABILITY_TYPE_TO_ID,
  CAPABILITY_TYPES,
  CAPABILITY_IDS,
  resolveCapabilityId,
  resolveCapabilityType,
  isKnownCapabilityType,
  // The canonical resolver every reader needed: accepts either spelling and
  // answers with the one id the registry, the pack's atoms and the drift guard
  // all agree on.
  canonicalCapabilityId,
  isCapability,
} from './type-mapping.js'

// ============================================================
// SURFACE CAPABILITY VALIDATION
// ============================================================

export {
  type CapabilityRequirement,
  type CapabilityValidationResult,
  validateSurfaceCapabilities,
} from './validation.js'

// ============================================================
// resolveCapability / listCapabilities (registry-only cutover)
// ============================================================

import type { Capability } from '@pwfabric/contracts'

/**
 * Tenant-registry lookup function injected by the runtime host.
 *
 * the hardcoded fallback is RETIRED. Callers MUST pass a
 * lookup backed by `workspace_capabilities` (or an equivalent data source).
 * A registry miss is a hard error — no silent fall-through to a global list.
 */
export type TenantCapabilityLookup = (id: string, worldId: string) => Promise<Capability | null>

/**
 * Registry-first capability resolve.
 *
 * @throws if the lookup is missing or the capability is not installed for
 *   the tenant. No fallback — pack install fan-out is the sole source of
 *   truth for what a tenant can resolve.
 */
export async function resolveCapability(
  id: string,
  worldId: string,
  lookup: TenantCapabilityLookup
): Promise<Capability> {
  const fromRegistry = await lookup(id, worldId)
  if (fromRegistry) return fromRegistry
  throw new Error(
    `Capability "${id}" is not installed for tenant "${worldId}". ` +
      `Install the providing pack via the plan bundle or marketplace install.`
  )
}

/**
 * Tenant-registry list function injected by the runtime host.
 */
export type TenantCapabilityList = (worldId: string) => Promise<readonly Capability[]>

/**
 * Registry-first capability list.
 *
 * Returns the full set of capabilities installed for a tenant. No fallback
 * to the canonical platformCapabilities array — an empty install state
 * returns `[]`, which the caller must handle (usually by telling the user
 * their plan bundle is empty).
 */
export async function listCapabilities(
  worldId: string,
  list: TenantCapabilityList
): Promise<readonly Capability[]> {
  return list(worldId)
}
