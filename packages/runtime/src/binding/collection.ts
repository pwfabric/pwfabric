/**
 * Collection Binding
 *
 * Reactive collection binding for arrays/lists in surfaces
 *
 * Provides:
 * - Reactive array subscriptions
 * - Filter, sort, map operations
 * - Item change tracking (add, remove, update)
 * - Derived/computed collections
 *
 * @module @pwfabric/runtime/binding/collection
 */

// ============================================================
// COLLECTION CHANGE EVENT
// ============================================================

/**
 * Types of changes that can occur to a collection
 */
export type CollectionChangeType = 'add' | 'remove' | 'update' | 'reset' | 'reorder'

/**
 * Event emitted when collection changes
 */
export interface CollectionChangeEvent<T> {
  /** Type of change */
  readonly type: CollectionChangeType
  /** Index where change occurred (-1 for reset/reorder) */
  readonly index: number
  /** Item that was affected (undefined for reset) */
  readonly item?: T | undefined
  /** Previous items (for reset) */
  readonly previousItems?: readonly T[] | undefined
  /** Timestamp of the change */
  readonly timestamp: number
}

/**
 * Listener for collection changes
 */
export type CollectionChangeListener<T> = (
  items: readonly T[],
  event: CollectionChangeEvent<T>
) => void

// ============================================================
// COLLECTION BINDING INTERFACE
// ============================================================

/**
 * Reactive collection binding interface
 */
export interface CollectionBinding<T> {
  /** Current items in the collection */
  readonly items: readonly T[]

  /** Field used as unique key for items */
  readonly keyField: string

  /** Number of items */
  readonly length: number

  /**
   * Subscribe to collection changes
   * @returns Unsubscribe function
   */
  subscribe(listener: CollectionChangeListener<T>): () => void

  /**
   * Create a filtered view of the collection
   */
  filter(predicate: (item: T, index: number) => boolean): CollectionBinding<T>

  /**
   * Create a sorted view of the collection
   */
  sort(comparator: (a: T, b: T) => number): CollectionBinding<T>

  /**
   * Create a mapped view of the collection
   */
  map<U>(mapper: (item: T, index: number) => U): CollectionBinding<U>

  /**
   * Create a sliced view of the collection
   */
  slice(start?: number, end?: number): CollectionBinding<T>

  /**
   * Get item by key value
   */
  getByKey(keyValue: unknown): T | undefined

  /**
   * Get item at index
   */
  at(index: number): T | undefined

  /**
   * Find first item matching predicate
   */
  find(predicate: (item: T, index: number) => boolean): T | undefined

  /**
   * Find index of first item matching predicate
   */
  findIndex(predicate: (item: T, index: number) => boolean): number

  /**
   * Check if any item matches predicate
   */
  some(predicate: (item: T, index: number) => boolean): boolean

  /**
   * Check if all items match predicate
   */
  every(predicate: (item: T, index: number) => boolean): boolean

  /**
   * Reduce collection to single value
   */
  reduce<U>(reducer: (acc: U, item: T, index: number) => U, initial: U): U

  /**
   * Dispose of the collection and all subscriptions
   */
  dispose(): void
}

/**
 * Mutable collection binding interface
 */
export interface MutableCollectionBinding<T> extends CollectionBinding<T> {
  /**
   * Add item to collection
   */
  add(item: T): void

  /**
   * Add multiple items to collection
   */
  addMany(items: readonly T[]): void

  /**
   * Remove item by key value
   */
  remove(keyValue: unknown): boolean

  /**
   * Remove item at index
   */
  removeAt(index: number): T | undefined

  /**
   * Update item by key value
   */
  update(keyValue: unknown, updates: Partial<T>): boolean

  /**
   * Replace item at index
   */
  replace(index: number, item: T): void

  /**
   * Replace all items
   */
  reset(items: readonly T[]): void

  /**
   * Clear all items
   */
  clear(): void

  /**
   * Move item from one index to another
   */
  move(fromIndex: number, toIndex: number): void
}

// ============================================================
// REACTIVE COLLECTION IMPLEMENTATION
// ============================================================

/**
 * Reactive collection implementation with change tracking
 */
export class ReactiveCollection<T> implements MutableCollectionBinding<T> {
  private _items: T[]
  private readonly _keyField: string
  private readonly listeners = new Set<CollectionChangeListener<T>>()
  private disposed = false

  constructor(initialItems: readonly T[] = [], keyField = 'id') {
    this._items = [...initialItems]
    this._keyField = keyField
  }

  get items(): readonly T[] {
    return this._items
  }

  get keyField(): string {
    return this._keyField
  }

  get length(): number {
    return this._items.length
  }

