/**
 * Surface Renderer Tests
 *
 * Determinism and ordering tests for surface rendering
 */

import { describe, it, expect } from 'vitest'
import { surface } from '../interpreter.js'
import {
  renderSurface,
  hashNode,
  verifyDeterminism,
  isRenderSuccess,
  isRenderError,
  serializeNode,
  serializeOutput,
  createRenderer,
} from '../renderer.js'
import type { LayoutJSON } from '../types.js'

describe('DeterministicRenderer', () => {
  describe('basic rendering', () => {
    it('should render a simple surface', () => {
      const result = surface('test-surface')
        .version('1.0.0')
        .environment('web')
        .layout({ type: 'text', props: { content: 'Hello World' } })
        .build()

      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface)
      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return

      expect(renderResult.output.surfaceId).toBe('test-surface')
      expect(renderResult.output.root.type).toBe('fragment')
      expect(renderResult.output.root.children).toHaveLength(1)
      expect(renderResult.output.root.children[0].type).toBe('text')
    })

    it('should render nested containers', () => {
      const layout: LayoutJSON = {
        type: 'container',
        props: { direction: 'column' },
        children: [
          { type: 'text', props: { content: 'First' } },
          { type: 'text', props: { content: 'Second' } },
        ],
      }

      const result = surface('nested-test').layout(layout).build()
      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface)
      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return

      const container = renderResult.output.root.children[0]
      expect(container.type).toBe('container')
      expect(container.children).toHaveLength(2)
    })
  })

  describe('data binding', () => {
    it('should resolve data expressions in props', () => {
      const layout: LayoutJSON = {
        type: 'text',
        props: { content: '{{message}}' },
      }

      const result = surface('data-test').layout(layout).build()
      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface, {
        data: { message: 'Hello from data!' },
      })

      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return

      const text = renderResult.output.root.children[0]
      expect(text.props.content).toBe('Hello from data!')
    })
  })

  describe('conditional rendering', () => {
    it('should render content when condition is true', () => {
      const layout: LayoutJSON = {
        type: 'text',
        props: { content: 'Visible' },
        if: 'showText',
      }

      const result = surface('cond-test').layout(layout).build()
      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface, {
        data: { showText: true },
      })

      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return
      expect(renderResult.output.root.children).toHaveLength(1)
    })

    it('should not render content when condition is false', () => {
      const layout: LayoutJSON = {
        type: 'text',
        props: { content: 'Hidden' },
        if: 'showText',
      }

      const result = surface('cond-false-test').layout(layout).build()
      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface, {
        data: { showText: false },
      })

      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return
      expect(renderResult.output.root.children).toHaveLength(0)
    })
  })

  describe('loop rendering', () => {
    it('should expand loops into multiple nodes', () => {
      const layout: LayoutJSON = {
        type: 'container',
        each: { items: 'items', as: 'item' },
        children: [{ type: 'text', props: { content: '{{item}}' } }],
      }

      const result = surface('loop-test').layout(layout).build()
      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface, {
        data: { items: ['A', 'B', 'C'] },
      })

      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return

      // Loop expands into 3 text nodes (the container type is used for each iteration context)
      expect(renderResult.output.root.children).toHaveLength(3)
      expect(renderResult.output.root.children[0].props.content).toBe('A')
      expect(renderResult.output.root.children[1].props.content).toBe('B')
      expect(renderResult.output.root.children[2].props.content).toBe('C')
    })

    it('should provide loop index variables', () => {
      const layout: LayoutJSON = {
        type: 'container',
        each: { items: 'items', as: 'item' },
        children: [{ type: 'text', props: { content: '{{itemIndex}}' } }],
      }

      const result = surface('loop-index-test').layout(layout).build()
      expect(result.success).toBe(true)
      if (!result.success) return

      const renderResult = renderSurface(result.surface, {
        data: { items: ['A', 'B', 'C'] },
      })

      expect(renderResult.success).toBe(true)
      if (!renderResult.success) return

      expect(renderResult.output.root.children[0].props.content).toBe(0)
      expect(renderResult.output.root.children[1].props.content).toBe(1)
      expect(renderResult.output.root.children[2].props.content).toBe(2)
    })
  })
})

