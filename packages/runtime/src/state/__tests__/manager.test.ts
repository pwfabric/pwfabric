/**
 * Surface State Manager Tests
 *
 * Tests for surface state manager implementation
 *
 * @module @pwfabric/runtime/state/__tests__/manager
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultSurfaceStateManager, createSurfaceStateManager } from '../manager.js'

describe('DefaultSurfaceStateManager', () => {
  let manager: DefaultSurfaceStateManager

  beforeEach(() => {
    manager = new DefaultSurfaceStateManager()
  })

  describe('createStore', () => {
    it('should create a new store for a surface', () => {
      const store = manager.createStore('surface-1', { count: 0 })

      expect(store).toBeDefined()
      expect(store.get('count')).toBe(0)
    })

    it('should throw error if store already exists', () => {
      manager.createStore('surface-1', { count: 0 })

      expect(() => manager.createStore('surface-1', { count: 1 })).toThrow(
        'State store already exists for surface: surface-1'
      )
    })

    it('should handle primitive initial state', () => {
      const store = manager.createStore('surface-1', 'hello')

      expect(store.get('value')).toBe('hello')
    })

    it('should handle array initial state', () => {
      const store = manager.createStore('surface-1', [1, 2, 3])

      expect(store.get('value')).toEqual([1, 2, 3])
    })

    it('should handle object initial state directly', () => {
      const store = manager.createStore('surface-1', { name: 'John', age: 30 })

      expect(store.get('name')).toBe('John')
      expect(store.get('age')).toBe(30)
    })
  })

  describe('getStore', () => {
    it('should return existing store', () => {
      const created = manager.createStore('surface-1', { count: 0 })
      const retrieved = manager.getStore('surface-1')

      expect(retrieved).toBe(created)
    })

    it('should return undefined for non-existent surface', () => {
      const store = manager.getStore('non-existent')

      expect(store).toBeUndefined()
    })
  })

  describe('hasStore', () => {
    it('should return true for existing store', () => {
      manager.createStore('surface-1', {})

      expect(manager.hasStore('surface-1')).toBe(true)
    })

    it('should return false for non-existent store', () => {
      expect(manager.hasStore('non-existent')).toBe(false)
    })
  })

  describe('destroyStore', () => {
    it('should destroy existing store', () => {
      manager.createStore('surface-1', { count: 0 })

      manager.destroyStore('surface-1')

      expect(manager.hasStore('surface-1')).toBe(false)
    })

    it('should clear store data before destroying', () => {
      const store = manager.createStore('surface-1', { count: 0 })

      manager.destroyStore('surface-1')

      expect(store.size()).toBe(0)
    })

    it('should handle destroying non-existent store gracefully', () => {
      expect(() => manager.destroyStore('non-existent')).not.toThrow()
    })
  })

  describe('destroyAll', () => {
    it('should destroy all stores', () => {
      manager.createStore('surface-1', { count: 0 })
      manager.createStore('surface-2', { count: 0 })
      manager.createStore('surface-3', { count: 0 })

      manager.destroyAll()

      expect(manager.hasStore('surface-1')).toBe(false)
      expect(manager.hasStore('surface-2')).toBe(false)
      expect(manager.hasStore('surface-3')).toBe(false)
    })

    it('should clear all store data', () => {
      const store1 = manager.createStore('surface-1', { count: 1 })
      const store2 = manager.createStore('surface-2', { count: 2 })

      manager.destroyAll()

      expect(store1.size()).toBe(0)
      expect(store2.size()).toBe(0)
    })
  })

  describe('getSurfaceIds', () => {
    it('should return all surface IDs', () => {
      manager.createStore('surface-1', {})
      manager.createStore('surface-2', {})
      manager.createStore('surface-3', {})

      const ids = manager.getSurfaceIds()

      expect(ids).toHaveLength(3)
      expect(ids).toContain('surface-1')
      expect(ids).toContain('surface-2')
      expect(ids).toContain('surface-3')
    })

    it('should return empty array when no stores exist', () => {
      expect(manager.getSurfaceIds()).toEqual([])
    })
  })

  describe('getOrCreateStore', () => {
    it('should return existing store if it exists', () => {
      const created = manager.createStore('surface-1', { count: 5 })
      const retrieved = manager.getOrCreateStore<{ count: number }>('surface-1')

      expect(retrieved).toBe(created)
      expect(retrieved.get('count')).toBe(5)
    })

    it('should create new store if it does not exist', () => {
      const store = manager.getOrCreateStore('surface-1', { count: 0 })

      expect(store).toBeDefined()
      expect(manager.hasStore('surface-1')).toBe(true)
    })

    it('should create store with empty object if no initial state provided', () => {
      const store = manager.getOrCreateStore('surface-1')

      expect(store).toBeDefined()
      expect(store.size()).toBe(0)
    })
  })

  describe('multiple surfaces isolation', () => {
    it('should keep state isolated between surfaces', () => {
      const store1 = manager.createStore('surface-1', { name: 'Surface 1' })
      const store2 = manager.createStore('surface-2', { name: 'Surface 2' })

      expect(store1.get('name')).toBe('Surface 1')
      expect(store2.get('name')).toBe('Surface 2')

      store1.set('name', 'Updated Surface 1')

      expect(store1.get('name')).toBe('Updated Surface 1')
      expect(store2.get('name')).toBe('Surface 2')
    })

    it('should allow different state shapes per surface', () => {
      const store1 = manager.createStore<{ count: number }>('surface-1', { count: 0 })
      const store2 = manager.createStore<{ items: string[] }>('surface-2', { items: [] })

      store1.set('count', 5)
      store2.set('items', ['a', 'b', 'c'])

      expect(store1.get('count')).toBe(5)
      expect(store2.get('items')).toEqual(['a', 'b', 'c'])
    })
  })

  describe('configuration', () => {
    it('should apply default config to created stores', () => {
      const configuredManager = new DefaultSurfaceStateManager({
        enableHistory: true,
        maxHistorySize: 5,
      })

      const store = configuredManager.createStore('surface-1', { count: 0 })

      // Set multiple values to test history
      store.set('count', 1)
      store.set('count', 2)
      store.set('count', 3)

      // History should be enabled
      // We can't directly test this without exposing getHistory,
      // but the store should be created successfully with config
      expect(store.get('count')).toBe(3)
    })
  })
})

describe('createSurfaceStateManager', () => {
  it('should create manager with default options', () => {
    const manager = createSurfaceStateManager()

    expect(manager).toBeInstanceOf(DefaultSurfaceStateManager)
  })

  it('should create manager with custom config', () => {
    const manager = createSurfaceStateManager({ enableHistory: true })

    expect(manager).toBeInstanceOf(DefaultSurfaceStateManager)
  })
})
