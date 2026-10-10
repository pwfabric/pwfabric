/**
 * Manifestation Definition Tests
 *
 * Tests for manifestation types and state transitions
 *
 * @module @pwfabric/contracts/fabric/__tests__/manifestation
 */

import { describe, it, expect, vi } from 'vitest'
import {
  MANIFESTATION_TRANSITIONS,
  type ManifestationState,
  type ManifestationMetadata,
  type ManifestationSnapshot,
  type ManifestationStats,
  type ManifestationEventType,
  type StateChangedEvent,
  type ManifestationCapabilityRegisteredEvent,
  type ManifestationCapabilityUnregisteredEvent,
  type ExecutionStartedEvent,
  type ExecutionCompletedEvent,
  type ExecutionFailedEvent,
  type ManifestationErrorEvent,
  type ManifestationEventHandler,
  type ManifestationSubscription,
  type ManifestationDescriptor,
} from '../../fabric/manifestation.js'
import type { CapabilityId, FabricId, ManifestationId } from '../../core/ids.js'

describe('MANIFESTATION_TRANSITIONS', () => {
  it('should define transitions from initializing', () => {
    expect(MANIFESTATION_TRANSITIONS.initializing).toContain('ready')
    expect(MANIFESTATION_TRANSITIONS.initializing).toContain('failed')
    expect(MANIFESTATION_TRANSITIONS.initializing).toHaveLength(2)
  })

  it('should define transitions from ready', () => {
    expect(MANIFESTATION_TRANSITIONS.ready).toContain('running')
    expect(MANIFESTATION_TRANSITIONS.ready).toContain('stopping')
    expect(MANIFESTATION_TRANSITIONS.ready).toContain('failed')
    expect(MANIFESTATION_TRANSITIONS.ready).toHaveLength(3)
  })

  it('should define transitions from running', () => {
    expect(MANIFESTATION_TRANSITIONS.running).toContain('stopping')
    expect(MANIFESTATION_TRANSITIONS.running).toContain('failed')
    expect(MANIFESTATION_TRANSITIONS.running).toHaveLength(2)
  })

  it('should define transitions from stopping', () => {
    expect(MANIFESTATION_TRANSITIONS.stopping).toContain('stopped')
    expect(MANIFESTATION_TRANSITIONS.stopping).toContain('failed')
    expect(MANIFESTATION_TRANSITIONS.stopping).toHaveLength(2)
  })

  it('should have no transitions from stopped', () => {
    expect(MANIFESTATION_TRANSITIONS.stopped).toHaveLength(0)
  })

  it('should allow restart from failed state', () => {
    expect(MANIFESTATION_TRANSITIONS.failed).toContain('initializing')
    expect(MANIFESTATION_TRANSITIONS.failed).toHaveLength(1)
  })

  it('should cover all manifestation states', () => {
    const states: ManifestationState[] = [
      'initializing',
      'ready',
      'running',
      'stopping',
      'stopped',
      'failed',
    ]

    states.forEach((state) => {
      expect(MANIFESTATION_TRANSITIONS).toHaveProperty(state)
    })
  })
})

describe('ManifestationState', () => {
  it('should accept all valid states', () => {
    const states: ManifestationState[] = [
      'initializing',
      'ready',
      'running',
      'stopping',
      'stopped',
      'failed',
    ]

    expect(states).toHaveLength(6)
  })
})

describe('ManifestationMetadata', () => {
  it('should accept empty metadata', () => {
    const metadata: ManifestationMetadata = {}

    expect(metadata.name).toBeUndefined()
  })

  it('should accept full metadata', () => {
    const metadata: ManifestationMetadata = {
      name: 'Production Instance',
      description: 'Main production manifestation',
      tags: ['production', 'primary'],
    }

    expect(metadata.name).toBe('Production Instance')
    expect(metadata.description).toBe('Main production manifestation')
    expect(metadata.tags).toHaveLength(2)
  })
})

describe('ManifestationSnapshot', () => {
  it('should contain all required fields', () => {
    const snapshot: ManifestationSnapshot = {
      id: 'manifest-1' as ManifestationId,
      fabricId: 'fabric-1' as FabricId,
      fabricVersion: { major: 1, minor: 0, patch: 0 },
      environment: { name: 'production', tier: 'production' },
      state: 'running',
      metadata: { name: 'Prod Instance' },
      capabilities: ['auth/login'] as CapabilityId[],
      startedAt: Date.now() - 3600000,
      updatedAt: Date.now() - 60000,
      timestamp: Date.now(),
      stats: {
        totalExecutions: 1000,
        successfulExecutions: 980,
        failedExecutions: 20,
        uptime: 3600000,
      },
    }

    expect(snapshot.id).toBe('manifest-1')
    expect(snapshot.state).toBe('running')
    expect(snapshot.stats.totalExecutions).toBe(1000)
  })
})

describe('ManifestationStats', () => {
  it('should contain all metrics', () => {
    const stats: ManifestationStats = {
      totalExecutions: 5000,
      successfulExecutions: 4800,
      failedExecutions: 200,
      uptime: 86400000, // 24 hours
    }

    expect(stats.totalExecutions).toBe(5000)
    expect(stats.successfulExecutions + stats.failedExecutions).toBe(stats.totalExecutions)
    expect(stats.uptime).toBe(86400000)
  })
})

