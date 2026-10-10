/**
 * Fabric Definition Tests
 *
 * Tests for fabric types, state transitions, and configuration
 *
 * @module @pwfabric/contracts/fabric/__tests__/fabric
 */

import { describe, it, expect } from 'vitest'
import {
  VALID_TRANSITIONS,
  DEFAULT_FABRIC_CONFIG,
  type FabricState,
  type FabricMetadata,
  type FabricConfig,
  type FabricDescriptor,
  type FabricSnapshot,
} from '../../fabric/fabric.js'
import type { CapabilityId, FabricId } from '../../core/ids.js'

describe('VALID_TRANSITIONS', () => {
  it('should define transitions from initializing', () => {
    expect(VALID_TRANSITIONS.initializing).toContain('ready')
    expect(VALID_TRANSITIONS.initializing).toContain('error')
    expect(VALID_TRANSITIONS.initializing).toHaveLength(2)
  })

  it('should define transitions from ready', () => {
    expect(VALID_TRANSITIONS.ready).toContain('running')
    expect(VALID_TRANSITIONS.ready).toContain('stopping')
    expect(VALID_TRANSITIONS.ready).toContain('error')
    expect(VALID_TRANSITIONS.ready).toHaveLength(3)
  })

  it('should define transitions from running', () => {
    expect(VALID_TRANSITIONS.running).toContain('stopping')
    expect(VALID_TRANSITIONS.running).toContain('error')
    expect(VALID_TRANSITIONS.running).toHaveLength(2)
  })

  it('should define transitions from stopping', () => {
    expect(VALID_TRANSITIONS.stopping).toContain('stopped')
    expect(VALID_TRANSITIONS.stopping).toContain('error')
    expect(VALID_TRANSITIONS.stopping).toHaveLength(2)
  })

  it('should have no transitions from stopped', () => {
    expect(VALID_TRANSITIONS.stopped).toHaveLength(0)
  })

  it('should have no transitions from error', () => {
    expect(VALID_TRANSITIONS.error).toHaveLength(0)
  })

  it('should cover all fabric states', () => {
    const states: FabricState[] = [
      'initializing',
      'ready',
      'running',
      'stopping',
      'stopped',
      'error',
    ]

    states.forEach((state) => {
      expect(VALID_TRANSITIONS).toHaveProperty(state)
    })
  })

  it('should not allow invalid transitions', () => {
    // stopped -> anything
    expect(VALID_TRANSITIONS.stopped).not.toContain('running')
    expect(VALID_TRANSITIONS.stopped).not.toContain('ready')

    // error -> anything
    expect(VALID_TRANSITIONS.error).not.toContain('running')
    expect(VALID_TRANSITIONS.error).not.toContain('ready')

    // running -> initializing (backwards)
    expect(VALID_TRANSITIONS.running).not.toContain('initializing')
    expect(VALID_TRANSITIONS.running).not.toContain('ready')
  })
})

describe('DEFAULT_FABRIC_CONFIG', () => {
  it('should have default timeout', () => {
    expect(DEFAULT_FABRIC_CONFIG.defaultTimeout).toBe(30000)
  })

  it('should have default max concurrency', () => {
    expect(DEFAULT_FABRIC_CONFIG.maxConcurrency).toBe(100)
  })

  it('should have tracing disabled by default', () => {
    expect(DEFAULT_FABRIC_CONFIG.tracing).toBe(false)
  })

  it('should have metrics disabled by default', () => {
    expect(DEFAULT_FABRIC_CONFIG.metrics).toBe(false)
  })

  it('should have all required properties', () => {
    expect(DEFAULT_FABRIC_CONFIG).toHaveProperty('defaultTimeout')
    expect(DEFAULT_FABRIC_CONFIG).toHaveProperty('maxConcurrency')
    expect(DEFAULT_FABRIC_CONFIG).toHaveProperty('tracing')
    expect(DEFAULT_FABRIC_CONFIG).toHaveProperty('metrics')
  })
})

