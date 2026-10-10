/**
 * Event Types Tests
 *
 * Tests for event system types and utilities
 *
 * @module @pwfabric/contracts/fabric/__tests__/events
 */

import { describe, it, expect, vi } from 'vitest'
import {
  generateEventId,
  createEvent,
  type BaseEvent,
  type EventSource,
  type FabricEventType,
  type FabricCreatedEvent,
  type FabricStartedEvent,
  type FabricStoppedEvent,
  type FabricErrorEvent,
  type CapabilityEventType,
  type CapabilityRegisteredEvent,
  type CapabilityUnregisteredEvent,
  type CapabilityInvokedEvent,
  type CapabilityCompletedEvent,
  type CapabilityFailedEvent,
  type DomainEventType,
  type DomainRegisteredEvent,
  type DomainUnregisteredEvent,
  type EventHandler,
  type EventSubscription,
  type EventFilter,
} from '../../fabric/events.js'
import type { CapabilityId, FabricId, DomainId } from '../../core/ids.js'

describe('generateEventId', () => {
  it('should generate unique event IDs', () => {
    const id1 = generateEventId()
    const id2 = generateEventId()

    expect(id1).not.toBe(id2)
  })

  it('should start with evt_ prefix', () => {
    const id = generateEventId()

    expect(id).toMatch(/^evt_/)
  })

  it('should contain timestamp component', () => {
    const before = Date.now()
    const id = generateEventId()
    const after = Date.now()

    // Extract timestamp from ID (format: evt_<timestamp>_<random>)
    const parts = id.split('_')
    const timestamp = parseInt(parts[1], 10)

    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })

  it('should contain random component', () => {
    const id = generateEventId()

    // Format: evt_<timestamp>_<random>
    const parts = id.split('_')
    expect(parts).toHaveLength(3)
    expect(parts[2].length).toBeGreaterThan(0)
  })
})

describe('createEvent', () => {
  it('should create event with specified type', () => {
    const source: EventSource = { fabricId: 'fabric-1' as FabricId }
    const event = createEvent('test.event', source)

    expect(event.type).toBe('test.event')
  })

  it('should create event with specified source', () => {
    const source: EventSource = {
      fabricId: 'fabric-1' as FabricId,
      capabilityId: 'auth/login' as CapabilityId,
      domainId: 'auth/core' as DomainId,
    }
    const event = createEvent('test.event', source)

    expect(event.source.fabricId).toBe('fabric-1')
    expect(event.source.capabilityId).toBe('auth/login')
    expect(event.source.domainId).toBe('auth/core')
  })

  it('should use current timestamp by default', () => {
    const before = Date.now()
    const source: EventSource = {}
    const event = createEvent('test.event', source)
    const after = Date.now()

    expect(event.timestamp).toBeGreaterThanOrEqual(before)
    expect(event.timestamp).toBeLessThanOrEqual(after)
  })

  it('should use provided timestamp', () => {
    const source: EventSource = {}
    const customTimestamp = 1234567890123
    const event = createEvent('test.event', source, customTimestamp)

    expect(event.timestamp).toBe(customTimestamp)
  })

  it('should generate unique ID for each event', () => {
    const source: EventSource = {}
    const event1 = createEvent('test.event', source)
    const event2 = createEvent('test.event', source)

    expect(event1.id).not.toBe(event2.id)
  })
})

describe('BaseEvent', () => {
  it('should have required properties', () => {
    const event: BaseEvent = {
      id: 'evt_123',
      type: 'test.event',
      timestamp: Date.now(),
      source: {},
    }

    expect(event.id).toBe('evt_123')
    expect(event.type).toBe('test.event')
  })
})

describe('EventSource', () => {
  it('should accept empty source', () => {
    const source: EventSource = {}

    expect(source.fabricId).toBeUndefined()
  })

  it('should accept full source', () => {
    const source: EventSource = {
      fabricId: 'fabric-1' as FabricId,
      capabilityId: 'auth/login' as CapabilityId,
      domainId: 'auth/core' as DomainId,
    }

    expect(source.fabricId).toBe('fabric-1')
    expect(source.capabilityId).toBe('auth/login')
    expect(source.domainId).toBe('auth/core')
  })
})

describe('FabricEventType', () => {
  it('should include all fabric event types', () => {
    const types: FabricEventType[] = [
      'fabric.created',
      'fabric.started',
      'fabric.stopped',
      'fabric.error',
    ]

    expect(types).toHaveLength(4)
  })
})

describe('Fabric Events', () => {
  it('should create FabricCreatedEvent', () => {
    const event: FabricCreatedEvent = {
      id: 'evt_123',
      type: 'fabric.created',
      timestamp: Date.now(),
      source: {},
      fabricId: 'fabric-1' as FabricId,
      version: '1.0.0',
    }

    expect(event.type).toBe('fabric.created')
    expect(event.fabricId).toBe('fabric-1')
  })

  it('should create FabricStartedEvent', () => {
    const event: FabricStartedEvent = {
      id: 'evt_123',
      type: 'fabric.started',
      timestamp: Date.now(),
      source: {},
      fabricId: 'fabric-1' as FabricId,
    }

    expect(event.type).toBe('fabric.started')
  })

  it('should create FabricStoppedEvent', () => {
    const event: FabricStoppedEvent = {
      id: 'evt_123',
      type: 'fabric.stopped',
      timestamp: Date.now(),
      source: {},
      fabricId: 'fabric-1' as FabricId,
      reason: 'Graceful shutdown',
    }

    expect(event.type).toBe('fabric.stopped')
    expect(event.reason).toBe('Graceful shutdown')
  })

  it('should create FabricErrorEvent', () => {
    const event: FabricErrorEvent = {
      id: 'evt_123',
      type: 'fabric.error',
      timestamp: Date.now(),
      source: {},
      fabricId: 'fabric-1' as FabricId,
      error: 'Connection lost',
      fatal: true,
    }

    expect(event.type).toBe('fabric.error')
    expect(event.fatal).toBe(true)
  })
})

