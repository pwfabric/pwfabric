/**
 * defineBlock API Tests
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  defineBlock,
  isCustomBlockDefinition,
  createBlockInstance,
  validateBlockDefinition,
} from '../define-block.js'

describe('field severity (name soft / type hard)', () => {
  const schema = z.object({ title: z.string().default('x') })
  const props = { title: 'x' }
  const comp = (): string => '<div/>'

  it('coerces a non-string name to type instead of throwing (cosmetic, SOFT)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = defineBlock({ type: 'price-card', name: 123 as any, schema, defaultProps: props, component: comp })
    expect(block.name).toBe('price-card')
  })

  it('coerces a missing/empty name to type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = defineBlock({ type: 'hero', name: '' as any, schema, defaultProps: props, component: comp })
    expect(block.name).toBe('hero')
  })

  it('still throws on an invalid type (identity, HARD)', () => {
    expect(() =>
      defineBlock({ type: 'Bad Type', name: 'ok', schema, defaultProps: props, component: comp })
    ).toThrow()
  })

  it('validateBlockDefinition: type=error, name=warning', () => {
    expect(validateBlockDefinition({ type: 'ok-type', name: 'Fine' })).toEqual([])
    const badName = validateBlockDefinition({ type: 'ok-type', name: 42 })
    expect(badName).toHaveLength(1)
    expect(badName[0]).toMatchObject({ field: 'name', severity: 'warning' })
    const badType = validateBlockDefinition({ type: 'Bad', name: 'Fine' })
    expect(badType.some((i) => i.field === 'type' && i.severity === 'error')).toBe(true)
  })
})

describe('defineBlock', () => {
  const validSchema = z.object({
    title: z.string(),
    count: z.number().default(0),
  })

  const validProps = {
    title: 'Test Title',
    count: 0,
  }

  const mockComponent = ({ props }: { props: { title: string; count: number } }): string => {
    return `<div>${props.title} - ${props.count}</div>`
  }

  describe('successful creation', () => {
    it('should create a block definition with required fields', () => {
      const block = defineBlock({
        type: 'test-block',
        name: 'Test Block',
        schema: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect(block.type).toBe('test-block')
      expect(block.name).toBe('Test Block')
      expect(block.category).toBe('content') // default
      expect(block.icon).toBe('◆') // default
      expect(block.canHaveChildren).toBe(false) // default
      expect(block.defaultProps).toEqual(validProps)
    })

    it('should create a block definition with all optional fields', () => {
      const block = defineBlock({
        type: 'custom-block',
        name: 'Custom Block',
        category: 'layout',
        icon: '🎨',
        schema: validSchema,
        defaultProps: validProps,
        canHaveChildren: true,
        allowedChildren: ['text', 'heading'],
        allowedParents: ['container'],
        traits: ['modal-content'],
        allowedChildTraits: ['inline'],
        maxInstances: 5,
        component: mockComponent,
      })

      expect(block.category).toBe('layout')
      expect(block.icon).toBe('🎨')
      expect(block.canHaveChildren).toBe(true)
      expect(block.allowedChildren).toEqual(['text', 'heading'])
      expect(block.allowedParents).toEqual(['container'])
      expect(block.traits).toEqual(['modal-content'])
      expect(block.allowedChildTraits).toEqual(['inline'])
      expect(block.maxInstances).toBe(5)
    })

    it('should omit traits fields when not provided', () => {
      const block = defineBlock({
        type: 'no-trait-block',
        name: 'No Trait Block',
        schema: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect('traits' in block).toBe(false)
      expect('allowedChildTraits' in block).toBe(false)
    })

    it('should return a frozen object', () => {
      const block = defineBlock({
        type: 'frozen-block',
        name: 'Frozen Block',
        schema: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect(Object.isFrozen(block)).toBe(true)
    })
  })

  describe('type validation', () => {
    it('should reject non-kebab-case types', () => {
      expect(() =>
        defineBlock({
          type: 'TestBlock',
          name: 'Test',
          schema: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('must be kebab-case')
    })

    it('should reject types starting with number', () => {
      expect(() =>
        defineBlock({
          type: '1-block',
          name: 'Test',
          schema: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('must be kebab-case')
    })

    it('should reject reserved block types', () => {
      expect(() =>
        defineBlock({
          type: 'container',
          name: 'Container',
          schema: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('is reserved')
    })

    it('should reject types that are too short', () => {
      expect(() =>
        defineBlock({
          type: 'a',
          name: 'Test',
          schema: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('2-50 characters')
    })

    it('should accept valid kebab-case types', () => {
      const block = defineBlock({
        type: 'my-custom-block-v2',
        name: 'My Custom Block V2',
        schema: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect(block.type).toBe('my-custom-block-v2')
    })
  })

  describe('schema validation', () => {
    it('warns but does NOT throw when defaultProps do not match schema (degrade)', () => {
      expect(() =>
        defineBlock({
          type: 'invalid-block',
          name: 'Invalid Block',
          schema: z.object({ required: z.string() }),
          defaultProps: { wrong: 'prop' } as unknown as { required: string },
          component: mockComponent as unknown as () => unknown,
        })
      ).not.toThrow()
    })

    it('should accept defaultProps that match schema', () => {
      const schema = z.object({
        name: z.string(),
        age: z.number().optional(),
      })

      const block = defineBlock({
        type: 'valid-block',
        name: 'Valid Block',
        schema,
        defaultProps: { name: 'Test' },
        component: () => null,
      })

      expect(block.defaultProps).toEqual({ name: 'Test' })
    })

    it('should apply schema defaults in defaultProps', () => {
      const schema = z.object({
        name: z.string(),
        count: z.number().default(10),
      })

      const block = defineBlock({
        type: 'default-block',
        name: 'Default Block',
        schema,
        defaultProps: { name: 'Test', count: 10 },
        component: () => null,
      })

      expect(block.defaultProps.count).toBe(10)
    })
  })

  describe('required-field degrade (render never throws)', () => {
    it('missing schema → passthrough, no throw', () => {
      let block!: ReturnType<typeof defineBlock>
      expect(() => {
        block = defineBlock({
          type: 'no-schema',
          name: 'No Schema',
          schema: undefined as unknown as z.ZodSchema,
          defaultProps: { anything: 1 },
          component: mockComponent as unknown as () => unknown,
        })
      }).not.toThrow()
      // passthrough accepts and keeps arbitrary props
      const parsed = block.schema.safeParse({ a: 1, b: 'x' })
      expect(parsed.success).toBe(true)
    })

    it('missing defaultProps → {}, no throw', () => {
      let block!: ReturnType<typeof defineBlock>
      expect(() => {
        block = defineBlock({
          type: 'no-props',
          name: 'No Props',
          schema: validSchema,
          defaultProps: undefined as unknown as typeof validProps,
          component: mockComponent,
        })
      }).not.toThrow()
      expect(block.defaultProps).toEqual({})
    })

    it('non-function component → placeholder, no throw', () => {
      let block!: ReturnType<typeof defineBlock>
      expect(() => {
        block = defineBlock({
          type: 'no-component',
          name: 'No Component',
          schema: validSchema,
          defaultProps: validProps,
          component: 'not a function' as unknown as typeof mockComponent,
        })
      }).not.toThrow()
      expect(typeof block.component).toBe('function')
    })
  })
})

describe('isCustomBlockDefinition', () => {
  it('should return true for valid block definitions', () => {
    const block = defineBlock({
      type: 'test-block',
      name: 'Test',
      schema: z.object({ title: z.string() }),
      defaultProps: { title: 'Test' },
      component: () => null,
    })

    expect(isCustomBlockDefinition(block)).toBe(true)
  })

  it('should return false for non-objects', () => {
    expect(isCustomBlockDefinition(null)).toBe(false)
    expect(isCustomBlockDefinition(undefined)).toBe(false)
    expect(isCustomBlockDefinition('string')).toBe(false)
    expect(isCustomBlockDefinition(123)).toBe(false)
  })

  it('should return false for objects missing required fields', () => {
    expect(isCustomBlockDefinition({ type: 'test' })).toBe(false)
    expect(isCustomBlockDefinition({ type: 'test', name: 'Test' })).toBe(false)
  })
})

describe('createBlockInstance', () => {
  const schema = z.object({
    title: z.string(),
    count: z.number().default(0),
  })

  const definition = defineBlock({
    type: 'instance-block',
    name: 'Instance Block',
    schema,
    defaultProps: { title: 'Default', count: 0 },
    component: () => null,
  })

  it('should create an instance with default props', () => {
    const instance = createBlockInstance(definition, 'block-1')

    expect(instance.id).toBe('block-1')
    expect(instance.type).toBe('instance-block')
    expect(instance.props.title).toBe('Default')
    expect(instance.props.count).toBe(0)
  })

  it('should merge provided props with defaults', () => {
    const instance = createBlockInstance(definition, 'block-2', { title: 'Custom' })

    expect(instance.props.title).toBe('Custom')
    expect(instance.props.count).toBe(0)
  })

  it('should validate merged props', () => {
    expect(() =>
      createBlockInstance(definition, 'block-3', { title: 123 as unknown as string })
    ).toThrow('Invalid block props')
  })

  it('should add children if allowed', () => {
    const containerDef = defineBlock({
      type: 'container-block',
      name: 'Container',
      schema: z.object({ gap: z.number() }),
      defaultProps: { gap: 16 },
      canHaveChildren: true,
      component: () => null,
    })

    const instance = createBlockInstance(containerDef, 'container-1', {}, [
      { id: 'child-1', type: 'text', props: { content: 'Hello' } },
    ])

    expect(instance.children).toHaveLength(1)
    expect(instance.children?.[0]?.id).toBe('child-1')
  })

  it('should reject children if not allowed', () => {
    expect(() =>
      createBlockInstance(definition, 'block-4', {}, [{ id: 'child-1', type: 'text', props: {} }])
    ).toThrow('cannot have children')
  })
})
