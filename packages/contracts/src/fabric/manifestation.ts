/**
 * Manifestation Definition
 *
 * PHASE0-WS1: Deployed instances of fabric configurations
 *
 * A Manifestation is a deployed, running instance of a Fabric
 * configuration bound to a specific environment.
 *
 * INVARIANTS:
 * - A Manifestation is created from a Fabric definition
 * - A Manifestation holds runtime state
 * - A Manifestation is bound to exactly one environment
 * - A Manifestation lifecycle is: INITIALIZING -> READY -> RUNNING -> STOPPING -> STOPPED
 * - A Manifestation can be introspected at runtime
 *
 * @module @pwfabric/contracts/fabric/manifestation
 */

import type { CapabilityId, FabricId, ManifestationId } from '../core/ids.js'
import type { SemanticVersion } from '../core/version.js'
import type { Capability } from './capability.js'
import type { EnvironmentDescriptor } from './surface.js'
import type { Timestamp } from './execution.js'

// ============================================================
// MANIFESTATION STATE
// ============================================================

/**
 * Manifestation lifecycle states
 */
export type ManifestationState =
  | 'initializing'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'failed'

/**
 * Valid state transitions for manifestation
 */
export const MANIFESTATION_TRANSITIONS: Record<ManifestationState, readonly ManifestationState[]> =
  {
    initializing: ['ready', 'failed'],
    ready: ['running', 'stopping', 'failed'],
    running: ['stopping', 'failed'],
    stopping: ['stopped', 'failed'],
    stopped: [],
    failed: ['initializing'], // Can restart from failed
  }

// ============================================================
// MANIFESTATION METADATA
// ============================================================

/**
 * Manifestation metadata
 */
export interface ManifestationMetadata {
  readonly name?: string
  readonly description?: string
  readonly tags?: readonly string[]
}

// ============================================================
// MANIFESTATION INTERFACE
// ============================================================

/**
 * Manifestation interface
 */
export interface Manifestation {
  /**
   * Unique manifestation identifier
   */
  readonly id: ManifestationId

  /**
   * The fabric this manifestation was created from
   */
  readonly fabricId: FabricId

  /**
   * Fabric version at creation time
   */
  readonly fabricVersion: SemanticVersion

  /**
   * Target environment
   */
  readonly environment: EnvironmentDescriptor

  /**
   * Current manifestation state
   */
  readonly state: ManifestationState

  /**
   * Manifestation metadata
   */
  readonly metadata: ManifestationMetadata

  /**
   * When the manifestation was started
   */
  readonly startedAt: Timestamp

  /**
   * When the manifestation was last updated
   */
  readonly updatedAt: Timestamp

  /**
   * Get a capability from this manifestation
   */
  getCapability<C extends Capability>(id: CapabilityId): C | undefined

  /**
   * Check if a capability exists in this manifestation
   */
  hasCapability(id: CapabilityId): boolean

  /**
   * List all capabilities in this manifestation
   */
  capabilities(): readonly CapabilityId[]

  /**
   * Get the current manifestation snapshot
   */
  getSnapshot(): ManifestationSnapshot

  /**
   * Emit a manifestation event
   */
  emit(event: ManifestationEvent): void

  /**
   * Subscribe to manifestation events
   */
  subscribe(handler: ManifestationEventHandler): ManifestationSubscription

  /**
   * Stop the manifestation
   */
  stop(): Promise<void>
}

// ============================================================
// MANIFESTATION SNAPSHOT
// ============================================================

/**
 * Manifestation snapshot for introspection
 */
export interface ManifestationSnapshot {
  readonly id: ManifestationId
  readonly fabricId: FabricId
  readonly fabricVersion: SemanticVersion
  readonly environment: EnvironmentDescriptor
  readonly state: ManifestationState
  readonly metadata: ManifestationMetadata
  readonly capabilities: readonly CapabilityId[]
  readonly startedAt: Timestamp
  readonly updatedAt: Timestamp
  readonly timestamp: Timestamp
  readonly stats: ManifestationStats
}

/**
 * Manifestation statistics
 */
export interface ManifestationStats {
  readonly totalExecutions: number
  readonly successfulExecutions: number
  readonly failedExecutions: number
  readonly uptime: number
}

// ============================================================
// MANIFESTATION EVENTS
// ============================================================

/**
 * Manifestation event types
 */
export type ManifestationEventType =
  | 'state_changed'
  | 'capability_registered'
  | 'capability_unregistered'
  | 'execution_started'
  | 'execution_completed'
  | 'execution_failed'
  | 'error'

/**
 * Base manifestation event
 */
export interface BaseManifestationEvent {
  readonly type: ManifestationEventType
  readonly manifestationId: ManifestationId
  readonly timestamp: Timestamp
}

/**
 * State change event
 */
export interface StateChangedEvent extends BaseManifestationEvent {
  readonly type: 'state_changed'
  readonly previousState: ManifestationState
  readonly newState: ManifestationState
}

/**
 * Capability registered event (manifestation-specific)
 */
export interface ManifestationCapabilityRegisteredEvent extends BaseManifestationEvent {
  readonly type: 'capability_registered'
  readonly capabilityId: CapabilityId
}

/**
 * Capability unregistered event (manifestation-specific)
 */
export interface ManifestationCapabilityUnregisteredEvent extends BaseManifestationEvent {
  readonly type: 'capability_unregistered'
  readonly capabilityId: CapabilityId
}

/**
 * Execution started event
 */
export interface ExecutionStartedEvent extends BaseManifestationEvent {
  readonly type: 'execution_started'
  readonly capabilityId: CapabilityId
  readonly traceId: string
}

/**
 * Execution completed event
 */
export interface ExecutionCompletedEvent extends BaseManifestationEvent {
  readonly type: 'execution_completed'
  readonly capabilityId: CapabilityId
  readonly traceId: string
  readonly duration: number
}

/**
 * Execution failed event
 */
export interface ExecutionFailedEvent extends BaseManifestationEvent {
  readonly type: 'execution_failed'
  readonly capabilityId: CapabilityId
  readonly traceId: string
  readonly error: string
}

/**
 * Error event
 */
export interface ManifestationErrorEvent extends BaseManifestationEvent {
  readonly type: 'error'
  readonly error: string
  readonly fatal: boolean
}

/**
 * Union of all manifestation events
 */
export type ManifestationEvent =
  | StateChangedEvent
  | ManifestationCapabilityRegisteredEvent
  | ManifestationCapabilityUnregisteredEvent
  | ExecutionStartedEvent
  | ExecutionCompletedEvent
  | ExecutionFailedEvent
  | ManifestationErrorEvent

/**
 * Manifestation event handler
 */
export type ManifestationEventHandler = (event: ManifestationEvent) => void

/**
 * Manifestation subscription
 */
export interface ManifestationSubscription {
  readonly unsubscribe: () => void
}

// ============================================================
// MANIFESTATION DESCRIPTOR
// ============================================================

/**
 * Manifestation descriptor for creation
 */
export interface ManifestationDescriptor {
  readonly fabricId: FabricId
  readonly environment: EnvironmentDescriptor
  readonly metadata?: ManifestationMetadata
}
