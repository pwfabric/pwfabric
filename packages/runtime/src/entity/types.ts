/**
 * Entity System Types
 *
 * Entity system type definitions for schema-based entity types,
 * CRUD operations, queries, and validation.
 *
 * @module @pwfabric/runtime/entity/types
 */

import type { z } from 'zod'

// ============================================================
// BRANDED IDENTIFIERS
// ============================================================

/**
 * Branded string type for entity type identifiers
 */
export type EntityTypeId = string & { readonly __brand: 'EntityTypeId' }

/**
 * Branded string type for entity instance identifiers
 */
export type EntityInstanceId = string & { readonly __brand: 'EntityInstanceId' }

// ============================================================
// ENTITY FIELD DEFINITIONS
// ============================================================

/**
 * Supported field types for entity definitions
 */
export type EntityFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'enum'
  | 'json'
  | 'reference'

/**
 * Definition of a single field within an entity
 */
export interface EntityFieldDefinition {
  readonly name: string
  readonly type: EntityFieldType
  readonly required: boolean
  readonly unique?: boolean
  readonly defaultValue?: unknown
  readonly enumValues?: readonly string[]
  readonly referenceTarget?: EntityTypeId
  readonly validation?: z.ZodType
  readonly label?: string
  readonly description?: string
}

// ============================================================
// ENTITY RELATION DEFINITIONS
// ============================================================

/**
 * Supported relation types between entities
 */
export type EntityRelationType = 'has-one' | 'has-many' | 'belongs-to' | 'many-to-many'

/**
 * Definition of a relation between entity types
 */
export interface EntityRelationDefinition {
  readonly name: string
  readonly type: EntityRelationType
  readonly target: EntityTypeId
  readonly foreignKey?: string
  readonly through?: EntityTypeId
  readonly cascade?: 'none' | 'delete' | 'nullify'
}

// ============================================================
// ENTITY DEFINITION
// ============================================================

/**
 * Complete definition of an entity type including fields, relations, and schema
 */
export interface EntityDefinition {
  readonly id: EntityTypeId
  readonly name: string
  readonly description?: string
  readonly fields: readonly EntityFieldDefinition[]
  readonly relations: readonly EntityRelationDefinition[]
  readonly primaryKey: string
  readonly timestamps?: boolean
  readonly softDelete?: boolean
  readonly schema: z.ZodObject<z.ZodRawShape>
}

// ============================================================
// QUERY TYPES
// ============================================================

/**
 * Entity query specification with optional filter, sort, and pagination
 */
export interface EntityQuery {
  readonly filter?: EntityFilter
  readonly sort?: readonly EntitySortField[]
  readonly pagination?: EntityPagination
  readonly include?: readonly string[]
}

/**
 * Filter condition for entity queries
 */
export interface EntityFilter {
  readonly field: string
  readonly operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains' | 'startsWith'
  readonly value: unknown
  readonly and?: readonly EntityFilter[]
  readonly or?: readonly EntityFilter[]
}

/**
 * Sort field specification
 */
export interface EntitySortField {
  readonly field: string
  readonly direction: 'asc' | 'desc'
}

/**
 * Pagination parameters
 */
export interface EntityPagination {
  readonly offset: number
  readonly limit: number
}

/** One number over a collection: `count` needs no field, the rest reduce `field`. */
export type EntityAggregateFn = 'count' | 'sum' | 'avg'

/**
 * An aggregate request — the source-level `aggregate` key. `filter`
 * narrows the rows first, in the `EntityQuery.filter` shape.
 */
export interface EntityAggregate {
  readonly fn: EntityAggregateFn
  readonly field?: string
  readonly filter?: EntityFilter
}

/**
 * What an aggregate answers: `value` is the number (`null` when a numeric
 * fn found nothing to reduce), `count` the rows the filter kept.
 */
export interface EntityAggregateResult {
  readonly fn: EntityAggregateFn
  readonly field?: string
  readonly value: number | null
  readonly count: number
}

/**
 * Result of a paginated entity query
 */
export interface EntityQueryResult<T = Record<string, unknown>> {
  readonly items: readonly T[]
  readonly total: number
  readonly offset: number
  readonly limit: number
  readonly hasMore: boolean
}

// ============================================================
// OPERATION RESULTS (DISCRIMINATED UNIONS)
// ============================================================

/**
 * Result of a create or update mutation
 */
export type EntityMutationResult =
  | {
      readonly success: true
      readonly data: Record<string, unknown>
      readonly id: EntityInstanceId
    }
  | { readonly success: false; readonly error: EntityOperationError }

/**
 * Result of a read operation
 */
export type EntityReadResult =
  | { readonly success: true; readonly data: Record<string, unknown> }
  | { readonly success: false; readonly error: EntityOperationError }

/**
 * Error descriptor for entity operations
 */
export interface EntityOperationError {
  readonly type: 'not_found' | 'validation' | 'conflict' | 'connector' | 'unauthorized' | 'unknown'
  readonly message: string
  readonly details?: unknown
}

// ============================================================
// VALIDATION TYPES
// ============================================================

/**
 * Result of entity validation (discriminated union)
 */
export type EntityValidationResult =
  | { readonly valid: true; readonly data: Record<string, unknown> }
  | { readonly valid: false; readonly errors: readonly EntityValidationError[] }

/**
 * Single field validation error
 */
export interface EntityValidationError {
  readonly field: string
  readonly message: string
  readonly code: string
}
