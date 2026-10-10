/**
 * Binding Engine Tests
 *
 * Tests for capability-to-surface binding
 *
 * @module @pwfabric/runtime/binding/__tests__/engine
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RuntimeBindingEngine, createBindingEngine } from '../engine.js'
import type { BindingConfig } from '../types.js'
import type { FabricKernel } from '../../kernel.js'
import type { CacheProvider } from '../../cache/types.js'

// Mock FabricKernel
function createMockFabric(): FabricKernel {
  const capabilities = new Map<string, unknown>()

  return {
    resolve: vi.fn((id: string) => {
      if (capabilities.has(id) || id === 'test-capability') {
        return {
          found: true,
          capability: { id, name: 'Test', version: '1.0.0' },
        }
      }
      return { found: false }
    }),
    execute: vi.fn(async (id: string, input: unknown) => {
      return { success: true, data: { id, input } }
    }),
    register: vi.fn(() => ({ success: true })),
    getState: vi.fn(() => 'running'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  } as unknown as FabricKernel
}

// Mock CacheProvider
function createMockCache(): CacheProvider {
  const store = new Map<string, unknown>()

  return {
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => store.delete(key)),
    has: vi.fn(async (key: string) => store.has(key)),
    clear: vi.fn(async () => store.clear()),
    stats: vi.fn(async () => ({
      hits: 0,
      misses: 0,
      size: store.size,
      evictions: 0,
    })),
  }
}

describe('RuntimeBindingEngine', () => {
  let fabric: FabricKernel
  let cache: CacheProvider
  let engine: RuntimeBindingEngine

  beforeEach(() => {
    fabric = createMockFabric()
    cache = createMockCache()
    engine = new RuntimeBindingEngine(fabric, cache)
  })

  describe('bind', () => {
    it('should bind a capability to a surface', () => {
      const config: BindingConfig = {
        capabilityId: 'test-capability',
        alias: 'test',
      }

      const result = engine.bind('surface-1', config)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.binding.capabilityId).toBe('test-capability')
        expect(result.binding.state).toBe('bound')
      }
    })

    it('should fail if capability not found', () => {
      const config: BindingConfig = {
        capabilityId: 'non-existent',
      }

      const result = engine.bind('surface-1', config)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('resolution_failed')
      }
    })

    it('should use capabilityId as alias if not provided', () => {
      const config: BindingConfig = {
        capabilityId: 'test-capability',
      }

      engine.bind('surface-1', config)
      const binding = engine.get('surface-1', 'test-capability')

      expect(binding).toBeDefined()
    })
  })

  describe('bindAll', () => {
    it('should bind multiple capabilities', () => {
      const configs: BindingConfig[] = [
        { capabilityId: 'test-capability', alias: 'cap1' },
        { capabilityId: 'test-capability', alias: 'cap2' },
      ]

      const result = engine.bindAll('surface-1', configs)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.context.bindings.size).toBe(2)
      }
    })

    it('should collect errors for failed bindings', () => {
      const configs: BindingConfig[] = [
        { capabilityId: 'test-capability', alias: 'cap1' },
        { capabilityId: 'non-existent', alias: 'cap2' },
      ]

      const result = engine.bindAll('surface-1', configs)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.errors.length).toBe(1)
      }
    })
  })

  describe('get', () => {
    it('should return bound capability', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })

      const binding = engine.get('surface-1', 'test')

      expect(binding).toBeDefined()
      expect(binding?.capabilityId).toBe('test-capability')
    })

    it('should return undefined for non-existent binding', () => {
      const binding = engine.get('surface-1', 'non-existent')

      expect(binding).toBeUndefined()
    })
  })

  describe('unbind', () => {
    it('should remove binding', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })

      const removed = engine.unbind('surface-1', 'test')

      expect(removed).toBe(true)
      expect(engine.get('surface-1', 'test')).toBeUndefined()
    })

    it('should return false if binding not found', () => {
      const removed = engine.unbind('surface-1', 'non-existent')

      expect(removed).toBe(false)
    })
  })

  describe('unbindAll', () => {
    it('should remove all bindings for surface', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test1' })
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test2' })

      engine.unbindAll('surface-1')

      expect(engine.get('surface-1', 'test1')).toBeUndefined()
      expect(engine.get('surface-1', 'test2')).toBeUndefined()
    })
  })

  describe('getContext', () => {
    it('should return binding context for surface', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })

      const context = engine.getContext('surface-1')

      expect(context).toBeDefined()
      expect(context?.surfaceId).toBe('surface-1')
    })

    it('should return undefined for surface without bindings', () => {
      const context = engine.getContext('non-existent')

      expect(context).toBeUndefined()
    })
  })

  describe('setAuthContext', () => {
    it('should set auth context on existing binding context', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })

      engine.setAuthContext('surface-1', {
        isAuthenticated: true,
        userId: 'user-123',
      })

      const context = engine.getContext('surface-1')
      expect(context?.auth?.isAuthenticated).toBe(true)
      expect(context?.auth?.userId).toBe('user-123')
    })

    it('should create context if not exists', () => {
      engine.setAuthContext('surface-2', {
        isAuthenticated: true,
        userId: 'user-456',
      })

      const context = engine.getContext('surface-2')
      expect(context).toBeDefined()
      expect(context?.auth?.isAuthenticated).toBe(true)
    })
  })

  describe('BoundCapability.id', () => {
    it('should return surfaceId:alias as the binding id', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })
      const binding = engine.get('surface-1', 'test')
      expect(binding).toBeDefined()
      if (!binding) return

      expect(binding.id).toBe('surface-1:test')
    })
  })

  describe('BoundCapability.invalidate', () => {
    it('should set binding state to stale', () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })
      const binding = engine.get('surface-1', 'test')
      expect(binding).toBeDefined()
      if (!binding) return

      binding.invalidate()

      expect(binding.state).toBe('stale')
    })

    it('should delete cache entry when cache is enabled', () => {
      engine.bind('surface-1', {
        capabilityId: 'test-capability',
        alias: 'cached-cap',
        cache: { enabled: true, key: 'my-cache-key' },
      })
      const binding = engine.get('surface-1', 'cached-cap')
      expect(binding).toBeDefined()
      if (!binding) return

      binding.invalidate()

      expect(cache.delete).toHaveBeenCalledWith('my-cache-key')
    })
  })

  describe('BoundCapability.execute', () => {
    it('should execute capability through binding', async () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })
      const binding = engine.get('surface-1', 'test')
      expect(binding).toBeDefined()
      if (!binding) return

      const result = await binding.execute({ data: 'input' })

      expect(result.success).toBe(true)
      expect(fabric.execute).toHaveBeenCalledWith('test-capability', { data: 'input' })
    })

    it('should apply input transform', async () => {
      const config: BindingConfig = {
        capabilityId: 'test-capability',
        alias: 'test',
        transform: {
          input: (data) => ({ transformed: data }),
        },
      }
      engine.bind('surface-1', config)
      const binding = engine.get('surface-1', 'test')
      expect(binding).toBeDefined()
      if (!binding) return

      await binding.execute({ original: 'data' })

      expect(fabric.execute).toHaveBeenCalledWith('test-capability', {
        transformed: { original: 'data' },
      })
    })

    it('should populate lastResult and lastExecuted after execute', async () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'test' })
      const binding = engine.get('surface-1', 'test')
      expect(binding).toBeDefined()
      if (!binding) return

      await binding.execute({ data: 'value' })

      // Access the getters to cover lines 344 and 350
      expect(binding.lastResult).toBeDefined()
      expect(binding.lastExecuted).toBeGreaterThan(0)
    })

    it('should populate error getter after failed execute', async () => {
      fabric.execute = vi.fn().mockResolvedValue({ success: false, error: { message: 'fail' } })

      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'err-test' })
      const binding = engine.get('surface-1', 'err-test')
      expect(binding).toBeDefined()
      if (!binding) return

      await binding.execute({ data: 'value' })

      // Access the error getter to cover line 350
      expect(binding.error).toBeDefined()
    })

    it('should handle execute throwing (catch block)', async () => {
      fabric.execute = vi.fn().mockRejectedValue(new Error('Kaboom'))

      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'throw-test' })
      const binding = engine.get('surface-1', 'throw-test')
      expect(binding).toBeDefined()
      if (!binding) return

      const result = await binding.execute({ data: 'input' })

      expect(result.success).toBe(false)
      expect(binding.state).toBe('error')
    })
  })

  describe('BoundCapability.refresh', () => {
    it('should return error when refresh called with no previous input', async () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'refresh-test' })
      const binding = engine.get('surface-1', 'refresh-test')
      expect(binding).toBeDefined()
      if (!binding) return

      const result = await binding.refresh()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('execution_error')
      }
    })

    it('should re-execute with last input on refresh', async () => {
      engine.bind('surface-1', { capabilityId: 'test-capability', alias: 'refresh-test2' })
      const binding = engine.get('surface-1', 'refresh-test2')
      expect(binding).toBeDefined()
      if (!binding) return

      await binding.execute({ key: 'val' })
      const result = await binding.refresh()

      expect(result.success).toBe(true)
      expect(fabric.execute).toHaveBeenCalledTimes(2)
    })
  })
})

describe('createBindingEngine', () => {
  it('should create a binding engine instance', () => {
    const fabric = createMockFabric()
    const engine = createBindingEngine(fabric)

    expect(engine).toBeInstanceOf(RuntimeBindingEngine)
  })

  it('should create engine with optional cache', () => {
    const fabric = createMockFabric()
    const cache = createMockCache()
    const engine = createBindingEngine(fabric, cache)

    expect(engine).toBeInstanceOf(RuntimeBindingEngine)
  })
})