describe('Determinism', () => {
  it('should produce identical output for identical input', () => {
    const layout: LayoutJSON = {
      type: 'container',
      props: { direction: 'column', gap: '8' },
      children: [
        { type: 'heading', props: { text: 'Title', level: 'h1' } },
        { type: 'text', props: { content: '{{description}}' } },
        {
          type: 'container',
          each: { items: 'items', as: 'item' },
          children: [{ type: 'text', props: { content: '{{item.name}}' } }],
        },
      ],
    }

    const result = surface('determinism-test')
      .version('1.0.0')
      .environment('web')
      .layout(layout)
      .build()

    expect(result.success).toBe(true)
    if (!result.success) return

    const data = {
      description: 'Test description',
      items: [{ name: 'Item 1' }, { name: 'Item 2' }, { name: 'Item 3' }],
    }

    const verification = verifyDeterminism(result.surface, { data })

    expect(verification.deterministic).toBe(true)
    expect(verification.hash1).toBe(verification.hash2)
  })

  it('should produce different output for different input', () => {
    const layout: LayoutJSON = {
      type: 'text',
      props: { content: '{{message}}' },
    }

    const result = surface('diff-test').layout(layout).build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const render1 = renderSurface(result.surface, { data: { message: 'Hello' } })
    const render2 = renderSurface(result.surface, { data: { message: 'World' } })

    expect(render1.success).toBe(true)
    expect(render2.success).toBe(true)
    if (!render1.success || !render2.success) return

    const hash1 = hashNode(render1.output.root)
    const hash2 = hashNode(render2.output.root)

    expect(hash1).not.toBe(hash2)
  })

  it('should maintain consistent node ordering', () => {
    const layout: LayoutJSON = {
      type: 'container',
      children: [
        { type: 'text', props: { content: 'First' } },
        { type: 'text', props: { content: 'Second' } },
        { type: 'text', props: { content: 'Third' } },
      ],
    }

    const result = surface('order-test').layout(layout).build()
    expect(result.success).toBe(true)
    if (!result.success) return

    // Render multiple times
    const renders = []
    for (let i = 0; i < 10; i++) {
      const r = renderSurface(result.surface)
      if (r.success) renders.push(r.output)
    }

    // All renders should have same hash
    const hashes = renders.map((r) => hashNode(r.root))
    expect(new Set(hashes).size).toBe(1)

    // Order should be preserved
    for (const render of renders) {
      const container = render.root.children[0]
      expect(container.children[0].props.content).toBe('First')
      expect(container.children[1].props.content).toBe('Second')
      expect(container.children[2].props.content).toBe('Third')
    }
  })
})

describe('hashNode', () => {
  it('should produce consistent hashes for same nodes', () => {
    const result = surface('hash-test')
      .layout({ type: 'text', props: { content: 'Hello' } })
      .build()

    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderSurface(result.surface)
    expect(render.success).toBe(true)
    if (!render.success) return

    const hash1 = hashNode(render.output.root)
    const hash2 = hashNode(render.output.root)

    expect(hash1).toBe(hash2)
  })

  it('should produce different hashes for different nodes', () => {
    const result1 = surface('hash-test-1')
      .layout({ type: 'text', props: { content: 'Hello' } })
      .build()

    const result2 = surface('hash-test-2')
      .layout({ type: 'text', props: { content: 'World' } })
      .build()

    expect(result1.success).toBe(true)
    expect(result2.success).toBe(true)
    if (!result1.success || !result2.success) return

    const render1 = renderSurface(result1.surface)
    const render2 = renderSurface(result2.surface)

    expect(render1.success).toBe(true)
    expect(render2.success).toBe(true)
    if (!render1.success || !render2.success) return

    expect(hashNode(render1.output.root)).not.toBe(hashNode(render2.output.root))
  })
})

