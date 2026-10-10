/**
 * TwoWayBindingManager Tests
 *
 * P1-5: Two-way data binding with write-back, validation, transforms, batching.
 *
 * @module @pwfabric/runtime/binding/__tests__/two-way
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { TwoWayBindingManager, createTwoWayBindingManager } from '../two-way.js'

afterEach(() => {
  vi.useRealTimers()
})

// ============================================================
// Factory
// ============================================================

describe('createTwoWayBindingManager()', () => {
  it('creates a manager instance', () => {
    const manager = createTwoWayBindingManager()
    expect(manager).toBeInstanceOf(TwoWayBindingManager)
  })

  it('initialises with provided data', () => {
    const manager = createTwoWayBindingManager({ user: { name: 'Alice' } })
    expect(manager.getValue('user.name')).toBe('Alice')
  })
})

// ============================================================
// TwoWayBindingManager - getValue / setValue
// ============================================================

describe('TwoWayBindingManager.getValue / setValue', () => {
  it('returns undefined for unknown path', () => {
    const manager = createTwoWayBindingManager()
    expect(manager.getValue('some.missing.path')).toBeUndefined()
  })

  it('sets and retrieves a top-level value', () => {
    const manager = createTwoWayBindingManager()
    manager.setValue('name', 'Bob')
    expect(manager.getValue('name')).toBe('Bob')
  })

  it('sets and retrieves a nested value', () => {
    const manager = createTwoWayBindingManager()
    manager.setValue('user.email', 'bob@example.com')
    expect(manager.getValue('user.email')).toBe('bob@example.com')
  })
})

// ============================================================
// TwoWayBindingManager - onChange
// ============================================================

describe('TwoWayBindingManager.onChange', () => {
  it('calls listener when value changes', () => {
    const manager = createTwoWayBindingManager({ count: 0 })
    const listener = vi.fn()
    manager.onChange('count', listener)

    manager.setValue('count', 1)
    expect(listener).toHaveBeenCalledWith(1, 0)
  })

  it('unsubscribes listener on returned teardown call', () => {
    const manager = createTwoWayBindingManager({ count: 0 })
    const listener = vi.fn()
    const unsub = manager.onChange('count', listener)

    unsub()
    manager.setValue('count', 5)
    expect(listener).not.toHaveBeenCalled()
  })

  it('removes path key when last listener unsubscribes', () => {
    const manager = createTwoWayBindingManager({})
    const listener = vi.fn()
    const unsub = manager.onChange('x', listener)
    unsub()
    // Should not throw, listener map cleaned up
    manager.setValue('x', 1)
    expect(listener).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by listeners', () => {
    const manager = createTwoWayBindingManager({ v: 0 })
    manager.onChange('v', () => {
      throw new Error('listener error')
    })
    expect(() => manager.setValue('v', 1)).not.toThrow()
  })
})

// ============================================================
// TwoWayBindingManager - batch
// ============================================================

describe('TwoWayBindingManager.batch', () => {
  it('defers listener notifications until batch completes', () => {
    const manager = createTwoWayBindingManager({ a: 0, b: 0 })
    const listener = vi.fn()
    manager.onChange('a', listener)

    manager.batch(() => {
      manager.setValue('a', 1)
      manager.setValue('a', 2)
    })

    // Last write wins, fired once
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(2, expect.anything())
  })

  it('fires notifications for all changed paths after batch', () => {
    const manager = createTwoWayBindingManager({ a: 0, b: 0 })
    const listenerA = vi.fn()
    const listenerB = vi.fn()
    manager.onChange('a', listenerA)
    manager.onChange('b', listenerB)

    manager.batch(() => {
      manager.setValue('a', 10)
      manager.setValue('b', 20)
    })

    expect(listenerA).toHaveBeenCalledOnce()
    expect(listenerB).toHaveBeenCalledOnce()
  })
})

// ============================================================
// TwoWayBindingManager - bind
// ============================================================

describe('TwoWayBindingManager.bind', () => {
  it('creates a binding with current value', () => {
    const manager = createTwoWayBindingManager({ score: 42 })
    const binding = manager.bind<number>({ path: 'score' })
    expect(binding.value).toBe(42)
    expect(binding.path).toBe('score')
  })

  it('initial isDirty is false', () => {
    const manager = createTwoWayBindingManager({ score: 0 })
    const binding = manager.bind<number>({ path: 'score' })
    expect(binding.isDirty).toBe(false)
  })

  it('setValue marks binding dirty', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ score: 0 })
    const binding = manager.bind<number>({ path: 'score', debounceMs: 0 })
    binding.setValue(99)
    expect(binding.isDirty).toBe(true)
  })

  it('setValue with same value as initial stays not dirty', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ score: 5 })
    const binding = manager.bind<number>({ path: 'score', debounceMs: 0 })
    binding.setValue(5)
    expect(binding.isDirty).toBe(false)
  })

  it('reset restores initial value and clears dirty', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ name: 'Alice' })
    const binding = manager.bind<string>({ path: 'name', debounceMs: 0 })
    binding.setValue('Bob')
    expect(binding.isDirty).toBe(true)
    binding.reset()
    expect(binding.value).toBe('Alice')
    expect(binding.isDirty).toBe(false)
  })

  it('validation prevents update on failure', () => {
    const manager = createTwoWayBindingManager({ age: 25 })
    const binding = manager.bind<number>({
      path: 'age',
      validate: (v) => ({ valid: (v as number) >= 0, error: 'Must be non-negative' }),
    })
    binding.setValue(-1)
    expect(binding.error).toBe('Must be non-negative')
    expect(binding.value).toBe(25) // unchanged
  })

  it('clears error on valid setValue', () => {
    const manager = createTwoWayBindingManager({ age: 25 })
    const binding = manager.bind<number>({
      path: 'age',
      validate: (v) => ({ valid: (v as number) >= 0, error: 'Must be non-negative' }),
    })
    binding.setValue(-1)
    expect(binding.error).toBeDefined()
    binding.setValue(30)
    expect(binding.error).toBeUndefined()
  })

  it('apply toView transform on initial value', () => {
    const manager = createTwoWayBindingManager({ celsius: 100 })
    const binding = manager.bind<number>({
      path: 'celsius',
      transform: {
        toView: (v) => ((v as number) * 9) / 5 + 32, // Celsius to Fahrenheit
      },
    })
    expect(binding.value).toBe(212) // 100C = 212F
  })

  it('apply toModel transform on write-back', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ fahrenheit: 32 })
    const binding = manager.bind<number>({
      path: 'fahrenheit',
      debounceMs: 0,
      transform: {
        toModel: (v) => (((v as number) - 32) * 5) / 9, // Fahrenheit to Celsius in store
      },
    })
    binding.setValue(212) // 212F → store should hold 100C
    expect(manager.getValue('fahrenheit')).toBeCloseTo(100, 0)
  })

  it('apply toModel transform on binding reset', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ val: 0 })
    const binding = manager.bind<number>({
      path: 'val',
      debounceMs: 0,
      transform: {
        toModel: (v) => (v as number) * 2, // view doubles on write
      },
    })
    binding.setValue(5) // writes 10 to store
    binding.reset() // resets view to 0 (initialValue) and writes toModel(0) = 0 to store
    expect(binding.isDirty).toBe(false)
  })

  it('apply toView transform when model updates externally', () => {
    const manager = createTwoWayBindingManager({ celsius: 0 })
    const binding = manager.bind<number>({
      path: 'celsius',
      transform: {
        toView: (v) => ((v as number) * 9) / 5 + 32, // Celsius to Fahrenheit
      },
    })
    // External model update
    manager.setValue('celsius', 100)
    // binding.value should be in Fahrenheit
    expect(binding.value).toBeCloseTo(212, 0)
  })

  it('write-back with immediate debounce (debounceMs: 0)', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ x: 0 })
    const binding = manager.bind<number>({ path: 'x', debounceMs: 0 })
    binding.setValue(7)
    expect(manager.getValue('x')).toBe(7)
  })

  it('write-back debounced (debounceMs > 0)', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ x: 0 })
    const binding = manager.bind<number>({ path: 'x', debounceMs: 200 })
    binding.setValue(9)
    // Not yet written back
    expect(manager.getValue('x')).toBe(0)
    vi.advanceTimersByTime(200)
    expect(manager.getValue('x')).toBe(9)
  })

  it('disposes a binding and ignores subsequent setValue', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ y: 0 })
    const binding = manager.bind<number>({ path: 'y', debounceMs: 0 })
    binding.dispose()
    binding.setValue(99)
    // Value in store should not change
    expect(manager.getValue('y')).toBe(0)
  })

  it('rebinding disposes the existing binding at same path', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ z: 0 })
    const first = manager.bind<number>({ path: 'z', debounceMs: 0 })
    const second = manager.bind<number>({ path: 'z', debounceMs: 0 })
    // First should be disposed, setting on it should be a no-op
    first.setValue(1)
    expect(manager.getValue('z')).toBe(0) // first was disposed
    second.setValue(2)
    expect(manager.getValue('z')).toBe(2)
  })

  it('updateFromModel updates binding value from external change', () => {
    const manager = createTwoWayBindingManager({ val: 10 })
    const binding = manager.bind<number>({ path: 'val' })
    // External model update via setValue
    manager.setValue('val', 20)
    expect(binding.value).toBe(20)
  })
})

// ============================================================
// TwoWayBindingManager - getDirtyBindings / resetAll
// ============================================================

describe('TwoWayBindingManager.getDirtyBindings', () => {
  it('returns empty when no bindings are dirty', () => {
    const manager = createTwoWayBindingManager({})
    manager.bind({ path: 'x' })
    expect(manager.getDirtyBindings()).toHaveLength(0)
  })

  it('returns dirty bindings', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ a: 0, b: 0 })
    const bindingA = manager.bind<number>({ path: 'a', debounceMs: 0 })
    manager.bind<number>({ path: 'b', debounceMs: 0 })
    bindingA.setValue(1)
    expect(manager.getDirtyBindings()).toHaveLength(1)
  })
})

describe('TwoWayBindingManager.resetAll', () => {
  it('resets all bindings to initial values', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ a: 'initial-a', b: 'initial-b' })
    const ba = manager.bind<string>({ path: 'a', debounceMs: 0 })
    const bb = manager.bind<string>({ path: 'b', debounceMs: 0 })
    ba.setValue('changed-a')
    bb.setValue('changed-b')
    manager.resetAll()
    expect(ba.value).toBe('initial-a')
    expect(bb.value).toBe('initial-b')
  })
})

// ============================================================
// TwoWayBindingManager - dispose
// ============================================================

describe('TwoWayBindingManager.dispose', () => {
  it('disposes all bindings and clears listeners', () => {
    const manager = createTwoWayBindingManager({ v: 0 })
    const listener = vi.fn()
    manager.onChange('v', listener)
    manager.bind({ path: 'v' })

    manager.dispose()

    // After dispose, setValue should not notify
    manager.setValue('v', 99)
    expect(listener).not.toHaveBeenCalled()
  })

  it('disposes a binding that has a pending debounce timer (clears timer)', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ n: 0 })
    // Use a positive debounceMs so the timer is pending when we dispose
    const binding = manager.bind<number>({ path: 'n', debounceMs: 500 })
    // Trigger a write-back so the debounce timer is set
    binding.setValue(42)
    // Dispose before the timer fires — should clear the pending timer
    binding.dispose()
    // Advance timers — the write-back should NOT fire
    vi.advanceTimersByTime(1000)
    // Store value unchanged since write-back was cancelled
    expect(manager.getValue('n')).toBe(0)
  })
})

describe('TwoWayBindingManager - isEqual with objects', () => {
  it('binding with object initialValue stays not dirty when set to equal object', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ config: { x: 1 } })
    // Bind to the config path — initialValue is { x: 1 }
    const binding = manager.bind<{ x: number }>({ path: 'config', debounceMs: 0 })
    // Set to an equivalent (but new) object — isDirty should be false
    binding.setValue({ x: 1 })
    vi.advanceTimersByTime(0)
    expect(binding.isDirty).toBe(false)
  })

  it('binding with object initialValue is dirty when set to different object', () => {
    vi.useFakeTimers()
    const manager = createTwoWayBindingManager({ config: { x: 1 } })
    const binding = manager.bind<{ x: number }>({ path: 'config', debounceMs: 0 })
    binding.setValue({ x: 2 })
    vi.advanceTimersByTime(0)
    expect(binding.isDirty).toBe(true)
  })
})
