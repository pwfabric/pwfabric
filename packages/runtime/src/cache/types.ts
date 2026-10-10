/**
 * Cache Types
 *
 * Caching system types
 *
 * @module @pwfabric/runtime/cache/types
 */

// ============================================================
// CACHE PROVIDER TYPES
// ============================================================

/**
 * Cache provider interface
 */
export interface CacheProvider {
  /**
   * Get a value from cache
   */
  get<T>(key: string): Promise<T | undefined>

  /**
   * Set a value in cache
   */
  set<T>(key: string, value: T, ttl?: number): Promise<void>

  /**
   * Delete a value from cache
   */
  delete(key: string): Promise<boolean>

  /**
   * Check if a key exists
   */
  has(key: string): Promise<boolean>

  /**
   * Clear all cache entries
   */
  clear(): Promise<void>

  /**
   * Get cache statistics
   */
  stats(): CacheStats
}

/**
 * Cache statistics
 */
export interface CacheStats {
  readonly hits: number
  readonly misses: number
  readonly size: number
  readonly maxSize?: number
}

/**
 * Cache entry with metadata
 */
export interface CacheEntry<T> {
  readonly value: T
  readonly createdAt: number
  readonly expiresAt?: number
  readonly hits: number
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  readonly maxSize?: number
  readonly defaultTtl?: number
  readonly evictionPolicy?: 'lru' | 'lfu' | 'fifo'
}
