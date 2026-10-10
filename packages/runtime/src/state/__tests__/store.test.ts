/**
 * State Store Tests
 *
 * Tests for in-memory state store implementation
 *
 * @module @pwfabric/runtime/state/__tests__/store
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InMemoryStateStore, createStateStore } from '../store.js'
import type { StateChangeEvent } from '../types.js'

describe('InMemoryStateStore', () => {
  let store: InMemoryStateStore<unknown>

  beforeEach(() => {
    store = new InMemoryStateStore()
  })

  describe('get/set', () => {
    it('should store and retrieve values', () => {
      store.set('key1', 'value1')

      const value = store.get('key1')

      expect(value).toBe('value1')
    })

    it('should return undefined for missing keys', () => {
      const value = store.get('non-existent')

      expect(value).toBeUndefined()
    })

    it('should handle complex values', () => {
      const data = { name: 'test', items: [1, 2, 3] }
      store.set('complex', data)

      const value = store.get('complex')

      expect(value).toEqual(data)
    })

    it('should overwrite existing values', () => {
      store.set('key', 'initial')
      store.set('key', 'updated')

      expect(store.get('key')).toBe('updated')
    })
  })

  describe('initial state', () => {
    it('should initialize with provided state', () => {
      const initialStore = new InMemoryStateStore({ name: 'John', age: 30 })

      expect(initialStore.get('name')).toBe('John')
      expect(initialStore.get('age')).toBe(30)
    })

    it('should initialize with empty state by default', () => {
      expect(store.size()).toBe(0)
    })
  })

  describe('subscribe', () => {
    it('should notify listener on value change', () => {
      const listener = vi.fn()

      store.subscribe('key', listener)
      store.set('key', 'value')

      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(
        'value',
        expect.objectContaining({
          key: 'key',
          previousValue: undefined,
          newValue: 'value',
        })
      )
    })

    it('should include previous value in event', () => {
      const listener = vi.fn()
      store.set('key', 'initial')

      store.subscribe('key', listener)
      store.set('key', 'updated')

      expect(listener).toHaveBeenCalledWith(
        'updated',
        expect.objectContaining({
          key: 'key',
          previousValue: 'initial',
          newValue: 'updated',
        })
      )
    })

    it('should include timestamp in event', () => {
      const listener = vi.fn()
      const beforeTime = Date.now()

      store.subscribe('key', listener)
      store.set('key', 'value')

      const afterTime = Date.now()
      const event = listener.mock.calls[0][1] as StateChangeEvent

      expect(event.timestamp).toBeGreaterThanOrEqual(beforeTime)
      expect(event.timestamp).toBeLessThanOrEqual(afterTime)
    })

    it('should support multiple listeners per key', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      store.subscribe('key', listener1)
      store.subscribe('key', listener2)
      store.set('key', 'value')

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should only notify listeners for the changed key', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      store.subscribe('key1', listener1)
      store.subscribe('key2', listener2)
      store.set('key1', 'value')

      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).not.toHaveBeenCalled()
    })

    it('should return unsubscribe function', () => {
      const listener = vi.fn()

      const unsubscribe = store.subscribe('key', listener)
      store.set('key', 'value1')

      unsubscribe()
      store.set('key', 'value2')

      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      const goodListener = vi.fn()

      store.subscribe('key', errorListener)
      store.subscribe('key', goodListener)

      // Should not throw
      expect(() => store.set('key', 'value')).not.toThrow()
      expect(goodListener).toHaveBeenCalled()
    })
  })

  describe('has', () => {
    it('should return true for existing keys', () => {
      store.set('exists', 'value')

      expect(store.has('exists')).toBe(true)
    })

    it('should return false for missing keys', () => {
      expect(store.has('missing')).toBe(false)
    })
  })

  describe('keys', () => {
    it('should return all keys', () => {
      store.set('key1', 'value1')
      store.set('key2', 'value2')
      store.set('key3', 'value3')

      const keys = store.keys()

      expect(keys).toHaveLength(3)
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys).toContain('key3')
    })

    it('should return empty array for empty store', () => {
      expect(store.keys()).toEqual([])
    })
  })

  describe('size', () => {
    it('should return correct size', () => {
      store.set('key1', 'value1')
      store.set('key2', 'value2')

      expect(store.size()).toBe(2)
    })

    it('should return 0 for empty store', () => {
      expect(store.size()).toBe(0)
    })
  })

  describe('clear', () => {
    it('should remove all entries', () => {
      store.set('key1', 'value1')
      store.set('key2', 'value2')

      store.clear()

      expect(store.size()).toBe(0)
      expect(store.get('key1')).toBeUndefined()
      expect(store.get('key2')).toBeUndefined()
    })

    it('should clear all listeners', () => {
      const listener = vi.fn()
      store.subscribe('key', listener)

      store.clear()
      store.set('key', 'value')

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('getSnapshot', () => {
    it('should return all state as object', () => {
      store.set('name', 'John')
      store.set('age', 30)

      const snapshot = (store as InMemoryStateStore).getSnapshot()

      expect(snapshot).toEqual({ name: 'John', age: 30 })
    })

    it('should return empty object for empty store', () => {
      const snapshot = (store as InMemoryStateStore).getSnapshot()

      expect(snapshot).toEqual({})
    })
  })

  describe('history', () => {
    it('should not record history by default', () => {
      store.set('key', 'value1')
      store.set('key', 'value2')

      const history = (store as InMemoryStateStore).getHistory('key')

      expect(history).toEqual([])
    })

    it('should record history when enabled', () => {
      const historyStore = new InMemoryStateStore({}, { enableHistory: true })

      historyStore.set('key', 'value1')
      historyStore.set('key', 'value2')

      const history = historyStore.getHistory('key')

      expect(history).toHaveLength(2)
      expect(history[0].value).toBe('value1')
      expect(history[1].value).toBe('value2')
    })

    it('should limit history size', () => {
      const historyStore = new InMemoryStateStore(
        {},
        {
          enableHistory: true,
          maxHistorySize: 3,
        }
      )

      historyStore.set('key', 'value1')
      historyStore.set('key', 'value2')
      historyStore.set('key', 'value3')
      historyStore.set('key', 'value4')
      historyStore.set('key', 'value5')

      const history = historyStore.getHistory('key')

      expect(history).toHaveLength(3)
      expect(history[0].value).toBe('value3')
      expect(history[2].value).toBe('value5')
    })
  })

  describe('deep clone', () => {
    it('should not deep clone by default', () => {
      const obj = { name: 'John' }
      store.set('key', obj)

      obj.name = 'Jane'

      expect(store.get('key')).toEqual({ name: 'Jane' })
    })

    it('should deep clone when enabled', () => {
      const cloneStore = new InMemoryStateStore({}, { deepClone: true })
      const obj = { name: 'John' }

      cloneStore.set('key', obj)
      obj.name = 'Jane'

      expect(cloneStore.get('key')).toEqual({ name: 'John' })
    })
  })
})

describe('createStateStore', () => {
  it('should create store with default options', () => {
    const store = createStateStore()

    expect(store).toBeInstanceOf(InMemoryStateStore)
  })

  it('should create store with initial state', () => {
    const store = createStateStore({ name: 'John', age: 30 })

    expect(store.get('name')).toBe('John')
    expect(store.get('age')).toBe(30)
  })

  it('should create store with custom config', () => {
    const store = createStateStore({}, { enableHistory: true })

    store.set('key', 'value')

    expect((store as InMemoryStateStore).getHistory('key')).toHaveLength(1)
  })
})
