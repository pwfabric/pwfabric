/**
 * Event Types
 *
 * PHASE0-WS1: Event system for fabric communication
 *
 * @module @pwfabric/contracts/fabric/events
 */

import type { CapabilityId, FabricId, DomainId } from '../core/ids.js'
import type { Timestamp } from './execution.js'

// ============================================================
// EVENT BASE
// ============================================================

/**
 * Base event interface
 */
export interface BaseEvent {
  readonly id: string
  readonly type: string
  readonly timestamp: Timestamp
  readonly source: EventSource
}

/**
 * Event source identification
 */
export interface EventSource {
  readonly fabricId?: FabricId
  readonly capabilityId?: CapabilityId
  readonly domainId?: DomainId
}

// ============================================================
// FABRIC EVENTS
// ============================================================

/**
 * Fabric event types
 */
export type FabricEventType =
  | 'fabric.created'
  | 'fabric.started'
  | 'fabric.stopped'
  | 'fabric.error'

/**
 * Fabric created event
 */
export interface FabricCreatedEvent extends BaseEvent {
  readonly type: 'fabric.created'
  readonly fabricId: FabricId
  readonly version: string
}

/**
 * Fabric started event
 */
export interface FabricStartedEvent extends BaseEvent {
  readonly type: 'fabric.started'
  readonly fabricId: FabricId
}

/**
 * Fabric stopped event
 */
export interface FabricStoppedEvent extends BaseEvent {
  readonly type: 'fabric.stopped'
  readonly fabricId: FabricId
  readonly reason?: string
}

/**
 * Fabric error event
 */
export interface FabricErrorEvent extends BaseEvent {
  readonly type: 'fabric.error'
  readonly fabricId: FabricId
  readonly error: string
  readonly fatal: boolean
}

// ============================================================
// CAPABILITY EVENTS
// ============================================================

/**
 * Capability event types
 */
export type CapabilityEventType =
  | 'capability.registered'
  | 'capability.unregistered'
  | 'capability.invoked'
  | 'capability.completed'
  | 'capability.failed'

/**
 * Capability registered event
 */
export interface CapabilityRegisteredEvent extends BaseEvent {
  readonly type: 'capability.registered'
  readonly capabilityId: CapabilityId
  readonly version: string
}

/**
 * Capability unregistered event
 */
export interface CapabilityUnregisteredEvent extends BaseEvent {
  readonly type: 'capability.unregistered'
  readonly capabilityId: CapabilityId
}

/**
 * Capability invoked event
 */
export interface CapabilityInvokedEvent extends BaseEvent {
  readonly type: 'capability.invoked'
  readonly capabilityId: CapabilityId
  readonly traceId: string
}

/**
 * Capability completed event
 */
export interface CapabilityCompletedEvent extends BaseEvent {
  readonly type: 'capability.completed'
  readonly capabilityId: CapabilityId
  readonly traceId: string
  readonly duration: number
}

/**
 * Capability failed event
 */
export interface CapabilityFailedEvent extends BaseEvent {
  readonly type: 'capability.failed'
  readonly capabilityId: CapabilityId
  readonly traceId: string
  readonly error: string
}

// ============================================================
// DOMAIN EVENTS
// ============================================================

/**
 * Domain event types
 */
export type DomainEventType = 'domain.registered' | 'domain.unregistered'

/**
 * Domain registered event
 */
export interface DomainRegisteredEvent extends BaseEvent {
  readonly type: 'domain.registered'
  readonly domainId: DomainId
  readonly version: string
}

/**
 * Domain unregistered event
 */
export interface DomainUnregisteredEvent extends BaseEvent {
  readonly type: 'domain.unregistered'
  readonly domainId: DomainId
}

// ============================================================
// EVENT UNION
// ============================================================

/**
 * All fabric events
 */
export type FabricEvent =
  | FabricCreatedEvent
  | FabricStartedEvent
  | FabricStoppedEvent
  | FabricErrorEvent
  | CapabilityRegisteredEvent
  | CapabilityUnregisteredEvent
  | CapabilityInvokedEvent
  | CapabilityCompletedEvent
  | CapabilityFailedEvent
  | DomainRegisteredEvent
  | DomainUnregisteredEvent

// ============================================================
// EVENT BUS INTERFACE
// ============================================================

/**
 * Event handler type
 */
export type EventHandler<E extends BaseEvent = BaseEvent> = (event: E) => void | Promise<void>

/**
 * Event subscription
 */
export interface EventSubscription {
  readonly unsubscribe: () => void
}

/**
 * Event filter
 */
export interface EventFilter {
  readonly types?: readonly string[]
  readonly sources?: readonly EventSource[]
}

/**
 * Event bus interface
 */
export interface EventBus {
  /**
   * Emit an event
   */
  emit<E extends BaseEvent>(event: E): void

  /**
   * Subscribe to events
   */
  subscribe<E extends BaseEvent>(handler: EventHandler<E>, filter?: EventFilter): EventSubscription

  /**
   * Subscribe to a specific event type
   */
  on<E extends BaseEvent>(type: E['type'], handler: EventHandler<E>): EventSubscription

  /**
   * Subscribe to an event type once
   */
  once<E extends BaseEvent>(type: E['type'], handler: EventHandler<E>): EventSubscription
}

// ============================================================
// EVENT UTILITIES
// ============================================================

/**
 * Generate a unique event ID
 */
export function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create a base event
 */
export function createEvent<T extends string>(
  type: T,
  source: EventSource,
  timestamp: Timestamp = Date.now()
): BaseEvent & { type: T } {
  return {
    id: generateEventId(),
    type,
    timestamp,
    source,
  }
}
