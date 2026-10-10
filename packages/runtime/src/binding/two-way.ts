/**
 * Two-way Data Binding
 *
 * P1-5: Extends the binding system with write-back capability.
 * UI changes propagate back to the data source, enabling form inputs,
 * editable fields, and other interactive elements to automatically
 * update the data model.
 *
 * @module @pwfabric/runtime/binding/two-way
 */

import { resolvePath } from './expression.js'

// ============================================================
// TYPES
// ============================================================

/**
 * Configuration for a two-way binding
 */
export interface TwoWayBindingConfig {
  /** Data path using dot-notation (e.g., "user.profile.name") */
  readonly path: string
  /** Debounce delay in ms for write-back (default: 300) */
  readonly debounceMs?: number
  /** Optional validation function run before setting value */
  readonly validate?: (value: unknown) => ValidationResult
  /** Optional transform functions between UI and model */
  readonly transform?: {
    readonly toModel?: (uiValue: unknown) => unknown
    readonly toView?: (modelValue: unknown) => unknown
  }
}

/**
 * Result of value validation
 */
export interface ValidationResult {
  readonly valid: boolean
  readonly error?: string
}

/**
 * A two-way binding instance for a specific data path
 */
export interface TwoWayBinding<T = unknown> {
  /** The data path this binding targets */
  readonly path: string
  /** Current value at the path */
  readonly value: T
  /** Current validation error, if any */
  readonly error?: string | undefined
  /** Whether the value has changed from the initial value */
  readonly isDirty: boolean
  /** Whether validation is currently running */
  readonly isValidating: boolean
  /** Set a new value (triggers validation, debounced write-back) */
  setValue(newValue: T): void
  /** Reset value to the initial value */
  reset(): void
  /** Dispose the binding and clean up timers */
  dispose(): void
}

/**
 * Listener called when a value changes at a path
 */
export type ChangeListener<T = unknown> = (newValue: T, oldValue: T) => void

// ============================================================
// PATH UTILITIES
// ============================================================

/**
 * Parsed segment of a data path
 */
type PathSegment = { type: 'property'; key: string } | { type: 'index'; index: number }

/**
 * Parse a dot-notation path into segments for traversal
 */
function parsePath(path: string): PathSegment[] {
  const segments: PathSegment[] = []
  const regex = /(\w+)|\[(\d+)\]/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      segments.push({ type: 'property', key: match[1] })
    } else if (match[2] !== undefined) {
      segments.push({ type: 'index', index: parseInt(match[2], 10) })
    }
  }

  return segments
}

/**
 * Set a value at a dot-notation path in an object, creating
 * intermediate objects/arrays as needed.
 *
 * Mutates the target object in place.
 */
function setAtPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segments = parsePath(path)
  if (segments.length === 0) return

  let current: unknown = obj

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i]
    if (segment === undefined) return

    if (segment.type === 'property') {
      if (typeof current !== 'object' || current === null) return
      const record = current as Record<string, unknown>
      if (record[segment.key] === undefined || record[segment.key] === null) {
        // Look ahead to decide whether to create an object or array
        const next = segments[i + 1]
        record[segment.key] = next && next.type === 'index' ? [] : {}
      }
      current = record[segment.key]
    } else {
      if (!Array.isArray(current)) return
      if (current[segment.index] === undefined || current[segment.index] === null) {
        const next = segments[i + 1]
        current[segment.index] = next && next.type === 'index' ? [] : {}
      }
      current = current[segment.index]
    }
  }

  const last = segments[segments.length - 1]
  if (last === undefined) return

  if (last.type === 'property') {
    if (typeof current === 'object' && current !== null) {
      ;(current as Record<string, unknown>)[last.key] = value
    }
  } else {
    if (Array.isArray(current)) {
      current[last.index] = value
    }
  }
}

/**
 * Deep-clone a plain object/array structure using structured clone
 * semantics (JSON round-trip for simplicity and zero dependencies).
 */
function deepClone<T>(value: T): T {
  if (value === undefined || value === null) return value
  if (typeof value !== 'object') return value
  return JSON.parse(JSON.stringify(value)) as T
}

// ============================================================
// TWO-WAY BINDING INSTANCE (INTERNAL)
// ============================================================

/**
 * Internal class that implements a single two-way binding
 */
class TwoWayBindingInstance<T = unknown> implements TwoWayBinding<T> {
  readonly path: string

  private _value: T
  private _initialValue: T
  private _error: string | undefined
  private _isDirty = false
  private _isValidating = false
  private _disposed = false

  private readonly config: TwoWayBindingConfig
  private readonly manager: TwoWayBindingManager
  private debounceTimer: ReturnType<typeof setTimeout> | undefined

