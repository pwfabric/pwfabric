/**
 * Surface State Manager
 *
 * Manager for surface-scoped state stores
 *
 * @module @pwfabric/runtime/state/manager
 */

import type { SurfaceStateManager, StateStore, StateStoreConfig } from './types.js'
import { InMemoryStateStore } from './store.js'

// ============================================================
// DEFAULT SURFACE STATE MANAGER
// ============================================================

/**
 * Default implementation of SurfaceStateManager
 * Manages multiple state stores, one per surface
 */
export class DefaultSurfaceStateManager implements SurfaceStateManager {
  private readonly stores = new Map<string, StateStore<unknown>>()
  private readonly defaultConfig: StateStoreConfig

  constructor(defaultConfig: StateStoreConfig = {}) {
    this.defaultConfig = defaultConfig
  }

  createStore<T>(surfaceId: string, initialState: T): StateStore<T> {
    // If store already exists, throw error to prevent accidental overwrites
    if (this.stores.has(surfaceId)) {
      throw new Error(`State store already exists for surface: ${surfaceId}`)
    }

    // Convert single value initialState to object format if needed
    const stateObject = this.normalizeInitialState(initialState)
    const store = new InMemoryStateStore<unknown>(stateObject, this.defaultConfig)

    this.stores.set(surfaceId, store)

    return store as StateStore<T>
  }

  getStore<T>(surfaceId: string): StateStore<T> | undefined {
    return this.stores.get(surfaceId) as StateStore<T> | undefined
  }

  hasStore(surfaceId: string): boolean {
    return this.stores.has(surfaceId)
  }

  destroyStore(surfaceId: string): void {
    const store = this.stores.get(surfaceId)
    if (store) {
      store.clear()
      this.stores.delete(surfaceId)
    }
  }

  destroyAll(): void {
    for (const store of this.stores.values()) {
      store.clear()
    }
    this.stores.clear()
  }

  getSurfaceIds(): string[] {
    return Array.from(this.stores.keys())
  }

  /**
   * Get or create a store for a surface
   * Creates a new store with empty initial state if it doesn't exist
   */
  getOrCreateStore<T>(surfaceId: string, initialState?: T): StateStore<T> {
    const existing = this.getStore<T>(surfaceId)
    if (existing) {
      return existing
    }

    return this.createStore<T>(surfaceId, initialState ?? ({} as T))
  }

  private normalizeInitialState<T>(initialState: T): Record<string, unknown> {
    // If already an object (but not null/array), use it directly
    if (initialState !== null && typeof initialState === 'object' && !Array.isArray(initialState)) {
      return initialState as Record<string, unknown>
    }

    // Otherwise, wrap in a 'value' key
    return { value: initialState }
  }
}

/**
 * Create a surface state manager
 */
export function createSurfaceStateManager(config?: StateStoreConfig): SurfaceStateManager {
  return new DefaultSurfaceStateManager(config)
}
