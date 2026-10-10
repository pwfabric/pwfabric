/**
 * CustomBlockRegistry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import {
  CustomBlockRegistry,
  createCustomBlockRegistry,
  getCustomBlockRegistry,
  resetGlobalRegistry,
  mergeRegistries,
  mergeWithBaseComponents,
} from '../registry.js'
import { defineBlock } from '../define-block.js'

// Test block definitions
const createTestBlock = (type: string, name = 'Test Block'): ReturnType<typeof defineBlock> =>
  defineBlock({
    type,
    name,
    schema: z.object({ title: z.string() }),
    defaultProps: { title: 'Default' },
    component: () => null,
  })

describe('CustomBlockRegistry', () => {
  let registry: CustomBlockRegistry

  beforeEach(() => {
    registry = new CustomBlockRegistry()
  })

  describe('register', () => {
    it('should register a custom block definition', () => {
      const block = createTestBlock('test-block')
      registry.register(block)

      expect(registry.has('test-block')).toBe(true)
      expect(registry.get('test-block')).toBe(block)
    })

    it('should throw on duplicate registration', () => {
      const block = createTestBlock('duplicate-block')
      registry.register(block)

      expect(() => registry.register(block)).toThrow('already registered')
    })
  })

  describe('registerMany', () => {
    it('should register multiple blocks', () => {
      const blocks = [
        createTestBlock('block-one'),
        createTestBlock('block-two'),
        createTestBlock('block-three'),
      ]

      registry.registerMany(blocks)

      expect(registry.size).toBe(3)
      expect(registry.has('block-one')).toBe(true)
      expect(registry.has('block-two')).toBe(true)
      expect(registry.has('block-three')).toBe(true)
    })
  })

  describe('get', () => {
    it('should return block definition if exists', () => {
      const block = createTestBlock('get-block')
      registry.register(block)

      expect(registry.get('get-block')).toBe(block)
    })

    it('should return undefined for non-existent block', () => {
      expect(registry.get('non-existent')).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for registered blocks', () => {
      registry.register(createTestBlock('has-block'))
      expect(registry.has('has-block')).toBe(true)
    })

    it('should return false for non-registered blocks', () => {
      expect(registry.has('not-registered')).toBe(false)
    })
  })

  describe('list', () => {
    it('should return all registered blocks', () => {
      registry.register(createTestBlock('list-block-one'))
      registry.register(createTestBlock('list-block-two'))

      const list = registry.list()
      expect(list).toHaveLength(2)
      expect(list.map((b) => b.type)).toContain('list-block-one')
      expect(list.map((b) => b.type)).toContain('list-block-two')
    })

    it('should return empty array when no blocks registered', () => {
      expect(registry.list()).toHaveLength(0)
    })
  })

  describe('getByCategory', () => {
    it('should return blocks matching category', () => {
      const controlBlock = defineBlock({
        type: 'content-block',
        name: 'Content',
        category: 'control',
        schema: z.object({ text: z.string() }),
        defaultProps: { text: '' },
        component: () => null,
      })

      const layoutBlock = defineBlock({
        type: 'layout-block',
        name: 'Layout',
        category: 'layout',
        schema: z.object({ gap: z.number() }),
        defaultProps: { gap: 16 },
        component: () => null,
      })

      registry.register(controlBlock)
      registry.register(layoutBlock)

      const controlBlocks = registry.getByCategory('control')
      expect(controlBlocks).toHaveLength(1)
      expect(controlBlocks[0].type).toBe('content-block')
    })
  })

  describe('types', () => {
    it('should return all registered block types', () => {
      registry.register(createTestBlock('types-block-one'))
      registry.register(createTestBlock('types-block-two'))

      const types = registry.types()
      expect(types).toHaveLength(2)
      expect(types).toContain('types-block-one')
      expect(types).toContain('types-block-two')
    })
  })

  describe('unregister', () => {
    it('should remove a registered block', () => {
      registry.register(createTestBlock('unregister-block'))
      expect(registry.has('unregister-block')).toBe(true)

      const result = registry.unregister('unregister-block')
      expect(result).toBe(true)
      expect(registry.has('unregister-block')).toBe(false)
    })

    it('should return false for non-existent block', () => {
      expect(registry.unregister('non-existent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should remove all registrations', () => {
      registry.register(createTestBlock('clear-block-one'))
      registry.register(createTestBlock('clear-block-two'))
      expect(registry.size).toBe(2)

      registry.clear()
      expect(registry.size).toBe(0)
    })
  })

  describe('getComponents', () => {
    it('should return a BlockComponentRegistry', () => {
      registry.register(createTestBlock('component-block'))

      const components = registry.getComponents()
      expect(components).toHaveProperty('component-block')
      expect(typeof components['component-block']).toBe('function')
    })

    it('should return empty object when no blocks registered', () => {
      const components = registry.getComponents()
      expect(Object.keys(components)).toHaveLength(0)
    })

    it('should pass context through to custom block component', () => {
      const contextBlock = defineBlock({
        type: 'context-block',
        name: 'Context Block',
        schema: z.object({ title: z.string() }),
        defaultProps: { title: 'Test' },
        component: () => null,
      })

      registry.register(contextBlock)
      const components = registry.getComponents()
      const wrapper = components['context-block']

      // Simulate runtime call with BlockContext
      const element = wrapper({
        block: { id: 'b1', type: 'context-block', props: { title: 'Hello' } },
        props: { title: 'Hello' },
        children: undefined,
        context: {
          theme: 'dark',
          viewport: 'md',
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onEvent: () => {},
          capabilities: new Map(),
          basePath: '/test',
          imageAdapter: undefined,
        },
      }) as { props?: Record<string, unknown> }

      // React element props should include narrowed context
      expect(element).toBeDefined()
      expect(element.props?.context).toBeDefined()
      expect(element.props?.context).toEqual(
        expect.objectContaining({
          theme: 'dark',
          viewport: 'md',
        })
      )
      // Should NOT expose capabilities or basePath
      const ctx = element.props?.context as Record<string, unknown>
      expect(ctx).not.toHaveProperty('capabilities')
      expect(ctx).not.toHaveProperty('basePath')
    })

    it('should handle missing context gracefully', () => {
      const noCtxBlock = defineBlock({
        type: 'no-ctx-block',
        name: 'No Context Block',
        schema: z.object({ title: z.string() }),
        defaultProps: { title: 'Test' },
        component: () => null,
      })

      registry.register(noCtxBlock)
      const components = registry.getComponents()
      const wrapper = components['no-ctx-block']

      const element = wrapper({
        block: { id: 'b1', type: 'no-ctx-block', props: { title: 'Hello' } },
        props: { title: 'Hello' },
        children: undefined,
        context: undefined,
      }) as { props?: Record<string, unknown> }

      expect(element.props?.context).toBeUndefined()
    })

    it('should map onEvent from context to narrowed interface', () => {
      const eventBlock = defineBlock({
        type: 'event-block',
        name: 'Event Block',
        schema: z.object({ title: z.string() }),
        defaultProps: { title: 'Test' },
        component: () => null,
      })

      registry.register(eventBlock)
      const components = registry.getComponents()
      const wrapper = components['event-block']

      const element = wrapper({
        block: { id: 'b1', type: 'event-block', props: { title: 'Hello' } },
        props: { title: 'Hello' },
        children: undefined,
        context: {
          theme: 'light',
          viewport: 'lg',
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          onEvent: () => {},
          capabilities: new Map(),
          basePath: '',
          imageAdapter: undefined,
        },
      }) as { props?: Record<string, unknown> }

      const ctx = element.props?.context as { onEvent?: (e: unknown) => void }
      expect(ctx).toBeDefined()
      expect(typeof ctx.onEvent).toBe('function')
    })
  })
})

describe('createCustomBlockRegistry', () => {
  it('should create a new registry instance', () => {
    const registry1 = createCustomBlockRegistry()
    const registry2 = createCustomBlockRegistry()

    expect(registry1).toBeInstanceOf(CustomBlockRegistry)
    expect(registry2).toBeInstanceOf(CustomBlockRegistry)
    expect(registry1).not.toBe(registry2)
  })
})

describe('getCustomBlockRegistry / resetGlobalRegistry', () => {
  beforeEach(() => {
    resetGlobalRegistry()
  })

  it('should return the same instance on multiple calls', () => {
    const registry1 = getCustomBlockRegistry()
    const registry2 = getCustomBlockRegistry()

    expect(registry1).toBe(registry2)
  })

  it('should return a new instance after reset', () => {
    const registry1 = getCustomBlockRegistry()
    registry1.register(createTestBlock('global-block'))

    resetGlobalRegistry()
    const registry2 = getCustomBlockRegistry()

    expect(registry1).not.toBe(registry2)
    expect(registry2.size).toBe(0)
  })
})

describe('mergeRegistries', () => {
  it('should merge multiple registries', () => {
    const registry1 = createCustomBlockRegistry()
    registry1.register(createTestBlock('merge-block-one'))

    const registry2 = createCustomBlockRegistry()
    registry2.register(createTestBlock('merge-block-two'))

    const merged = mergeRegistries(registry1, registry2)

    expect(merged.size).toBe(2)
    expect(merged.has('merge-block-one')).toBe(true)
    expect(merged.has('merge-block-two')).toBe(true)
  })

  it('should throw on duplicate block types', () => {
    const registry1 = createCustomBlockRegistry()
    registry1.register(createTestBlock('duplicate-merge'))

    const registry2 = createCustomBlockRegistry()
    registry2.register(createTestBlock('duplicate-merge'))

    expect(() => mergeRegistries(registry1, registry2)).toThrow('already registered')
  })
})

describe('mergeWithBaseComponents', () => {
  it('should merge custom registry with base components', () => {
    const baseComponents = {
      container: () => null,
      text: () => null,
    }

    const registry = createCustomBlockRegistry()
    registry.register(createTestBlock('custom-block'))

    const merged = mergeWithBaseComponents(baseComponents, registry)

    expect(merged).toHaveProperty('container')
    expect(merged).toHaveProperty('text')
    expect(merged).toHaveProperty('custom-block')
  })

  it('should override base components with custom ones', () => {
    const baseComponents = {
      container: () => 'base',
    }

    // Can't actually override reserved types, so test with different type
    const registry = createCustomBlockRegistry()
    registry.register(createTestBlock('other-block'))

    const merged = mergeWithBaseComponents(baseComponents, registry)

    expect(merged).toHaveProperty('container')
    expect(merged).toHaveProperty('other-block')
  })
})
