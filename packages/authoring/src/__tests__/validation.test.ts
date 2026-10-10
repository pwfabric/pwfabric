/**
 * Validation Utilities Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
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
} from '../validation.js'
import { defineBlock } from '../define-block.js'
import { createCustomBlockRegistry } from '../registry.js'
import type { Block } from '@pwfabric/runtime'

describe('validateProps', () => {
  const schema = z.object({
    title: z.string(),
    count: z.number().optional(),
  })

  it('should return valid result for matching props', () => {
    const result = validateProps({ title: 'Test' }, schema)

    expect(result.valid).toBe(true)
    expect(result.props).toEqual({ title: 'Test' })
    expect(result.errors).toHaveLength(0)
  })

  it('should return invalid result for non-matching props', () => {
    const result = validateProps({ count: 10 }, schema)

    expect(result.valid).toBe(false)
    expect(result.props).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].code).toBe('VALIDATION_ERROR')
  })

  it('should include path in error for nested objects', () => {
    const nestedSchema = z.object({
      nested: z.object({
        value: z.string(),
      }),
    })

    const result = validateProps({ nested: { value: 123 } }, nestedSchema)

    expect(result.valid).toBe(false)
    expect(result.errors[0].path).toBe('nested.value')
  })
})

describe('validatePropsWithDefaults', () => {
  const schema = z.object({
    title: z.string(),
    count: z.number(),
  })

  const defaults = { title: 'Default', count: 0 }

  it('should return validated props when valid', () => {
    const result = validatePropsWithDefaults({ title: 'Custom', count: 5 }, schema, defaults)

    expect(result).toEqual({ title: 'Custom', count: 5 })
  })

  it('should return defaults when validation fails', () => {
    const result = validatePropsWithDefaults({ invalid: true }, schema, defaults)

    expect(result).toEqual(defaults)
  })
})

describe('validateBlock', () => {
  const definition = defineBlock({
    type: 'validated-block',
    name: 'Validated Block',
    schema: z.object({
      title: z.string(),
      active: z.boolean().default(false),
    }),
    defaultProps: { title: 'Default', active: false },
    canHaveChildren: false,
    component: () => null,
  })

  it('should validate a matching block', () => {
    const block: Block = {
      id: 'block-1',
      type: 'validated-block',
      props: { title: 'Test', active: true },
    }

    const result = validateBlock(block, definition)

    expect(result.valid).toBe(true)
    expect(result.block).toEqual(block)
  })

  it('should return error for type mismatch', () => {
    const block: Block = {
      id: 'block-2',
      type: 'wrong-type',
      props: { title: 'Test', active: true },
    }

    const result = validateBlock(block, definition)

    expect(result.valid).toBe(false)
    expect(result.errors[0].code).toBe('TYPE_MISMATCH')
  })

  it('should return error for invalid props', () => {
    const block: Block = {
      id: 'block-3',
      type: 'validated-block',
      props: { title: 123 }, // wrong type
    }

    const result = validateBlock(block, definition)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'VALIDATION_ERROR')).toBe(true)
  })

  it('should return error for children when not allowed', () => {
    const block: Block = {
      id: 'block-4',
      type: 'validated-block',
      props: { title: 'Test', active: true },
      children: [{ id: 'child-1', type: 'text', props: {} }],
    }

    const result = validateBlock(block, definition)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'CHILDREN_NOT_ALLOWED')).toBe(true)
  })

  it('should validate allowed children types', () => {
    const containerDef = defineBlock({
      type: 'container-validated',
      name: 'Container',
      schema: z.object({ gap: z.number() }),
      defaultProps: { gap: 16 },
      canHaveChildren: true,
      allowedChildren: ['text', 'heading'],
      component: () => null,
    })

    const block: Block = {
      id: 'container-1',
      type: 'container-validated',
      props: { gap: 16 },
      children: [
        { id: 'child-1', type: 'image', props: {} }, // not allowed
      ],
    }

    const result = validateBlock(block, containerDef)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.code === 'INVALID_CHILD_TYPE')).toBe(true)
  })
})

describe('validateBlockTree', () => {
  let registry: ReturnType<typeof createCustomBlockRegistry>

  beforeEach(() => {
    registry = createCustomBlockRegistry()
    registry.register(
      defineBlock({
        type: 'tree-block',
        name: 'Tree Block',
        schema: z.object({ value: z.string() }),
        defaultProps: { value: '' },
        canHaveChildren: true,
        component: () => null,
      })
    )
  })

  it('should validate all blocks in tree', () => {
    const blocks: Block[] = [
      {
        id: 'root',
        type: 'tree-block',
        props: { value: 'root' },
        children: [
          {
            id: 'child',
            type: 'tree-block',
            props: { value: 'child' },
          },
        ],
      },
    ]

    const errors = validateBlockTree(blocks, registry)
    expect(errors).toHaveLength(0)
  })

  it('should return errors for invalid blocks in tree', () => {
    const blocks: Block[] = [
      {
        id: 'root',
        type: 'tree-block',
        props: { value: 123 }, // invalid
      },
    ]

    const errors = validateBlockTree(blocks, registry)
    expect(errors.length).toBeGreaterThan(0)
  })

  it('should skip validation for non-registered blocks', () => {
    const blocks: Block[] = [
      {
        id: 'root',
        type: 'container', // built-in, not in custom registry
        props: {},
      },
    ]

    const errors = validateBlockTree(blocks, registry)
    expect(errors).toHaveLength(0)
  })
})

describe('createBlockValidator', () => {
  it('should create a reusable validator', () => {
    const definition = defineBlock({
      type: 'reusable-block',
      name: 'Reusable',
      schema: z.object({ text: z.string() }),
      defaultProps: { text: '' },
      component: () => null,
    })

    const validate = createBlockValidator(definition)

    const validResult = validate({
      id: 'b1',
      type: 'reusable-block',
      props: { text: 'hello' },
    })
    expect(validResult.valid).toBe(true)

    const invalidResult = validate({
      id: 'b2',
      type: 'wrong-type',
      props: {},
    })
    expect(invalidResult.valid).toBe(false)
  })
})

describe('createPropsValidator', () => {
  it('should create a reusable props validator', () => {
    const schema = z.object({ count: z.number().positive() })
    const validate = createPropsValidator(schema)

    const validResult = validate({ count: 5 })
    expect(validResult.valid).toBe(true)
    expect(validResult.props).toEqual({ count: 5 })

    const invalidResult = validate({ count: -1 })
    expect(invalidResult.valid).toBe(false)
  })
})

describe('formatValidationErrors', () => {
  it('should format errors as readable string', () => {
    const errors = [
      { code: 'ERR1', message: 'First error', path: 'field1' },
      { code: 'ERR2', message: 'Second error' },
    ]

    const formatted = formatValidationErrors(errors)

    expect(formatted).toContain('[ERR1] at field1: First error')
    expect(formatted).toContain('[ERR2]: Second error')
  })

  it('should return "No errors" for empty array', () => {
    expect(formatValidationErrors([])).toBe('No errors')
  })
})

describe('hasErrors', () => {
  it('should return true for invalid result with errors', () => {
    const result = { valid: false, errors: [{ code: 'ERR', message: 'Error' }] }
    expect(hasErrors(result)).toBe(true)
  })

  it('should return false for valid result', () => {
    const result = { valid: true, props: {}, errors: [] }
    expect(hasErrors(result)).toBe(false)
  })
})

describe('isBlock', () => {
  it('should return true for valid block objects', () => {
    expect(isBlock({ id: 'b1', type: 'text', props: {} })).toBe(true)
    expect(isBlock({ id: 'b2', type: 'container', props: { gap: 16 }, children: [] })).toBe(true)
  })

  it('should return false for invalid values', () => {
    expect(isBlock(null)).toBe(false)
    expect(isBlock(undefined)).toBe(false)
    expect(isBlock('string')).toBe(false)
    expect(isBlock({ id: 'b1' })).toBe(false) // missing type and props
    expect(isBlock({ id: 'b1', type: 'text' })).toBe(false) // missing props
  })
})

describe('isBlockArray', () => {
  it('should return true for valid block arrays', () => {
    expect(
      isBlockArray([
        { id: 'b1', type: 'text', props: {} },
        { id: 'b2', type: 'heading', props: { text: 'Hello' } },
      ])
    ).toBe(true)
  })

  it('should return true for empty array', () => {
    expect(isBlockArray([])).toBe(true)
  })

  it('should return false for arrays with invalid blocks', () => {
    expect(isBlockArray([{ id: 'b1', type: 'text', props: {} }, { invalid: true }])).toBe(false)
  })

  it('should return false for non-arrays', () => {
    expect(isBlockArray('not an array')).toBe(false)
    expect(isBlockArray({ id: 'b1', type: 'text', props: {} })).toBe(false)
  })
})
