/**
 * Collection Binding Tests
 *
 * Tests for reactive collection binding
 *
 * @module @pwfabric/runtime/binding/__tests__/collection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReactiveCollection, createCollection, createReadOnlyCollection } from '../collection.js'

// ============================================================
// TEST DATA
// ============================================================

interface TestItem {
  id: number
  name: string
  price: number
}

function createTestItems(): TestItem[] {
  return [
    { id: 1, name: 'Apple', price: 1.5 },
    { id: 2, name: 'Banana', price: 0.75 },
    { id: 3, name: 'Orange', price: 2.0 },
  ]
}

// ============================================================
// REACTIVE COLLECTION TESTS
// ============================================================

describe('ReactiveCollection', () => {
  let collection: ReactiveCollection<TestItem>

  beforeEach(() => {
    collection = new ReactiveCollection(createTestItems())
  })

  describe('initialization', () => {
    it('should initialize with items', () => {
      expect(collection.items).toHaveLength(3)
      expect(collection.items[0]?.name).toBe('Apple')
    })

    it('should initialize with empty array', () => {
      const empty = new ReactiveCollection<TestItem>()
      expect(empty.items).toHaveLength(0)
    })

    it('should have default keyField of "id"', () => {
      expect(collection.keyField).toBe('id')
    })

    it('should accept custom keyField', () => {
      const custom = new ReactiveCollection(createTestItems(), 'name')
      expect(custom.keyField).toBe('name')
    })
  })

  describe('items property', () => {
    it('should return readonly items', () => {
      expect(collection.items).toHaveLength(3)
    })

    it('should report correct length', () => {
      expect(collection.length).toBe(3)
    })
  })

  describe('add', () => {
    it('should add item to collection', () => {
      collection.add({ id: 4, name: 'Grape', price: 3.0 })
      expect(collection.items).toHaveLength(4)
      expect(collection.items[3]?.name).toBe('Grape')
    })

    it('should notify listeners on add', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.add({ id: 4, name: 'Grape', price: 3.0 })

      expect(listener).toHaveBeenCalledOnce()
      expect(listener).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'add',
          index: 3,
          item: { id: 4, name: 'Grape', price: 3.0 },
        })
      )
    })
  })

  describe('addMany', () => {
    it('should add multiple items', () => {
      collection.addMany([
        { id: 4, name: 'Grape', price: 3.0 },
        { id: 5, name: 'Mango', price: 2.5 },
      ])
      expect(collection.items).toHaveLength(5)
    })

    it('should notify for each added item', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.addMany([
        { id: 4, name: 'Grape', price: 3.0 },
        { id: 5, name: 'Mango', price: 2.5 },
      ])

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('should not notify for empty array', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.addMany([])

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('remove', () => {
    it('should remove item by key', () => {
      const removed = collection.remove(2)
      expect(removed).toBe(true)
      expect(collection.items).toHaveLength(2)
      expect(collection.getByKey(2)).toBeUndefined()
    })

    it('should return false for non-existent key', () => {
      const removed = collection.remove(999)
      expect(removed).toBe(false)
    })

    it('should notify listeners on remove', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.remove(2)

      expect(listener).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'remove',
          index: 1,
        })
      )
    })
  })

  describe('removeAt', () => {
    it('should remove item at index', () => {
      const item = collection.removeAt(1)
      expect(item?.name).toBe('Banana')
      expect(collection.items).toHaveLength(2)
    })

    it('should return undefined for out of range index', () => {
      expect(collection.removeAt(-1)).toBeUndefined()
      expect(collection.removeAt(100)).toBeUndefined()
    })
  })

  describe('update', () => {
    it('should update item by key', () => {
      const updated = collection.update(2, { price: 1.0 })
      expect(updated).toBe(true)
      expect(collection.getByKey(2)?.price).toBe(1.0)
    })

    it('should preserve other fields on update', () => {
      collection.update(2, { price: 1.0 })
      expect(collection.getByKey(2)?.name).toBe('Banana')
    })

    it('should return false for non-existent key', () => {
      const updated = collection.update(999, { price: 1.0 })
      expect(updated).toBe(false)
    })

    it('should notify listeners on update', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.update(2, { price: 1.0 })

      expect(listener).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'update',
          index: 1,
        })
      )
    })
  })

  describe('replace', () => {
    it('should replace item at index', () => {
      collection.replace(1, { id: 2, name: 'Blueberry', price: 4.0 })
      expect(collection.at(1)?.name).toBe('Blueberry')
    })

    it('should not throw for out of range index', () => {
      const testItem = createTestItems()[0]
      expect(testItem).toBeDefined()
      if (testItem) {
        expect(() => collection.replace(100, testItem)).not.toThrow()
      }
    })
  })

  describe('reset', () => {
    it('should replace all items', () => {
      const newItems = [{ id: 10, name: 'Peach', price: 2.0 }]
      collection.reset(newItems)
      expect(collection.items).toHaveLength(1)
      expect(collection.items[0]?.name).toBe('Peach')
    })

    it('should notify with reset event', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.reset([])

      expect(listener).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          type: 'reset',
          index: -1,
        })
      )
    })
  })

  describe('clear', () => {
    it('should remove all items', () => {
      collection.clear()
      expect(collection.items).toHaveLength(0)
    })
  })

  describe('move', () => {
    it('should move item from one index to another', () => {
      collection.move(0, 2)
      expect(collection.items[0]?.name).toBe('Banana')
      expect(collection.items[2]?.name).toBe('Apple')
    })

    it('should not move for same index', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.move(1, 1)

      expect(listener).not.toHaveBeenCalled()
    })

    it('should not move for out of range indices', () => {
      const listener = vi.fn()
      collection.subscribe(listener)

      collection.move(-1, 2)
      collection.move(0, 100)

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('getByKey', () => {
    it('should find item by key', () => {
      const item = collection.getByKey(2)
      expect(item?.name).toBe('Banana')
    })

    it('should return undefined for non-existent key', () => {
      expect(collection.getByKey(999)).toBeUndefined()
    })
  })

  describe('at', () => {
    it('should return item at positive index', () => {
      expect(collection.at(0)?.name).toBe('Apple')
      expect(collection.at(1)?.name).toBe('Banana')
    })

    it('should return item at negative index', () => {
      expect(collection.at(-1)?.name).toBe('Orange')
      expect(collection.at(-2)?.name).toBe('Banana')
    })
  })

  describe('find/findIndex', () => {
    it('should find item by predicate', () => {
      const item = collection.find((i) => i.price > 1.0)
      expect(item?.name).toBe('Apple')
    })

    it('should return undefined when not found', () => {
      expect(collection.find((i) => i.price > 100)).toBeUndefined()
    })

    it('should find index by predicate', () => {
      const index = collection.findIndex((i) => i.name === 'Banana')
      expect(index).toBe(1)
    })

    it('should return -1 when index not found', () => {
      expect(collection.findIndex((i) => i.name === 'Missing')).toBe(-1)
    })
  })

  describe('some/every', () => {
    it('should return true if some items match', () => {
      expect(collection.some((i) => i.price > 1.0)).toBe(true)
    })

    it('should return false if no items match', () => {
      expect(collection.some((i) => i.price > 100)).toBe(false)
    })

    it('should return true if all items match', () => {
      expect(collection.every((i) => i.price > 0)).toBe(true)
    })

    it('should return false if not all items match', () => {
      expect(collection.every((i) => i.price > 1.0)).toBe(false)
    })
  })

  describe('reduce', () => {
    it('should reduce collection to single value', () => {
      const total = collection.reduce((acc, item) => acc + item.price, 0)
      expect(total).toBe(4.25) // 1.5 + 0.75 + 2.0
    })
  })

  describe('subscribe', () => {
    it('should subscribe to changes', () => {
      const listener = vi.fn()
      const unsubscribe = collection.subscribe(listener)

      collection.add({ id: 4, name: 'Grape', price: 3.0 })
      expect(listener).toHaveBeenCalledOnce()

      unsubscribe()
      collection.add({ id: 5, name: 'Mango', price: 2.5 })
      expect(listener).toHaveBeenCalledOnce() // Still 1
    })

    it('should throw when subscribing to disposed collection', () => {
      collection.dispose()
      // Empty listener intentionally - testing that subscribe throws on disposed
      const noopListener = (): void => {
        /* intentionally empty */
      }
      expect(() => collection.subscribe(noopListener)).toThrow()
    })
  })

  describe('dispose', () => {
    it('should prevent further modifications', () => {
      const listener = vi.fn()
      collection.subscribe(listener)
      collection.dispose()

      collection.add({ id: 4, name: 'Grape', price: 3.0 })
      expect(listener).not.toHaveBeenCalled()
    })
  })
})

