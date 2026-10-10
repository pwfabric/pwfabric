/**
 * Entity Store Tests
 *
 * Tests for CRUD operations with StaticConnector.
 *
 * @module @pwfabric/runtime/entity/__tests__/store
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { DefaultEntityStore, createEntityStore } from '../store.js'
import { InMemoryEntityRegistry } from '../registry.js'
import { InMemoryConnectorRegistry } from '../connector.js'
import { StaticConnector } from '../connectors/static.js'
import type { EntityDefinition, EntityTypeId, EntityInstanceId } from '../types.js'

// ============================================================
// TEST HELPERS
// ============================================================

const PRODUCT_TYPE = 'product' as EntityTypeId

const productSchema = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  category: z.string().optional(),
})

const productDefinition: EntityDefinition = {
  id: PRODUCT_TYPE,
  name: 'Product',
  description: 'A product entity',
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'price', type: 'number', required: true },
    { name: 'category', type: 'string', required: false },
  ],
  relations: [],
  primaryKey: 'id',
  timestamps: false,
  softDelete: false,
  schema: productSchema,
}

function createTestSetup(): {
  registry: InMemoryEntityRegistry
  connectorRegistry: InMemoryConnectorRegistry
  connector: StaticConnector
  store: DefaultEntityStore
} {
  const registry = new InMemoryEntityRegistry()
  const connectorRegistry = new InMemoryConnectorRegistry()
  const connector = new StaticConnector('test-static')
  const store = new DefaultEntityStore(registry, connectorRegistry)

  registry.register(productDefinition)
  connectorRegistry.register(connector)
  connectorRegistry.setDefault('test-static')

  return { registry, connectorRegistry, connector, store }
}

// ============================================================
// TESTS
// ============================================================

describe('DefaultEntityStore', () => {
  let store: DefaultEntityStore

  beforeEach(() => {
    const setup = createTestSetup()
    store = setup.store as DefaultEntityStore
  })

  describe('create', () => {
    it('should create a valid entity', async () => {
      const result = await store.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
        category: 'gadgets',
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Widget')
        expect(result.data.price).toBe(29.99)
        expect(result.id).toBeTruthy()
      }
    })

    it('should reject invalid data', async () => {
      const result = await store.create(PRODUCT_TYPE, {
        name: '',
        price: -5,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('validation')
      }
    })

    it('should reject unregistered entity type', async () => {
      const result = await store.create('unknown_type' as EntityTypeId, {
        name: 'test',
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should fail when no connector is available', async () => {
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      const noConnectorStore = new DefaultEntityStore(registry, connectorRegistry)
      registry.register(productDefinition)

      const result = await noConnectorStore.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('connector')
      }
    })
  })

  describe('read', () => {
    it('should read an existing entity', async () => {
      const created = await store.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
      })
      expect(created.success).toBe(true)
      if (!created.success) return

      const result = await store.read(PRODUCT_TYPE, created.id)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.name).toBe('Widget')
      }
    })

    it('should return not_found for missing entity', async () => {
      const result = await store.read(PRODUCT_TYPE, 'nonexistent' as EntityInstanceId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should return not_found for unregistered entity type', async () => {
      const result = await store.read('unknown_type' as EntityTypeId, 'any' as EntityInstanceId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })
  })

  describe('update', () => {
    it('should update an existing entity', async () => {
      const created = await store.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
      })
      expect(created.success).toBe(true)
      if (!created.success) return

      const result = await store.update(PRODUCT_TYPE, created.id, {
        price: 39.99,
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.price).toBe(39.99)
        expect(result.data.name).toBe('Widget')
        expect(result.id).toBe(created.id)
      }
    })

    it('should reject invalid update data', async () => {
      const created = await store.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
      })
      expect(created.success).toBe(true)
      if (!created.success) return

      const result = await store.update(PRODUCT_TYPE, created.id, {
        price: -10,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('validation')
      }
    })

    it('should return not_found for missing entity', async () => {
      const result = await store.update(PRODUCT_TYPE, 'nonexistent' as EntityInstanceId, {
        price: 39.99,
      })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })
  })

  describe('delete', () => {
    it('should delete an existing entity', async () => {
      const created = await store.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
      })
      expect(created.success).toBe(true)
      if (!created.success) return

      const result = await store.delete(PRODUCT_TYPE, created.id)

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.id).toBe(created.id)
      }
    })

    it('should return not_found after deletion', async () => {
      const created = await store.create(PRODUCT_TYPE, {
        name: 'Widget',
        price: 29.99,
      })
      expect(created.success).toBe(true)
      if (!created.success) return

      await store.delete(PRODUCT_TYPE, created.id)
      const readResult = await store.read(PRODUCT_TYPE, created.id)

      expect(readResult.success).toBe(false)
    })

    it('should return not_found for missing entity', async () => {
      const result = await store.delete(PRODUCT_TYPE, 'nonexistent' as EntityInstanceId)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })
  })

  describe('query', () => {
    it('should query all entities', async () => {
      await store.create(PRODUCT_TYPE, { name: 'Widget A', price: 10 })
      await store.create(PRODUCT_TYPE, { name: 'Widget B', price: 20 })
      await store.create(PRODUCT_TYPE, { name: 'Widget C', price: 30 })

      const result = await store.query(PRODUCT_TYPE, {})

      expect(result.total).toBe(3)
      expect(result.items).toHaveLength(3)
    })

    it('should return empty result for unregistered entity type', async () => {
      const result = await store.query('unknown_type' as EntityTypeId, {})

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })

    it('should return empty result when no connector available', async () => {
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      const noConnectorStore = new DefaultEntityStore(registry, connectorRegistry)
      registry.register(productDefinition)

      const result = await noConnectorStore.query(PRODUCT_TYPE, {})

      expect(result.items).toEqual([])
      expect(result.total).toBe(0)
    })

    it('should support filtering', async () => {
      await store.create(PRODUCT_TYPE, { name: 'Widget A', price: 10 })
      await store.create(PRODUCT_TYPE, { name: 'Widget B', price: 20 })
      await store.create(PRODUCT_TYPE, { name: 'Widget C', price: 30 })

      const result = await store.query(PRODUCT_TYPE, {
        filter: { field: 'price', operator: 'gt', value: 15 },
      })

      expect(result.total).toBe(2)
    })

    it('should support pagination', async () => {
      await store.create(PRODUCT_TYPE, { name: 'Widget A', price: 10 })
      await store.create(PRODUCT_TYPE, { name: 'Widget B', price: 20 })
      await store.create(PRODUCT_TYPE, { name: 'Widget C', price: 30 })

      const result = await store.query(PRODUCT_TYPE, {
        pagination: { offset: 0, limit: 2 },
      })

      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
      expect(result.total).toBe(3)
    })
  })
})

describe('createEntityStore', () => {
  it('should create a DefaultEntityStore instance', () => {
    const registry = new InMemoryEntityRegistry()
    const connectors = new InMemoryConnectorRegistry()

    const store = createEntityStore(registry, connectors)

    expect(store).toBeInstanceOf(DefaultEntityStore)
  })
})

// ============================================================
// Error branch coverage: unregistered type + no connector
// ============================================================

describe('DefaultEntityStore — error branches', () => {
  const UNKNOWN_TYPE = 'unknown-type' as EntityTypeId

  describe('create — error paths', () => {
    it('should return not_found for unregistered entity type', async () => {
      const { store } = createTestSetup()
      const result = await store.create(UNKNOWN_TYPE, { name: 'X' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should return connector error when no connector is registered', async () => {
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      registry.register(productDefinition)
      // No connector registered

      const store = new DefaultEntityStore(registry, connectorRegistry)
      const result = await store.create(PRODUCT_TYPE, { name: 'X', price: 5 })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('connector')
      }
    })

    it('should emit entity:created via eventBus when provided', async () => {
      const { store: baseStore, registry, connectorRegistry } = createTestSetup()
      const emitted: unknown[] = []
      const eventBus = {
        emit: (e: unknown) => emitted.push(e),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        on: () => () => {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        off: () => {},
      }
      // Create store with eventBus
      const storeWithBus = new DefaultEntityStore(registry, connectorRegistry, eventBus as never)

      const result = await storeWithBus.create(PRODUCT_TYPE, { name: 'Widget', price: 10 })
      expect(result.success).toBe(true)
      expect(emitted).toHaveLength(1)
      void baseStore // suppress unused warning
    })
  })

  describe('read — error paths', () => {
    it('should return not_found for unregistered entity type', async () => {
      const { store } = createTestSetup()
      const result = await store.read(UNKNOWN_TYPE, 'id-1' as EntityInstanceId)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should return connector error when no connector is registered', async () => {
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      registry.register(productDefinition)
      const store = new DefaultEntityStore(registry, connectorRegistry)

      const result = await store.read(PRODUCT_TYPE, 'id-1' as EntityInstanceId)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('connector')
      }
    })
  })

  describe('update — error paths', () => {
    it('should return not_found for unregistered entity type', async () => {
      const { store } = createTestSetup()
      const result = await store.update(UNKNOWN_TYPE, 'id-1' as EntityInstanceId, { name: 'X' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should return connector error when no connector is registered', async () => {
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      registry.register(productDefinition)
      const store = new DefaultEntityStore(registry, connectorRegistry)

      const result = await store.update(PRODUCT_TYPE, 'id-1' as EntityInstanceId, { name: 'X' })
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('connector')
      }
    })

    it('should emit entity:updated via eventBus when update succeeds', async () => {
      const { registry, connectorRegistry } = createTestSetup()
      const emitted: unknown[] = []
      const eventBus = {
        emit: (e: unknown) => emitted.push(e),
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        on: () => () => {},
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        off: () => {},
      }
      const storeWithBus = new DefaultEntityStore(registry, connectorRegistry, eventBus as never)

      const created = await storeWithBus.create(PRODUCT_TYPE, { name: 'Gadget', price: 50 })
      expect(created.success).toBe(true)
      if (!created.success) return

      emitted.length = 0 // clear creation event

      const result = await storeWithBus.update(PRODUCT_TYPE, created.id, { price: 60 })
      expect(result.success).toBe(true)
      expect(emitted).toHaveLength(1)
    })
  })

  describe('delete — error paths', () => {
    it('should return not_found for unregistered entity type', async () => {
      const { store } = createTestSetup()
      const result = await store.delete(UNKNOWN_TYPE, 'id-1' as EntityInstanceId)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
      }
    })

    it('should return connector error when no connector is registered', async () => {
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      registry.register(productDefinition)
      const store = new DefaultEntityStore(registry, connectorRegistry)

      const result = await store.delete(PRODUCT_TYPE, 'id-1' as EntityInstanceId)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('connector')
      }
    })
  })

  describe('query — error paths', () => {
    it('should return empty result when connector.query fails', async () => {
      // Test the no-connector path
      const registry = new InMemoryEntityRegistry()
      const connectorRegistry = new InMemoryConnectorRegistry()
      registry.register(productDefinition)
      const storeNoConn = new DefaultEntityStore(registry, connectorRegistry)

      const result = await storeNoConn.query(PRODUCT_TYPE, {})
      // Without connector, returns empty result
      expect(result.items).toHaveLength(0)
    })
  })
})

describe('DefaultEntityStore — id of a created record', () => {
  async function createVia(answer: Record<string, unknown>): Promise<string> {
    const registry = new InMemoryEntityRegistry()
    const connectorRegistry = new InMemoryConnectorRegistry()
    const connector = new StaticConnector('wrapping')
    connector.create = async () => ({ success: true, data: answer }) as never
    const store = new DefaultEntityStore(registry, connectorRegistry)
    registry.register(productDefinition)
    connectorRegistry.register(connector)
    connectorRegistry.setDefault('wrapping')
    const result = await store.create(PRODUCT_TYPE, { name: 'Widget', price: 1 })
    if (!result.success) throw new Error('create failed')
    return result.id as string
  }

  it('reads the id from a record service that wraps the record in data', async () => {
    expect(await createVia({ data: { id: 'rec-42', name: 'Widget', price: 1 } })).toBe('rec-42')
  })

  it('still reads an id the service returns at the top level', async () => {
    expect(await createVia({ id: 'rec-7', name: 'Widget', price: 1 })).toBe('rec-7')
  })

  it('turns a numeric id into a string', async () => {
    expect(await createVia({ data: { id: 9 } })).toBe('9')
  })
})
