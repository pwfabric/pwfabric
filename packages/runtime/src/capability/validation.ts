/**
 * Surface Capability Validation
 *
 * Validates that a surface's capability requirements
 * can be satisfied by the capabilities registered in a registry.
 *
 * @module @pwfabric/runtime/capability/validation
 */

import type { CapabilityRegistry } from '../registry.js'
import { resolveCapabilityId } from './type-mapping.js'

// ============================================================
// TYPES
// ============================================================

/**
 * A capability requirement declared by a surface.
 */
export interface CapabilityRequirement {
  /** The capability type string (e.g., 'persistence' or 'platform/persistence') */
  readonly capability: string
  /** Whether this capability is required (true) or optional (false) */
  readonly required: boolean
  /** Optional configuration for the capability */
  readonly config?: Record<string, unknown>
}

/**
 * Result of validating surface capabilities against a registry.
 */
export interface CapabilityValidationResult {
  /** Whether all required capabilities are satisfied */
  readonly valid: boolean
  /** IDs of capabilities that are registered and satisfy requirements */
  readonly satisfied: readonly string[]
  /** IDs of required capabilities that are NOT registered */
  readonly missing: readonly string[]
  /** IDs of optional capabilities that are NOT registered */
  readonly optional: readonly string[]
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate that a surface's capability requirements can be met
 * by the capabilities available in the registry.
 *
 * Capability strings can be either:
 * - Short-form types from starters (e.g., 'persistence') which are resolved via type-mapping
 * - Full capability IDs (e.g., 'platform/persistence') used directly
 *
 * @param requirements - The capability requirements declared by a surface
 * @param registry - The capability registry to validate against
 * @returns A ValidationResult indicating which requirements are met
 */
export function validateSurfaceCapabilities(
  requirements: readonly CapabilityRequirement[],
  registry: CapabilityRegistry
): CapabilityValidationResult {
  const satisfied: string[] = []
  const missing: string[] = []
  const optional: string[] = []

  for (const requirement of requirements) {
    const { capability, required } = requirement

    // Try to resolve short-form type to full ID, or use as-is
    const resolvedId = resolveCapabilityId(capability)
    const lookupId = resolvedId ?? capability

    // Check if the capability is registered
    // Use capabilityId() cast since registry.has() expects a branded CapabilityId
    const isRegistered = registry.has(lookupId as ReturnType<typeof resolveCapabilityId> & string)

    if (isRegistered) {
      satisfied.push(capability)
    } else if (required) {
      missing.push(capability)
    } else {
      optional.push(capability)
    }
  }

  return {
    valid: missing.length === 0,
    satisfied,
    missing,
    optional,
  }
}
