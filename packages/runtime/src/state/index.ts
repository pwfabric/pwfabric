/**
 * State Management Module
 *
 * State management capability for surfaces
 *
 * Exports:
 * - Types: StateStore, SurfaceStateManager, StateChangeEvent, etc.
 * - Implementations: InMemoryStateStore, DefaultSurfaceStateManager
 * - Factory functions: createStateStore, createSurfaceStateManager
 *
 * @module @pwfabric/runtime/state
 */

// Types
export type {
  StateStore,
  SurfaceStateManager,
  StateChangeEvent,
  StateChangeListener,
  StateStoreConfig,
  StateHistoryEntry,
} from './types.js'

// Implementations
export { InMemoryStateStore, createStateStore } from './store.js'
export { DefaultSurfaceStateManager, createSurfaceStateManager } from './manager.js'
