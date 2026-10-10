/**
 * State Management Types
 *
 * State management capability for surfaces
 *
 * @module @pwfabric/runtime/state/types
 */

// ============================================================
// STATE CHANGE EVENT
// ============================================================

/**
 * Event emitted when state changes
 */
export interface StateChangeEvent<T = unknown> {
  readonly key: string
  readonly previousValue: T | undefined
  readonly newValue: T
  readonly timestamp: number
}

/**
 * State change listener callback
 */
export type StateChangeListener<T = unknown> = (value: T, event: StateChangeEvent<T>) => void

// ============================================================
// STATE STORE
// ============================================================

/**
 * State store interface for managing reactive state
 */
export interface StateStore<T = unknown> {
  /**
   * Get a value from the store
   */
  get(key: string): T | undefined

  /**
   * Set a value in the store
   */
  set(key: string, value: T): void

  /**
   * Subscribe to changes for a specific key
   * Returns an unsubscribe function
   */
  subscribe(key: string, listener: StateChangeListener<T>): () => void

  /**
   * Clear all state from the store
   */
  clear(): void

  /**
   * Get all keys in the store
   */
  keys(): string[]

  /**
   * Check if a key exists in the store
   */
  has(key: string): boolean

  /**
   * Get the number of entries in the store
   */
  size(): number
}

// ============================================================
// SURFACE STATE MANAGER
// ============================================================

/**
 * Manager for surface-scoped state stores
 */
export interface SurfaceStateManager {
  /**
   * Create a new store for a surface with initial state
   */
  createStore<T>(surfaceId: string, initialState: T): StateStore<T>

  /**
   * Get an existing store for a surface
   */
  getStore<T>(surfaceId: string): StateStore<T> | undefined

  /**
   * Check if a store exists for a surface
   */
  hasStore(surfaceId: string): boolean

  /**
   * Destroy a store for a surface
   */
  destroyStore(surfaceId: string): void

  /**
   * Destroy all stores
   */
  destroyAll(): void

  /**
   * Get all surface IDs with active stores
   */
  getSurfaceIds(): string[]
}

// ============================================================
// STATE CONFIGURATION
// ============================================================

/**
 * Configuration for state store
 */
export interface StateStoreConfig {
  /**
   * Whether to enable state change history
   */
  readonly enableHistory?: boolean

  /**
   * Maximum history entries to keep per key
   */
  readonly maxHistorySize?: number

  /**
   * Whether to deep clone values on get/set
   */
  readonly deepClone?: boolean
}

/**
 * State history entry
 */
export interface StateHistoryEntry<T = unknown> {
  readonly value: T
  readonly timestamp: number
}
