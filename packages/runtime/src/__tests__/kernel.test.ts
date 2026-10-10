/**
 * FabricKernel Tests
 *
 * Fabric kernel - capability registration, resolution, execution.
 *
 * @module @pwfabric/runtime/__tests__/kernel
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { FabricKernel, createFabric } from '../kernel.js'
import type { CapabilityId, Capability } from '@pwfabric/contracts'
import { ok, err, validationError } from '@pwfabric/contracts'

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// HELPERS
// ============================================================

function makeCapability(
  id: string,
  opts: {
    execute?: () => Promise<unknown>
    validateInput?: (d: unknown) => ReturnType<Capability['contract']['validateInput']>
    validateOutput?: (d: unknown) => ReturnType<Capability['contract']['validateOutput']>
    deps?: string[]
  } = {}
): Capability {
  const { execute, validateInput, validateOutput, deps = [] } = opts
  return {
    id: id as CapabilityId,
    version: { major: 1, minor: 0, patch: 0 },
    contract: {
      id: `${id}-contract` as never,
      version: '1.0.0',
      metadata: { name: id, state: 'stable' },
      inputSchema: {} as never,
      outputSchema: {} as never,
      validateInput: validateInput ?? ((d) => ok(d as never)),
      validateOutput: validateOutput ?? ((d) => ok(d as never)),
    },
    dependencies: deps as unknown as readonly CapabilityId[],
    metadata: { name: id, state: 'stable' },
    execute: execute ?? (async () => ok({ done: true })),
  }
}

// ============================================================
// FabricKernel
// ============================================================

describe('FabricKernel', () => {
  describe('constructor', () => {
    it('creates a fabric with default config', () => {
      const fabric = new FabricKernel()
      expect(fabric.id).toBeDefined()
      expect(fabric.state).toBe('ready')
      expect(fabric.metadata.name).toBe('PWFabric')
    })

    it('accepts custom id', () => {
      const fabric = new FabricKernel({ id: 'my-fabric' })
      expect(fabric.id).toContain('my-fabric')
    })

    it('accepts custom metadata', () => {
      const fabric = new FabricKernel({
        metadata: { name: 'Custom Fabric', description: 'test', tags: ['a'], environment: 'test' },
      })
      expect(fabric.metadata.name).toBe('Custom Fabric')
      expect(fabric.metadata.description).toBe('test')
    })

    it('accepts custom version', () => {
      const fabric = new FabricKernel({ version: '2.1.0' })
      expect(fabric.version.major).toBe(2)
      expect(fabric.version.minor).toBe(1)
    })

    it('createdAt is a timestamp number', () => {
      const fabric = new FabricKernel()
      expect(typeof fabric.createdAt).toBe('number')
      expect(fabric.createdAt).toBeGreaterThan(0)
    })
  })

  describe('register()', () => {
    it('registers a valid capability', () => {
      const fabric = new FabricKernel()
      const cap = makeCapability('cap-a')
      const result = fabric.register(cap)

      expect(result.success).toBe(true)
    })

    it('returns failure for invalid capability (no id)', () => {
      const fabric = new FabricKernel()
      const badCap = makeCapability('')
      const result = fabric.register(badCap)

      expect(result.success).toBe(false)
    })

    it('returns failure for duplicate capability', () => {
      const fabric = new FabricKernel()
      fabric.register(makeCapability('dup-cap'))
      const result = fabric.register(makeCapability('dup-cap'))

      expect(result.success).toBe(false)
    })
  })

  describe('resolve()', () => {
    it('resolves a registered capability', () => {
      const fabric = new FabricKernel()
      fabric.register(makeCapability('cap-resolve'))

      const result = fabric.resolve('cap-resolve' as CapabilityId)
      expect(result.found).toBe(true)
    })

    it('returns found=false for unregistered capability', () => {
      const fabric = new FabricKernel()
      const result = fabric.resolve('unknown' as CapabilityId)
      expect(result.found).toBe(false)
    })
  })

  describe('has()', () => {
    it('returns true for registered capability', () => {
      const fabric = new FabricKernel()
      fabric.register(makeCapability('cap-x'))
      expect(fabric.has('cap-x' as CapabilityId)).toBe(true)
    })

    it('returns false for unregistered capability', () => {
      const fabric = new FabricKernel()
      expect(fabric.has('absent' as CapabilityId)).toBe(false)
    })
  })

  describe('capabilities()', () => {
    it('returns empty array initially', () => {
      const fabric = new FabricKernel()
      expect(fabric.capabilities()).toHaveLength(0)
    })

    it('returns registered capability ids', () => {
      const fabric = new FabricKernel()
      fabric.register(makeCapability('cap-1'))
      fabric.register(makeCapability('cap-2'))

      const caps = fabric.capabilities()
      expect(caps).toContain('cap-1')
      expect(caps).toContain('cap-2')
    })
  })

  describe('execute()', () => {
    it('executes a registered capability and returns ok result', async () => {
      const fabric = new FabricKernel()
      fabric.register(
        makeCapability('cap-exec', {
          execute: async () => ({ answer: 42 }),
        })
      )

      const result = await fabric.execute('cap-exec' as CapabilityId, {})
      expect(result.success).toBe(true)
    })

    it('returns capability_not_found error for unregistered capability', async () => {
      const fabric = new FabricKernel()
      const result = await fabric.execute('missing-cap' as CapabilityId, {})

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('capability_not_found')
      }
    })

    it('returns validation_error when input validation fails', async () => {
      const fabric = new FabricKernel()
      fabric.register(
        makeCapability('cap-validate', {
          validateInput: () => err([validationError(['x'], 'required', 'required')]),
        })
      )

      const result = await fabric.execute('cap-validate' as CapabilityId, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('validation_error')
      }
    })

    it('returns contract_violation when output validation fails', async () => {
      const fabric = new FabricKernel()
      fabric.register(
        makeCapability('cap-out-fail', {
          execute: async () => ({ bad: 'output' }),
          validateOutput: () => err([validationError(['out'], 'invalid output', 'invalid')]),
        })
      )

      const result = await fabric.execute('cap-out-fail' as CapabilityId, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('contract_violation')
      }
    })

    it('returns execution_error when capability throws', async () => {
      const fabric = new FabricKernel()
      fabric.register(
        makeCapability('cap-throws', {
          execute: () => {
            throw new Error('runtime failure')
          },
        })
      )

      const result = await fabric.execute('cap-throws' as CapabilityId, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('execution_error')
      }
    })

    it('returns timeout error when execution exceeds timeout', async () => {
      vi.useFakeTimers()
      const fabric = new FabricKernel()
      fabric.register(
        makeCapability('cap-slow', {
          execute: async () => {
            await new Promise((r) => setTimeout(r, 10000))
            return ok({})
          },
        })
      )

      const resultPromise = fabric.execute('cap-slow' as CapabilityId, {}, { timeout: 50 })
      vi.advanceTimersByTime(100)

      const result = await resultPromise
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('timeout')
      }
    })

    it('passes contextData to execution context', async () => {
      const fabric = new FabricKernel()
      let capturedContext: unknown
      fabric.register(
        makeCapability('cap-ctx', {
          execute: async (_, ctx) => {
            capturedContext = ctx
            return ok({})
          },
        })
      )

      await fabric.execute(
        'cap-ctx' as CapabilityId,
        {},
        {
          contextData: { userId: 'user-42' },
        }
      )

      expect((capturedContext as Record<string, unknown>).data).toBeDefined()
    })

    it('allows capability to invoke another capability via context', async () => {
      const fabric = new FabricKernel()
      // Register the inner capability
      fabric.register(
        makeCapability('cap-inner', {
          execute: async () => ({ value: 'inner-result' }),
        })
      )
      // Register the outer capability that calls inner via ctx.invoke
      fabric.register(
        makeCapability('cap-outer', {
          deps: ['cap-inner'],
          execute: async (_, ctx) => {
            const innerResult = await (
              ctx as { invoke: (id: CapabilityId, input: unknown) => Promise<unknown> }
            ).invoke('cap-inner' as CapabilityId, {})
            return ok({ delegated: innerResult })
          },
        })
      )

      const result = await fabric.execute('cap-outer' as CapabilityId, {})
      expect(result.success).toBe(true)
    })
  })

  describe('start() / shutdown()', () => {
    it('transitions to running on start', async () => {
      const fabric = new FabricKernel()
      await fabric.start()
      expect(fabric.state).toBe('running')
    })

    it('transitions to stopped on shutdown', async () => {
      const fabric = new FabricKernel()
      await fabric.start()
      await fabric.shutdown()
      expect(fabric.state).toBe('stopped')
    })
  })

  describe('getSnapshot()', () => {
    it('returns a snapshot of current state', () => {
      const fabric = new FabricKernel()
      fabric.register(makeCapability('snap-cap'))

      const snapshot = fabric.getSnapshot()
      expect(snapshot.id).toBe(fabric.id)
      expect(snapshot.state).toBe('ready')
      expect(snapshot.capabilities).toContain('snap-cap')
      expect(typeof snapshot.timestamp).toBe('number')
    })
  })

  describe('getEventBus()', () => {
    it('returns the event bus', () => {
      const fabric = new FabricKernel()
      const bus = fabric.getEventBus()
      expect(bus).toBeDefined()
      expect(typeof bus.emit).toBe('function')
    })
  })

  describe('invalid state transitions', () => {
    it('throws when trying to start from stopped state', async () => {
      const fabric = new FabricKernel()
      await fabric.start()
      await fabric.shutdown()
      // Cannot start from stopped state
      await expect(fabric.start()).rejects.toThrow()
    })
  })
})

describe('createFabric()', () => {
  it('creates a FabricKernel instance', () => {
    const fabric = createFabric()
    expect(fabric).toBeInstanceOf(FabricKernel)
    expect(fabric.state).toBe('ready')
  })

  it('passes options to FabricKernel', () => {
    const fabric = createFabric({ metadata: { name: 'My Fabric' } })
    expect(fabric.metadata.name).toBe('My Fabric')
  })
})
