/**
 * In-Memory State Store
 *
 * In-memory state store implementation with reactive subscriptions
 *
 * @module @pwfabric/runtime/state/store
 */

import type {
  StateStore,
  StateChangeEvent,
  StateChangeListener,
  StateStoreConfig,
  StateHistoryEntry,
} from './types.js'

// ============================================================
// IN-MEMORY STATE STORE
// ============================================================

/**
 * In-memory implementation of StateStore with reactive subscriptions
 */
export class InMemoryStateStore<T = unknown> implements StateStore<T> {
  private readonly state = new Map<string, T>()
  private readonly listeners = new Map<string, Set<StateChangeListener<T>>>()
  private readonly history = new Map<string, StateHistoryEntry<T>[]>()
  private readonly config: Required<StateStoreConfig>

  constructor(initialState: Record<string, T> = {}, config: StateStoreConfig = {}) {
    this.config = {
      enableHistory: config.enableHistory ?? false,
      maxHistorySize: config.maxHistorySize ?? 100,
      deepClone: config.deepClone ?? false,
    }

    // Initialize with initial state
    for (const [key, value] of Object.entries(initialState)) {
      this.state.set(key, this.maybeClone(value))
    }
  }

  get(key: string): T | undefined {
    const value = this.state.get(key)
    return value !== undefined ? this.maybeClone(value) : undefined
  }

  set(key: string, value: T): void {
    const previousValue = this.state.get(key)
    const newValue = this.maybeClone(value)

    this.state.set(key, newValue)

    // Record history if enabled
    if (this.config.enableHistory) {
      this.recordHistory(key, newValue)
    }

    // Notify listeners
    const event: StateChangeEvent<T> = {
      key,
      previousValue,
      newValue,
      timestamp: Date.now(),
    }

    this.notifyListeners(key, newValue, event)
  }

  subscribe(key: string, listener: StateChangeListener<T>): () => void {
    let keyListeners = this.listeners.get(key)
    if (!keyListeners) {
      keyListeners = new Set()
      this.listeners.set(key, keyListeners)
    }

    keyListeners.add(listener)

    // Return unsubscribe function
    return () => {
      keyListeners.delete(listener)
      if (keyListeners.size === 0) {
        this.listeners.delete(key)
      }
    }
  }

  clear(): void {
    this.state.clear()
    this.listeners.clear()
    this.history.clear()
  }

  keys(): string[] {
    return Array.from(this.state.keys())
  }

  has(key: string): boolean {
    return this.state.has(key)
  }

  size(): number {
    return this.state.size
  }

  /**
   * Get state change history for a key (if history is enabled)
   */
  getHistory(key: string): readonly StateHistoryEntry<T>[] {
    return this.history.get(key) ?? []
  }

  /**
   * Get all current state as an object
   */
  getSnapshot(): Record<string, T> {
    const snapshot: Record<string, T> = {}
    for (const [key, value] of this.state) {
      snapshot[key] = this.maybeClone(value)
    }
    return snapshot
  }

  private notifyListeners(key: string, value: T, event: StateChangeEvent<T>): void {
    const keyListeners = this.listeners.get(key)
    if (keyListeners) {
      for (const listener of keyListeners) {
        try {
          listener(value, event)
        } catch {
          // Swallow errors from listeners to prevent one bad listener from breaking others
        }
      }
    }
  }

  private recordHistory(key: string, value: T): void {
    let keyHistory = this.history.get(key)
    if (!keyHistory) {
      keyHistory = []
      this.history.set(key, keyHistory)
    }

    keyHistory.push({
      value: this.maybeClone(value),
      timestamp: Date.now(),
    })

    // Trim history if exceeds max size
    while (keyHistory.length > this.config.maxHistorySize) {
      keyHistory.shift()
    }
  }

  private maybeClone(value: T): T {
    if (!this.config.deepClone) {
      return value
    }

    // Simple deep clone using JSON (works for most cases)
    // For more complex cases, a proper deep clone library would be needed
    try {
      return JSON.parse(JSON.stringify(value)) as T
    } catch {
      // If cloning fails, return original value
      return value
    }
  }
}

/**
 * Create an in-memory state store
 */
export function createStateStore<T = unknown>(
  initialState?: Record<string, T>,
  config?: StateStoreConfig
): StateStore<T> {
  return new InMemoryStateStore<T>(initialState, config)
}
