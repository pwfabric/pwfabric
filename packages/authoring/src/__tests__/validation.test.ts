/**
 * Validation Utilities Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
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
import type { BlockPropDescriptor } from '@pwfabric/contracts'

describe('validateProps', () => {
  const descriptors: readonly BlockPropDescriptor[] = [
    { name: 'title', required: true, jsonSchema: { type: 'string' } },
    { name: 'count', jsonSchema: { type: 'number' } },
  ]

  it('should return valid result for matching props', () => {
    const result = validateProps({ title: 'Test' }, descriptors)

    expect(result.valid).toBe(true)
    expect(result.props).toEqual({ title: 'Test' })
    expect(result.errors).toHaveLength(0)
  })

  it('should return invalid result when a required prop without default is missing', () => {
    const result = validateProps({ count: 10 }, descriptors)

    expect(result.valid).toBe(false)
    expect(result.props).toBeUndefined()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].code).toBe('VALIDATION_ERROR')
    expect(result.errors[0].path).toBe('title')
  })

  it('should accept a missing required prop that has a declared default, and apply it', () => {
    const result = validateProps({}, [{ name: 'title', required: true, default: 'Hi', jsonSchema: { type: 'string' } }])

    expect(result.valid).toBe(true)
    expect(result.props).toEqual({ title: 'Hi' })
  })

  it('should return invalid result for a value of the wrong type', () => {
    const result = validateProps({ title: 123 }, descriptors)

    expect(result.valid).toBe(false)
    expect(result.errors[0]).toMatchObject({ code: 'VALIDATION_ERROR', path: 'title' })
  })

  it('should treat non-object props as invalid', () => {
    for (const bad of [null, 'x', 42, ['a']]) {
      const result = validateProps(bad, descriptors)
      expect(result.valid).toBe(false)
      expect(result.errors[0].code).toBe('VALIDATION_ERROR')
    }
  })

  it('should include path in error for nested objects', () => {
    const nested: readonly BlockPropDescriptor[] = [
      { name: 'nested', jsonSchema: { type: 'object', properties: { value: { type: 'string' } } } },
    ]

    const result = validateProps({ nested: { value: 123 } }, nested)

    expect(result.valid).toBe(false)
    expect(result.errors[0].path).toBe('nested.value')
  })

  it('should include the item index in the path for arrays', () => {
    const list: readonly BlockPropDescriptor[] = [
      {
        name: 'items',
        jsonSchema: { type: 'array', items: { type: 'object', properties: { label: { type: 'string' } } } },
      },
    ]

    const result = validateProps({ items: [{ label: 'ok' }, { label: 7 }] }, list)

    expect(result.valid).toBe(false)
    expect(result.errors[0].path).toBe('items[1].label')
  })
})

describe('validatePropsWithDefaults', () => {
  const descriptors: readonly BlockPropDescriptor[] = [
    { name: 'title', default: 'Default', jsonSchema: { type: 'string' } },
    { name: 'count', default: 0, jsonSchema: { type: 'number' } },
  ]

  it('should return the props when they fit', () => {
    const result = validatePropsWithDefaults({ title: 'Custom', count: 5 }, descriptors)

    expect(result).toEqual({ title: 'Custom', count: 5 })
  })

  it('should fill in declared defaults for missing props', () => {
    const result = validatePropsWithDefaults({ invalid: true }, descriptors)

    expect(result).toEqual({ invalid: true, title: 'Default', count: 0 })
  })

  it('should keep a value that does not fit, never its default (never fails)', () => {
    const result = validatePropsWithDefaults({ title: { not: 'a string' }, count: 'many' }, descriptors)

    expect(result).toEqual({ title: { not: 'a string' }, count: 'many' })
  })

  it('should coerce a lossless value to its shape', () => {
    const result = validatePropsWithDefaults({ count: '12' }, descriptors)

    expect(result.count).toBe(12)
  })
})

describe('validateBlock', () => {
  const definition = defineBlock({
    type: 'validated-block',
    name: 'Validated Block',
    props: [
      { name: 'title', required: true, jsonSchema: { type: 'string' } },
      { name: 'active', default: false, jsonSchema: { type: 'boolean' } },
    ],
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

  it('should return the block with declared defaults applied', () => {
    const block: Block = {
      id: 'block-1b',
      type: 'validated-block',
      props: { title: 'Test' },
    }

    const result = validateBlock(block, definition)

    expect(result.valid).toBe(true)
    expect(result.block?.props).toEqual({ title: 'Test', active: false })
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
      props: [{ name: 'gap', jsonSchema: { type: 'number' } }],
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
        props: [{ name: 'value', jsonSchema: { type: 'string' } }],
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
      props: [{ name: 'text', jsonSchema: { type: 'string' } }],
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
    const validate = createPropsValidator([{ name: 'count', jsonSchema: { type: 'number', exclusiveMinimum: 0 } }])

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
