/**
 * Static Connector Tests
 *
 * Tests for in-memory static connector including filter, sort, and pagination.
 *
 * @module @pwfabric/runtime/entity/__tests__/connectors/static
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { StaticConnector, createStaticConnector } from '../../connectors/static.js'
import type { EntityTypeId, EntityInstanceId } from '../../types.js'

// ============================================================
// TEST HELPERS
// ============================================================

const PRODUCT_TYPE = 'product' as EntityTypeId

function seedProducts(connector: StaticConnector): void {
  connector.seed(PRODUCT_TYPE, [
    { id: 'p1' as EntityInstanceId, name: 'Widget A', price: 10, category: 'gadgets' },
    { id: 'p2' as EntityInstanceId, name: 'Widget B', price: 25, category: 'gadgets' },
    { id: 'p3' as EntityInstanceId, name: 'Gizmo C', price: 50, category: 'tools' },
    { id: 'p4' as EntityInstanceId, name: 'Doohickey D', price: 15, category: 'tools' },
    { id: 'p5' as EntityInstanceId, name: 'Thingamajig E', price: 100, category: 'gadgets' },
  ])
}

// ============================================================
// TESTS
// ============================================================

describe('StaticConnector', () => {
  let connector: StaticConnector

  beforeEach(() => {
    connector = new StaticConnector('test-static')
  })

  describe('constructor', () => {
    it('should set name and type', () => {
      expect(connector.name).toBe('test-static')
      expect(connector.type).toBe('static')
    })

    it('should use default name when not provided', () => {
      const defaultConnector = new StaticConnector()
      expect(defaultConnector.name).toBe('static')
    })
  })

  describe('create', () => {
    it('should create a new record with generated id', async () => {
      const result = await connector.create(PRODUCT_TYPE, {
        name: 'New Widget',
        price: 29.99,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('New Widget')
        expect(result.data.price).toBe(29.99)
        expect(result.data.id).toBeTruthy()
      }
    })

    it('should generate unique ids for each record', async () => {
      const r1 = await connector.create(PRODUCT_TYPE, { name: 'A' })
      const r2 = await connector.create(PRODUCT_TYPE, { name: 'B' })

      expect(r1.success && r2.success).toBe(true)
      if (r1.success && r2.success) {
        expect(r1.data.id).not.toBe(r2.data.id)
      }
    })
  })

  describe('read', () => {
    it('should read an existing record', async () => {
      seedProducts(connector)

      const result = await connector.read(PRODUCT_TYPE, 'p1' as EntityInstanceId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Widget A')
        expect(result.data.price).toBe(10)
      }
    })

    it('should return error for missing record', async () => {
      const result = await connector.read(PRODUCT_TYPE, 'nonexistent' as EntityInstanceId)

      expect(result.success).toBe(false)
    })

    it('should return error for missing entity type', async () => {
      const result = await connector.read('unknown' as EntityTypeId, 'any' as EntityInstanceId)

      expect(result.success).toBe(false)
    })
  })

  describe('update', () => {
    it('should update an existing record', async () => {
      seedProducts(connector)

      const result = await connector.update(PRODUCT_TYPE, 'p1' as EntityInstanceId, {
        price: 15,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.price).toBe(15)
        expect(result.data.name).toBe('Widget A')
      }
    })

    it('should preserve id on update', async () => {
      seedProducts(connector)

      const result = await connector.update(PRODUCT_TYPE, 'p1' as EntityInstanceId, {
        id: 'should-not-change',
        price: 15,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.id).toBe('p1')
      }
    })

    it('should return error for missing record', async () => {
      const result = await connector.update(PRODUCT_TYPE, 'nonexistent' as EntityInstanceId, {
        price: 15,
      })

      expect(result.success).toBe(false)
    })
  })

  describe('delete', () => {
    it('should delete an existing record', async () => {
      seedProducts(connector)

      const result = await connector.delete(PRODUCT_TYPE, 'p1' as EntityInstanceId)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Widget A')
      }

      const readResult = await connector.read(PRODUCT_TYPE, 'p1' as EntityInstanceId)
      expect(readResult.success).toBe(false)
    })

    it('should return error for missing record', async () => {
      const result = await connector.delete(PRODUCT_TYPE, 'nonexistent' as EntityInstanceId)

      expect(result.success).toBe(false)
    })
  })

  describe('query - filter', () => {
    beforeEach(() => {
      seedProducts(connector)
    })

    it('should return all items with no filter', async () => {
      const result = await connector.query(PRODUCT_TYPE, {})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.items).toHaveLength(5)
        expect(result.result.total).toBe(5)
      }
    })

    it('should filter with eq operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'category', operator: 'eq', value: 'tools' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(2)
        expect(
          result.result.items.every(
            (item) => (item as Record<string, unknown>).category === 'tools'
          )
        ).toBe(true)
      }
    })

    it('should filter with neq operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'category', operator: 'neq', value: 'tools' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(3)
      }
    })

    it('should filter with gt operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'price', operator: 'gt', value: 20 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(3)
      }
    })

    it('should filter with gte operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'price', operator: 'gte', value: 25 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(3)
      }
    })

    it('should filter with lt operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'price', operator: 'lt', value: 20 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(2)
      }
    })

    it('should filter with lte operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'price', operator: 'lte', value: 15 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(2)
      }
    })

    it('should filter with in operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'price', operator: 'in', value: [10, 50, 100] },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(3)
      }
    })

    it('should filter with contains operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'name', operator: 'contains', value: 'Widget' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(2)
      }
    })

    it('should filter with startsWith operator', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'name', operator: 'startsWith', value: 'Gizmo' },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(1)
      }
    })

    it('should return empty result for unknown entity type', async () => {
      const result = await connector.query('unknown' as EntityTypeId, {})

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.items).toEqual([])
        expect(result.result.total).toBe(0)
      }
    })
  })

  describe('query - sort', () => {
    beforeEach(() => {
      seedProducts(connector)
    })

    it('should sort by field ascending', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        sort: [{ field: 'price', direction: 'asc' }],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const prices = result.result.items.map(
          (item) => (item as Record<string, unknown>).price as number
        )
        expect(prices).toEqual([10, 15, 25, 50, 100])
      }
    })

    it('should sort by field descending', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        sort: [{ field: 'price', direction: 'desc' }],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const prices = result.result.items.map(
          (item) => (item as Record<string, unknown>).price as number
        )
        expect(prices).toEqual([100, 50, 25, 15, 10])
      }
    })

    it('should sort by string field', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        sort: [{ field: 'name', direction: 'asc' }],
      })

      expect(result.success).toBe(true)
      if (result.success) {
        const names = result.result.items.map(
          (item) => (item as Record<string, unknown>).name as string
        )
        expect(names).toEqual(['Doohickey D', 'Gizmo C', 'Thingamajig E', 'Widget A', 'Widget B'])
      }
    })
  })

  describe('query - pagination', () => {
    beforeEach(() => {
      seedProducts(connector)
    })

    it('should paginate results', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        pagination: { offset: 0, limit: 2 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.items).toHaveLength(2)
        expect(result.result.total).toBe(5)
        expect(result.result.offset).toBe(0)
        expect(result.result.limit).toBe(2)
        expect(result.result.hasMore).toBe(true)
      }
    })

    it('should handle second page', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        pagination: { offset: 2, limit: 2 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.items).toHaveLength(2)
        expect(result.result.offset).toBe(2)
        expect(result.result.hasMore).toBe(true)
      }
    })

    it('should handle last page', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        pagination: { offset: 4, limit: 2 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.items).toHaveLength(1)
        expect(result.result.hasMore).toBe(false)
      }
    })

    it('should handle offset beyond total', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        pagination: { offset: 10, limit: 2 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.items).toHaveLength(0)
        expect(result.result.hasMore).toBe(false)
      }
    })
  })

  describe('query - combined filter, sort, pagination', () => {
    beforeEach(() => {
      seedProducts(connector)
    })

    it('should filter, sort, then paginate', async () => {
      const result = await connector.query(PRODUCT_TYPE, {
        filter: { field: 'category', operator: 'eq', value: 'gadgets' },
        sort: [{ field: 'price', direction: 'asc' }],
        pagination: { offset: 0, limit: 2 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.result.total).toBe(3)
        expect(result.result.items).toHaveLength(2)
        expect(result.result.hasMore).toBe(true)

        const prices = result.result.items.map(
          (item) => (item as Record<string, unknown>).price as number
        )
        expect(prices).toEqual([10, 25])
      }
    })
  })

  describe('seed', () => {
    it('should seed data into the connector', () => {
      seedProducts(connector)

      expect(connector.count(PRODUCT_TYPE)).toBe(5)
    })

    it('should generate ids for records without id', () => {
      connector.seed(PRODUCT_TYPE, [{ name: 'No ID' }])

      expect(connector.count(PRODUCT_TYPE)).toBe(1)
    })
  })

  describe('clear', () => {
    it('should clear all data', () => {
      seedProducts(connector)

      connector.clear()

      expect(connector.count(PRODUCT_TYPE)).toBe(0)
    })
  })

  describe('clearType', () => {
    it('should clear data for a specific entity type', () => {
      seedProducts(connector)
      connector.seed('order' as EntityTypeId, [{ total: 100 }])

      connector.clearType(PRODUCT_TYPE)

      expect(connector.count(PRODUCT_TYPE)).toBe(0)
      expect(connector.count('order' as EntityTypeId)).toBe(1)
    })
  })
})

describe('createStaticConnector', () => {
  it('should create a StaticConnector instance', () => {
    const connector = createStaticConnector()

    expect(connector).toBeInstanceOf(StaticConnector)
    expect(connector.name).toBe('static')
  })

  it('should create a StaticConnector with custom name', () => {
    const connector = createStaticConnector('my-static')

    expect(connector.name).toBe('my-static')
  })
})
