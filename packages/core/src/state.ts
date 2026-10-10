/**
 * State Management
 *
 * PHASE0-WS3: Simple state management utilities
 *
 * @module @pwfabric/core/state
 */

// ============================================================
// STATE STORE INTERFACE
// ============================================================

/**
 * State change listener
 */
export type StateListener<T> = (newState: T, oldState: T) => void

/**
 * State store interface
 */
export interface StateStore<T> {
  /**
   * Get the current state
   */
  getState(): T

  /**
   * Set the state
   */
  setState(newState: T): void

  /**
   * Update the state with a partial update
   */
  updateState(partial: Partial<T>): void

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener<T>): () => void

  /**
   * Get a snapshot of the state
   */
  snapshot(): StateSnapshot<T>
}

/**
 * State snapshot
 */
export interface StateSnapshot<T> {
  readonly state: T
  readonly timestamp: number
  readonly version: number
}

// ============================================================
// SIMPLE STATE STORE IMPLEMENTATION
// ============================================================

/**
 * Simple in-memory state store
 */
export class SimpleStateStore<T extends object> implements StateStore<T> {
  private state: T
  private version = 0
  private listeners = new Set<StateListener<T>>()

  constructor(initialState: T) {
    this.state = { ...initialState }
  }

  getState(): T {
    return { ...this.state }
  }

  setState(newState: T): void {
    const oldState = this.state
    this.state = { ...newState }
    this.version++
    this.notifyListeners(this.state, oldState)
  }

  updateState(partial: Partial<T>): void {
    const oldState = this.state
    this.state = { ...this.state, ...partial }
    this.version++
    this.notifyListeners(this.state, oldState)
  }

  subscribe(listener: StateListener<T>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot(): StateSnapshot<T> {
    return {
      state: this.getState(),
      timestamp: Date.now(),
      version: this.version,
    }
  }

  private notifyListeners(newState: T, oldState: T): void {
    for (const listener of this.listeners) {
      try {
        listener(newState, oldState)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a new state store
 */
export function createStateStore<T extends object>(initialState: T): StateStore<T> {
  return new SimpleStateStore<T>(initialState)
}

// ============================================================
// COMPUTED STATE
// ============================================================

/**
 * Selector function type
 */
export type Selector<T, R> = (state: T) => R

/**
 * Create a computed value from a store
 */
export function computed<T extends object, R>(
  store: StateStore<T>,
  selector: Selector<T, R>
): () => R {
  return () => selector(store.getState())
}

/**
 * Subscribe to a specific slice of state
 */
export function subscribeToSlice<T extends object, R>(
  store: StateStore<T>,
  selector: Selector<T, R>,
  listener: StateListener<R>
): () => void {
  let previousValue = selector(store.getState())

  return store.subscribe((newState, oldState) => {
    const newValue = selector(newState)
    const oldValue = selector(oldState)

    // Only notify if the selected value changed
    if (newValue !== oldValue) {
      listener(newValue, previousValue)
      previousValue = newValue
    }
  })
}

// ============================================================
// STATE MACHINE
// ============================================================

/**
 * State machine transition
 */
export interface Transition<S, E> {
  from: S
  to: S
  event: E
  guard?: () => boolean
  action?: () => void
}

/**
 * State machine configuration
 */
export interface StateMachineConfig<S, E> {
  initial: S
  transitions: Transition<S, E>[]
}

/**
 * State machine interface
 */
export interface StateMachine<S, E> {
  /**
   * Get the current state
   */
  getState(): S

  /**
   * Check if an event can be processed
   */
  can(event: E): boolean

  /**
   * Process an event
   */
  dispatch(event: E): boolean

  /**
   * Subscribe to state changes
   */
  subscribe(listener: StateListener<S>): () => void
}

/**
 * Simple state machine implementation
 */
export class SimpleStateMachine<S, E> implements StateMachine<S, E> {
  private state: S
  private readonly transitions: Transition<S, E>[]
  private listeners = new Set<StateListener<S>>()

  constructor(config: StateMachineConfig<S, E>) {
    this.state = config.initial
    this.transitions = config.transitions
  }

  getState(): S {
    return this.state
  }

  can(event: E): boolean {
    const transition = this.findTransition(event)
    if (!transition) return false
    if (transition.guard && !transition.guard()) return false
    return true
  }

  dispatch(event: E): boolean {
    const transition = this.findTransition(event)
    if (!transition) return false
    if (transition.guard && !transition.guard()) return false

    const oldState = this.state
    this.state = transition.to

    if (transition.action) {
      transition.action()
    }

    this.notifyListeners(this.state, oldState)
    return true
  }

  subscribe(listener: StateListener<S>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private findTransition(event: E): Transition<S, E> | undefined {
    return this.transitions.find((t) => t.from === this.state && t.event === event)
  }

  private notifyListeners(newState: S, oldState: S): void {
    for (const listener of this.listeners) {
      try {
        listener(newState, oldState)
      } catch {
        // Ignore listener errors
      }
    }
  }
}

/**
 * Create a state machine
 */
export function createStateMachine<S, E>(config: StateMachineConfig<S, E>): StateMachine<S, E> {
  return new SimpleStateMachine<S, E>(config)
}
