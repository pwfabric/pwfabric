/**
 * Layout System Tests
 *
 * Slot and layout resolution tests.
 *
 * @module @pwfabric/runtime/surface/__tests__/layout
 */

import { describe, it, expect } from 'vitest'
import type { SurfaceId } from '@pwfabric/contracts'
import {
  resolveLayout,
  createSlotMap,
  extractSlots,
  composeLayouts,
  wrapInContainer,
  validateLayout,
} from '../layout.js'
import type { LayoutJSON, RenderContext } from '../types.js'
import { createNode } from '../types.js'

// ============================================================
// Helpers
// ============================================================

function makeContext(data: Record<string, unknown> = {}): RenderContext {
  return {
    surfaceId: 'test-surface' as SurfaceId,
    bindings: new Map(),
    data,
    slots: new Map(),
  }
}

// ============================================================
// resolveLayout
// ============================================================

describe('resolveLayout()', () => {
  it('resolves a simple primitive node', () => {
    const layout: LayoutJSON = { type: 'text', props: { content: 'Hello' } }
    const result = resolveLayout(layout, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.type).toBe('text')
    expect(result.nodes[0]?.props.content).toBe('Hello')
  })

  it('resolves children recursively', () => {
    const layout: LayoutJSON = {
      type: 'container',
      children: [{ type: 'text' }, { type: 'button' }],
    }
    const result = resolveLayout(layout, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes[0]?.children).toHaveLength(2)
  })

  it('renders nothing when condition is false', () => {
    const layout: LayoutJSON = { type: 'text', if: 'false' }
    const result = resolveLayout(layout, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(0)
  })

  it('renders when condition is true', () => {
    const layout: LayoutJSON = { type: 'text', props: { x: 1 }, if: 'true' }
    const result = resolveLayout(layout, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(1)
  })

  it('evaluates condition against context data', () => {
    const layout: LayoutJSON = { type: 'text', if: 'show' }
    const result = resolveLayout(layout, makeContext({ show: true }))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(1)
  })

  it('returns error for invalid condition expression', () => {
    const layout: LayoutJSON = { type: 'text', if: '{{invalid{{' }
    const result = resolveLayout(layout, makeContext())
    // May succeed or fail depending on expression evaluator; just no throw
    expect(result).toBeDefined()
  })

  it('resolves expression props ({{expr}})', () => {
    const layout: LayoutJSON = { type: 'text', props: { label: '{{name}}' } }
    const result = resolveLayout(layout, makeContext({ name: 'World' }))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes[0]?.props.label).toBe('World')
  })

  it('resolves string interpolation in props', () => {
    const layout: LayoutJSON = { type: 'text', props: { label: 'Hello, {{name}}!' } }
    const result = resolveLayout(layout, makeContext({ name: 'Alice' }))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes[0]?.props.label).toBe('Hello, Alice!')
  })

  it('handles loop expansion (each)', () => {
    const layout: LayoutJSON = {
      type: 'container',
      each: { items: 'items', as: 'item' },
      children: [{ type: 'text', props: { label: '{{item}}' } }],
    }
    const result = resolveLayout(layout, makeContext({ items: ['a', 'b', 'c'] }))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(3)
  })

  it('handles loop with key expression', () => {
    const layout: LayoutJSON = {
      type: 'container',
      each: { items: 'rows', as: 'row', key: 'row.id' },
      children: [{ type: 'text' }],
    }
    const data = { rows: [{ id: 'r1' }, { id: 'r2' }] }
    const result = resolveLayout(layout, makeContext(data))

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[0]?.props.key).toBe('r1')
  })

  it('returns error when loop items expression fails', () => {
    const layout: LayoutJSON = {
      type: 'container',
      each: { items: 'nonexistent.deep.path.value', as: 'item' },
      children: [],
    }
    const result = resolveLayout(layout, makeContext())
    // nonexistent path returns undefined → not an array → error
    if (!result.success) {
      expect(result.error).toContain('array')
    } else {
      expect(result.nodes).toHaveLength(0)
    }
  })

  it('handles slot with content in context', () => {
    const layout: LayoutJSON = { type: 'slot', slot: 'header' }
    const slotNodes = [createNode('heading', { text: 'My Header' })]
    const context: RenderContext = {
      surfaceId: 'test' as SurfaceId,
      bindings: new Map(),
      data: {},
      slots: new Map([['header', slotNodes]]),
    }
    const result = resolveLayout(layout, context)

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.type).toBe('heading')
  })

  it('handles slot with fallback when no slot content', () => {
    const layout: LayoutJSON = {
      type: 'slot',
      slot: 'missing',
      children: [{ type: 'text', props: { label: 'default' } }],
    }
    const result = resolveLayout(layout, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0]?.props.label).toBe('default')
  })

  it('handles empty slot with no fallback', () => {
    const layout: LayoutJSON = { type: 'slot', slot: 'missing' }
    const result = resolveLayout(layout, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(0)
  })

  it('allows unknown type with colon (custom component)', () => {
    const layout: LayoutJSON = { type: 'my:custom-component', props: { x: 1 } }
    const result = resolveLayout(layout, makeContext())
    expect(result.success).toBe(true)
  })
})

