/**
 * Schema Types for Contract Validation
 *
 * PHASE0-WS1: Runtime-validated, serializable schema definitions
 *
 * These types define the shape of validation schemas without
 * coupling to a specific validation library.
 *
 * @module @pwfabric/contracts/core/schema
 */

import type { ValidationResult } from './result.js'

// ============================================================
// SCHEMA TYPES
// ============================================================

/**
 * Supported primitive types in schemas
 */
export type SchemaType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'array'
  | 'object'
  | 'union'
  | 'literal'
  | 'unknown'

/**
 * Base schema definition
 */
export interface SchemaDefinition {
  readonly type: SchemaType
  readonly nullable?: boolean
  readonly optional?: boolean
  readonly description?: string
}

/**
 * String schema
 */
export interface StringSchema extends SchemaDefinition {
  readonly type: 'string'
  readonly minLength?: number
  readonly maxLength?: number
  readonly pattern?: string
  readonly format?: 'email' | 'uuid' | 'uri' | 'date' | 'datetime'
}

/**
 * Number schema
 */
export interface NumberSchema extends SchemaDefinition {
  readonly type: 'number'
  readonly minimum?: number
  readonly maximum?: number
  readonly integer?: boolean
}

/**
 * Boolean schema
 */
export interface BooleanSchema extends SchemaDefinition {
  readonly type: 'boolean'
}

/**
 * Null schema
 */
export interface NullSchema extends SchemaDefinition {
  readonly type: 'null'
}

/**
 * Array schema
 */
export interface ArraySchema extends SchemaDefinition {
  readonly type: 'array'
  readonly items: AnySchema
  readonly minItems?: number
  readonly maxItems?: number
}

/**
 * Object schema
 */
export interface ObjectSchema extends SchemaDefinition {
  readonly type: 'object'
  readonly properties: Record<string, AnySchema>
  readonly required?: string[]
  readonly additionalProperties?: boolean | AnySchema
}

/**
 * Union schema (discriminated or simple)
 */
export interface UnionSchema extends SchemaDefinition {
  readonly type: 'union'
  readonly variants: AnySchema[]
  readonly discriminator?: string
}

/**
 * Literal schema
 */
export interface LiteralSchema extends SchemaDefinition {
  readonly type: 'literal'
  readonly value: string | number | boolean
}

/**
 * Unknown schema (accepts any value)
 */
export interface UnknownSchema extends SchemaDefinition {
  readonly type: 'unknown'
}

/**
 * Any valid schema
 */
export type AnySchema =
  | StringSchema
  | NumberSchema
  | BooleanSchema
  | NullSchema
  | ArraySchema
  | ObjectSchema
  | UnionSchema
  | LiteralSchema
  | UnknownSchema

// ============================================================
// SCHEMA INTERFACE
// ============================================================

/**
 * Schema validator interface
 *
 * This interface abstracts the validation logic, allowing
 * different implementations (Zod, Yup, custom, etc.)
 */
export interface Schema<T = unknown> {
  /**
   * The schema definition (serializable)
   */
  readonly definition: AnySchema

  /**
   * Validate data against the schema
   */
  validate(data: unknown): ValidationResult<T>

  /**
   * Parse data (validate and transform)
   */
  parse(data: unknown): T

  /**
   * Safe parse (returns result instead of throwing)
   */
  safeParse(data: unknown): ValidationResult<T>

  /**
   * Serialize the schema to JSON Schema format
   */
  toJsonSchema(): JsonSchema
}

// ============================================================
// JSON SCHEMA COMPATIBILITY
// ============================================================

/**
 * JSON Schema compatible format
 * Subset of JSON Schema Draft-07
 */
export interface JsonSchema {
  $schema?: string
  $id?: string
  title?: string
  description?: string
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  allOf?: JsonSchema[]
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  minimum?: number
  maximum?: number
  minItems?: number
  maxItems?: number
  additionalProperties?: boolean | JsonSchema
}

// ============================================================
// SERIALIZATION
// ============================================================

/**
 * Serialized contract schema (for network transport)
 */
export interface SerializedSchema {
  readonly version: string
  readonly definition: AnySchema
  readonly jsonSchema: JsonSchema
}

/**
 * Helper to filter out undefined values from an object
 */
function filterUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result as Partial<T>
}

/**
 * Serialize a schema definition to JSON Schema
 */
export function toJsonSchema(schema: AnySchema): JsonSchema {
  const base: JsonSchema = filterUndefined({
    description: schema.description,
  })

  switch (schema.type) {
    case 'string': {
      const s = schema as StringSchema
      return filterUndefined({
        ...base,
        type: 'string',
        minLength: s.minLength,
        maxLength: s.maxLength,
        pattern: s.pattern,
        format: s.format,
      })
    }

    case 'number': {
      const n = schema as NumberSchema
      return filterUndefined({
        ...base,
        type: n.integer ? 'integer' : 'number',
        minimum: n.minimum,
        maximum: n.maximum,
      })
    }

    case 'boolean':
      return { ...base, type: 'boolean' }

    case 'null':
      return { ...base, type: 'null' }

    case 'array': {
      const a = schema as ArraySchema
      return filterUndefined({
        ...base,
        type: 'array',
        items: toJsonSchema(a.items),
        minItems: a.minItems,
        maxItems: a.maxItems,
      })
    }

    case 'object': {
      const o = schema as ObjectSchema
      const properties: Record<string, JsonSchema> = {}
      for (const [key, value] of Object.entries(o.properties)) {
        properties[key] = toJsonSchema(value)
      }
      const result: JsonSchema = {
        ...base,
        type: 'object',
        properties,
      }
      if (o.required) {
        result.required = o.required
      }
      if (typeof o.additionalProperties === 'boolean') {
        result.additionalProperties = o.additionalProperties
      } else if (o.additionalProperties) {
        result.additionalProperties = toJsonSchema(o.additionalProperties)
      }
      return result
    }

    case 'union': {
      const u = schema as UnionSchema
      return {
        ...base,
        oneOf: u.variants.map(toJsonSchema),
      }
    }

    case 'literal': {
      const l = schema as LiteralSchema
      return {
        ...base,
        const: l.value,
      }
    }

    case 'unknown':
      return { ...base }

    default:
      return base
  }
}
