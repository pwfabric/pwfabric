/**
 * Behavior Engine Tests
 *
 * Tests for guards, actions, priority ordering, and async execution.
 *
 * @module @pwfabric/runtime/entity/__tests__/behavior
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DefaultEntityLifecycleEngine,
  createEntityLifecycleEngine,
} from '../behavior.js'
import type {
  EntityLifecycleHook,
  EntityBehaviorContext,
  EntityLifecycleEvent,
  EntityLifecycleTransition,
} from '../behavior.js'
import type { EntityTypeId } from '../types.js'

// ============================================================
// TEST HELPERS
// ============================================================

const ENTITY_TYPE = 'test_entity' as EntityTypeId

function createContext(overrides?: Partial<EntityBehaviorContext>): EntityBehaviorContext {
  return {
    entityType: ENTITY_TYPE,
    event: 'onCreate',
    data: { name: 'Test' },
    metadata: {},
    ...overrides,
  }
}

function createBehavior(overrides?: Partial<EntityLifecycleHook>): EntityLifecycleHook {
  return {
    id: 'test-behavior',
    entityType: ENTITY_TYPE,
    trigger: 'onCreate',
    action: vi.fn(),
    ...overrides,
  }
}

// ============================================================
// TESTS
// ============================================================

describe('DefaultEntityLifecycleEngine', () => {
  let engine: DefaultEntityLifecycleEngine

  beforeEach(() => {
    engine = new DefaultEntityLifecycleEngine()
  })

  describe('register', () => {
    it('should register a behavior', () => {
      const behavior = createBehavior()

      engine.register(behavior)

      const behaviors = engine.getBehaviors(ENTITY_TYPE)
      expect(behaviors).toHaveLength(1)
      expect(behaviors[0]).toBe(behavior)
    })

    it('should throw if behavior has no id', () => {
      const behavior = createBehavior({ id: '' })

      expect(() => engine.register(behavior)).toThrow('Lifecycle hook must have an id')
    })

    it('should throw if behavior has no entityType', () => {
      const behavior = createBehavior({ entityType: '' as EntityTypeId })

      expect(() => engine.register(behavior)).toThrow('Lifecycle hook must have an entityType')
    })

    it('should throw if behavior has no trigger', () => {
      const behavior = createBehavior({ trigger: '' as EntityLifecycleEvent })

      expect(() => engine.register(behavior)).toThrow('Lifecycle hook must have a trigger')
    })

    it('should throw if behavior has no action', () => {
      const behavior = createBehavior({
        action: undefined as unknown as () => void,
      })

      expect(() => engine.register(behavior)).toThrow('Lifecycle hook must have an action')
    })

    it('should throw if behavior id is already registered', () => {
      const behavior = createBehavior()
      engine.register(behavior)

      expect(() => engine.register(behavior)).toThrow(
        "Lifecycle hook 'test-behavior' is already registered"
      )
    })

    it('should register multiple behaviors', () => {
      engine.register(createBehavior({ id: 'behavior-1' }))
      engine.register(createBehavior({ id: 'behavior-2' }))

      expect(engine.getBehaviors(ENTITY_TYPE)).toHaveLength(2)
    })
  })

  describe('unregister', () => {
    it('should remove a registered behavior', () => {
      engine.register(createBehavior())

      const removed = engine.unregister('test-behavior')

      expect(removed).toBe(true)
      expect(engine.getBehaviors(ENTITY_TYPE)).toHaveLength(0)
    })

    it('should return false for unregistered behavior', () => {
      const removed = engine.unregister('nonexistent')

      expect(removed).toBe(false)
    })
  })

  describe('execute', () => {
    it('should execute matching behavior action', async () => {
      const action = vi.fn()
      engine.register(createBehavior({ action }))
      const context = createContext()

      await engine.execute(ENTITY_TYPE, 'onCreate', context)

      expect(action).toHaveBeenCalledOnce()
      expect(action).toHaveBeenCalledWith(context)
    })

    it('should not execute behavior for different entity type', async () => {
      const action = vi.fn()
      engine.register(createBehavior({ action }))
      const context = createContext({ entityType: 'other_entity' as EntityTypeId })

      await engine.execute('other_entity' as EntityTypeId, 'onCreate', context)

      expect(action).not.toHaveBeenCalled()
    })

    it('should not execute behavior for different event', async () => {
      const action = vi.fn()
      engine.register(createBehavior({ trigger: 'onCreate', action }))
      const context = createContext({ event: 'onUpdate' })

      await engine.execute(ENTITY_TYPE, 'onUpdate', context)

      expect(action).not.toHaveBeenCalled()
    })

    it('should execute async actions', async () => {
      const order: number[] = []
      const asyncAction = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        order.push(1)
      })

      engine.register(createBehavior({ action: asyncAction }))
      const context = createContext()

      await engine.execute(ENTITY_TYPE, 'onCreate', context)

      expect(asyncAction).toHaveBeenCalledOnce()
      expect(order).toEqual([1])
    })

    it('should respect guard returning true', async () => {
      const action = vi.fn()
      const guard = vi.fn(() => true)
      engine.register(createBehavior({ guard, action }))
      const context = createContext()

      await engine.execute(ENTITY_TYPE, 'onCreate', context)

      expect(guard).toHaveBeenCalledOnce()
      expect(action).toHaveBeenCalledOnce()
    })

    it('should skip action when guard returns false', async () => {
      const action = vi.fn()
      const guard = vi.fn(() => false)
      engine.register(createBehavior({ guard, action }))
      const context = createContext()

      await engine.execute(ENTITY_TYPE, 'onCreate', context)

      expect(guard).toHaveBeenCalledOnce()
      expect(action).not.toHaveBeenCalled()
    })

    it('should execute behaviors in priority order', async () => {
      const executionOrder: string[] = []

      engine.register(
        createBehavior({
          id: 'low-priority',
          priority: 50,
          action: () => {
            executionOrder.push('low')
          },
        })
      )
      engine.register(
        createBehavior({
          id: 'high-priority',
          priority: 10,
          action: () => {
            executionOrder.push('high')
          },
        })
      )
      engine.register(
        createBehavior({
          id: 'default-priority',
          action: () => {
            executionOrder.push('default')
          },
        })
      )

      const context = createContext()
      await engine.execute(ENTITY_TYPE, 'onCreate', context)

      expect(executionOrder).toEqual(['high', 'low', 'default'])
    })

    it('should handle behaviors with no matches gracefully', async () => {
      const context = createContext()

      await expect(engine.execute(ENTITY_TYPE, 'onCreate', context)).resolves.toBeUndefined()
    })

    it('should execute multiple behaviors for same event', async () => {
      const action1 = vi.fn()
      const action2 = vi.fn()

      engine.register(createBehavior({ id: 'behavior-1', action: action1 }))
      engine.register(createBehavior({ id: 'behavior-2', action: action2 }))

      const context = createContext()
      await engine.execute(ENTITY_TYPE, 'onCreate', context)

      expect(action1).toHaveBeenCalledOnce()
      expect(action2).toHaveBeenCalledOnce()
    })
  })

  describe('getBehaviors', () => {
    it('should return all behaviors for entity type', () => {
      engine.register(createBehavior({ id: 'b1', trigger: 'onCreate' }))
      engine.register(createBehavior({ id: 'b2', trigger: 'onUpdate' }))
      engine.register(createBehavior({ id: 'b3', trigger: 'onDelete' }))

      const behaviors = engine.getBehaviors(ENTITY_TYPE)

      expect(behaviors).toHaveLength(3)
    })

    it('should filter by event when provided', () => {
      engine.register(createBehavior({ id: 'b1', trigger: 'onCreate' }))
      engine.register(createBehavior({ id: 'b2', trigger: 'onUpdate' }))
      engine.register(createBehavior({ id: 'b3', trigger: 'onCreate' }))

      const behaviors = engine.getBehaviors(ENTITY_TYPE, 'onCreate')

      expect(behaviors).toHaveLength(2)
    })

    it('should return empty array for unknown entity type', () => {
      engine.register(createBehavior())

      const behaviors = engine.getBehaviors('other_entity' as EntityTypeId)

      expect(behaviors).toEqual([])
    })

    it('should return empty array when no behaviors match event', () => {
      engine.register(createBehavior({ trigger: 'onCreate' }))

      const behaviors = engine.getBehaviors(ENTITY_TYPE, 'onDelete')

      expect(behaviors).toEqual([])
    })
  })

  describe('clear', () => {
    it('should remove all behaviors', () => {
      engine.register(createBehavior({ id: 'b1' }))
      engine.register(createBehavior({ id: 'b2' }))

      engine.clear()

      expect(engine.getBehaviors(ENTITY_TYPE)).toEqual([])
    })
  })
})

// ============================================================
// EntityLifecycleEngine primary name tests
// ============================================================

describe('EntityLifecycleEngine (primary name)', () => {
  describe('createEntityLifecycleEngine', () => {
    it('should create a DefaultEntityLifecycleEngine instance', () => {
      const engine = createEntityLifecycleEngine()

      expect(engine).toBeInstanceOf(DefaultEntityLifecycleEngine)
    })
  })

  describe('DefaultEntityLifecycleEngine — register/unregister/execute/clear', () => {
    let engine: DefaultEntityLifecycleEngine

    beforeEach(() => {
      engine = new DefaultEntityLifecycleEngine()
    })

    it('should register a behavior', () => {
      const behavior: EntityLifecycleHook = {
        id: 'ele-behavior',
        entityType: ENTITY_TYPE,
        trigger: 'onCreate',
        action: vi.fn(),
      }

      engine.register(behavior)

      expect(engine.getBehaviors(ENTITY_TYPE)).toHaveLength(1)
    })

    it('should unregister a behavior', () => {
      const behavior: EntityLifecycleHook = {
        id: 'ele-behavior',
        entityType: ENTITY_TYPE,
        trigger: 'onCreate',
        action: vi.fn(),
      }

      engine.register(behavior)
      const removed = engine.unregister('ele-behavior')

      expect(removed).toBe(true)
      expect(engine.getBehaviors(ENTITY_TYPE)).toHaveLength(0)
    })

    it('should execute matching behaviors', async () => {
      const action = vi.fn()
      const behavior: EntityLifecycleHook = {
        id: 'ele-behavior',
        entityType: ENTITY_TYPE,
        trigger: 'onUpdate',
        action,
      }
      engine.register(behavior)
      const context = createContext({ event: 'onUpdate' })

      await engine.execute(ENTITY_TYPE, 'onUpdate', context)

      expect(action).toHaveBeenCalledOnce()
      expect(action).toHaveBeenCalledWith(context)
    })

    it('should clear all behaviors', () => {
      engine.register(createBehavior({ id: 'ele-b1' }))
      engine.register(createBehavior({ id: 'ele-b2' }))

      engine.clear()

      expect(engine.getBehaviors(ENTITY_TYPE)).toEqual([])
    })
  })

  describe('EntityLifecycleTransition type', () => {
    it('should accept onCreate as a valid EntityLifecycleTransition', () => {
      const transition: EntityLifecycleTransition = 'onCreate'

      expect(transition).toBe('onCreate')
    })

    it('should accept onUpdate as a valid EntityLifecycleTransition', () => {
      const transition: EntityLifecycleTransition = 'onUpdate'

      expect(transition).toBe('onUpdate')
    })

    it('should accept onDelete as a valid EntityLifecycleTransition', () => {
      const transition: EntityLifecycleTransition = 'onDelete'

      expect(transition).toBe('onDelete')
    })

    it('should accept onRead as a valid EntityLifecycleTransition', () => {
      const transition: EntityLifecycleTransition = 'onRead'

      expect(transition).toBe('onRead')
    })

    it('EntityLifecycleTransition and EntityLifecycleEvent should accept the same values', () => {
      const event: EntityLifecycleEvent = 'onCreate'
      const transition: EntityLifecycleTransition = event

      expect(transition).toBe(event)
    })
  })
})