// ============================================================
// FILTER/SORT/MAP TESTS
// ============================================================

describe('ReactiveCollection - derived collections', () => {
  let collection: ReactiveCollection<TestItem>

  beforeEach(() => {
    collection = new ReactiveCollection(createTestItems())
  })

  describe('filter', () => {
    it('should create filtered view', () => {
      const expensive = collection.filter((i) => i.price > 1.0)
      expect(expensive.items).toHaveLength(2)
      expect(expensive.items[0]?.name).toBe('Apple')
      expect(expensive.items[1]?.name).toBe('Orange')
    })

    it('should update when source changes', () => {
      const expensive = collection.filter((i) => i.price > 1.0)
      const listener = vi.fn()
      expensive.subscribe(listener)

      collection.add({ id: 4, name: 'Grape', price: 3.0 })

      expect(expensive.items).toHaveLength(3)
      expect(listener).toHaveBeenCalled()
    })

    it('should chain filters', () => {
      const filtered = collection.filter((i) => i.price > 0.5).filter((i) => i.price < 2.0)
      expect(filtered.items).toHaveLength(2)
      expect(filtered.items[0]?.name).toBe('Apple')
      expect(filtered.items[1]?.name).toBe('Banana')
    })
  })

  describe('sort', () => {
    it('should create sorted view', () => {
      const sorted = collection.sort((a, b) => a.price - b.price)
      expect(sorted.items[0]?.name).toBe('Banana')
      expect(sorted.items[1]?.name).toBe('Apple')
      expect(sorted.items[2]?.name).toBe('Orange')
    })

    it('should update when source changes', () => {
      const sorted = collection.sort((a, b) => a.price - b.price)

      collection.add({ id: 4, name: 'Cherry', price: 0.5 })

      expect(sorted.items[0]?.name).toBe('Cherry')
    })
  })

  describe('map', () => {
    it('should create mapped view', () => {
      const names = collection.map((i) => i.name)
      expect(names.items).toEqual(['Apple', 'Banana', 'Orange'])
    })

    it('should update when source changes', () => {
      const names = collection.map((i) => i.name)

      collection.add({ id: 4, name: 'Grape', price: 3.0 })

      expect(names.items).toContain('Grape')
    })
  })

  describe('slice', () => {
    it('should create sliced view', () => {
      const sliced = collection.slice(0, 2)
      expect(sliced.items).toHaveLength(2)
      expect(sliced.items[0]?.name).toBe('Apple')
      expect(sliced.items[1]?.name).toBe('Banana')
    })

    it('should update when source changes', () => {
      const first = collection.slice(0, 1)

      // Remove first item
      collection.removeAt(0)

      expect(first.items[0]?.name).toBe('Banana')
    })
  })

  describe('chained operations', () => {
    it('should support complex chains', () => {
      const result = collection
        .filter((i) => i.price >= 1.0)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => `${i.name}: $${i.price}`)

      expect(result.items).toEqual(['Apple: $1.5', 'Orange: $2'])
    })

    it('should update through the chain', () => {
      const result = collection.filter((i) => i.price >= 1.0).map((i) => i.name)

      collection.add({ id: 4, name: 'Grape', price: 3.0 })

      expect(result.items).toContain('Grape')
    })
  })

  describe('dispose', () => {
    it('should unsubscribe from source when disposed', () => {
      const filtered = collection.filter((i) => i.price > 1.0)
      const listener = vi.fn()
      filtered.subscribe(listener)

      filtered.dispose()
      collection.add({ id: 4, name: 'Grape', price: 3.0 })

      // Listener should not be called after dispose
      expect(listener).not.toHaveBeenCalled()
    })
  })
})

