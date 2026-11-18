/**
 * defineBlock API Tests
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { BlockPropDescriptor } from '@pwfabric/contracts'
import {
  defineBlock,
  isCustomBlockDefinition,
  createBlockInstance,
  validateBlockDefinition,
} from '../define-block.js'

describe('field severity (name soft / type hard)', () => {
  const descriptors: readonly BlockPropDescriptor[] = [{ name: 'title', default: 'x', jsonSchema: { type: 'string' } }]
  const props = { title: 'x' }
  const comp = (): string => '<div/>'

  it('coerces a non-string name to type instead of throwing (cosmetic, SOFT)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = defineBlock({ type: 'price-card', name: 123 as any, props: descriptors, defaultProps: props, component: comp })
    expect(block.name).toBe('price-card')
  })

  it('coerces a missing/empty name to type', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const block = defineBlock({ type: 'hero', name: '' as any, props: descriptors, defaultProps: props, component: comp })
    expect(block.name).toBe('hero')
  })

  it('still throws on an invalid type (identity, HARD)', () => {
    expect(() =>
      defineBlock({ type: 'Bad Type', name: 'ok', props: descriptors, defaultProps: props, component: comp })
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

type TestProps = { title: string; count: number }

describe('defineBlock', () => {
  const validSchema: readonly BlockPropDescriptor[] = [
    { name: 'title', required: true, jsonSchema: { type: 'string' } },
    { name: 'count', default: 0, jsonSchema: { type: 'number' } },
  ]

  const validProps = {
    title: 'Test Title',
    count: 0,
  }

  const mockComponent = ({ props }: { props: TestProps }): string => {
    return `<div>${props.title} - ${props.count}</div>`
  }

  describe('successful creation', () => {
    it('should create a block definition with required fields', () => {
      const block = defineBlock<TestProps>({
        type: 'test-block',
        name: 'Test Block',
        props: validSchema,
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
      const block = defineBlock<TestProps>({
        type: 'custom-block',
        name: 'Custom Block',
        category: 'layout',
        icon: '🎨',
        props: validSchema,
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
      const block = defineBlock<TestProps>({
        type: 'no-trait-block',
        name: 'No Trait Block',
        props: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect('traits' in block).toBe(false)
      expect('allowedChildTraits' in block).toBe(false)
    })

    it('should return a frozen object', () => {
      const block = defineBlock<TestProps>({
        type: 'frozen-block',
        name: 'Frozen Block',
        props: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect(Object.isFrozen(block)).toBe(true)
    })
  })

  describe('type validation', () => {
    it('should reject non-kebab-case types', () => {
      expect(() =>
        defineBlock<TestProps>({
          type: 'TestBlock',
          name: 'Test',
          props: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('must be kebab-case')
    })

    it('should reject types starting with number', () => {
      expect(() =>
        defineBlock<TestProps>({
          type: '1-block',
          name: 'Test',
          props: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('must be kebab-case')
    })

    it('should reject reserved block types', () => {
      expect(() =>
        defineBlock<TestProps>({
          type: 'container',
          name: 'Container',
          props: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('is reserved')
    })

    it('should reject types that are too short', () => {
      expect(() =>
        defineBlock<TestProps>({
          type: 'a',
          name: 'Test',
          props: validSchema,
          defaultProps: validProps,
          component: mockComponent,
        })
      ).toThrow('2-50 characters')
    })

    it('should accept valid kebab-case types', () => {
      const block = defineBlock<TestProps>({
        type: 'my-custom-block-v2',
        name: 'My Custom Block V2',
        props: validSchema,
        defaultProps: validProps,
        component: mockComponent,
      })

      expect(block.type).toBe('my-custom-block-v2')
    })
  })

  describe('declared props', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('warns but does NOT throw when defaultProps do not fit the declared props (degrade)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(() =>
        defineBlock<{ label: string }>({
          type: 'invalid-block',
          name: 'Invalid Block',
          props: [{ name: 'label', jsonSchema: { type: 'string' } }],
          defaultProps: { label: 42 } as unknown as { label: string },
          component: () => null,
        })
      ).not.toThrow()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('defaultProps do not fit'))
    })

    it('does not warn when defaultProps fit the declared props', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const props: readonly BlockPropDescriptor[] = [
        { name: 'name', required: true, jsonSchema: { type: 'string' } },
        { name: 'age', jsonSchema: { type: 'number' } },
      ]

      const block = defineBlock<{ name: string; age?: number }>({
        type: 'valid-block',
        name: 'Valid Block',
        props,
        defaultProps: { name: 'Test' },
        component: () => null,
      })

      expect(block.defaultProps).toEqual({ name: 'Test' })
      expect(block.props).toBe(props)
      expect(warn).not.toHaveBeenCalled()
    })

    it('keeps defaultProps as given (declared defaults are applied per instance)', () => {
      const block = defineBlock<{ name: string; count: number }>({
        type: 'default-block',
        name: 'Default Block',
        props: [
          { name: 'name', required: true, jsonSchema: { type: 'string' } },
          { name: 'count', default: 10, jsonSchema: { type: 'number' } },
        ],
        defaultProps: { name: 'Test', count: 10 },
        component: () => null,
      })

      expect(block.defaultProps.count).toBe(10)
    })
  })

  describe('required-field degrade (render never throws)', () => {
    it('missing props → [], no throw', () => {
      let block!: ReturnType<typeof defineBlock<TestProps>>
      expect(() => {
        block = defineBlock<TestProps>({
          type: 'no-props-declared',
          name: 'No Props Declared',
          defaultProps: validProps,
          component: mockComponent,
        })
      }).not.toThrow()
      expect(block.props).toEqual([])
    })

    it('missing defaultProps → {}, no throw', () => {
      let block!: ReturnType<typeof defineBlock<TestProps>>
      expect(() => {
        block = defineBlock<TestProps>({
          type: 'no-props',
          name: 'No Props',
          props: validSchema,
          component: mockComponent,
        })
      }).not.toThrow()
      expect(block.defaultProps).toEqual({})
    })

    it('non-function component → placeholder, no throw', () => {
      let block!: ReturnType<typeof defineBlock<TestProps>>
      expect(() => {
        block = defineBlock<TestProps>({
          type: 'no-component',
          name: 'No Component',
          props: validSchema,
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
      props: [{ name: 'title', jsonSchema: { type: 'string' } }],
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

  it('should return false when props is not a descriptor array', () => {
    const base = { type: 'test', name: 'Test', category: 'content', defaultProps: {}, component: () => null }
    expect(isCustomBlockDefinition({ ...base, props: [] })).toBe(true)
    expect(isCustomBlockDefinition(base)).toBe(false)
    expect(isCustomBlockDefinition({ ...base, props: { title: 'x' } })).toBe(false)
  })
})

describe('createBlockInstance', () => {
  const descriptors: readonly BlockPropDescriptor[] = [
    { name: 'title', required: true, jsonSchema: { type: 'string' } },
    { name: 'count', default: 0, jsonSchema: { type: 'number' } },
    { name: 'size', default: 'md', jsonSchema: { type: 'string', enum: ['sm', 'md', 'lg'] } },
  ]

  const definition = defineBlock<{ title: string; count: number; size: string; extra?: boolean }>({
    type: 'instance-block',
    name: 'Instance Block',
    props: descriptors,
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

  it('should apply declared defaults the starting props do not set', () => {
    const instance = createBlockInstance(definition, 'block-5')

    expect(instance.props.size).toBe('md')
  })

  it('should refuse a value outside the declared enum, naming the prop', () => {
    expect(() => createBlockInstance(definition, 'block-6', { size: 'xl' })).toThrow(/Invalid block props: size:/)
  })

  it('should keep undeclared props as given', () => {
    const instance = createBlockInstance(definition, 'block-7', { extra: true })

    expect(instance.props.extra).toBe(true)
  })

  it('should add children if allowed', () => {
    const containerDef = defineBlock({
      type: 'container-block',
      name: 'Container',
      props: [{ name: 'gap', jsonSchema: { type: 'number' } }],
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