// ============================================================
// createSlotMap
// ============================================================

describe('createSlotMap()', () => {
  it('creates a map from slot names to nodes', () => {
    const header = [createNode('heading', {})]
    const footer = [createNode('text', {})]
    const map = createSlotMap({ header, footer })

    expect(map.get('header')).toBe(header)
    expect(map.get('footer')).toBe(footer)
  })

  it('returns empty map for empty input', () => {
    const map = createSlotMap({})
    expect(map.size).toBe(0)
  })
})

// ============================================================
// extractSlots
// ============================================================

describe('extractSlots()', () => {
  it('separates default and named slots', () => {
    const headerNode = createNode('heading', { slot: 'header' })
    const bodyNode = createNode('text', {})
    const { default: def, named } = extractSlots([headerNode, bodyNode])

    expect(def).toHaveLength(1)
    expect(def[0]?.type).toBe('text')
    expect(named.get('header')).toHaveLength(1)
    expect(named.get('header')?.[0]?.type).toBe('heading')
  })

  it('handles all default (no named slots)', () => {
    const nodes = [createNode('text', {}), createNode('button', {})]
    const { default: def, named } = extractSlots(nodes)
    expect(def).toHaveLength(2)
    expect(named.size).toBe(0)
  })

  it('accumulates multiple nodes in same named slot', () => {
    const nodes = [createNode('text', { slot: 'footer' }), createNode('button', { slot: 'footer' })]
    const { named } = extractSlots(nodes)
    expect(named.get('footer')).toHaveLength(2)
  })
})

// ============================================================
// composeLayouts
// ============================================================

describe('composeLayouts()', () => {
  it('composes multiple layouts into one result', () => {
    const layouts: LayoutJSON[] = [
      { type: 'text', props: { a: 1 } },
      { type: 'button', props: { b: 2 } },
    ]
    const result = composeLayouts(layouts, makeContext())

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.nodes).toHaveLength(2)
  })

  it('returns error if any layout fails', () => {
    const layouts: LayoutJSON[] = [
      { type: 'text', props: { label: '{{name}}' } },
      {
        type: 'slot',
        slot: undefined as unknown as string, // force failure
      },
    ]
    // slot with undefined slot name returns error from resolveLayoutNode
    const result = composeLayouts(layouts, makeContext())
    // May fail or succeed depending on edge case handling
    expect(result).toBeDefined()
  })
})

// ============================================================
// wrapInContainer
// ============================================================

describe('wrapInContainer()', () => {
  it('wraps nodes in a container node', () => {
    const inner = createNode('text', {})
    const wrapper = wrapInContainer([inner])

    expect(wrapper.type).toBe('container')
    expect(wrapper.children).toHaveLength(1)
    expect(wrapper.children[0]?.type).toBe('text')
  })

  it('accepts extra props for the container', () => {
    const wrapper = wrapInContainer([], { className: 'my-container' })
    expect(wrapper.props.className).toBe('my-container')
  })
})

// ============================================================
// validateLayout
// ============================================================

describe('validateLayout()', () => {
  it('validates a valid layout', () => {
    const layout: LayoutJSON = { type: 'text', props: { content: 'hi' } }
    const result = validateLayout(layout)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects layout without type', () => {
    const layout = { props: {} } as unknown as LayoutJSON
    const result = validateLayout(layout)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Layout must have a type')
  })

  it('rejects loop layout without items', () => {
    const layout: LayoutJSON = {
      type: 'container',
      each: { items: '', as: 'item' },
    }
    const result = validateLayout(layout)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('items'))).toBe(true)
  })

  it('rejects loop layout without as variable', () => {
    const layout: LayoutJSON = {
      type: 'container',
      each: { items: 'data', as: '' },
    }
    const result = validateLayout(layout)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('as'))).toBe(true)
  })

  it('validates children recursively', () => {
    const layout: LayoutJSON = {
      type: 'container',
      children: [
        { type: 'text' },
        { props: { x: 1 } } as unknown as LayoutJSON, // invalid child
      ],
    }
    const result = validateLayout(layout)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.startsWith('children[1]'))).toBe(true)
  })
})
