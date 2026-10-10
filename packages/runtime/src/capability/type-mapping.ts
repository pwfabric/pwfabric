/**
 * Capability Type Mapping
 *
 * Maps short-form CapabilityType strings to their corresponding platform
 * capability IDs used in the registry.
 *
 * @module @pwfabric/runtime/capability/type-mapping
 */

import { capabilityId } from '@pwfabric/contracts'
import type { CapabilityId } from '@pwfabric/contracts'

// ============================================================
// TYPE-TO-ID MAPPING
// ============================================================

/**
 * Maps short-form CapabilityType strings to registry CapabilityId values.
 *
 * Keys are the short-form types (e.g., 'persistence').
 * Values are the full platform capability IDs (e.g., 'platform/persistence').
 */
export const CAPABILITY_TYPE_TO_ID: Record<string, string> = {
  persistence: 'platform/persistence',
  entities: 'platform/entities',
  navigation: 'platform/navigation',
  interaction: 'platform/interaction',
} as const

/**
 * All known capability type keys
 */
export const CAPABILITY_TYPES = Object.keys(CAPABILITY_TYPE_TO_ID) as readonly string[]

/**
 * All known capability IDs
 */
export const CAPABILITY_IDS = Object.values(CAPABILITY_TYPE_TO_ID) as readonly string[]

// ============================================================
// LOOKUP FUNCTIONS
// ============================================================

/**
 * Resolve a CapabilityType string to a CapabilityId.
 *
 * @param type - The capability type string (e.g., 'auth')
 * @returns The corresponding CapabilityId, or null if not found
 */
export function resolveCapabilityId(type: string): CapabilityId | null {
  const id = CAPABILITY_TYPE_TO_ID[type]
  if (!id) return null
  return capabilityId(id)
}

/**
 * Resolve a CapabilityId back to a CapabilityType string.
 *
 * @param id - The capability ID (e.g., 'platform/persistence')
 * @returns The corresponding type string, or null if not found
 */
export function resolveCapabilityType(id: string): string | null {
  for (const [type, capId] of Object.entries(CAPABILITY_TYPE_TO_ID)) {
    if (capId === id) return type
  }
  return null
}

/**
 * Check if a CapabilityType string is known.
 *
 * @param type - The capability type string to check
 * @returns true if the type is a known platform capability type
 */
export function isKnownCapabilityType(type: string): boolean {
  return type in CAPABILITY_TYPE_TO_ID
}

/**
 * The canonical id, from EITHER spelling.
 *
 * Every reader that compares a capability id should go through this: a raw
 * comparison against `'platform/…'` misses anything written the short way.
 *
 * Both spellings occur in real documents (`navigation`, `persistence`,
 * `entities` next to `platform/navigation` …). Both are legitimate — the plan
 * layer's contract types the short one, the registry and the pack's atoms use
 * the long one — so a reader that accepts only one is blind to real data.
 *
 * `null` for anything outside the canonical four, which is the answer a caller
 * needs for a retired name (`auth`, `input`) or one that never existed (`seo`):
 * not a silent pass-through that would let a ghost look like a capability.
 */
export function canonicalCapabilityId(value: string): CapabilityId | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const mapped = CAPABILITY_TYPE_TO_ID[trimmed]
  if (mapped) return capabilityId(mapped)
  return CAPABILITY_IDS.includes(trimmed) ? capabilityId(trimmed) : null
}

/**
 * Does this capability entry name the given canonical capability?
 *
 * The shape every one of those fourteen sites was hand-rolling:
 * `caps.find((c) => c.capability === 'platform/persistence')`.
 */
export function isCapability(entry: { capability?: string } | null | undefined, id: string): boolean {
  const declared = entry?.capability
  if (typeof declared !== 'string') return false
  const canonical = canonicalCapabilityId(id)
  return canonical !== null && canonicalCapabilityId(declared) === canonical
}
