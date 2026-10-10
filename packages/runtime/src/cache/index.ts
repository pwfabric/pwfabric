/**
 * Cache Module
 *
 * Caching system for binding and data
 *
 * @module @pwfabric/runtime/cache
 */

// Types
export type { CacheProvider, CacheStats, CacheEntry, CacheConfig } from './types.js'

// Memory cache
export { InMemoryCache, createMemoryCache } from './memory.js'
