/**
 * defineFactory API
 *
 * Create factory functions that generate block compositions.
 *
 * @module @pwfabric/authoring/define-factory
 *
 * @example
 * ```typescript
 * import { defineFactory } from '@pwfabric/authoring'
 * import { z } from 'zod'
 *
 * const MyPageFactory = defineFactory({
 *   id: 'my-page',
 *   name: 'My Page Factory',
 *   configSchema: z.object({
 *     title: z.string(),
 *     subtitle: z.string().optional(),
 *   }),
 *   build: (config) => [
 *     { type: 'heading', props: { text: config.title, level: 'h1' } },
 *     { type: 'text', props: { content: config.subtitle ?? '' } },
 *   ]
 * })
 * ```
 */

import type { ZodSchema } from 'zod'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { blockRegistry } from '@pwfabric/runtime/blocks'
import type {
  FactoryOptions,
  FactoryDefinition,
  FactoryConfig,
  FactoryValidationResult,
  FactoryValidationError,
  BlockSpec,
} from './types.js'

// ============================================================
// ID GENERATION
// ============================================================

let idCounter = 0

/**
 * Generate a unique block ID
 */
function generateBlockId(type: string): string {
  idCounter += 1
  return `${type}-${idCounter}-${Date.now().toString(36)}`
}

/**
 * Reset the ID counter (useful for testing)
 */
export function resetIdCounter(): void {
  idCounter = 0
}

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validate factory identifier
 */
function validateFactoryId(id: string): void {
  if (typeof id !== 'string') {
    throw new Error('Factory id must be a string')
  }

  if (id.length < 2 || id.length > 50) {
    throw new Error('Factory id must be 2-50 characters')
  }

  const kebabCaseRegex = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
  if (!kebabCaseRegex.test(id)) {
    throw new Error(
      `Factory id "${id}" must be kebab-case (lowercase letters, numbers, hyphens, starting with a letter)`
    )
  }
}

/**
 * Validate factory config against schema
 */
function validateConfig<TConfig extends FactoryConfig>(
  config: unknown,
  schema?: ZodSchema<TConfig>
): FactoryValidationResult<TConfig> {
  if (!schema) {
    // No schema, accept any config
    return {
      valid: true,
      config: config as TConfig,
    }
  }

  const result = schema.safeParse(config)
  if (result.success) {
    return {
      valid: true,
      config: result.data,
    }
  }

  const errors: FactoryValidationError[] = result.error.errors.map((e) => ({
    path: e.path.join('.'),
    message: e.message,
  }))

  return {
    valid: false,
    errors,
  }
}

// ============================================================
// BLOCK SPEC TO BLOCK
// ============================================================

/**
 * Convert a BlockSpec (without id) to a Block (with id)
 */
function specToBlock(spec: BlockSpec): Block {
  const block: Block = {
    id: generateBlockId(spec.type),
    type: spec.type,
    props: spec.props,
    layout: blockRegistry.get(spec.type)?.defaultLayout ?? DEFAULT_BLOCK_LAYOUT,
  }

  if (spec.children && spec.children.length > 0) {
    return {
      ...block,
      children: spec.children.map(specToBlock),
    }
  }

  return block
}

// ============================================================
// DEFINE FACTORY
// ============================================================

/**
 * Define a factory function that generates block compositions
 *
 * Factories allow you to create reusable block patterns that can be
 * customized with configuration. They automatically generate unique
 * block IDs and validate configuration against an optional schema.
 *
 * @param options - Factory definition options
 * @returns A frozen factory definition
 *
 * @example
 * ```typescript
 * import { defineFactory } from '@pwfabric/authoring'
 * import { z } from 'zod'
 *
 * // Define a pricing section factory
 * const PricingSectionFactory = defineFactory({
 *   id: 'pricing-section',
 *   name: 'Pricing Section',
 *   description: 'Create a pricing section with multiple tiers',
 *   configSchema: z.object({
 *     title: z.string(),
 *     tiers: z.array(z.object({
 *       name: z.string(),
 *       price: z.number(),
 *       features: z.array(z.string()),
 *     })),
 *   }),
 *   build: (config) => [
 *     {
 *       type: 'container',
 *       props: { direction: 'column', gap: 32 },
 *       children: [
 *         { type: 'heading', props: { text: config.title, level: 'h2' } },
 *         {
 *           type: 'grid',
 *           props: { columns: config.tiers.length },
 *           children: config.tiers.map((tier) => ({
 *             type: 'pricing-card',
 *             props: {
 *               title: tier.name,
 *               price: tier.price,
 *               features: tier.features,
 *             },
 *           })),
 *         },
 *       ],
 *     },
 *   ],
 * })
 *
 * // Use the factory
 * const blocks = PricingSectionFactory.build({
 *   title: 'Choose Your Plan',
 *   tiers: [
 *     { name: 'Basic', price: 9, features: ['Feature 1'] },
 *     { name: 'Pro', price: 29, features: ['Feature 1', 'Feature 2'] },
 *   ],
 * })
 * ```
 */
export function defineFactory<TConfig extends FactoryConfig = FactoryConfig>(
  options: FactoryOptions<TConfig>
): FactoryDefinition<TConfig> {
  // Validate required fields
  validateFactoryId(options.id)

  if (typeof options.build !== 'function') {
    throw new Error('Factory build function is required')
  }

  // Create the build wrapper that converts specs to blocks
  const buildWithIds = (config: TConfig): readonly Block[] => {
    const specs = options.build(config)
    return specs.map(specToBlock)
  }

  // Create the validation function
  const validateConfigFn = (config: unknown): FactoryValidationResult<TConfig> => {
    return validateConfig(config, options.configSchema)
  }

  const definition = {
    id: options.id,
    name: options.name ?? options.id,
    description: options.description ?? '',
    build: buildWithIds,
    validateConfig: validateConfigFn,
    // Only include configSchema if it's defined
    ...(options.configSchema !== undefined && { configSchema: options.configSchema }),
  } as FactoryDefinition<TConfig>

  return Object.freeze(definition)
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

/**
 * Check if a value is a factory definition
 */
export function isFactoryDefinition(value: unknown): value is FactoryDefinition {
  if (!value || typeof value !== 'object') {
    return false
  }

  const def = value as Partial<FactoryDefinition>
  return (
    typeof def.id === 'string' &&
    typeof def.name === 'string' &&
    typeof def.build === 'function' &&
    typeof def.validateConfig === 'function'
  )
}

/**
 * Compose multiple factory outputs into a single block array
 *
 * @param factories - Array of factory output block arrays
 * @returns Combined block array
 */
export function composeFactoryOutputs(
  ...factories: readonly (readonly Block[])[]
): readonly Block[] {
  return factories.flat()
}

/**
 * Wrap factory output in a container block
 *
 * @param blocks - Factory output blocks
 * @param containerProps - Props for the wrapper container
 * @returns Single container block with children
 */
export function wrapInContainer(
  blocks: readonly Block[],
  containerProps: Record<string, unknown> = {}
): Block {
  return {
    id: generateBlockId('container'),
    type: 'container',
    props: {
      direction: 'column',
      gap: 24,
      ...containerProps,
    },
    layout: blockRegistry.get('container')?.defaultLayout ?? DEFAULT_BLOCK_LAYOUT,
    children: [...blocks],
  }
}