  constructor(config: TwoWayBindingConfig, initialValue: T, manager: TwoWayBindingManager) {
    this.path = config.path
    this.config = config
    this.manager = manager

    // Apply toView transform for initial value
    const viewValue = config.transform?.toView
      ? (config.transform.toView(initialValue) as T)
      : initialValue

    this._value = viewValue
    this._initialValue = deepClone(viewValue)
  }

  get value(): T {
    return this._value
  }

  get error(): string | undefined {
    return this._error
  }

  get isDirty(): boolean {
    return this._isDirty
  }

  get isValidating(): boolean {
    return this._isValidating
  }

  setValue(newValue: T): void {
    if (this._disposed) return

    const oldValue = this._value

    // Run validation if configured
    if (this.config.validate) {
      this._isValidating = true
      const result = this.config.validate(newValue)
      this._isValidating = false

      if (!result.valid) {
        this._error = result.error
        return
      }
    }

    // Clear any previous error
    this._error = undefined

    // Update the local value
    this._value = newValue

    // Track dirty state
    this._isDirty = !isEqual(newValue, this._initialValue)

    // Debounced write-back to model
    this.scheduleWriteBack(newValue, oldValue)
  }

  reset(): void {
    if (this._disposed) return

    const oldValue = this._value
    this._value = deepClone(this._initialValue)
    this._isDirty = false
    this._error = undefined
    this.clearDebounce()

    // Write the reset value back to model immediately
    const modelValue = this.config.transform?.toModel
      ? this.config.transform.toModel(this._value)
      : this._value

    this.manager.setValueInternal(this.path, modelValue, oldValue)
  }

  dispose(): void {
    if (this._disposed) return
    this._disposed = true
    this.clearDebounce()
  }

  /**
   * Called by the manager when the model value changes externally
   */
  updateFromModel(modelValue: unknown): void {
    if (this._disposed) return

    const viewValue = this.config.transform?.toView
      ? (this.config.transform.toView(modelValue) as T)
      : (modelValue as T)

    this._value = viewValue
    this._isDirty = !isEqual(viewValue, this._initialValue)
  }

  private scheduleWriteBack(newValue: T, oldValue: T): void {
    this.clearDebounce()

    const delay = this.config.debounceMs ?? DEFAULT_DEBOUNCE_MS

    if (delay <= 0) {
      // Write immediately
      this.writeBack(newValue, oldValue)
      return
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      this.writeBack(newValue, oldValue)
    }, delay)
  }

  private writeBack(newValue: T, oldValue: T): void {
    if (this._disposed) return

    // Apply toModel transform before writing back
    const modelValue = this.config.transform?.toModel
      ? this.config.transform.toModel(newValue)
      : newValue

    this.manager.setValueInternal(this.path, modelValue, oldValue)
  }

  private clearDebounce(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
  }
}

// ============================================================
// CONSTANTS
// ============================================================

/** Default debounce delay in milliseconds */
const DEFAULT_DEBOUNCE_MS = 300

// ============================================================
// UTILITY
// ============================================================

/**
 * Shallow equality check suitable for primitive and simple object values.
 * Uses JSON serialization for object comparison (safe for plain data).
 */
function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}

// ============================================================
// TWO-WAY BINDING MANAGER
// ============================================================

/**
 * Manages two-way data bindings.
 *
 * Provides a central data store with path-based access, change listeners,
 * validation, transforms, and batch update support. Each call to `bind()`
 * creates a `TwoWayBinding` instance that can read/write a specific path
 * in the data model.
 */
export class TwoWayBindingManager {
  private readonly bindings = new Map<string, TwoWayBindingInstance>()
  private data: Record<string, unknown>
  private readonly listeners = new Map<string, Set<ChangeListener>>()
  private batchDepth = 0
  private readonly pendingNotifications: {
    path: string
    newValue: unknown
    oldValue: unknown
  }[] = []

  constructor(initialData?: Record<string, unknown>) {
    this.data = initialData ? deepClone(initialData) : {}
  }

  /**
   * Create a two-way binding for a specific data path.
   *
   * Returns a `TwoWayBinding` instance that tracks the value at the path,
   * supports validation and transforms, and writes changes back to the
   * data model with optional debouncing.
   */
  bind<T = unknown>(config: TwoWayBindingConfig): TwoWayBinding<T> {
    // Dispose any existing binding at this path
    const existing = this.bindings.get(config.path)
    if (existing) {
      existing.dispose()
    }

    const currentValue = resolvePath(this.data, config.path) as T
    const instance = new TwoWayBindingInstance<T>(config, currentValue, this)

    this.bindings.set(config.path, instance as TwoWayBindingInstance)

    return instance
  }

  /**
   * Get the current value at a data path
   */
  getValue(path: string): unknown {
    return resolvePath(this.data, path)
  }

