/**
 * DefaultInteractionRuleEngine Unit Tests
 *
 * InteractionRuleEngine (formerly DefaultSurfaceBehaviorEngine).
 * Covers: register/unregister, attach/detach, guard evaluation, priority
 * ordering, fail-safe error handling, clear(), and factory function.
 *
 * @module @pwfabric/runtime/render/__tests__/interaction-rule-engine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  DefaultInteractionRuleEngine,
  createInteractionRuleEngine,
} from '../interaction-rule-engine.js'
import type { InteractionRule } from '@pwfabric/contracts'
import type { SurfaceEventDescriptor } from '@pwfabric/contracts'

// ============================================================
// HELPERS
// ============================================================

function makeEvent(overrides: Partial<SurfaceEventDescriptor> = {}): SurfaceEventDescriptor {
  return {
    type: 'block:click',
    surfaceId: 'surface-1',
    timestamp: Date.now(),
    ...overrides,
  }
}

function makeRule(overrides: Partial<InteractionRule> = {}): InteractionRule {
  return {
    id: 'rule-1',
    trigger: 'block:click',
    action: vi.fn(),
    ...overrides,
  }
}

interface MockBus {
  on(pattern: string, handler: (e: SurfaceEventDescriptor) => void): () => void
  emit(event: SurfaceEventDescriptor): void
  listenerCount(pattern: string): number
}

/** Minimal mock event bus */
function makeMockBus(): MockBus {
  const listeners = new Map<string, ((e: SurfaceEventDescriptor) => void)[]>()

  return {
    on(pattern: string, handler: (e: SurfaceEventDescriptor) => void): () => void {
      const existing = listeners.get(pattern) ?? []
      existing.push(handler)
      listeners.set(pattern, existing)
      return () => {
        const arr = listeners.get(pattern) ?? []
        listeners.set(
          pattern,
          arr.filter((h) => h !== handler)
        )
      }
    },
    emit(event: SurfaceEventDescriptor): void {
      const handlers = listeners.get(event.type) ?? []
      handlers.forEach((h) => h(event))
    },
    listenerCount(pattern: string): number {
      return (listeners.get(pattern) ?? []).length
    },
  }
}

// ============================================================
// TESTS
// ============================================================

