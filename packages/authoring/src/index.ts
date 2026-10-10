/**
 * @pwfabric/authoring
 *
 * The surface a pack author writes against: define a block, compose a factory,
 * declare a capability, register and validate what you built.
 *
 * It holds no HTTP client: talking to a hosting service is that service's
 * own package. The scaffolding templates in the authoring tooling emit
 * `import { defineBlock } from ...`, so this is the module name a third-party
 * author reads first.
 *
 * @module @pwfabric/authoring
 *
 * @example
 * ```typescript
 * import { defineBlock, createCustomBlockRegistry } from '@pwfabric/authoring'
 * import { z } from 'zod'
 *
 * const MyBlock = defineBlock({
 *   type: 'my-block',
 *   name: 'My Block',
 *   schema: z.object({ title: z.string() }),
 *   defaultProps: { title: 'Default' },
 *   component: ({ props }) => <div>{props.title}</div>
 * })
 *
 * const registry = createCustomBlockRegistry()
 * registry.register(MyBlock)
 * ```
 */

// Re-export runtime (which includes core and contracts)
export * from '@pwfabric/runtime'

// ============================================================
// TYPES
// ============================================================

export type {
  // Custom block types
  CustomBlockOptions,
  SchemaProps,
  CustomBlockComponentProps,
  CustomBlockComponent,
  CustomBlockContext,
  CustomBlockDefinition,

  // Factory types
  FactoryConfig,
  BlockSpec,
  FactoryOptions,
  FactoryDefinition,
  FactoryValidationResult,
  FactoryValidationError,

  // Registry types
  ICustomBlockRegistry,

  // Validation types
  BlockValidationResult,
  BlockValidationError,
  PropsValidationResult,

  // Utility types
  InferBlockProps,
  InferFactoryConfig,
  InferSchemaProps,
} from './types.js'

// ============================================================
// DEFINE BLOCK API
// ============================================================

export { defineBlock, isCustomBlockDefinition, createBlockInstance } from './define-block.js'
// single-source field-severity gate for authoring/install.
export { validateBlockDefinition } from './define-block.js'
export type { BlockDefinitionIssue } from './define-block.js'

// ============================================================
// DEFINE FACTORY API
// ============================================================

export {
  defineFactory,
  isFactoryDefinition,
  composeFactoryOutputs,
  wrapInContainer,
  resetIdCounter,
} from './define-factory.js'

// ============================================================
// DEFINE CAPABILITY API
// ============================================================

export { CapabilityBuilder, defineCapability } from '@pwfabric/contracts'

// ============================================================
// REGISTRY API
// ============================================================

export {
  CustomBlockRegistry,
  createCustomBlockRegistry,
  getCustomBlockRegistry,
  resetGlobalRegistry,
  mergeRegistries,
  mergeWithBaseComponents,
} from './registry.js'

// ============================================================
// VALIDATION API
// ============================================================

export {
  validateProps,
  validatePropsWithDefaults,
  validateBlock,
  validateBlockTree,
  createBlockValidator,
  createPropsValidator,
  formatValidationErrors,
  hasErrors,
  isBlock,
  isBlockArray,
} from './validation.js'