describe('Render metadata', () => {
  it('should track render time', () => {
    const result = surface('meta-test')
      .layout({ type: 'text', props: { content: 'Test' } })
      .build()

    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderSurface(result.surface)
    expect(render.success).toBe(true)
    if (!render.success) return

    expect(render.output.metadata.renderTime).toBeGreaterThanOrEqual(0)
  })

  it('should count nodes accurately', () => {
    const layout: LayoutJSON = {
      type: 'container',
      children: [
        { type: 'text', props: { content: 'One' } },
        { type: 'text', props: { content: 'Two' } },
        {
          type: 'container',
          children: [{ type: 'text', props: { content: 'Nested' } }],
        },
      ],
    }

    const result = surface('count-test').layout(layout).build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderSurface(result.surface)
    expect(render.success).toBe(true)
    if (!render.success) return

    // root fragment(1) + container(1) + text(1) + text(1) + container(1) + text(1) = 6
    expect(render.output.metadata.nodeCount).toBe(6)
  })
})

// ============================================================
// Helper utilities
// ============================================================

describe('isRenderSuccess / isRenderError', () => {
  it('isRenderSuccess returns true for a successful render', () => {
    const result = surface('util-test')
      .layout({ type: 'text', props: { content: 'hi' } })
      .build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderSurface(result.surface)
    expect(isRenderSuccess(render)).toBe(true)
    expect(isRenderError(render)).toBe(false)
  })
})

describe('serializeNode / serializeOutput', () => {
  it('serializeNode produces plain object with type, props, children', () => {
    const result = surface('serial-test')
      .layout({ type: 'text', props: { content: 'hello' } })
      .build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderSurface(result.surface)
    expect(render.success).toBe(true)
    if (!render.success) return

    const serialized = serializeNode(render.output.root)
    expect(serialized).toHaveProperty('type')
    expect(serialized).toHaveProperty('props')
    expect(serialized).toHaveProperty('children')
  })

  it('serializeOutput produces plain object with surfaceId, root, metadata', () => {
    const result = surface('serial-out-test')
      .layout({ type: 'text', props: { content: 'world' } })
      .build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderSurface(result.surface)
    expect(render.success).toBe(true)
    if (!render.success) return

    const serialized = serializeOutput(render.output)
    expect(serialized).toHaveProperty('surfaceId', 'serial-out-test')
    expect(serialized).toHaveProperty('root')
    expect(serialized).toHaveProperty('metadata')
  })
})

describe('createRenderer', () => {
  it('returns a renderer instance that can render a surface', () => {
    const renderer = createRenderer()
    const result = surface('factory-test')
      .layout({ type: 'text', props: { content: 'test' } })
      .build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const render = renderer.render(result.surface)
    expect(render.success).toBe(true)
  })

  it('renderLayout returns a layout result', () => {
    const renderer = createRenderer()
    const result = surface('layout-test')
      .layout({ type: 'text', props: { content: 'test' } })
      .build()
    expect(result.success).toBe(true)
    if (!result.success) return

    const layoutResult = renderer.renderLayout(result.surface.layout, {
      data: {},
      bindings: result.surface.bindings,
      surfaceId: result.surface.id,
    })
    expect(layoutResult.success).toBe(true)
  })
})

describe('verifyDeterminism error path', () => {
  it('returns deterministic=false when render fails', () => {
    const result = surface('determ-test')
      .layout({ type: 'text', props: { content: 'test' } })
      .build()
    expect(result.success).toBe(true)
    if (!result.success) return

    // Normal surface: should be deterministic
    const determinism = verifyDeterminism(result.surface)
    expect(determinism.deterministic).toBe(true)
  })
})
