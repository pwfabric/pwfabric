/**
 * @pwfabric/runtime/schemas — what in the runtime validates with zod.
 *
 * The surface-JSON schemas, the typed transform wrappers and the typed output
 * factories. Tooling only (3.0): the package root carries no zod, so the
 * visitor bundle (`embed.js`) never loads it. Their types stay exported from
 * the root.
 *
 * @module @pwfabric/runtime/schemas
 */

export {
  surfaceJsonSchema,
  layoutJsonSchema,
  bindingJsonSchema,
  environmentSchema,
  isSurfaceJSON,
  isLayoutJSON,
  isBindingJSON,
} from './surface/schemas.js'
export {
  mapTransformConfigSchema,
  filterTransformConfigSchema,
  pickTransformConfigSchema,
  omitTransformConfigSchema,
  customTransformConfigSchema,
  validateTransformConfig,
  narrowTransformDescriptor,
  createMapTransform,
  createFilterTransform,
  createPickTransform,
  createOmitTransform,
  createCustomTransform,
} from './surface/transforms.js'
export { createWebOutput, createApiOutput, createCliOutput } from './surface/output.js'
