/**
 * @pwfabric/core/schemas — core's zod schemas (block layout).
 *
 * Tooling only. The package root is zod-free, so the visitor bundle never
 * loads zod; the types these schemas infer stay exported from the root.
 *
 * @module @pwfabric/core/schemas
 */

export * from './blocks/layout-schema.schema.js'
