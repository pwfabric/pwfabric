/**
 * Domain Definition
 *
 * PHASE0-WS1: Bounded contexts for capability organization
 *
 * A Domain is a bounded context that groups related capabilities
 * under a common namespace and ownership boundary.
 *
 * INVARIANTS:
 * - A Domain provides namespace isolation for capability IDs
 * - A Domain declares its public API (exported capabilities)
 * - A Domain encapsulates internal capabilities
 * - Dependencies between Domains must be explicit and acyclic
 * - A Domain has exactly one owner
 *
 * @module @pwfabric/contracts/fabric/domain
 */

import type { CapabilityId, DomainId, OwnerId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'

// ============================================================
// DOMAIN METADATA
// ============================================================

/**
 * Domain metadata
 */
export interface DomainMetadata {
  readonly name: string
  readonly description?: string
  readonly tags?: readonly string[]
}

// ============================================================
// DOMAIN INTERFACE
// ============================================================

/**
 * Domain interface
 */
export interface Domain {
  /**
   * Unique domain identifier
   */
  readonly id: DomainId

  /**
   * Domain version
   */
  readonly version: SemanticVersion

  /**
   * Domain owner
   */
  readonly owner: OwnerId

  /**
   * Domain metadata
   */
  readonly metadata: DomainMetadata

  /**
   * All capabilities in this domain
   */
  readonly capabilities: readonly CapabilityId[]

  /**
   * Exported (public) capabilities
   */
  readonly exports: readonly CapabilityId[]

  /**
   * Domain dependencies
   */
  readonly dependencies: readonly DomainId[]

  /**
   * Check if a capability belongs to this domain
   */
  contains(capabilityId: CapabilityId): boolean

  /**
   * Check if a capability is exported (public)
   */
  isExported(capabilityId: CapabilityId): boolean

  /**
   * Check if a capability is internal (private)
   */
  isInternal(capabilityId: CapabilityId): boolean

  /**
   * Get the full capability ID with domain prefix
   */
  qualify(capabilityName: string): CapabilityId
}

// ============================================================
// DOMAIN DESCRIPTOR
// ============================================================

/**
 * Domain descriptor for creation
 */
export interface DomainDescriptor {
  readonly id: string
  readonly version: string
  readonly owner: string
  readonly metadata: DomainMetadata
  readonly capabilities?: readonly string[]
  readonly exports?: readonly string[]
  readonly dependencies?: readonly string[]
}

// ============================================================
// DOMAIN REGISTRY
// ============================================================

/**
 * Domain registry for managing domains
 */
export interface DomainRegistry {
  /**
   * Register a domain
   */
  register(domain: Domain): DomainRegistrationResult

  /**
   * Get a domain by ID
   */
  get(id: DomainId): Domain | undefined

  /**
   * Check if a domain exists
   */
  has(id: DomainId): boolean

  /**
   * List all registered domains
   */
  list(): readonly Domain[]

  /**
   * Get the domain for a capability
   */
  domainOf(capabilityId: CapabilityId): Domain | undefined

  /**
   * Check for circular dependencies
   */
  validateDependencies(): DomainDependencyValidation
}

/**
 * Domain registration result
 */
export type DomainRegistrationResult =
  | { readonly success: true; readonly domain: Domain }
  | { readonly success: false; readonly error: DomainRegistrationError }

/**
 * Domain registration error types
 */
export type DomainRegistrationError =
  | { readonly type: 'already_registered'; readonly id: DomainId }
  | { readonly type: 'invalid_owner'; readonly id: DomainId; readonly owner: OwnerId }
  | { readonly type: 'missing_dependency'; readonly id: DomainId; readonly missing: DomainId }
  | { readonly type: 'circular_dependency'; readonly cycle: readonly DomainId[] }

/**
 * Domain dependency validation result
 */
export type DomainDependencyValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly cycles: readonly DomainCycle[] }

/**
 * Circular dependency cycle
 */
export interface DomainCycle {
  readonly domains: readonly DomainId[]
}

// ============================================================
// DOMAIN VISIBILITY
// ============================================================

/**
 * Capability visibility within a domain
 */
export type CapabilityVisibility = 'public' | 'internal'

/**
 * Capability visibility declaration
 */
export interface CapabilityVisibilityDeclaration {
  readonly capabilityId: CapabilityId
  readonly visibility: CapabilityVisibility
}

// ============================================================
// DOMAIN BOUNDARY
// ============================================================

/**
 * Domain boundary check result
 */
export type DomainBoundaryCheck =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: DomainBoundaryViolation }

/**
 * Domain boundary violation types
 */
export type DomainBoundaryViolation =
  | {
      readonly type: 'internal_access'
      readonly from: DomainId
      readonly to: DomainId
      readonly capability: CapabilityId
    }
  | { readonly type: 'missing_dependency'; readonly from: DomainId; readonly to: DomainId }
  | { readonly type: 'circular_dependency'; readonly from: DomainId; readonly to: DomainId }

/**
 * Check if access from one domain to a capability in another is allowed
 */
export function checkDomainBoundary(
  fromDomain: Domain,
  toDomain: Domain,
  capabilityId: CapabilityId
): DomainBoundaryCheck {
  // Same domain: always allowed
  if (fromDomain.id === toDomain.id) {
    return { allowed: true }
  }

  // Check if fromDomain depends on toDomain
  if (!fromDomain.dependencies.includes(toDomain.id)) {
    return {
      allowed: false,
      reason: { type: 'missing_dependency', from: fromDomain.id, to: toDomain.id },
    }
  }

  // Check if capability is exported
  if (!toDomain.isExported(capabilityId)) {
    return {
      allowed: false,
      reason: {
        type: 'internal_access',
        from: fromDomain.id,
        to: toDomain.id,
        capability: capabilityId,
      },
    }
  }

  return { allowed: true }
}
