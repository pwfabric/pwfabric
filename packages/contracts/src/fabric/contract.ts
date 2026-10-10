/**
 * Contract Definition
 *
 * PHASE0-WS1: Immutable interface contracts for capabilities
 *
 * A Contract is the formal, serializable interface definition that
 * specifies the shape of inputs, outputs, and errors for a capability.
 *
 * INVARIANTS:
 * - Contracts contain NO implementation logic
 * - Contracts are serializable (JSON Schema compatible)
 * - Contracts are version-pinned and immutable after publication
 * - Contracts are environment-agnostic (no IO, no framework imports)
 * - Contracts are validated at compile time AND runtime
 *
 * @module @pwfabric/contracts/fabric/contract
 */

import type { ContractId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'
import type { Schema, SerializedSchema } from '../core/schema.js'
import type { ValidationResult } from '../core/result.js'

// ============================================================
// CONTRACT METADATA
// ============================================================

/**
 * Contract lifecycle state
 */
export type ContractState = 'draft' | 'alpha' | 'beta' | 'rc' | 'stable' | 'deprecated'

/**
 * Contract metadata
 */
export interface ContractMetadata {
  readonly name: string
  readonly description?: string
  readonly state: ContractState
  readonly tags?: readonly string[]
  readonly deprecated?: {
    readonly since: string
    readonly message: string
    readonly replacement?: ContractId
  }
}

// ============================================================
// CONTRACT ERROR
// ============================================================

/**
 * Standardized contract error structure
 */
export interface ContractError {
  readonly code: string
  readonly message: string
  readonly details?: Record<string, unknown>
}

// ============================================================
// CONTRACT DEFINITION
// ============================================================

/**
 * Contract interface
 *
 * Type Parameters:
 * - TInput: The validated input type
 * - TOutput: The validated output type
 * - TError: The error type (defaults to ContractError)
 */
export interface Contract<TInput = unknown, TOutput = unknown, TError = ContractError> {
  /**
   * Unique contract identifier
   */
  readonly id: ContractId

  /**
   * Contract version (semver)
   */
  readonly version: SemanticVersion

  /**
   * Contract metadata
   */
  readonly metadata: ContractMetadata

  /**
   * Input schema
   */
  readonly input: Schema<TInput>

  /**
   * Output schema
   */
  readonly output: Schema<TOutput>

  /**
   * Error schemas (multiple error types possible)
   */
  readonly errors: readonly Schema<TError>[]

  /**
   * Validate input data
   */
  validateInput(data: unknown): ValidationResult<TInput>

  /**
   * Validate output data
   */
  validateOutput(data: unknown): ValidationResult<TOutput>

  /**
   * Validate error data
   */
  validateError(data: unknown): ValidationResult<TError>

  /**
   * Serialize the contract for transport/storage
   */
  serialize(): SerializedContract
}

// ============================================================
// SERIALIZED CONTRACT
// ============================================================

/**
 * Serialized contract for network transport
 */
export interface SerializedContract {
  readonly id: string
  readonly version: string
  readonly metadata: ContractMetadata
  readonly input: SerializedSchema
  readonly output: SerializedSchema
  readonly errors: readonly SerializedSchema[]
}

// ============================================================
// CONTRACT DESCRIPTOR
// ============================================================

/**
 * Contract descriptor for registration
 * This is the input format for defining a new contract
 */
export interface ContractDescriptor<TInput = unknown, TOutput = unknown, TError = ContractError> {
  readonly id: string
  readonly version: string
  readonly metadata: ContractMetadata
  readonly inputSchema: Schema<TInput>
  readonly outputSchema: Schema<TOutput>
  readonly errorSchemas?: readonly Schema<TError>[]
}

// ============================================================
// CONTRACT REFERENCE
// ============================================================

/**
 * Reference to a contract (for dependencies)
 */
export interface ContractRef {
  readonly id: ContractId
  readonly version: SemanticVersion
}

/**
 * Create a contract reference
 */
export function contractRef(id: ContractId, version: SemanticVersion): ContractRef {
  return { id, version }
}

// ============================================================
// TYPE UTILITIES
// ============================================================

/**
 * Extract input type from a contract
 */
export type ContractInput<C> = C extends Contract<infer I, unknown, unknown> ? I : never

/**
 * Extract output type from a contract
 */
export type ContractOutput<C> = C extends Contract<unknown, infer O, unknown> ? O : never

/**
 * Extract error type from a contract
 */
export type ContractErrors<C> = C extends Contract<unknown, unknown, infer E> ? E : never
