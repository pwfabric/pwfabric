/**
 * Schema Types Tests
 *
 * Tests for schema definitions and JSON Schema conversion
 *
 * @module @pwfabric/contracts/core/__tests__/schema
 */

import { describe, it, expect } from 'vitest'
import {
  toJsonSchema,
  type StringSchema,
  type NumberSchema,
  type BooleanSchema,
  type NullSchema,
  type ArraySchema,
  type ObjectSchema,
  type UnionSchema,
  type LiteralSchema,
  type UnknownSchema,
  type AnySchema,
} from '../../core/schema.js'

describe('toJsonSchema', () => {
  describe('StringSchema', () => {
    it('should convert basic string schema', () => {
      const schema: StringSchema = { type: 'string' }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ type: 'string' })
    })

    it('should convert string schema with constraints', () => {
      const schema: StringSchema = {
        type: 'string',
        minLength: 1,
        maxLength: 100,
        description: 'A name field',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'string',
        minLength: 1,
        maxLength: 100,
        description: 'A name field',
      })
    })

    it('should convert string schema with pattern', () => {
      const schema: StringSchema = {
        type: 'string',
        pattern: '^[a-z]+$',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'string',
        pattern: '^[a-z]+$',
      })
    })

    it('should convert string schema with format', () => {
      const schema: StringSchema = {
        type: 'string',
        format: 'email',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'string',
        format: 'email',
      })
    })
  })

  describe('NumberSchema', () => {
    it('should convert basic number schema', () => {
      const schema: NumberSchema = { type: 'number' }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ type: 'number' })
    })

    it('should convert number schema with constraints', () => {
      const schema: NumberSchema = {
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'A percentage',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'number',
        minimum: 0,
        maximum: 100,
        description: 'A percentage',
      })
    })

    it('should convert integer schema', () => {
      const schema: NumberSchema = {
        type: 'number',
        integer: true,
        minimum: 1,
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'integer',
        minimum: 1,
      })
    })
  })

  describe('BooleanSchema', () => {
    it('should convert boolean schema', () => {
      const schema: BooleanSchema = { type: 'boolean' }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ type: 'boolean' })
    })

    it('should convert boolean schema with description', () => {
      const schema: BooleanSchema = {
        type: 'boolean',
        description: 'Is active flag',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'boolean',
        description: 'Is active flag',
      })
    })
  })

  describe('NullSchema', () => {
    it('should convert null schema', () => {
      const schema: NullSchema = { type: 'null' }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ type: 'null' })
    })
  })

  describe('ArraySchema', () => {
    it('should convert basic array schema', () => {
      const schema: ArraySchema = {
        type: 'array',
        items: { type: 'string' },
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'array',
        items: { type: 'string' },
      })
    })

    it('should convert array schema with constraints', () => {
      const schema: ArraySchema = {
        type: 'array',
        items: { type: 'number' },
        minItems: 1,
        maxItems: 10,
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'array',
        items: { type: 'number' },
        minItems: 1,
        maxItems: 10,
      })
    })

    it('should convert nested array schema', () => {
      const schema: ArraySchema = {
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'number' },
        } as ArraySchema,
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'array',
        items: {
          type: 'array',
          items: { type: 'number' },
        },
      })
    })
  })

  describe('ObjectSchema', () => {
    it('should convert basic object schema', () => {
      const schema: ObjectSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
      })
    })

    it('should convert object schema with required fields', () => {
      const schema: ObjectSchema = {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
        required: ['id'],
      })
    })

    it('should convert object schema with additionalProperties boolean', () => {
      const schema: ObjectSchema = {
        type: 'object',
        properties: {},
        additionalProperties: false,
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: false,
      })
    })

    it('should convert object schema with additionalProperties schema', () => {
      const schema: ObjectSchema = {
        type: 'object',
        properties: {},
        additionalProperties: { type: 'string' },
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'object',
        properties: {},
        additionalProperties: { type: 'string' },
      })
    })

    it('should convert nested object schema', () => {
      const schema: ObjectSchema = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          } as ObjectSchema,
        },
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              name: { type: 'string' },
            },
          },
        },
      })
    })
  })

  describe('UnionSchema', () => {
    it('should convert union schema', () => {
      const schema: UnionSchema = {
        type: 'union',
        variants: [{ type: 'string' }, { type: 'number' }],
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        oneOf: [{ type: 'string' }, { type: 'number' }],
      })
    })

    it('should convert union schema with description', () => {
      const schema: UnionSchema = {
        type: 'union',
        variants: [{ type: 'string' }, { type: 'null' }],
        description: 'Nullable string',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        description: 'Nullable string',
        oneOf: [{ type: 'string' }, { type: 'null' }],
      })
    })
  })

  describe('LiteralSchema', () => {
    it('should convert string literal schema', () => {
      const schema: LiteralSchema = {
        type: 'literal',
        value: 'active',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ const: 'active' })
    })

    it('should convert number literal schema', () => {
      const schema: LiteralSchema = {
        type: 'literal',
        value: 42,
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ const: 42 })
    })

    it('should convert boolean literal schema', () => {
      const schema: LiteralSchema = {
        type: 'literal',
        value: true,
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ const: true })
    })
  })

  describe('UnknownSchema', () => {
    it('should convert unknown schema', () => {
      const schema: UnknownSchema = { type: 'unknown' }

      const result = toJsonSchema(schema)

      expect(result).toEqual({})
    })

    it('should convert unknown schema with description', () => {
      const schema: UnknownSchema = {
        type: 'unknown',
        description: 'Any value',
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({ description: 'Any value' })
    })
  })

  describe('Complex schemas', () => {
    it('should convert a complex nested schema', () => {
      const schema: ObjectSchema = {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' } as StringSchema,
          status: {
            type: 'union',
            variants: [
              { type: 'literal', value: 'active' } as LiteralSchema,
              { type: 'literal', value: 'inactive' } as LiteralSchema,
            ],
          } as UnionSchema,
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
            maxItems: 10,
          } as ArraySchema,
          metadata: {
            type: 'object',
            properties: {},
            additionalProperties: { type: 'unknown' } as UnknownSchema,
          } as ObjectSchema,
        },
        required: ['id', 'status'],
      }

      const result = toJsonSchema(schema)

      expect(result).toEqual({
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          status: {
            oneOf: [{ const: 'active' }, { const: 'inactive' }],
          },
          tags: {
            type: 'array',
            items: { type: 'string' },
            minItems: 0,
            maxItems: 10,
          },
          metadata: {
            type: 'object',
            properties: {},
            additionalProperties: {},
          },
        },
        required: ['id', 'status'],
      })
    })
  })
})

describe('Schema type definitions', () => {
  it('should allow AnySchema to hold any schema type', () => {
    const schemas: AnySchema[] = [
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
      { type: 'null' },
      { type: 'array', items: { type: 'string' } },
      { type: 'object', properties: {} },
      { type: 'union', variants: [] },
      { type: 'literal', value: 'test' },
      { type: 'unknown' },
    ]

    expect(schemas).toHaveLength(9)
  })
})

describe('toJsonSchema default branch', () => {
  it('should return base object for an unrecognised schema type at runtime', () => {
    // The default branch in toJsonSchema is a defensive guard for runtime callers
    // who pass a schema type that is not in the AnySchema union.
    // We cast to bypass TypeScript's type checking.
    const unknownTypeSchema = { type: 'custom-ext' } as unknown as AnySchema

    const result = toJsonSchema(unknownTypeSchema)

    // The default branch returns `base`, which is an empty object when there is no description.
    expect(result).toEqual({})
  })

  it('should include description in the default branch result', () => {
    const unknownTypeSchema = {
      type: 'custom-ext',
      description: 'An extension schema type',
    } as unknown as AnySchema

    const result = toJsonSchema(unknownTypeSchema)

    expect(result).toEqual({ description: 'An extension schema type' })
  })
})
