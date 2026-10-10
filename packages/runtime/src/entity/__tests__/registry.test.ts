/**
 * Entity Registry Tests
 *
 * Tests for entity registration, validation, lookup, and error cases.
 *
 * @module @pwfabric/runtime/entity/__tests__/registry
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { InMemoryEntityRegistry, createEntityRegistry } from '../registry.js'
import type { EntityDefinition, EntityTypeId } from '../types.js'

// ============================================================
// TEST HELPERS
// ============================================================

function createTestDefinition(overrides?: Partial<EntityDefinition>): EntityDefinition {
  return {
    id: 'test_entity' as EntityTypeId,
    name: 'Test Entity',
    description: 'A test entity for unit tests',
    fields: [
      { name: 'name', type: 'string', required: true },
      { name: 'email', type: 'string', required: true },
      { name: 'age', type: 'number', required: false },
    ],
    relations: [],
    primaryKey: 'id',
    timestamps: false,
    softDelete: false,
    schema: z.object({
      name: z.string().min(1),
      email: z.string().email(),
      age: z.number().optional(),
    }),
    ...overrides,
  }
}

// ============================================================
// TESTS
// ============================================================

describe('InMemoryEntityRegistry', () => {
  let registry: InMemoryEntityRegistry

  beforeEach(() => {
    registry = new InMemoryEntityRegistry()
  })

  describe('register', () => {
    it('should register an entity definition', () => {
      const definition = createTestDefinition()

      registry.register(definition)

      expect(registry.has(definition.id)).toBe(true)
    })

    it('should throw if definition has no id', () => {
      const definition = createTestDefinition({ id: '' as EntityTypeId })

      expect(() => registry.register(definition)).toThrow('Entity definition must have an id')
    })

    it('should throw if definition has no name', () => {
      const definition = createTestDefinition({ name: '' })

      expect(() => registry.register(definition)).toThrow('Entity definition must have a name')
    })

    it('should throw if definition has no schema', () => {
      const definition = createTestDefinition({
        schema: undefined as unknown as z.ZodObject<z.ZodRawShape>,
      })

      expect(() => registry.register(definition)).toThrow('Entity definition must have a schema')
    })

    it('should throw if definition has no primaryKey', () => {
      const definition = createTestDefinition({ primaryKey: '' })

      expect(() => registry.register(definition)).toThrow(
        'Entity definition must have a primaryKey'
      )
    })

    it('should throw if entity type is already registered', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      expect(() => registry.register(definition)).toThrow(
        "Entity type 'test_entity' is already registered"
      )
    })

    it('should register multiple different entity types', () => {
      const def1 = createTestDefinition({ id: 'entity_a' as EntityTypeId, name: 'Entity A' })
      const def2 = createTestDefinition({ id: 'entity_b' as EntityTypeId, name: 'Entity B' })

      registry.register(def1)
      registry.register(def2)

      expect(registry.has(def1.id)).toBe(true)
      expect(registry.has(def2.id)).toBe(true)
    })
  })

  describe('get', () => {
    it('should return registered definition', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const result = registry.get(definition.id)

      expect(result).toBe(definition)
    })

    it('should return undefined for unregistered entity', () => {
      const result = registry.get('nonexistent' as EntityTypeId)

      expect(result).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for registered entity', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      expect(registry.has(definition.id)).toBe(true)
    })

    it('should return false for unregistered entity', () => {
      expect(registry.has('nonexistent' as EntityTypeId)).toBe(false)
    })
  })

  describe('list', () => {
    it('should return all registered entity type ids', () => {
      const def1 = createTestDefinition({ id: 'entity_a' as EntityTypeId, name: 'A' })
      const def2 = createTestDefinition({ id: 'entity_b' as EntityTypeId, name: 'B' })
      registry.register(def1)
      registry.register(def2)

      const ids = registry.list()

      expect(ids).toHaveLength(2)
      expect(ids).toContain('entity_a')
      expect(ids).toContain('entity_b')
    })

    it('should return empty array when no entities registered', () => {
      expect(registry.list()).toEqual([])
    })
  })

  describe('validate', () => {
    it('should validate valid data successfully', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const result = registry.validate(definition.id, {
        name: 'John Doe',
        email: 'john@example.com',
        age: 30,
      })

      expect(result.valid).toBe(true)
      if (result.valid) {
        expect(result.data).toEqual({
          name: 'John Doe',
          email: 'john@example.com',
          age: 30,
        })
      }
    })

    it('should return errors for invalid data', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const result = registry.validate(definition.id, {
        name: '',
        email: 'not-an-email',
      })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThan(0)
        expect(result.errors.some((e) => e.field === 'name' || e.field === 'email')).toBe(true)
      }
    })

    it('should validate optional fields correctly', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const result = registry.validate(definition.id, {
        name: 'Jane',
        email: 'jane@example.com',
      })

      expect(result.valid).toBe(true)
    })

    it('should return error for unregistered entity type', () => {
      const result = registry.validate('nonexistent' as EntityTypeId, { name: 'test' })

      expect(result.valid).toBe(false)
      if (!result.valid) {
        expect(result.errors[0].code).toBe('entity_not_found')
      }
    })

    it('should handle completely invalid data shapes', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const result = registry.validate(definition.id, 'not an object')

      expect(result.valid).toBe(false)
    })

    it('should handle null data', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const result = registry.validate(definition.id, null)

      expect(result.valid).toBe(false)
    })
  })

  describe('unregister', () => {
    it('should remove a registered entity definition', () => {
      const definition = createTestDefinition()
      registry.register(definition)

      const removed = registry.unregister(definition.id)

      expect(removed).toBe(true)
      expect(registry.has(definition.id)).toBe(false)
    })

    it('should return false for unregistered entity', () => {
      const removed = registry.unregister('nonexistent' as EntityTypeId)

      expect(removed).toBe(false)
    })
  })

  describe('clear', () => {
    it('should remove all registered entity definitions', () => {
      const def1 = createTestDefinition({ id: 'entity_a' as EntityTypeId, name: 'A' })
      const def2 = createTestDefinition({ id: 'entity_b' as EntityTypeId, name: 'B' })
      registry.register(def1)
      registry.register(def2)

      registry.clear()

      expect(registry.list()).toEqual([])
      expect(registry.has(def1.id)).toBe(false)
      expect(registry.has(def2.id)).toBe(false)
    })
  })
})

describe('createEntityRegistry', () => {
  it('should create an InMemoryEntityRegistry instance', () => {
    const registry = createEntityRegistry()

    expect(registry).toBeInstanceOf(InMemoryEntityRegistry)
  })

  it('should create a functional registry', () => {
    const registry = createEntityRegistry()
    const definition = createTestDefinition()

    registry.register(definition)

    expect(registry.has(definition.id)).toBe(true)
  })
})
