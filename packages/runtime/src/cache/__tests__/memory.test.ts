/**
 * In-Memory Cache Tests
 *
 * Tests for in-memory caching implementation
 *
 * @module @pwfabric/runtime/cache/__tests__/memory
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { InMemoryCache, createMemoryCache } from '../memory.js'

describe('InMemoryCache', () => {
  let cache: InMemoryCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new InMemoryCache({ maxSize: 10 })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('get/set', () => {
    it('should store and retrieve values', async () => {
      await cache.set('key1', 'value1')

      const value = await cache.get('key1')

      expect(value).toBe('value1')
    })

    it('should return undefined for missing keys', async () => {
      const value = await cache.get('non-existent')

      expect(value).toBeUndefined()
    })

    it('should handle complex values', async () => {
      const data = { name: 'test', items: [1, 2, 3] }
      await cache.set('complex', data)

      const value = await cache.get<typeof data>('complex')

      expect(value).toEqual(data)
    })
  })

  describe('TTL expiration', () => {
    it('should expire entries after TTL', async () => {
      await cache.set('expiring', 'value', 1000) // 1 second TTL

      // Value should be available before expiration
      expect(await cache.get('expiring')).toBe('value')

      // Advance time past TTL
      vi.advanceTimersByTime(1100)

      // Value should be expired
      expect(await cache.get('expiring')).toBeUndefined()
    })

    it('should not expire entries without TTL', async () => {
      await cache.set('permanent', 'value')

      vi.advanceTimersByTime(86400000) // 24 hours

      expect(await cache.get('permanent')).toBe('value')
    })
  })

  describe('has', () => {
    it('should return true for existing keys', async () => {
      await cache.set('exists', 'value')

      expect(await cache.has('exists')).toBe(true)
    })

    it('should return false for missing keys', async () => {
      expect(await cache.has('missing')).toBe(false)
    })

    it('should return false for expired keys', async () => {
      await cache.set('expiring', 'value', 1000)

      vi.advanceTimersByTime(1100)

      expect(await cache.has('expiring')).toBe(false)
    })
  })

  describe('delete', () => {
    it('should remove entries', async () => {
      await cache.set('key', 'value')

      const deleted = await cache.delete('key')

      expect(deleted).toBe(true)
      expect(await cache.get('key')).toBeUndefined()
    })

    it('should return false for missing keys', async () => {
      const deleted = await cache.delete('non-existent')

      expect(deleted).toBe(false)
    })
  })

  describe('clear', () => {
    it('should remove all entries', async () => {
      await cache.set('key1', 'value1')
      await cache.set('key2', 'value2')
      await cache.set('key3', 'value3')

      await cache.clear()

      expect(await cache.get('key1')).toBeUndefined()
      expect(await cache.get('key2')).toBeUndefined()
      expect(await cache.get('key3')).toBeUndefined()
    })
  })

  describe('stats', () => {
    it('should track cache statistics', async () => {
      await cache.set('key1', 'value1')
      await cache.get('key1') // hit
      await cache.get('key2') // miss

      const stats = await cache.stats()

      expect(stats.hits).toBe(1)
      expect(stats.misses).toBe(1)
      expect(stats.size).toBe(1)
    })
  })

  describe('LRU eviction', () => {
    it('should evict least recently used entries when full', async () => {
      const smallCache = new InMemoryCache({ maxSize: 3, evictionPolicy: 'lru' })

      await smallCache.set('key1', 'value1')
      await smallCache.set('key2', 'value2')
      await smallCache.set('key3', 'value3')

      // Access key1 to make it recently used
      await smallCache.get('key1')

      // Add new entry, should evict key2 (least recently used)
      await smallCache.set('key4', 'value4')

      expect(await smallCache.get('key1')).toBe('value1')
      expect(await smallCache.get('key2')).toBeUndefined()
      expect(await smallCache.get('key3')).toBe('value3')
      expect(await smallCache.get('key4')).toBe('value4')
    })
  })

  describe('LFU eviction', () => {
    it('should evict least frequently used entries when full', async () => {
      const smallCache = new InMemoryCache({ maxSize: 3, evictionPolicy: 'lfu' })

      await smallCache.set('key1', 'value1')
      await smallCache.set('key2', 'value2')
      await smallCache.set('key3', 'value3')

      // Access key1 and key3 multiple times
      await smallCache.get('key1')
      await smallCache.get('key1')
      await smallCache.get('key3')

      // Add new entry, should evict key2 (least frequently used)
      await smallCache.set('key4', 'value4')

      expect(await smallCache.get('key1')).toBe('value1')
      expect(await smallCache.get('key2')).toBeUndefined()
      expect(await smallCache.get('key3')).toBe('value3')
      expect(await smallCache.get('key4')).toBe('value4')
    })
  })

  describe('FIFO eviction', () => {
    it('should evict first-in entries when full', async () => {
      const smallCache = new InMemoryCache({ maxSize: 3, evictionPolicy: 'fifo' })

      await smallCache.set('key1', 'value1')
      await smallCache.set('key2', 'value2')
      await smallCache.set('key3', 'value3')

      // Add new entry, should evict key1 (first in)
      await smallCache.set('key4', 'value4')

      expect(await smallCache.get('key1')).toBeUndefined()
      expect(await smallCache.get('key2')).toBe('value2')
      expect(await smallCache.get('key3')).toBe('value3')
      expect(await smallCache.get('key4')).toBe('value4')
    })
  })
})

describe('createMemoryCache', () => {
  it('should create cache with default options', () => {
    const cache = createMemoryCache()

    expect(cache).toBeInstanceOf(InMemoryCache)
  })

  it('should create cache with custom options', () => {
    const cache = createMemoryCache({ maxSize: 100, evictionPolicy: 'lfu' })

    expect(cache).toBeInstanceOf(InMemoryCache)
  })
})
