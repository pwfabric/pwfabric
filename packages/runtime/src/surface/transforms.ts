/**
 * Typed Transform Wrappers
 *
 * Typed runtime wrappers for TransformDescriptor.config.
 * These do NOT modify @pwfabric/contracts. They provide typed alternatives
 * that narrow the opaque Record<string, unknown> config.
 *
 * @module @pwfabric/runtime/surface/transforms
 */

import { z } from 'zod'
import type { TransformDescriptor } from '@pwfabric/contracts'

// ============================================================
// TYPED TRANSFORM CONFIG INTERFACES
// ============================================================

/**
 * Config for 'map' transforms
 */
export interface MapTransformConfig {
  readonly field: string
  readonly mapper: string
}

/**
 * Config for 'filter' transforms
 */
export interface FilterTransformConfig {
  readonly field: string
  readonly predicate: string
}

/**
 * Config for 'pick' transforms
 */
export interface PickTransformConfig {
  readonly fields: readonly string[]
}

/**
 * Config for 'omit' transforms
 */
export interface OmitTransformConfig {
  readonly fields: readonly string[]
}

/**
 * Config for 'custom' transforms
 */
export interface CustomTransformConfig {
  readonly handler: string
  readonly params?: Record<string, unknown>
}

/**
 * Discriminated union of all typed transform configs
 */
export type TypedTransformConfig =
  | { readonly type: 'map'; readonly config: MapTransformConfig }
  | { readonly type: 'filter'; readonly config: FilterTransformConfig }
  | { readonly type: 'pick'; readonly config: PickTransformConfig }
  | { readonly type: 'omit'; readonly config: OmitTransformConfig }
  | { readonly type: 'custom'; readonly config: CustomTransformConfig }

// ============================================================
// ZOD SCHEMAS
// ============================================================

export const mapTransformConfigSchema = z.object({
  field: z.string().min(1),
  mapper: z.string().min(1),
})

export const filterTransformConfigSchema = z.object({
  field: z.string().min(1),
  predicate: z.string().min(1),
})

export const pickTransformConfigSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
})

export const omitTransformConfigSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
})

export const customTransformConfigSchema = z.object({
  handler: z.string().min(1),
  params: z.record(z.unknown()).optional(),
})

/**
 * Map of transform types to their Zod schemas
 */
const transformConfigSchemas = {
  map: mapTransformConfigSchema,
  filter: filterTransformConfigSchema,
  pick: pickTransformConfigSchema,
  omit: omitTransformConfigSchema,
  custom: customTransformConfigSchema,
} as const

// ============================================================
// VALIDATION TYPES
// ============================================================

/**
 * Result of validating a transform config
 */
export interface TransformValidationResult {
  readonly valid: boolean
  readonly errors: readonly string[]
}

// ============================================================
// VALIDATION FUNCTION
// ============================================================

/**
 * Validate a transform descriptor's config against the typed schema
 * for the given transform type.
 */
export function validateTransformConfig(
  type: TransformDescriptor['type'],
  config: Record<string, unknown>
): TransformValidationResult {
  const schema = transformConfigSchemas[type]

  const result = schema.safeParse(config)

  if (result.success) {
    return { valid: true, errors: [] }
  }

  return {
    valid: false,
    errors: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
  }
}

// ============================================================
// TYPE GUARD
// ============================================================

/**
 * Type guard that narrows an opaque TransformDescriptor into
 * a TypedTransformConfig if the config passes validation.
 */
export function narrowTransformDescriptor(
  descriptor: TransformDescriptor
): TypedTransformConfig | null {
  if (!descriptor.config) {
    return null
  }

  const schema = transformConfigSchemas[descriptor.type]
  const result = schema.safeParse(descriptor.config)

  if (!result.success) {
    return null
  }

  // The type assertion is safe because Zod validated the config shape
  return {
    type: descriptor.type,
    config: result.data,
  } as TypedTransformConfig
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a typed 'map' transform descriptor
 */
export function createMapTransform(config: MapTransformConfig): TransformDescriptor {
  const parsed = mapTransformConfigSchema.parse(config)
  return { type: 'map', config: parsed }
}

/**
 * Create a typed 'filter' transform descriptor
 */
export function createFilterTransform(config: FilterTransformConfig): TransformDescriptor {
  const parsed = filterTransformConfigSchema.parse(config)
  return { type: 'filter', config: parsed }
}

/**
 * Create a typed 'pick' transform descriptor
 */
export function createPickTransform(config: PickTransformConfig): TransformDescriptor {
  const parsed = pickTransformConfigSchema.parse(config)
  return { type: 'pick', config: { ...parsed, fields: [...parsed.fields] } }
}

/**
 * Create a typed 'omit' transform descriptor
 */
export function createOmitTransform(config: OmitTransformConfig): TransformDescriptor {
  const parsed = omitTransformConfigSchema.parse(config)
  return { type: 'omit', config: { ...parsed, fields: [...parsed.fields] } }
}

/**
 * Create a typed 'custom' transform descriptor
 */
export function createCustomTransform(config: CustomTransformConfig): TransformDescriptor {
  const parsed = customTransformConfigSchema.parse(config)
  return { type: 'custom', config: parsed }
}