  /**
   * Set a value at a data path, triggering change listeners
   */
  setValue(path: string, value: unknown): void {
    const oldValue = resolvePath(this.data, path)

    // Write to data store
    setAtPath(this.data, path, value)

    // Update any binding watching this path
    const binding = this.bindings.get(path)
    if (binding) {
      binding.updateFromModel(value)
    }

    // Notify listeners
    this.notifyChange(path, value, oldValue)
  }

  /**
   * Subscribe to changes at a data path.
   *
   * @returns Unsubscribe function
   */
  onChange<T = unknown>(path: string, listener: ChangeListener<T>): () => void {
    let pathListeners = this.listeners.get(path)
    if (!pathListeners) {
      pathListeners = new Set<ChangeListener>()
      this.listeners.set(path, pathListeners)
    }

    pathListeners.add(listener as ChangeListener)

    return () => {
      pathListeners.delete(listener as ChangeListener)
      if (pathListeners.size === 0) {
        this.listeners.delete(path)
      }
    }
  }

  /**
   * Batch multiple updates together.
   *
   * Listener notifications are deferred until the outermost batch
   * completes, then fired once per changed path.
   */
  batch(updates: () => void): void {
    this.batchDepth++

    try {
      updates()
    } finally {
      this.batchDepth--

      if (this.batchDepth === 0) {
        this.flushPendingNotifications()
      }
    }
  }

  /**
   * Get all bindings that have been modified from their initial values
   */
  getDirtyBindings(): readonly TwoWayBinding[] {
    const dirty: TwoWayBinding[] = []

    for (const binding of this.bindings.values()) {
      if (binding.isDirty) {
        dirty.push(binding)
      }
    }

    return dirty
  }

  /**
   * Reset all bindings to their initial values
   */
  resetAll(): void {
    for (const binding of this.bindings.values()) {
      binding.reset()
    }
  }

  /**
   * Dispose all bindings and clear all listeners
   */
  dispose(): void {
    for (const binding of this.bindings.values()) {
      binding.dispose()
    }
    this.bindings.clear()
    this.listeners.clear()
    this.pendingNotifications.length = 0
  }

  /**
   * Internal method called by binding instances to write back to the model.
   * Not part of the public API.
   */
  setValueInternal(path: string, modelValue: unknown, oldViewValue: unknown): void {
    const oldModelValue = resolvePath(this.data, path)

    // Write to data store
    setAtPath(this.data, path, modelValue)

    // Notify listeners with model values
    this.notifyChange(path, modelValue, oldModelValue ?? oldViewValue)
  }

  // ============================================================
  // PRIVATE
  // ============================================================

  private notifyChange(path: string, newValue: unknown, oldValue: unknown): void {
    if (this.batchDepth > 0) {
      // During batch, accumulate notifications (last write wins per path)
      const existingIdx = this.pendingNotifications.findIndex((n) => n.path === path)
      if (existingIdx >= 0) {
        const existing = this.pendingNotifications[existingIdx]
        if (existing) {
          // Keep the original oldValue, update newValue
          this.pendingNotifications[existingIdx] = {
            path,
            newValue,
            oldValue: existing.oldValue,
          }
        }
      } else {
        this.pendingNotifications.push({ path, newValue, oldValue })
      }
      return
    }

    this.fireListeners(path, newValue, oldValue)
  }

  private flushPendingNotifications(): void {
    // Copy and clear to handle re-entrant batch calls
    const pending = [...this.pendingNotifications]
    this.pendingNotifications.length = 0

    for (const { path, newValue, oldValue } of pending) {
      this.fireListeners(path, newValue, oldValue)
    }
  }

  private fireListeners(path: string, newValue: unknown, oldValue: unknown): void {
    const pathListeners = this.listeners.get(path)
    if (!pathListeners) return

    for (const listener of pathListeners) {
      try {
        listener(newValue, oldValue)
      } catch {
        // Swallow errors from listeners to prevent cascade failures
      }
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a two-way binding manager
 *
 * @param initialData - Optional initial data to populate the model
 * @returns A new TwoWayBindingManager instance
 *
 * @example
 * ```ts
 * const manager = createTwoWayBindingManager({
 *   user: { name: 'John', email: 'john@example.com' }
 * })
 *
 * const nameBinding = manager.bind<string>({
 *   path: 'user.name',
 *   debounceMs: 200,
 *   validate: (v) => ({
 *     valid: typeof v === 'string' && v.length > 0,
 *     error: 'Name is required',
 *   }),
 * })
 *
 * nameBinding.setValue('Jane')
 * // After debounce, manager.getValue('user.name') === 'Jane'
 * ```
 */
export function createTwoWayBindingManager(
  initialData?: Record<string, unknown>
): TwoWayBindingManager {
  return new TwoWayBindingManager(initialData)
}