// ============================================================
// FACTORY FUNCTION TESTS
// ============================================================

describe('createCollection', () => {
  it('should create mutable collection', () => {
    const collection = createCollection(createTestItems())
    expect(collection.items).toHaveLength(3)

    collection.add({ id: 4, name: 'Grape', price: 3.0 })
    expect(collection.items).toHaveLength(4)
  })

  it('should create empty collection', () => {
    const collection = createCollection<TestItem>()
    expect(collection.items).toHaveLength(0)
  })

  it('should accept custom keyField', () => {
    const collection = createCollection(createTestItems(), 'name')
    expect(collection.keyField).toBe('name')
    expect(collection.getByKey('Apple')?.id).toBe(1)
  })
})

describe('createReadOnlyCollection', () => {
  it('should create read-only collection', () => {
    const collection = createReadOnlyCollection(createTestItems())
    expect(collection.items).toHaveLength(3)

    // TypeScript should prevent calling add, remove, etc.
    // but we can verify the interface doesn't expose them
    expect('add' in collection).toBe(false)
    expect('remove' in collection).toBe(false)
    expect('update' in collection).toBe(false)
  })

  it('should support derived operations', () => {
    const collection = createReadOnlyCollection(createTestItems())
    const filtered = collection.filter((i) => i.price > 1.0)
    expect(filtered.items).toHaveLength(2)
  })
})

// ============================================================
// EDGE CASE TESTS
// ============================================================

describe('ReactiveCollection - edge cases', () => {
  it('should handle listener errors gracefully', () => {
    const collection = createCollection(createTestItems())

    const errorListener = vi.fn(() => {
      throw new Error('Listener error')
    })
    const normalListener = vi.fn()

    collection.subscribe(errorListener)
    collection.subscribe(normalListener)

    // Should not throw and should call second listener
    collection.add({ id: 4, name: 'Grape', price: 3.0 })

    expect(errorListener).toHaveBeenCalled()
    expect(normalListener).toHaveBeenCalled()
  })

  it('should handle items without id field', () => {
    const collection = new ReactiveCollection<{ value: number }>(
      [{ value: 1 }, { value: 2 }],
      'value'
    )

    expect(collection.getByKey(1)?.value).toBe(1)
    expect(collection.remove(2)).toBe(true)
    expect(collection.items).toHaveLength(1)
  })

  it('should handle primitive items', () => {
    const collection = new ReactiveCollection<number>([1, 2, 3])

    expect(collection.getByKey(2)).toBe(2)
    expect(collection.filter((n) => n > 1).items).toEqual([2, 3])
    expect(collection.map((n) => n * 2).items).toEqual([2, 4, 6])
  })
})
