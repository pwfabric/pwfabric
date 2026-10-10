/**
 * Fabric Definition
 *
 * PHASE0-WS1: Runtime orchestration context
 *
 * A Fabric is a runtime orchestration context that manages capability
 * registration, dependency resolution, and execution lifecycle.
 *
 * INVARIANTS:
 * - A Fabric is a singleton per execution context
 * - A Fabric owns the capability registry
 * - A Fabric enforces contract validation at registration time
 * - A Fabric provides deterministic capability resolution
 *
 * @module @pwfabric/contracts/fabric/fabric
 */

import type { CapabilityId, FabricId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'
import type { Capability, RegistrationResult, Resolution } from './capability.js'
import type { ExecutionResult, ExecutionOptions, Timestamp } from './execution.js'

// ============================================================
// FABRIC STATE
// ============================================================

/**
 * Fabric lifecycle states
 */
export type FabricState = 'initializing' | 'ready' | 'running' | 'stopping' | 'stopped' | 'error'

/**
 * Fabric state transitions
 *
 * initializing -> ready -> running -> stopping -> stopped
 *                    \-> error
 */
export const VALID_TRANSITIONS: Record<FabricState, readonly FabricState[]> = {
  initializing: ['ready', 'error'],
  ready: ['running', 'stopping', 'error'],
  running: ['stopping', 'error'],
  stopping: ['stopped', 'error'],
  stopped: [],
  error: [],
}

// ============================================================
// FABRIC METADATA
// ============================================================

/**
 * Fabric metadata
 */
export interface FabricMetadata {
  readonly name: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly environment?: string
}

// ============================================================
// FABRIC INTERFACE
// ============================================================

/**
 * Fabric interface
 *
 * The Fabric is the central orchestrator for capability management
 * and execution.
 */
export interface Fabric {
  /**
   * Unique fabric identifier
   */
  readonly id: FabricId

  /**
   * Fabric version
   */
  readonly version: SemanticVersion

  /**
   * Current fabric state
   */
  readonly state: FabricState

  /**
   * Fabric metadata
   */
  readonly metadata: FabricMetadata

  /**
   * When the fabric was created
   */
  readonly createdAt: Timestamp

  /**
   * Register a capability
   *
   * @param capability - The capability to register
   * @returns Registration result (success or failure with reason)
   */
  register<C extends Capability>(capability: C): RegistrationResult<C>

  /**
   * Resolve a capability by ID
   *
   * @param id - The capability ID to resolve
   * @returns Resolution result with the capability or failure reason
   */
  resolve<C extends Capability>(id: CapabilityId): Resolution<C>

  /**
   * Check if a capability is registered
   *
   * @param id - The capability ID to check
   */
  has(id: CapabilityId): boolean

  /**
   * Get all registered capability IDs
   */
  capabilities(): readonly CapabilityId[]

  /**
   * Execute a capability
   *
   * @param id - The capability ID to execute
   * @param input - The input data
   * @param options - Execution options
   * @returns Execution result
   */
  execute<TInput, TOutput>(
    id: CapabilityId,
    input: TInput,
    options?: ExecutionOptions
  ): Promise<ExecutionResult<TOutput>>

  /**
   * Start the fabric (transition to running state)
   */
  start(): Promise<void>

  /**
   * Shutdown the fabric gracefully
   */
  shutdown(): Promise<void>
}

// ============================================================
// FABRIC CONFIGURATION
// ============================================================

/**
 * Fabric configuration options
 */
export interface FabricConfig {
  readonly id?: string
  readonly version?: string
  readonly metadata?: Partial<FabricMetadata>

  /**
   * Default execution timeout (ms)
   */
  readonly defaultTimeout?: number

  /**
   * Maximum concurrent executions
   */
  readonly maxConcurrency?: number

  /**
   * Enable execution tracing
   */
  readonly tracing?: boolean

  /**
   * Enable metrics collection
   */
  readonly metrics?: boolean
}

/**
 * Default fabric configuration
 */
export const DEFAULT_FABRIC_CONFIG: Required<
  Pick<FabricConfig, 'defaultTimeout' | 'maxConcurrency' | 'tracing' | 'metrics'>
> = {
  defaultTimeout: 30000,
  maxConcurrency: 100,
  tracing: false,
  metrics: false,
}

// ============================================================
// FABRIC DESCRIPTOR
// ============================================================

/**
 * Fabric descriptor for creation
 */
export interface FabricDescriptor {
  readonly id?: string
  readonly version?: string
  readonly metadata?: FabricMetadata
  readonly config?: FabricConfig
  readonly capabilities?: readonly Capability[]
}

// ============================================================
// FABRIC SNAPSHOT
// ============================================================

/**
 * Fabric snapshot for introspection
 */
export interface FabricSnapshot {
  readonly id: FabricId
  readonly version: SemanticVersion
  readonly state: FabricState
  readonly metadata: FabricMetadata
  readonly capabilities: readonly CapabilityId[]
  readonly timestamp: Timestamp
}