describe('FabricState', () => {
  it('should accept all valid states', () => {
    const states: FabricState[] = [
      'initializing',
      'ready',
      'running',
      'stopping',
      'stopped',
      'error',
    ]

    expect(states).toHaveLength(6)
    states.forEach((state) => {
      expect(typeof state).toBe('string')
    })
  })
})

describe('FabricMetadata', () => {
  it('should accept minimal metadata', () => {
    const metadata: FabricMetadata = {
      name: 'Main Fabric',
    }

    expect(metadata.name).toBe('Main Fabric')
  })

  it('should accept full metadata', () => {
    const metadata: FabricMetadata = {
      name: 'Production Fabric',
      description: 'Main production fabric instance',
      tags: ['production', 'main', 'critical'],
      environment: 'production',
    }

    expect(metadata.description).toBe('Main production fabric instance')
    expect(metadata.tags).toContain('production')
    expect(metadata.environment).toBe('production')
  })
})

describe('FabricConfig', () => {
  it('should accept empty config', () => {
    const config: FabricConfig = {}

    expect(config.defaultTimeout).toBeUndefined()
  })

  it('should accept full config', () => {
    const config: FabricConfig = {
      id: 'fabric-prod-1',
      version: '1.0.0',
      metadata: { name: 'Production' },
      defaultTimeout: 60000,
      maxConcurrency: 200,
      tracing: true,
      metrics: true,
    }

    expect(config.id).toBe('fabric-prod-1')
    expect(config.defaultTimeout).toBe(60000)
    expect(config.maxConcurrency).toBe(200)
    expect(config.tracing).toBe(true)
    expect(config.metrics).toBe(true)
  })
})

describe('FabricDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: FabricDescriptor = {}

    expect(descriptor.id).toBeUndefined()
  })

  it('should accept full descriptor', () => {
    const descriptor: FabricDescriptor = {
      id: 'fabric-1',
      version: '2.0.0',
      metadata: {
        name: 'Main Fabric',
        description: 'Primary fabric instance',
      },
      config: {
        defaultTimeout: 45000,
        tracing: true,
      },
      capabilities: [],
    }

    expect(descriptor.id).toBe('fabric-1')
    expect(descriptor.version).toBe('2.0.0')
    expect(descriptor.metadata?.name).toBe('Main Fabric')
  })
})

describe('FabricSnapshot', () => {
  it('should contain all required fields', () => {
    const snapshot: FabricSnapshot = {
      id: 'fabric-1' as FabricId,
      version: { major: 1, minor: 0, patch: 0 },
      state: 'running',
      metadata: { name: 'Test Fabric' },
      capabilities: ['auth/login', 'payments/process'] as CapabilityId[],
      timestamp: Date.now(),
    }

    expect(snapshot.id).toBe('fabric-1')
    expect(snapshot.state).toBe('running')
    expect(snapshot.capabilities).toHaveLength(2)
  })

  it('should capture point-in-time state', () => {
    const beforeTimestamp = Date.now()
    const snapshot: FabricSnapshot = {
      id: 'fabric-1' as FabricId,
      version: { major: 1, minor: 0, patch: 0 },
      state: 'ready',
      metadata: { name: 'Test Fabric' },
      capabilities: [],
      timestamp: Date.now(),
    }
    const afterTimestamp = Date.now()

    expect(snapshot.timestamp).toBeGreaterThanOrEqual(beforeTimestamp)
    expect(snapshot.timestamp).toBeLessThanOrEqual(afterTimestamp)
  })
})

describe('State transition validation', () => {
  it('should validate happy path: initializing -> ready -> running -> stopping -> stopped', () => {
    const happyPath: FabricState[] = ['initializing', 'ready', 'running', 'stopping', 'stopped']

    for (let i = 0; i < happyPath.length - 1; i++) {
      const current = happyPath[i]
      const next = happyPath[i + 1]
      expect(VALID_TRANSITIONS[current]).toContain(next)
    }
  })

  it('should allow error state from any active state', () => {
    const activeStates: FabricState[] = ['initializing', 'ready', 'running', 'stopping']

    activeStates.forEach((state) => {
      expect(VALID_TRANSITIONS[state]).toContain('error')
    })
  })
})