  subscribe(listener: CollectionChangeListener<T>): () => void {
    if (this.disposed) {
      throw new Error('Cannot subscribe to disposed collection')
    }

    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  filter(predicate: (item: T, index: number) => boolean): CollectionBinding<T> {
    return new DerivedCollection(this, (items) =>
      items.filter((item, index) => predicate(item, index))
    )
  }

  sort(comparator: (a: T, b: T) => number): CollectionBinding<T> {
    return new DerivedCollection(this, (items) => [...items].sort(comparator))
  }

  map<U>(mapper: (item: T, index: number) => U): CollectionBinding<U> {
    return new DerivedCollection(this, (items) => items.map((item, index) => mapper(item, index)))
  }

  slice(start?: number, end?: number): CollectionBinding<T> {
    return new DerivedCollection(this, (items) => items.slice(start, end))
  }

  getByKey(keyValue: unknown): T | undefined {
    return this._items.find((item) => this.getKeyValue(item) === keyValue)
  }

  at(index: number): T | undefined {
    if (index < 0) {
      return this._items[this._items.length + index]
    }
    return this._items[index]
  }

  find(predicate: (item: T, index: number) => boolean): T | undefined {
    return this._items.find((item, index) => predicate(item, index))
  }

  findIndex(predicate: (item: T, index: number) => boolean): number {
    return this._items.findIndex((item, index) => predicate(item, index))
  }

  some(predicate: (item: T, index: number) => boolean): boolean {
    return this._items.some((item, index) => predicate(item, index))
  }

  every(predicate: (item: T, index: number) => boolean): boolean {
    return this._items.every((item, index) => predicate(item, index))
  }

  reduce<U>(reducer: (acc: U, item: T, index: number) => U, initial: U): U {
    return this._items.reduce((acc, item, index) => reducer(acc, item, index), initial)
  }

  add(item: T): void {
    if (this.disposed) return

    const index = this._items.length
    this._items.push(item)
    this.notify({ type: 'add', index, item, timestamp: Date.now() })
  }

  addMany(items: readonly T[]): void {
    if (this.disposed || items.length === 0) return

    const startIndex = this._items.length
    this._items.push(...items)

    // Notify for each added item
    for (let i = 0; i < items.length; i++) {
      this.notify({
        type: 'add',
        index: startIndex + i,
        item: items[i],
        timestamp: Date.now(),
      })
    }
  }

  remove(keyValue: unknown): boolean {
    if (this.disposed) return false

    const index = this._items.findIndex((item) => this.getKeyValue(item) === keyValue)
    if (index === -1) return false

    const [item] = this._items.splice(index, 1)
    this.notify({ type: 'remove', index, item, timestamp: Date.now() })
    return true
  }

  removeAt(index: number): T | undefined {
    if (this.disposed) return undefined
    if (index < 0 || index >= this._items.length) return undefined

    const [item] = this._items.splice(index, 1)
    this.notify({ type: 'remove', index, item, timestamp: Date.now() })
    return item
  }

  update(keyValue: unknown, updates: Partial<T>): boolean {
    if (this.disposed) return false

    const index = this._items.findIndex((item) => this.getKeyValue(item) === keyValue)
    if (index === -1) return false

    const existing = this._items[index]
    if (existing === undefined) return false
    const updated = { ...existing, ...updates }
    this._items[index] = updated
    this.notify({ type: 'update', index, item: updated, timestamp: Date.now() })
    return true
  }

  replace(index: number, item: T): void {
    if (this.disposed) return
    if (index < 0 || index >= this._items.length) return

    this._items[index] = item
    this.notify({ type: 'update', index, item, timestamp: Date.now() })
  }

  reset(items: readonly T[]): void {
    if (this.disposed) return

    const previousItems = this._items
    this._items = [...items]
    this.notify({
      type: 'reset',
      index: -1,
      previousItems,
      timestamp: Date.now(),
    })
  }

  clear(): void {
    this.reset([])
  }

  move(fromIndex: number, toIndex: number): void {
    if (this.disposed) return
    if (fromIndex < 0 || fromIndex >= this._items.length) return
    if (toIndex < 0 || toIndex >= this._items.length) return
    if (fromIndex === toIndex) return

    const [item] = this._items.splice(fromIndex, 1)
    if (item === undefined) return
    this._items.splice(toIndex, 0, item)
    this.notify({ type: 'reorder', index: toIndex, item, timestamp: Date.now() })
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
  }

  private getKeyValue(item: T): unknown {
    if (typeof item === 'object' && item !== null) {
      return (item as Record<string, unknown>)[this._keyField]
    }
    return item
  }

  private notify(event: CollectionChangeEvent<T>): void {
    const items = this._items
    for (const listener of this.listeners) {
      try {
        listener(items, event)
      } catch {
        // Swallow errors from listeners
      }
    }
  }
}

// ============================================================
// DERIVED COLLECTION IMPLEMENTATION
// ============================================================

/**
 * Derived collection that transforms a source collection
 */
class DerivedCollection<TSource, TDerived = TSource> implements CollectionBinding<TDerived> {
  private readonly source: CollectionBinding<TSource>
  private readonly transform: (items: readonly TSource[]) => readonly TDerived[]
  private readonly listeners = new Set<CollectionChangeListener<TDerived>>()
  private _items: readonly TDerived[]
  private unsubscribe: (() => void) | null = null
  private disposed = false

