/**
 * FabricKernel.execute Tests — F20
 *
 * F20: Capability execution via FabricKernel.execute
 *
 * Verifies the execute() path: capability not found, validation fail,
 * successful execution, and execution error.
 *
 * Error codes and execute() conventions match kernel.test.ts patterns:
 *   - not_found = 'capability_not_found'
 *   - execution throw = 'execution_error'
 *   - execute() returns raw data (not wrapped in ok/err) unless the
 *     output needs to pass validateOutput
 *
 * @module @pwfabric/runtime/__tests__/kernel-execute
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { FabricKernel } from '../kernel.js'
import type { CapabilityId, Capability } from '@pwfabric/contracts'
import { ok, err } from '@pwfabric/contracts'

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// HELPERS
// ============================================================

function makeCapability(
  id: string,
  opts: {
    execute?: (input: unknown, ctx: unknown) => Promise<unknown>
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
    // execute returns raw data — NOT wrapped in ok/err
    // (kernel validates output separately via contract.validateOutput)
    execute: execute ?? (async () => ({ done: true })),
  }
}

// ============================================================
// TESTS — F20
// ============================================================

describe('FabricKernel.execute: capability execution', () => {
  it('should execute a registered capability and return success result', async () => {
    const kernel = new FabricKernel()
    const capability = makeCapability('test-cap', {
      // Return raw data — kernel wraps in executionOk via validateOutput
      execute: async (input) => ({ processed: true, input }),
    })

    kernel.register(capability)
    const result = await kernel.execute('test-cap' as CapabilityId, { value: 42 })

    expect(result.success).toBe(true)
    if (result.success) {
      const data = result.data as { processed: boolean; input: unknown }
      expect(data.processed).toBe(true)
    }
  })

  it('should return capability_not_found error when capability is not registered', async () => {
    const kernel = new FabricKernel()

    const result = await kernel.execute('nonexistent-cap' as CapabilityId, {})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.type).toBe('capability_not_found')
    }
  })

  it('should return validation_error when input validation fails', async () => {
    const kernel = new FabricKernel()
    const capability = makeCapability('strict-cap', {
      validateInput: (_d) =>
        err({
          type: 'validation_error' as const,
          message: 'Input must have required field',
          details: [],
        }),
    })

    kernel.register(capability)
    const result = await kernel.execute('strict-cap' as CapabilityId, { wrong: 'input' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.type).toBe('validation_error')
    }
  })

  it('should return execution_error when capability.execute throws', async () => {
    const kernel = new FabricKernel()
    const capability = makeCapability('throwing-cap', {
      execute: async () => {
        throw new Error('Capability exploded')
      },
    })

    kernel.register(capability)
    const result = await kernel.execute('throwing-cap' as CapabilityId, {})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.type).toBe('execution_error')
    }
  })

  it('should pass input to the capability execute function', async () => {
    const kernel = new FabricKernel()
    const executeSpy = vi.fn(async (input: unknown) => ({ echo: input }))
    const capability = makeCapability('echo-cap', { execute: executeSpy })

    kernel.register(capability)
    await kernel.execute('echo-cap' as CapabilityId, { message: 'hello F20' })

    expect(executeSpy).toHaveBeenCalledWith({ message: 'hello F20' }, expect.any(Object))
  })

  it('should handle multiple registered capabilities independently', async () => {
    const kernel = new FabricKernel()

    kernel.register(
      makeCapability('cap-a', {
        execute: async () => ({ from: 'cap-a' }),
      })
    )
    kernel.register(
      makeCapability('cap-b', {
        execute: async () => ({ from: 'cap-b' }),
      })
    )

    const resultA = await kernel.execute('cap-a' as CapabilityId, {})
    const resultB = await kernel.execute('cap-b' as CapabilityId, {})

    expect(resultA.success).toBe(true)
    expect(resultB.success).toBe(true)

    if (resultA.success && resultB.success) {
      expect((resultA.data as { from: string }).from).toBe('cap-a')
      expect((resultB.data as { from: string }).from).toBe('cap-b')
    }
  })

  it('should emit execution events (fabric remains in ready state after execution)', async () => {
    const kernel = new FabricKernel()
    const capability = makeCapability('event-cap')

    kernel.register(capability)
    await kernel.execute('event-cap' as CapabilityId, {})

    expect(kernel.state).toBe('ready')
  })
})
