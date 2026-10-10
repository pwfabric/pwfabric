/**
 * In-Memory Cache
 *
 * In-memory cache implementation
 *
 * @module @pwfabric/runtime/cache/memory
 */

import type { CacheProvider, CacheStats, CacheEntry, CacheConfig } from './types.js'

// ============================================================
// IN-MEMORY CACHE
// ============================================================

/**
 * In-memory cache implementation with LRU eviction
 */
export class InMemoryCache implements CacheProvider {
  private readonly cache = new Map<string, CacheEntry<unknown>>()
  private readonly config: Required<CacheConfig>
  private hits = 0
  private misses = 0

  constructor(config: CacheConfig = {}) {
    this.config = {
      maxSize: config.maxSize ?? 1000,
      defaultTtl: config.defaultTtl ?? 300000, // 5 minutes
      evictionPolicy: config.evictionPolicy ?? 'lru',
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    const entry = this.cache.get(key)

    if (!entry) {
      this.misses++
      return undefined
    }

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }

    // Update hit count and move to end for LRU
    this.hits++
    const updated: CacheEntry<T> = {
      ...entry,
      hits: entry.hits + 1,
    } as CacheEntry<T>

    // LRU: delete and re-add to move to end
    this.cache.delete(key)
    this.cache.set(key, updated)

    return entry.value as T
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    // Evict if at max size
    if (this.cache.size >= this.config.maxSize && !this.cache.has(key)) {
      this.evict()
    }

    const entry: CacheEntry<T> = {
      value,
      createdAt: Date.now(),
      hits: 0,
    }

    // Only set expiresAt if TTL is specified
    if (ttl !== undefined) {
      ;(entry as { expiresAt: number }).expiresAt = Date.now() + ttl
    }

    this.cache.set(key, entry)
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key)
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key)
    if (!entry) return false

    // Check expiration
    if (entry.expiresAt && entry.expiresAt < Date.now()) {
      this.cache.delete(key)
      return false
    }

    return true
  }

  async clear(): Promise<void> {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  stats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.config.maxSize,
    }
  }

  private evict(): void {
    switch (this.config.evictionPolicy) {
      case 'lru':
        this.evictLru()
        break
      case 'lfu':
        this.evictLfu()
        break
      case 'fifo':
        this.evictFifo()
        break
    }
  }

  private evictLru(): void {
    // Map maintains insertion order, first item is LRU
    const firstKey = this.cache.keys().next().value
    if (firstKey) {
      this.cache.delete(firstKey)
    }
  }

  private evictLfu(): void {
    // Find entry with lowest hit count
    let minHits = Infinity
    let minKey: string | undefined

    for (const [key, entry] of this.cache) {
      if (entry.hits < minHits) {
        minHits = entry.hits
        minKey = key
      }
    }

    if (minKey) {
      this.cache.delete(minKey)
    }
  }

  private evictFifo(): void {
    // Same as LRU for Map since it maintains insertion order
    this.evictLru()
  }
}

/**
 * Create an in-memory cache
 */
export function createMemoryCache(config?: CacheConfig): CacheProvider {
  return new InMemoryCache(config)
}