  constructor(
    source: CollectionBinding<TSource>,
    transform: (items: readonly TSource[]) => readonly TDerived[]
  ) {
    this.source = source
    this.transform = transform
    this._items = transform(source.items)

    // Subscribe to source changes
    this.unsubscribe = source.subscribe(() => {
      this.update()
    })
  }

  get items(): readonly TDerived[] {
    return this._items
  }

  get keyField(): string {
    return this.source.keyField
  }

  get length(): number {
    return this._items.length
  }

  subscribe(listener: CollectionChangeListener<TDerived>): () => void {
    if (this.disposed) {
      throw new Error('Cannot subscribe to disposed collection')
    }

    this.listeners.add(listener)

    return () => {
      this.listeners.delete(listener)
    }
  }

  filter(predicate: (item: TDerived, index: number) => boolean): CollectionBinding<TDerived> {
    return new DerivedCollection(this, (items) =>
      items.filter((item, index) => predicate(item, index))
    )
  }

  sort(comparator: (a: TDerived, b: TDerived) => number): CollectionBinding<TDerived> {
    return new DerivedCollection(this, (items) => [...items].sort(comparator))
  }

  map<U>(mapper: (item: TDerived, index: number) => U): CollectionBinding<U> {
    return new DerivedCollection(this, (items) => items.map((item, index) => mapper(item, index)))
  }

  slice(start?: number, end?: number): CollectionBinding<TDerived> {
    return new DerivedCollection(this, (items) => items.slice(start, end))
  }

  getByKey(keyValue: unknown): TDerived | undefined {
    // Note: For derived collections with map transforms, key lookup may not work as expected
    return this._items.find((item) => {
      if (typeof item === 'object' && item !== null) {
        return (item as Record<string, unknown>)[this.keyField] === keyValue
      }
      return item === keyValue
    })
  }

  at(index: number): TDerived | undefined {
    if (index < 0) {
      return this._items[this._items.length + index]
    }
    return this._items[index]
  }

  find(predicate: (item: TDerived, index: number) => boolean): TDerived | undefined {
    return this._items.find((item, index) => predicate(item, index))
  }

  findIndex(predicate: (item: TDerived, index: number) => boolean): number {
    return this._items.findIndex((item, index) => predicate(item, index))
  }

  some(predicate: (item: TDerived, index: number) => boolean): boolean {
    return this._items.some((item, index) => predicate(item, index))
  }

  every(predicate: (item: TDerived, index: number) => boolean): boolean {
    return this._items.every((item, index) => predicate(item, index))
  }

  reduce<U>(reducer: (acc: U, item: TDerived, index: number) => U, initial: U): U {
    return this._items.reduce((acc, item, index) => reducer(acc, item, index), initial)
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = null
    }
  }

  private update(): void {
    const previousItems = this._items
    this._items = this.transform(this.source.items)

    // Notify listeners
    const event: CollectionChangeEvent<TDerived> = {
      type: 'reset',
      index: -1,
      previousItems,
      timestamp: Date.now(),
    }

    for (const listener of this.listeners) {
      try {
        listener(this._items, event)
      } catch {
        // Swallow errors from listeners
      }
    }
  }
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a reactive collection
 */
export function createCollection<T>(
  initialItems?: readonly T[],
  keyField?: string
): MutableCollectionBinding<T> {
  return new ReactiveCollection<T>(initialItems, keyField)
}

/**
 * Create a read-only collection from existing data
 */
export function createReadOnlyCollection<T>(
  items: readonly T[],
  keyField = 'id'
): CollectionBinding<T> {
  const collection = new ReactiveCollection<T>(items, keyField)
  // Return interface without mutation methods
  return {
    get items() {
      return collection.items
    },
    get keyField() {
      return collection.keyField
    },
    get length() {
      return collection.length
    },
    subscribe: (listener) => collection.subscribe(listener),
    filter: (predicate) => collection.filter(predicate),
    sort: (comparator) => collection.sort(comparator),
    map: (mapper) => collection.map(mapper),
    slice: (start, end) => collection.slice(start, end),
    getByKey: (keyValue) => collection.getByKey(keyValue),
    at: (index) => collection.at(index),
    find: (predicate) => collection.find(predicate),
    findIndex: (predicate) => collection.findIndex(predicate),
    some: (predicate) => collection.some(predicate),
    every: (predicate) => collection.every(predicate),
    reduce: (reducer, initial) => collection.reduce(reducer, initial),
    dispose: () => collection.dispose(),
  }
}

/**
 * Create a collection from an async iterable
 */
export async function createCollectionFromAsync<T>(
  asyncIterable: AsyncIterable<T>,
  keyField = 'id'
): Promise<MutableCollectionBinding<T>> {
  const items: T[] = []
  for await (const item of asyncIterable) {
    items.push(item)
  }
  return new ReactiveCollection<T>(items, keyField)
}
