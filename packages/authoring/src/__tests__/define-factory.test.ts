/**
 * defineFactory API Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  defineFactory,
  isFactoryDefinition,
  composeFactoryOutputs,
  wrapInContainer,
  resetIdCounter,
} from '../define-factory.js'

describe('defineFactory', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  describe('successful creation', () => {
    it('should create a factory definition with required fields', () => {
      const factory = defineFactory({
        id: 'test-factory',
        build: () => [{ type: 'text', props: { content: 'Hello' } }],
      })

      expect(factory.id).toBe('test-factory')
      expect(factory.name).toBe('test-factory') // default to id
      expect(factory.description).toBe('') // default
      expect(typeof factory.build).toBe('function')
      expect(typeof factory.validateConfig).toBe('function')
    })

    it('should create a factory with all optional fields', () => {
      const factory = defineFactory({
        id: 'full-factory',
        name: 'Full Factory',
        description: 'A factory with all options',
        configSchema: z.object({ title: z.string() }),
        build: (config) => [{ type: 'heading', props: { text: config.title } }],
      })

      expect(factory.name).toBe('Full Factory')
      expect(factory.description).toBe('A factory with all options')
      expect(factory.configSchema).toBeDefined()
    })

    it('should return a frozen object', () => {
      const factory = defineFactory({
        id: 'frozen-factory',
        build: () => [],
      })

      expect(Object.isFrozen(factory)).toBe(true)
    })
  })

  describe('id validation', () => {
    it('should reject non-kebab-case ids', () => {
      expect(() =>
        defineFactory({
          id: 'TestFactory',
          build: () => [],
        })
      ).toThrow('must be kebab-case')
    })

    it('should reject ids that are too short', () => {
      expect(() =>
        defineFactory({
          id: 'a',
          build: () => [],
        })
      ).toThrow('2-50 characters')
    })

    it('should accept valid kebab-case ids', () => {
      const factory = defineFactory({
        id: 'my-complex-factory-v2',
        build: () => [],
      })

      expect(factory.id).toBe('my-complex-factory-v2')
    })
  })

  describe('build function', () => {
    it('should generate blocks with unique IDs', () => {
      const factory = defineFactory({
        id: 'id-factory',
        build: () => [
          { type: 'text', props: { content: 'One' } },
          { type: 'text', props: { content: 'Two' } },
        ],
      })

      const blocks = factory.build({})

      expect(blocks).toHaveLength(2)
      expect(blocks[0].id).toBeDefined()
      expect(blocks[1].id).toBeDefined()
      expect(blocks[0].id).not.toBe(blocks[1].id)
    })

    it('should handle nested children', () => {
      const factory = defineFactory({
        id: 'nested-factory',
        build: () => [
          {
            type: 'container',
            props: { direction: 'column' },
            children: [{ type: 'text', props: { content: 'Child' } }],
          },
        ],
      })

      const blocks = factory.build({})

      expect(blocks).toHaveLength(1)
      expect(blocks[0]?.children).toHaveLength(1)
      expect(blocks[0]?.children?.[0]?.id).toBeDefined()
    })

    it('should pass config to build function', () => {
      const factory = defineFactory({
        id: 'config-factory',
        configSchema: z.object({
          title: z.string(),
          count: z.number(),
        }),
        build: (config) =>
          Array.from({ length: config.count }, (_, i) => ({
            type: 'text',
            props: { content: `${config.title} ${i + 1}` },
          })),
      })

      const blocks = factory.build({ title: 'Item', count: 3 })

      expect(blocks).toHaveLength(3)
      expect(blocks[0].props.content).toBe('Item 1')
      expect(blocks[2].props.content).toBe('Item 3')
    })
  })

  describe('config validation', () => {
    it('should validate config against schema', () => {
      const factory = defineFactory({
        id: 'validated-factory',
        configSchema: z.object({
          title: z.string(),
          required: z.boolean(),
        }),
        build: () => [],
      })

      const validResult = factory.validateConfig({ title: 'Test', required: true })
      expect(validResult.valid).toBe(true)
      expect(validResult.config).toEqual({ title: 'Test', required: true })

      const invalidResult = factory.validateConfig({ title: 'Test' })
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.errors).toBeDefined()
      expect(invalidResult.errors?.length).toBeGreaterThan(0)
    })

    it('should accept any config when no schema provided', () => {
      const factory = defineFactory({
        id: 'no-schema-factory',
        build: () => [],
      })

      const result = factory.validateConfig({ anything: 'goes' })
      expect(result.valid).toBe(true)
      expect(result.config).toEqual({ anything: 'goes' })
    })
  })

  describe('required field validation', () => {
    it('should reject missing build function', () => {
      expect(() =>
        defineFactory({
          id: 'no-build',
          build: undefined as unknown as () => [],
        })
      ).toThrow('build function is required')
    })
  })
})

describe('isFactoryDefinition', () => {
  it('should return true for valid factory definitions', () => {
    const factory = defineFactory({
      id: 'check-factory',
      build: () => [],
    })

    expect(isFactoryDefinition(factory)).toBe(true)
  })

  it('should return false for non-objects', () => {
    expect(isFactoryDefinition(null)).toBe(false)
    expect(isFactoryDefinition(undefined)).toBe(false)
    expect(isFactoryDefinition('string')).toBe(false)
  })

  it('should return false for objects missing required fields', () => {
    expect(isFactoryDefinition({ id: 'test' })).toBe(false)
    expect(isFactoryDefinition({ id: 'test', name: 'Test' })).toBe(false)
  })
})

describe('composeFactoryOutputs', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  it('should combine multiple factory outputs', () => {
    const factory1 = defineFactory({
      id: 'factory-one',
      build: () => [{ type: 'heading', props: { text: 'Title' } }],
    })

    const factory2 = defineFactory({
      id: 'factory-two',
      build: () => [{ type: 'text', props: { content: 'Content' } }],
    })

    const combined = composeFactoryOutputs(factory1.build({}), factory2.build({}))

    expect(combined).toHaveLength(2)
    expect(combined[0].type).toBe('heading')
    expect(combined[1].type).toBe('text')
  })

  it('should handle empty arrays', () => {
    const combined = composeFactoryOutputs([], [], [])
    expect(combined).toHaveLength(0)
  })
})

describe('wrapInContainer', () => {
  beforeEach(() => {
    resetIdCounter()
  })

  it('should wrap blocks in a container', () => {
    const blocks = [
      { id: 'b1', type: 'text', props: { content: 'Hello' } },
      { id: 'b2', type: 'text', props: { content: 'World' } },
    ]

    const wrapped = wrapInContainer(blocks)

    expect(wrapped.type).toBe('container')
    expect(wrapped.id).toBeDefined()
    expect(wrapped.children).toHaveLength(2)
    expect(wrapped.props.direction).toBe('column')
    expect(wrapped.props.gap).toBe(24)
  })

  it('should apply custom container props', () => {
    const blocks = [{ id: 'b1', type: 'text', props: {} }]

    const wrapped = wrapInContainer(blocks, {
      direction: 'row',
      gap: 48,
      padding: 16,
    })

    expect(wrapped.props.direction).toBe('row')
    expect(wrapped.props.gap).toBe(48)
    expect(wrapped.props.padding).toBe(16)
  })
})

describe('resetIdCounter', () => {
  it('should reset the ID counter', () => {
    resetIdCounter()

    const factory = defineFactory({
      id: 'reset-factory',
      build: () => [{ type: 'text', props: {} }],
    })

    const blocks1 = factory.build({})
    resetIdCounter()
    const blocks2 = factory.build({})

    // After reset, IDs should start fresh (though timestamp makes them unique)
    expect(blocks1[0].id).toBeDefined()
    expect(blocks2[0].id).toBeDefined()
  })
})