describe('DefaultInteractionRuleEngine', () => {
  let engine: DefaultInteractionRuleEngine

  beforeEach(() => {
    engine = new DefaultInteractionRuleEngine()
  })

  // ----------------------------------------------------------
  // register / unregister
  // ----------------------------------------------------------
  describe('register / unregister', () => {
    it('registers a rule without throwing', () => {
      const rule = makeRule()
      expect(() => engine.register(rule)).not.toThrow()
    })

    it('unregister returns true when the rule existed', () => {
      engine.register(makeRule({ id: 'r1' }))
      expect(engine.unregister('r1')).toBe(true)
    })

    it('unregister returns false when the rule did not exist', () => {
      expect(engine.unregister('nonexistent')).toBe(false)
    })

    it('overrides an existing rule with the same id on re-register', () => {
      const action1 = vi.fn()
      const action2 = vi.fn()
      engine.register(makeRule({ id: 'r1', action: action1 }))
      engine.register(makeRule({ id: 'r1', action: action2 }))

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      // Only the second action should be registered (Map overwrites)
      expect(action1).not.toHaveBeenCalled()
      expect(action2).toHaveBeenCalledOnce()
    })
  })

  // ----------------------------------------------------------
  // attach / detach
  // ----------------------------------------------------------
  describe('attach / detach', () => {
    it('subscribes to bus events for each registered trigger', () => {
      engine.register(makeRule({ id: 'r1', trigger: 'block:click' }))
      engine.register(makeRule({ id: 'r2', trigger: 'form:submit' }))

      const bus = makeMockBus()
      engine.attach(bus)

      expect(bus.listenerCount('block:click')).toBe(1)
      expect(bus.listenerCount('form:submit')).toBe(1)
    })

    it('calls the rule action when the bus emits a matching event', async () => {
      const action = vi.fn()
      engine.register(makeRule({ id: 'r1', trigger: 'block:click', action }))

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      // Allow microtasks to flush (action is awaited in the bus handler)
      await vi.waitFor(() => expect(action).toHaveBeenCalledOnce())
    })

    it('calls guard before action — skips if guard returns false', async () => {
      const action = vi.fn()
      const guard = vi.fn().mockReturnValue(false)
      engine.register(makeRule({ id: 'r1', trigger: 'block:click', action, guard }))

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      await vi.waitFor(() => expect(guard).toHaveBeenCalledOnce())
      expect(action).not.toHaveBeenCalled()
    })

    it('calls action when guard returns true', async () => {
      const action = vi.fn()
      const guard = vi.fn().mockReturnValue(true)
      engine.register(makeRule({ id: 'r1', trigger: 'block:click', action, guard }))

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      await vi.waitFor(() => expect(action).toHaveBeenCalledOnce())
    })

    it('sorts rules by priority (higher first)', async () => {
      const order: number[] = []
      engine.register(
        makeRule({
          id: 'low',
          priority: 1,
          action: async () => {
            order.push(1)
          },
        })
      )
      engine.register(
        makeRule({
          id: 'high',
          priority: 10,
          action: async () => {
            order.push(10)
          },
        })
      )
      engine.register(
        makeRule({
          id: 'mid',
          priority: 5,
          action: async () => {
            order.push(5)
          },
        })
      )

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      await vi.waitFor(() => expect(order).toHaveLength(3))
      expect(order).toEqual([10, 5, 1])
    })

    it('returns unsubscribe function that stops listening', async () => {
      const action = vi.fn()
      engine.register(makeRule({ id: 'r1', trigger: 'block:click', action }))

      const bus = makeMockBus()
      const detach = engine.attach(bus)

      // Detach before emitting
      detach()
      bus.emit(makeEvent({ type: 'block:click' }))

      // Give microtasks time to run — action should NOT have been called
      await new Promise((r) => setTimeout(r, 10))
      expect(action).not.toHaveBeenCalled()
    })

    it('catches rule action errors without breaking other rules (fail-safe)', async () => {
      const failingAction = vi.fn().mockRejectedValue(new Error('boom'))
      const safeAction = vi.fn()

      // Register low priority (runs second) first so both exist under same trigger
      engine.register(makeRule({ id: 'r-safe', priority: 1, action: safeAction }))
      engine.register(makeRule({ id: 'r-fail', priority: 10, action: failingAction }))

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      // Both should have been invoked — the error in failing rule must not stop safeAction
      await vi.waitFor(() => expect(safeAction).toHaveBeenCalledOnce())
      expect(failingAction).toHaveBeenCalledOnce()
    })

    it('does not call action for a non-matching trigger', async () => {
      const action = vi.fn()
      engine.register(makeRule({ id: 'r1', trigger: 'form:submit', action }))

      const bus = makeMockBus()
      engine.attach(bus)
      bus.emit(makeEvent({ type: 'block:click' }))

      await new Promise((r) => setTimeout(r, 10))
      expect(action).not.toHaveBeenCalled()
    })

    it('merges multiple rules with same trigger into a single bus subscription', () => {
      engine.register(makeRule({ id: 'r1', trigger: 'block:click', action: vi.fn() }))
      engine.register(makeRule({ id: 'r2', trigger: 'block:click', action: vi.fn() }))

      const bus = makeMockBus()
      engine.attach(bus)

      // Both rules share a single bus.on() subscription
      expect(bus.listenerCount('block:click')).toBe(1)
    })
  })

  // ----------------------------------------------------------
  // clear
  // ----------------------------------------------------------
  describe('clear', () => {
    it('removes all rules — attach creates no subscriptions after clear', () => {
      engine.register(makeRule({ id: 'r1', trigger: 'block:click' }))
      engine.register(makeRule({ id: 'r2', trigger: 'form:submit' }))
      engine.clear()

      const bus = makeMockBus()
      engine.attach(bus)

      expect(bus.listenerCount('block:click')).toBe(0)
      expect(bus.listenerCount('form:submit')).toBe(0)
    })

    it('unregister returns false after clear (rule no longer exists)', () => {
      engine.register(makeRule({ id: 'r1' }))
      engine.clear()
      expect(engine.unregister('r1')).toBe(false)
    })
  })

  // ----------------------------------------------------------
  // createInteractionRuleEngine factory
  // ----------------------------------------------------------
  describe('createInteractionRuleEngine factory', () => {
    it('returns an object that implements InteractionRuleEngine', () => {
      const eng = createInteractionRuleEngine()
      expect(typeof eng.register).toBe('function')
      expect(typeof eng.unregister).toBe('function')
      expect(typeof eng.attach).toBe('function')
      expect(typeof eng.clear).toBe('function')
    })

    it('returns a fresh engine with no rules', () => {
      const eng = createInteractionRuleEngine()
      const bus = makeMockBus()
      eng.attach(bus)
      // No rules registered → no subscriptions
      expect(bus.listenerCount('block:click')).toBe(0)
    })

    it('returns a DefaultInteractionRuleEngine instance', () => {
      const eng = createInteractionRuleEngine()
      expect(eng).toBeInstanceOf(DefaultInteractionRuleEngine)
    })
  })
})
