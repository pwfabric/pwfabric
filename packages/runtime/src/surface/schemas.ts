/**
 * Surface JSON Zod Schemas
 *
 * Zod validation schemas for Surface JSON definitions
 *
 * Provides schema-based validation to replace manual string-based
 * validation in the interpreter. Ensures SurfaceJSON, LayoutJSON,
 * and BindingJSON conform to their TypeScript interfaces.
 *
 * @module @pwfabric/runtime/surface/schemas
 */

import { z } from 'zod'
import type { SurfaceJSON, LayoutJSON, BindingJSON } from './types.js'

// ============================================================
// ENVIRONMENT SCHEMA
// ============================================================

/**
 * Valid environment types for surfaces
 */
export const environmentSchema = z.enum([
  'web',
  'api',
  'cli',
  'worker',
  'edge',
  'node',
  'native',
  'test',
])

// ============================================================
// BINDING JSON SCHEMA
// ============================================================

/**
 * Zod schema for BindingJSON
 *
 * Validates capability bindings in surface definitions.
 * - capability: required string identifying the capability
 * - alias: optional string alias for the binding
 * - transform: optional input/output transform configuration
 */
export const bindingJsonSchema = z.object({
  capability: z.string().min(1, 'Binding capability must be a non-empty string'),
  alias: z.string().optional(),
  transform: z
    .object({
      input: z.record(z.unknown()).optional(),
      output: z.record(z.unknown()).optional(),
    })
    .optional(),
})

// ============================================================
// LAYOUT JSON SCHEMA (RECURSIVE)
// ============================================================

/**
 * Zod schema for LayoutJSON
 *
 * Uses z.lazy() for recursive children validation.
 * - type: required string identifying the layout element type
 * - props: optional record of properties
 * - children: optional array of nested LayoutJSON (recursive)
 * - slot: optional named slot reference
 * - if: optional conditional expression
 * - each: optional loop configuration (items, as, key)
 */
// Recursive schema uses z.lazy() with a forward-declared type variable.
// The explicit ZodType cast is required because z.lazy() needs the
// schema variable to exist at the point of self-reference in children.
export const layoutJsonSchema: z.ZodType = z.lazy(() =>
  z.object({
    type: z.string().min(1, 'Layout must have a type'),
    props: z.record(z.unknown()).optional(),
    children: z.array(layoutJsonSchema).optional(),
    slot: z.string().optional(),
    if: z.string().optional(),
    each: z
      .object({
        items: z.string().min(1, 'Loop layout must have items expression'),
        as: z.string().min(1, 'Loop layout must have as variable name'),
        key: z.string().optional(),
      })
      .optional(),
  })
)

// ============================================================
// SURFACE JSON SCHEMA
// ============================================================

/**
 * Metadata schema for surface definitions
 */
const metadataSchema = z
  .object({
    name: z.string().optional(),
    description: z.string().optional(),
    tags: z.array(z.string()).optional(),
  })
  .optional()

/**
 * Zod schema for SurfaceJSON
 *
 * Validates the top-level surface definition structure.
 * - id: required non-empty string
 * - version: required non-empty string (semver)
 * - environment: required enum of valid environment types
 * - $schema: optional schema reference
 * - metadata: optional name, description, tags
 * - bindings: optional array of capability bindings
 * - layout: required recursive layout definition
 */
export const surfaceJsonSchema = z.object({
  $schema: z.string().optional(),
  id: z.string().min(1, 'Surface must have a string id'),
  version: z.string().min(1, 'Surface must have a string version'),
  environment: environmentSchema,
  metadata: metadataSchema,
  bindings: z.array(bindingJsonSchema).optional(),
  layout: layoutJsonSchema,
})

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Type guard for SurfaceJSON
 *
 * Returns true if the provided data conforms to the SurfaceJSON schema.
 */
export function isSurfaceJSON(data: unknown): data is SurfaceJSON {
  return surfaceJsonSchema.safeParse(data).success
}

/**
 * Type guard for LayoutJSON
 *
 * Returns true if the provided data conforms to the LayoutJSON schema.
 */
export function isLayoutJSON(data: unknown): data is LayoutJSON {
  return layoutJsonSchema.safeParse(data).success
}

/**
 * Type guard for BindingJSON
 *
 * Returns true if the provided data conforms to the BindingJSON schema.
 */
export function isBindingJSON(data: unknown): data is BindingJSON {
  return bindingJsonSchema.safeParse(data).success
}
