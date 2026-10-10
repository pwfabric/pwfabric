/**
 * State Management Tests
 *
 * Tests for state store and state machine
 *
 * @module @pwfabric/core/__tests__/state
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  SimpleStateStore,
  createStateStore,
  computed,
  subscribeToSlice,
  SimpleStateMachine,
  createStateMachine,
  type StateStore,
  type StateMachine,
} from '../state.js'

describe('SimpleStateStore', () => {
  interface TestState {
    count: number
    name: string
  }

  let store: StateStore<TestState>

  beforeEach(() => {
    store = new SimpleStateStore<TestState>({ count: 0, name: 'test' })
  })

  describe('getState', () => {
    it('should return current state', () => {
      const state = store.getState()

      expect(state.count).toBe(0)
      expect(state.name).toBe('test')
    })

    it('should return a copy, not the original', () => {
      const state1 = store.getState()
      const state2 = store.getState()

      expect(state1).not.toBe(state2)
      expect(state1).toEqual(state2)
    })
  })

  describe('setState', () => {
    it('should replace entire state', () => {
      store.setState({ count: 10, name: 'updated' })

      const state = store.getState()

      expect(state.count).toBe(10)
      expect(state.name).toBe('updated')
    })

    it('should notify listeners', () => {
      const listener = vi.fn()
      store.subscribe(listener)

      store.setState({ count: 5, name: 'new' })

      expect(listener).toHaveBeenCalledWith({ count: 5, name: 'new' }, { count: 0, name: 'test' })
    })
  })

  describe('updateState', () => {
    it('should merge partial state', () => {
      store.updateState({ count: 5 })

      const state = store.getState()

      expect(state.count).toBe(5)
      expect(state.name).toBe('test')
    })

    it('should notify listeners', () => {
      const listener = vi.fn()
      store.subscribe(listener)

      store.updateState({ name: 'updated' })

      expect(listener).toHaveBeenCalledWith(
        { count: 0, name: 'updated' },
        { count: 0, name: 'test' }
      )
    })
  })

  describe('subscribe', () => {
    it('should add listener', () => {
      const listener = vi.fn()

      store.subscribe(listener)
      store.updateState({ count: 1 })

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should return unsubscribe function', () => {
      const listener = vi.fn()

      const unsubscribe = store.subscribe(listener)
      unsubscribe()
      store.updateState({ count: 1 })

      expect(listener).not.toHaveBeenCalled()
    })

    it('should handle multiple listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      store.subscribe(listener1)
      store.subscribe(listener2)
      store.updateState({ count: 1 })

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      const goodListener = vi.fn()

      store.subscribe(errorListener)
      store.subscribe(goodListener)

      // Should not throw
      expect(() => store.updateState({ count: 1 })).not.toThrow()
      expect(goodListener).toHaveBeenCalled()
    })
  })

  describe('snapshot', () => {
    it('should return snapshot with state, timestamp, and version', () => {
      const snapshot = store.snapshot()

      expect(snapshot.state).toEqual({ count: 0, name: 'test' })
      expect(snapshot.timestamp).toBeLessThanOrEqual(Date.now())
      expect(snapshot.version).toBe(0)
    })

    it('should increment version on state changes', () => {
      store.updateState({ count: 1 })
      store.updateState({ count: 2 })

      const snapshot = store.snapshot()

      expect(snapshot.version).toBe(2)
    })
  })
})

describe('createStateStore', () => {
  it('should create a state store with initial state', () => {
    const store = createStateStore({ value: 42 })

    expect(store.getState().value).toBe(42)
  })
})

describe('computed', () => {
  it('should create computed value from store', () => {
    const store = createStateStore({ items: [1, 2, 3] })
    const total = computed(store, (state) => state.items.reduce((a, b) => a + b, 0))

    expect(total()).toBe(6)
  })

  it('should update when store changes', () => {
    const store = createStateStore({ count: 0 })
    const doubled = computed(store, (state) => state.count * 2)

    expect(doubled()).toBe(0)

    store.updateState({ count: 5 })

    expect(doubled()).toBe(10)
  })
})

describe('subscribeToSlice', () => {
  it('should only notify when slice changes', () => {
    const store = createStateStore({ count: 0, name: 'test' })
    const listener = vi.fn()

    subscribeToSlice(store, (s) => s.count, listener)

    // Change name only - listener should not be called
    store.updateState({ name: 'updated' })
    expect(listener).not.toHaveBeenCalled()

    // Change count - listener should be called
    store.updateState({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(1, 0)
  })

  it('should return unsubscribe function', () => {
    const store = createStateStore({ count: 0 })
    const listener = vi.fn()

    const unsubscribe = subscribeToSlice(store, (s) => s.count, listener)
    unsubscribe()
    store.updateState({ count: 5 })

    expect(listener).not.toHaveBeenCalled()
  })
})

describe('SimpleStateMachine', () => {
  type State = 'idle' | 'loading' | 'success' | 'error'
  type Event = 'START' | 'SUCCESS' | 'FAILURE' | 'RESET'

  let machine: StateMachine<State, Event>

  beforeEach(() => {
    machine = new SimpleStateMachine<State, Event>({
      initial: 'idle',
      transitions: [
        { from: 'idle', to: 'loading', event: 'START' },
        { from: 'loading', to: 'success', event: 'SUCCESS' },
        { from: 'loading', to: 'error', event: 'FAILURE' },
        { from: 'success', to: 'idle', event: 'RESET' },
        { from: 'error', to: 'idle', event: 'RESET' },
      ],
    })
  })

  describe('getState', () => {
    it('should return initial state', () => {
      expect(machine.getState()).toBe('idle')
    })
  })

  describe('can', () => {
    it('should return true for valid transition', () => {
      expect(machine.can('START')).toBe(true)
    })

    it('should return false for invalid transition', () => {
      expect(machine.can('SUCCESS')).toBe(false)
    })

    it('should respect guards', () => {
      let canStart = true
      const guardedMachine = createStateMachine<State, Event>({
        initial: 'idle',
        transitions: [
          {
            from: 'idle',
            to: 'loading',
            event: 'START',
            guard: () => canStart,
          },
        ],
      })

      expect(guardedMachine.can('START')).toBe(true)

      canStart = false
      expect(guardedMachine.can('START')).toBe(false)
    })
  })

  describe('dispatch', () => {
    it('should transition state on valid event', () => {
      const result = machine.dispatch('START')

      expect(result).toBe(true)
      expect(machine.getState()).toBe('loading')
    })

    it('should return false for invalid transition', () => {
      const result = machine.dispatch('SUCCESS')

      expect(result).toBe(false)
      expect(machine.getState()).toBe('idle')
    })

    it('should execute action on transition', () => {
      const action = vi.fn()
      const actionMachine = createStateMachine<State, Event>({
        initial: 'idle',
        transitions: [{ from: 'idle', to: 'loading', event: 'START', action }],
      })

      actionMachine.dispatch('START')

      expect(action).toHaveBeenCalledTimes(1)
    })

    it('should not execute action when guard fails', () => {
      const action = vi.fn()
      const guardedMachine = createStateMachine<State, Event>({
        initial: 'idle',
        transitions: [
          {
            from: 'idle',
            to: 'loading',
            event: 'START',
            guard: () => false,
            action,
          },
        ],
      })

      guardedMachine.dispatch('START')

      expect(action).not.toHaveBeenCalled()
    })

    it('should notify listeners on transition', () => {
      const listener = vi.fn()
      machine.subscribe(listener)

      machine.dispatch('START')

      expect(listener).toHaveBeenCalledWith('loading', 'idle')
    })
  })

  describe('subscribe', () => {
    it('should add state change listener', () => {
      const listener = vi.fn()

      machine.subscribe(listener)
      machine.dispatch('START')

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should return unsubscribe function', () => {
      const listener = vi.fn()

      const unsubscribe = machine.subscribe(listener)
      unsubscribe()
      machine.dispatch('START')

      expect(listener).not.toHaveBeenCalled()
    })

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      machine.subscribe(errorListener)

      expect(() => machine.dispatch('START')).not.toThrow()
    })
  })

  describe('complex transitions', () => {
    it('should handle multiple transitions', () => {
      machine.dispatch('START')
      expect(machine.getState()).toBe('loading')

      machine.dispatch('SUCCESS')
      expect(machine.getState()).toBe('success')

      machine.dispatch('RESET')
      expect(machine.getState()).toBe('idle')
    })

    it('should handle error flow', () => {
      machine.dispatch('START')
      machine.dispatch('FAILURE')

      expect(machine.getState()).toBe('error')

      machine.dispatch('RESET')
      expect(machine.getState()).toBe('idle')
    })
  })
})

describe('createStateMachine', () => {
  it('should create a state machine with config', () => {
    const machine = createStateMachine({
      initial: 'off',
      transitions: [
        { from: 'off', to: 'on', event: 'TOGGLE' },
        { from: 'on', to: 'off', event: 'TOGGLE' },
      ],
    })

    expect(machine.getState()).toBe('off')
    machine.dispatch('TOGGLE')
    expect(machine.getState()).toBe('on')
    machine.dispatch('TOGGLE')
    expect(machine.getState()).toBe('off')
  })
})
