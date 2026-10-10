/**
 * Validation Utilities
 *
 * Schema validation utilities for custom blocks.
 *
 * @module @pwfabric/authoring/validation
 */

import type { ZodSchema } from 'zod'
import type { Block } from '@pwfabric/core'
import type {
  CustomBlockDefinition,
  BlockValidationResult,
  BlockValidationError,
  PropsValidationResult,
  ICustomBlockRegistry,
} from './types.js'

// ============================================================
// PROPS VALIDATION
// ============================================================

/**
 * Validate props against a Zod schema
 *
 * @param props - The props to validate
 * @param schema - The Zod schema to validate against
 * @returns Validation result with validated props or errors
 */
export function validateProps<TProps extends Record<string, unknown>>(
  props: unknown,
  schema: ZodSchema<TProps>
): PropsValidationResult<TProps> {
  const result = schema.safeParse(props)

  if (result.success) {
    return {
      valid: true,
      props: result.data,
      errors: [],
    }
  }

  const errors: BlockValidationError[] = result.error.errors.map((e) => ({
    code: 'VALIDATION_ERROR',
    message: e.message,
    path: e.path.join('.'),
  }))

  return {
    valid: false,
    errors,
  }
}

/**
 * Validate props with defaults applied
 *
 * If validation fails, returns the default props.
 *
 * @param props - The props to validate
 * @param schema - The Zod schema
 * @param defaultProps - Default props to use if validation fails
 * @returns Validated props or defaults
 */
export function validatePropsWithDefaults<TProps extends Record<string, unknown>>(
  props: unknown,
  schema: ZodSchema<TProps>,
  defaultProps: TProps
): TProps {
  const result = schema.safeParse(props)
  return result.success ? result.data : defaultProps
}

// ============================================================
// BLOCK VALIDATION
// ============================================================

/**
 * Validate a block against its definition
 *
 * @param block - The block to validate
 * @param definition - The block definition
 * @returns Validation result
 */
export function validateBlock<TProps extends Record<string, unknown>>(
  block: Block,
  definition: CustomBlockDefinition<TProps>
): BlockValidationResult {
  const errors: BlockValidationError[] = []

  // Validate type matches
  if (block.type !== definition.type) {
    errors.push({
      code: 'TYPE_MISMATCH',
      message: `Expected block type "${definition.type}", got "${block.type}"`,
    })
    return { valid: false, errors }
  }

  // Validate props
  const propsResult = validateProps(block.props, definition.schema)
  if (!propsResult.valid) {
    errors.push(...propsResult.errors)
  }

  // Validate children constraints
  if (block.children && block.children.length > 0) {
    if (!definition.canHaveChildren) {
      errors.push({
        code: 'CHILDREN_NOT_ALLOWED',
        message: `Block type "${definition.type}" cannot have children`,
      })
    }

    if (definition.allowedChildren && definition.allowedChildren.length > 0) {
      for (const child of block.children) {
        if (!definition.allowedChildren.includes(child.type)) {
          errors.push({
            code: 'INVALID_CHILD_TYPE',
            message: `Block type "${child.type}" is not allowed as a child of "${definition.type}"`,
            path: `children.${child.id}`,
          })
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  return {
    valid: true,
    block: {
      ...block,
      props: propsResult.props ?? block.props,
    },
    errors: [],
  }
}

/**
 * Validate a block tree against a registry of definitions
 *
 * Recursively validates all blocks in the tree.
 *
 * @param blocks - The blocks to validate
 * @param registry - The block registry
 * @returns Array of validation errors (empty if all valid)
 */
export function validateBlockTree(
  blocks: readonly Block[],
  registry: ICustomBlockRegistry
): readonly BlockValidationError[] {
  const errors: BlockValidationError[] = []

  function validateRecursive(block: Block, path: string): void {
    const definition = registry.get(block.type)

    if (!definition) {
      // Not a custom block, skip validation
      // (could be a built-in block type)
      if (block.children) {
        block.children.forEach((child: Block, index: number) => {
          validateRecursive(child, `${path}.children[${index}]`)
        })
      }
      return
    }

    const result = validateBlock(block, definition)
    if (!result.valid) {
      errors.push(
        ...result.errors.map((e) => ({
          ...e,
          path: e.path ? `${path}.${e.path}` : path,
        }))
      )
    }

    if (block.children) {
      block.children.forEach((child: Block, index: number) => {
        validateRecursive(child, `${path}.children[${index}]`)
      })
    }
  }

  blocks.forEach((block, index) => {
    validateRecursive(block, `blocks[${index}]`)
  })

  return errors
}

// ============================================================
// SCHEMA UTILITIES
// ============================================================

/**
 * Create a validation function for a specific block type
 *
 * @param definition - The block definition
 * @returns A validation function
 */
export function createBlockValidator<TProps extends Record<string, unknown>>(
  definition: CustomBlockDefinition<TProps>
): (block: Block) => BlockValidationResult {
  return (block: Block) => validateBlock(block, definition)
}

/**
 * Create a props validation function for a specific schema
 *
 * @param schema - The Zod schema
 * @returns A validation function
 */
export function createPropsValidator<TProps extends Record<string, unknown>>(
  schema: ZodSchema<TProps>
): (props: unknown) => PropsValidationResult<TProps> {
  return (props: unknown) => validateProps(props, schema)
}

// ============================================================
// ERROR FORMATTING
// ============================================================

/**
 * Format validation errors as a human-readable string
 *
 * @param errors - The validation errors
 * @returns Formatted error string
 */
export function formatValidationErrors(errors: readonly BlockValidationError[]): string {
  if (errors.length === 0) {
    return 'No errors'
  }

  return errors
    .map((e) => {
      const path = e.path ? ` at ${e.path}` : ''
      return `[${e.code}]${path}: ${e.message}`
    })
    .join('\n')
}

/**
 * Check if a validation result has errors
 */
export function hasErrors(result: BlockValidationResult | PropsValidationResult): boolean {
  return !result.valid && result.errors.length > 0
}

// ============================================================
// TYPE GUARDS
// ============================================================

/**
 * Check if a value is a valid Block
 */
export function isBlock(value: unknown): value is Block {
  if (!value || typeof value !== 'object') {
    return false
  }

  const block = value as Partial<Block>
  return (
    typeof block.id === 'string' &&
    typeof block.type === 'string' &&
    typeof block.props === 'object'
  )
}

/**
 * Check if a value is a valid Block array
 */
export function isBlockArray(value: unknown): value is Block[] {
  return Array.isArray(value) && value.every(isBlock)
}
