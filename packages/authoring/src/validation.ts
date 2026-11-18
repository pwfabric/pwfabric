/**
 * Validation Utilities
 *
 * Schema validation utilities for custom blocks.
 *
 * @module @pwfabric/authoring/validation
 */

import { applyBlockProps, checkPropValue, propDefault, type BlockPropDescriptor } from '@pwfabric/contracts'
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
 * Validate props against a block's declared props (its manifest
 * `definition.props`).
 *
 * @param props - The props to validate
 * @param descriptors - The declared props
 * @returns Validation result with the props (declared defaults applied) or errors
 */
export function validateProps<TProps extends Record<string, unknown>>(
  props: unknown,
  descriptors: readonly BlockPropDescriptor[]
): PropsValidationResult<TProps> {
  const record = props && typeof props === 'object' && !Array.isArray(props) ? (props as Record<string, unknown>) : null
  if (!record) {
    return { valid: false, errors: [{ code: 'VALIDATION_ERROR', message: 'props must be an object', path: '' }] }
  }
  const errors: BlockValidationError[] = []
  for (const d of descriptors) {
    const value = record[d.name]
    if (value === undefined) {
      if (d.required && propDefault(d) === undefined) errors.push({ code: 'VALIDATION_ERROR', message: 'is required', path: d.name })
      continue
    }
    for (const issue of checkPropValue(value, d.jsonSchema, d.name)) {
      errors.push({ code: 'VALIDATION_ERROR', message: issue.message, path: issue.path })
    }
  }
  if (errors.length > 0) return { valid: false, errors }
  return { valid: true, props: applyBlockProps(record, descriptors) as TProps, errors: [] }
}

/**
 * The props a block renders with: the declared defaults filled in, values
 * coerced, and a value that does not fit replaced by its default
 * (`applyBlockProps`). Never fails.
 *
 * @param props - The props as written
 * @param descriptors - The declared props
 */
export function validatePropsWithDefaults<TProps extends Record<string, unknown>>(
  props: Record<string, unknown>,
  descriptors: readonly BlockPropDescriptor[]
): TProps {
  return applyBlockProps(props, descriptors) as TProps
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
  const propsResult = validateProps(block.props, definition.props)
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
 * Create a props validation function for a block's declared props
 *
 * @param descriptors - The declared props
 * @returns A validation function
 */
export function createPropsValidator<TProps extends Record<string, unknown>>(
  descriptors: readonly BlockPropDescriptor[]
): (props: unknown) => PropsValidationResult<TProps> {
  return (props: unknown) => validateProps<TProps>(props, descriptors)
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
