/**
 * Capability Definition
 *
 * PHASE0-WS1: Discrete units of functionality with typed contracts
 *
 * A Capability is a discrete, stateless unit of functionality with
 * a declared contract for inputs, outputs, and side effects.
 *
 * INVARIANTS:
 * - A Capability has exactly one contract
 * - A Capability is stateless (state is held in context)
 * - A Capability declares its dependencies explicitly
 * - A Capability is immutable after registration
 * - A Capability execution is deterministic given the same input and context
 *
 * @module @pwfabric/contracts/fabric/capability
 */

import type { CapabilityId, DomainId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'
import type { ConfigSchema } from './config-schema.js'
import type { Contract, ContractRef } from './contract.js'
import type { ExecutionContext } from './execution.js'

// ============================================================
// CAPABILITY METADATA
// ============================================================

/**
 * Capability lifecycle state
 */
export type CapabilityState = 'draft' | 'alpha' | 'beta' | 'stable' | 'deprecated'

/**
 * Capability metadata
 */
export interface CapabilityMetadata {
  readonly name: string
  readonly description?: string
  readonly state: CapabilityState
  readonly domain?: DomainId
  readonly tags?: readonly string[]
  readonly timeout?: number
  readonly retryable?: boolean
  readonly idempotent?: boolean
  readonly deprecated?: {
    readonly since: string
    readonly message: string
    readonly replacement?: CapabilityId
  }
}

// ============================================================
// CAPABILITY INTERFACE
// ============================================================

/**
 * Capability interface
 *
 * Type Parameters:
 * - TId: The capability identifier type
 * - TInput: The validated input type (from contract)
 * - TOutput: The validated output type (from contract)
 * - TDeps: Tuple of dependency capability IDs
 */
export interface Capability<
  TId extends CapabilityId = CapabilityId,
  TInput = unknown,
  TOutput = unknown,
  TDeps extends readonly CapabilityId[] = readonly CapabilityId[],
> {
  /**
   * Unique capability identifier
   */
  readonly id: TId

  /**
   * Capability version (semver)
   */
  readonly version: SemanticVersion

  /**
   * The contract this capability implements
   */
  readonly contract: Contract<TInput, TOutput>

  /**
   * Explicit dependencies on other capabilities
   */
  readonly dependencies: TDeps

  /**
   * Capability metadata
   */
  readonly metadata: CapabilityMetadata

  /**
   * Optional configuration schema
   * Declares what settings this capability accepts for administration.
   */
  readonly configSchema?: ConfigSchema | undefined

  /**
   * Execute the capability
   */
  execute(input: TInput, context: ExecutionContext): Promise<TOutput>
}

// ============================================================
// CAPABILITY DESCRIPTOR
// ============================================================

/**
 * Capability descriptor for registration
 * This is the input format for defining a new capability
 */
export interface CapabilityDescriptor<TInput = unknown, TOutput = unknown> {
  readonly id: string
  readonly version: string
  readonly contractRef: ContractRef
  readonly dependencies?: readonly string[]
  readonly metadata: CapabilityMetadata
  readonly execute: CapabilityExecutor<TInput, TOutput>
}

/**
 * Capability executor function type
 */
export type CapabilityExecutor<TInput, TOutput> = (
  input: TInput,
  context: ExecutionContext
) => Promise<TOutput>

// ============================================================
// CAPABILITY REFERENCE
// ============================================================

/**
 * Reference to a capability (for dependencies)
 */
export interface CapabilityRef {
  readonly id: CapabilityId
  readonly version: SemanticVersion
}

/**
 * Create a capability reference
 */
export function capabilityRef(id: CapabilityId, version: SemanticVersion): CapabilityRef {
  return { id, version }
}

// ============================================================
// CAPABILITY RESOLUTION
// ============================================================

/**
 * Resolution result when looking up a capability
 */
export type Resolution<C extends Capability> =
  | { readonly found: true; readonly capability: C }
  | { readonly found: false; readonly reason: ResolutionFailure }

/**
 * Resolution failure reasons
 */
export type ResolutionFailure =
  | { readonly type: 'not_found'; readonly id: CapabilityId }
  | {
      readonly type: 'version_mismatch'
      readonly id: CapabilityId
      readonly required: SemanticVersion
      readonly available: SemanticVersion
    }
  | {
      readonly type: 'dependency_missing'
      readonly id: CapabilityId
      readonly missing: CapabilityId
    }

// ============================================================
// CAPABILITY REGISTRATION
// ============================================================

/**
 * Registration result
 */
export type RegistrationResult<C extends Capability> =
  | { readonly success: true; readonly capability: C }
  | { readonly success: false; readonly error: RegistrationError }

/**
 * Registration error types
 */
export type RegistrationError =
  | { readonly type: 'already_registered'; readonly id: CapabilityId }
  | { readonly type: 'invalid_contract'; readonly id: CapabilityId; readonly message: string }
  | {
      readonly type: 'missing_dependency'
      readonly id: CapabilityId
      readonly missing: CapabilityId
    }
  | { readonly type: 'circular_dependency'; readonly cycle: readonly CapabilityId[] }
  | {
      readonly type: 'version_conflict'
      readonly id: CapabilityId
      readonly existing: SemanticVersion
      readonly new: SemanticVersion
    }

// ============================================================
// TYPE UTILITIES
// ============================================================

/**
 * Extract input type from a capability
 */
export type CapabilityInput<C> =
  C extends Capability<CapabilityId, infer I, unknown, readonly CapabilityId[]> ? I : never

/**
 * Extract output type from a capability
 */
export type CapabilityOutput<C> =
  C extends Capability<CapabilityId, unknown, infer O, readonly CapabilityId[]> ? O : never

/**
 * Extract dependency IDs from a capability
 */
export type CapabilityDeps<C> =
  C extends Capability<CapabilityId, unknown, unknown, infer D> ? D : never