describe('ManifestationEventType', () => {
  it('should include all event types', () => {
    const types: ManifestationEventType[] = [
      'state_changed',
      'capability_registered',
      'capability_unregistered',
      'execution_started',
      'execution_completed',
      'execution_failed',
      'error',
    ]

    expect(types).toHaveLength(7)
  })
})

describe('Manifestation Events', () => {
  it('should create StateChangedEvent', () => {
    const event: StateChangedEvent = {
      type: 'state_changed',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      previousState: 'ready',
      newState: 'running',
    }

    expect(event.type).toBe('state_changed')
    expect(event.previousState).toBe('ready')
    expect(event.newState).toBe('running')
  })

  it('should create ManifestationCapabilityRegisteredEvent', () => {
    const event: ManifestationCapabilityRegisteredEvent = {
      type: 'capability_registered',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      capabilityId: 'auth/login' as CapabilityId,
    }

    expect(event.type).toBe('capability_registered')
    expect(event.capabilityId).toBe('auth/login')
  })

  it('should create ManifestationCapabilityUnregisteredEvent', () => {
    const event: ManifestationCapabilityUnregisteredEvent = {
      type: 'capability_unregistered',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      capabilityId: 'auth/login' as CapabilityId,
    }

    expect(event.type).toBe('capability_unregistered')
  })

  it('should create ExecutionStartedEvent', () => {
    const event: ExecutionStartedEvent = {
      type: 'execution_started',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      capabilityId: 'auth/login' as CapabilityId,
      traceId: 'trace-123',
    }

    expect(event.type).toBe('execution_started')
    expect(event.traceId).toBe('trace-123')
  })

  it('should create ExecutionCompletedEvent', () => {
    const event: ExecutionCompletedEvent = {
      type: 'execution_completed',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      capabilityId: 'auth/login' as CapabilityId,
      traceId: 'trace-123',
      duration: 150,
    }

    expect(event.type).toBe('execution_completed')
    expect(event.duration).toBe(150)
  })

  it('should create ExecutionFailedEvent', () => {
    const event: ExecutionFailedEvent = {
      type: 'execution_failed',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      capabilityId: 'auth/login' as CapabilityId,
      traceId: 'trace-123',
      error: 'Authentication failed',
    }

    expect(event.type).toBe('execution_failed')
    expect(event.error).toBe('Authentication failed')
  })

  it('should create ManifestationErrorEvent', () => {
    const event: ManifestationErrorEvent = {
      type: 'error',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      error: 'Critical system error',
      fatal: true,
    }

    expect(event.type).toBe('error')
    expect(event.fatal).toBe(true)
  })
})

describe('ManifestationEventHandler', () => {
  it('should handle events', () => {
    const handler: ManifestationEventHandler = vi.fn()
    const event: StateChangedEvent = {
      type: 'state_changed',
      manifestationId: 'manifest-1' as ManifestationId,
      timestamp: Date.now(),
      previousState: 'ready',
      newState: 'running',
    }

    handler(event)

    expect(handler).toHaveBeenCalledWith(event)
  })
})

describe('ManifestationSubscription', () => {
  it('should have unsubscribe method', () => {
    const subscription: ManifestationSubscription = {
      unsubscribe: vi.fn(),
    }

    subscription.unsubscribe()

    expect(subscription.unsubscribe).toHaveBeenCalled()
  })
})

describe('ManifestationDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: ManifestationDescriptor = {
      fabricId: 'fabric-1' as FabricId,
      environment: { name: 'development', tier: 'development' },
    }

    expect(descriptor.fabricId).toBe('fabric-1')
  })

  it('should accept full descriptor', () => {
    const descriptor: ManifestationDescriptor = {
      fabricId: 'fabric-1' as FabricId,
      environment: { name: 'production', tier: 'production' },
      metadata: {
        name: 'Prod Instance',
        description: 'Production manifestation',
        tags: ['production'],
      },
    }

    expect(descriptor.metadata?.name).toBe('Prod Instance')
  })
})

describe('State transition validation', () => {
  it('should validate happy path: initializing -> ready -> running -> stopping -> stopped', () => {
    const happyPath: ManifestationState[] = [
      'initializing',
      'ready',
      'running',
      'stopping',
      'stopped',
    ]

    for (let i = 0; i < happyPath.length - 1; i++) {
      const current = happyPath[i]
      const next = happyPath[i + 1]
      expect(MANIFESTATION_TRANSITIONS[current]).toContain(next)
    }
  })

  it('should allow failed state from active states', () => {
    const activeStates: ManifestationState[] = ['initializing', 'ready', 'running', 'stopping']

    activeStates.forEach((state) => {
      expect(MANIFESTATION_TRANSITIONS[state]).toContain('failed')
    })
  })

  it('should allow recovery from failed state', () => {
    expect(MANIFESTATION_TRANSITIONS.failed).toContain('initializing')
  })
})