describe('CapabilityEventType', () => {
  it('should include all capability event types', () => {
    const types: CapabilityEventType[] = [
      'capability.registered',
      'capability.unregistered',
      'capability.invoked',
      'capability.completed',
      'capability.failed',
    ]

    expect(types).toHaveLength(5)
  })
})

describe('Capability Events', () => {
  it('should create CapabilityRegisteredEvent', () => {
    const event: CapabilityRegisteredEvent = {
      id: 'evt_123',
      type: 'capability.registered',
      timestamp: Date.now(),
      source: {},
      capabilityId: 'auth/login' as CapabilityId,
      version: '1.0.0',
    }

    expect(event.type).toBe('capability.registered')
    expect(event.capabilityId).toBe('auth/login')
  })

  it('should create CapabilityUnregisteredEvent', () => {
    const event: CapabilityUnregisteredEvent = {
      id: 'evt_123',
      type: 'capability.unregistered',
      timestamp: Date.now(),
      source: {},
      capabilityId: 'auth/login' as CapabilityId,
    }

    expect(event.type).toBe('capability.unregistered')
  })

  it('should create CapabilityInvokedEvent', () => {
    const event: CapabilityInvokedEvent = {
      id: 'evt_123',
      type: 'capability.invoked',
      timestamp: Date.now(),
      source: {},
      capabilityId: 'auth/login' as CapabilityId,
      traceId: 'trace-123',
    }

    expect(event.type).toBe('capability.invoked')
    expect(event.traceId).toBe('trace-123')
  })

  it('should create CapabilityCompletedEvent', () => {
    const event: CapabilityCompletedEvent = {
      id: 'evt_123',
      type: 'capability.completed',
      timestamp: Date.now(),
      source: {},
      capabilityId: 'auth/login' as CapabilityId,
      traceId: 'trace-123',
      duration: 150,
    }

    expect(event.type).toBe('capability.completed')
    expect(event.duration).toBe(150)
  })

  it('should create CapabilityFailedEvent', () => {
    const event: CapabilityFailedEvent = {
      id: 'evt_123',
      type: 'capability.failed',
      timestamp: Date.now(),
      source: {},
      capabilityId: 'auth/login' as CapabilityId,
      traceId: 'trace-123',
      error: 'Authentication failed',
    }

    expect(event.type).toBe('capability.failed')
    expect(event.error).toBe('Authentication failed')
  })
})

describe('DomainEventType', () => {
  it('should include all domain event types', () => {
    const types: DomainEventType[] = ['domain.registered', 'domain.unregistered']

    expect(types).toHaveLength(2)
  })
})

describe('Domain Events', () => {
  it('should create DomainRegisteredEvent', () => {
    const event: DomainRegisteredEvent = {
      id: 'evt_123',
      type: 'domain.registered',
      timestamp: Date.now(),
      source: {},
      domainId: 'auth/core' as DomainId,
      version: '1.0.0',
    }

    expect(event.type).toBe('domain.registered')
    expect(event.domainId).toBe('auth/core')
  })

  it('should create DomainUnregisteredEvent', () => {
    const event: DomainUnregisteredEvent = {
      id: 'evt_123',
      type: 'domain.unregistered',
      timestamp: Date.now(),
      source: {},
      domainId: 'auth/core' as DomainId,
    }

    expect(event.type).toBe('domain.unregistered')
  })
})

describe('EventHandler', () => {
  it('should handle events synchronously', () => {
    const handler: EventHandler = (event) => {
      expect(event.type).toBeDefined()
    }

    const event: BaseEvent = {
      id: 'evt_123',
      type: 'test',
      timestamp: Date.now(),
      source: {},
    }

    handler(event)
  })

  it('should handle events asynchronously', async () => {
    const handler: EventHandler = async (event) => {
      await Promise.resolve()
      expect(event.type).toBeDefined()
    }

    const event: BaseEvent = {
      id: 'evt_123',
      type: 'test',
      timestamp: Date.now(),
      source: {},
    }

    await handler(event)
  })
})

describe('EventSubscription', () => {
  it('should have unsubscribe method', () => {
    const subscription: EventSubscription = {
      unsubscribe: vi.fn(),
    }

    subscription.unsubscribe()

    expect(subscription.unsubscribe).toHaveBeenCalled()
  })
})

describe('EventFilter', () => {
  it('should accept empty filter', () => {
    const filter: EventFilter = {}

    expect(filter.types).toBeUndefined()
    expect(filter.sources).toBeUndefined()
  })

  it('should accept filter with types', () => {
    const filter: EventFilter = {
      types: ['fabric.created', 'capability.registered'],
    }

    expect(filter.types).toHaveLength(2)
  })

  it('should accept filter with sources', () => {
    const filter: EventFilter = {
      sources: [{ fabricId: 'fabric-1' as FabricId }],
    }

    expect(filter.sources).toHaveLength(1)
  })
})
