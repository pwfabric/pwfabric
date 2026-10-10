// @vitest-environment jsdom
/**
 * SurfaceRenderer — block-wrapper decoration seam (ADR render-unification).
 *
 * Proves the additive seam: with no `renderBlockWrapper` the runtime renders
 * the default wrapper (now carrying the unified `data-block-id` alongside the
 * deprecated `data-block-wrapper`); with a decorator supplied the editor owns
 * the wrapper and receives the runtime-computed `wrapperProps.style`. Also
 * covers unknown-block child rendering and `interactionMode`: `onEvent` always
 * fires (notification) while `context.interactionMode` is exposed to blocks so
 * they can gate real side-effects.
 *
 * @module @pwfabric/runtime/render/__tests__/renderer-seam.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SurfaceRenderer } from '../renderer.js'
import { DynamicArtifactProvider } from '../dynamic-artifact-context.js'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import type {
  RenderableSurface,
  BlockComponentRegistry,
  BlockWrapperRenderArgs,
} from '../types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const textBlock: Block = {
  id: 'text-1',
  type: 'text',
  layout: DEFAULT_BLOCK_LAYOUT,
  props: { content: 'Hello' },
}

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="text-block">{String(props.content ?? '')}</p>
  )) as never,
  button: (({ props, context }: { props: Record<string, unknown>; context: unknown }) => (
    <button
      type="button"
      data-testid="button-block"
      onClick={() => {
        const ctx = context as { onEvent?: (e: unknown) => void }
        ctx.onEvent?.({ type: 'click', label: props.label })
      }}
    >
      {String(props.label ?? 'Button')}
    </button>
  )) as never,
}

describe('decoration seam — default (no renderBlockWrapper)', () => {
  it('emits the unified data-block-id alongside the deprecated data-block-wrapper, with layout style intact', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)

    const byId = container.querySelector('[data-block-id="text-1"]')
    const byWrapper = container.querySelector('[data-block-wrapper="text-1"]')
    expect(byId).not.toBeNull()
    expect(byWrapper).not.toBeNull()
    // Same element carries both (alias) — byte-identical wrapper + the new id.
    expect(byId).toBe(byWrapper)
    // Runtime-computed layout is still applied to the default wrapper.
    expect((byId as HTMLElement).style.gridColumn).toContain('span')
    // Block content still renders inside.
    expect(screen.getByTestId('text-block').textContent).toBe('Hello')
  })
})

describe('decoration seam — decorator supplied', () => {
  it('invokes renderBlockWrapper per block, replaces the default div, and forwards the runtime-computed style', () => {
    const seen: BlockWrapperRenderArgs[] = []
    const renderBlockWrapper = (args: BlockWrapperRenderArgs): React.ReactNode => {
      seen.push(args)
      return (
        <div
          data-testid="decorated"
          data-deco-id={args.wrapperProps['data-block-id']}
          style={args.wrapperProps.style}
        >
          {args.children}
        </div>
      )
    }

    const surface: RenderableSurface = {
      blocks: [textBlock, { ...textBlock, id: 'text-2', props: { content: 'Two' } }],
    }
    const { container } = render(
      <SurfaceRenderer
        surface={surface}
        components={components}
        renderBlockWrapper={renderBlockWrapper}
      />
    )

    // Called once per top-level block, with the runtime-computed layout style.
    expect(seen).toHaveLength(2)
    expect(seen[0]!.wrapperProps['data-block-id']).toBe('text-1')
    expect(String(seen[0]!.wrapperProps.style?.gridColumn ?? '')).toContain('span')

    // Decorator output replaced the default wrapper div entirely.
    expect(container.querySelectorAll('[data-testid="decorated"]')).toHaveLength(2)
    expect(container.querySelector('[data-block-wrapper="text-1"]')).toBeNull()
    expect(container.querySelector('[data-deco-id="text-2"]')).not.toBeNull()
    // The real block content is still rendered inside the decorator.
    expect(screen.getAllByTestId('text-block')).toHaveLength(2)
  })
})

describe('unknown block', () => {
  it('renders its children so the editor tree stays navigable', () => {
    const surface: RenderableSurface = {
      blocks: [
        {
          id: 'mystery-1',
          type: 'mystery-widget', // no component registered → unknown path
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          children: [textBlock],
        },
      ],
    }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)

    expect(container.querySelector('[data-unknown-type="mystery-widget"]')).not.toBeNull()
    // No visible "Unknown block" placeholder text on published/preview surfaces.
    expect(container.textContent).not.toContain('Unknown block')
    // Child still renders (navigable subtree).
    expect(screen.getByTestId('text-block').textContent).toBe('Hello')
  })
})

describe('interactionMode', () => {
  const buttonBlock: Block = {
    id: 'btn-1',
    type: 'button',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { label: 'Go' },
  }

  it('live (default) forwards block-dispatched events to onEvent', async () => {
    const onEvent = vi.fn()
    render(
      <SurfaceRenderer
        surface={{ blocks: [buttonBlock] }}
        components={components}
        onEvent={onEvent}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('inert STILL forwards onEvent (a pure notification) — only real side-effects are gated', async () => {
    // onEvent is a notification, not a side-effect: it always fires so the host
    // (editor/preview) can react (e.g. show a toast / drive selection). What
    // `inert` gates is real side-effects, which blocks read via
    // `context.interactionMode` (see the interactionMode-context test below).
    const onEvent = vi.fn()
    render(
      <SurfaceRenderer
        surface={{ blocks: [buttonBlock] }}
        components={components}
        onEvent={onEvent}
        interactionMode="inert"
      />
    )
    await userEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(onEvent).toHaveBeenCalledTimes(1)
  })

  it('exposes interactionMode to block components via context (so blocks can gate side-effects)', () => {
    const seen: Array<string | undefined> = []
    const probe: Partial<BlockComponentRegistry> = {
      button: (({ context }: { context: unknown }) => {
        seen.push((context as { interactionMode?: string }).interactionMode)
        return <span data-testid="probe" />
      }) as never,
    }
    // inert
    render(
      <SurfaceRenderer
        surface={{ blocks: [buttonBlock] }}
        components={probe}
        interactionMode="inert"
      />
    )
    expect(seen).toContain('inert')
    cleanup()
    seen.length = 0
    // live (default)
    render(<SurfaceRenderer surface={{ blocks: [buttonBlock] }} components={probe} />)
    expect(seen).toContain('live')
  })
})

describe('weighted columns — row-container child flex hints', () => {
  // A row container whose two children declare arbitrary `style.flex` ratios.
  // The integer-span model can only express k/12 ratios; authored flex lets a
  // child express an arbitrary one (here 1.62 : 1). The wrapper is the flex
  // item, so the flex hint must reach the WRAPPER, overriding the span-derived
  // default rowChildStyle.
  const weightedRow: Block = {
    id: 'row-1',
    type: 'container',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { direction: 'row' },
    children: [
      {
        id: 'col-major',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: 'Major' },
        style: { flex: '1.62 1 0' },
      },
      {
        id: 'col-minor',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: 'Minor' },
        style: { flex: '1 1 0' },
      },
    ],
  }

  it('hoists authored flex to the child wrappers, expressing the exact 1.62:1 ratio', () => {
    const seen = new Map<string, BlockWrapperRenderArgs>()
    const renderBlockWrapper = (args: BlockWrapperRenderArgs): React.ReactNode => {
      seen.set(String(args.wrapperProps['data-block-id']), args)
      return (
        <div data-block-id={args.wrapperProps['data-block-id']} style={args.wrapperProps.style}>
          {args.children}
        </div>
      )
    }

    render(
      <SurfaceRenderer
        surface={{ blocks: [weightedRow] }}
        components={components}
        renderBlockWrapper={renderBlockWrapper}
      />
    )

    const major = seen.get('col-major')!.wrapperProps.style as React.CSSProperties
    const minor = seen.get('col-minor')!.wrapperProps.style as React.CSSProperties

    // Authored flex shorthand landed on the wrapper (the flex item) verbatim.
    expect(major.flex).toBe('1.62 1 0')
    expect(minor.flex).toBe('1 1 0')

    // The authored hint REPLACES the span-derived default: neither wrapper carries
    // the equal-distribution {flexGrow:1, flexBasis:'0'} fallback as separate props.
    expect(major.flexBasis).toBeUndefined()
    expect(major.flexGrow).toBeUndefined()
    expect(minor.flexBasis).toBeUndefined()
  })

  it('renders the flex ratio onto the real DOM wrapper (default wrapper path)', () => {
    const { container } = render(
      <SurfaceRenderer surface={{ blocks: [weightedRow] }} components={components} />
    )
    const major = container.querySelector('[data-block-id="col-major"]') as HTMLElement
    const minor = container.querySelector('[data-block-id="col-minor"]') as HTMLElement
    expect(major).not.toBeNull()
    expect(minor).not.toBeNull()
    // jsdom expands the `flex` shorthand into longhands on the style object.
    expect(major.style.flexGrow).toBe('1.62')
    expect(minor.style.flexGrow).toBe('1')
  })

  it('falls back to span-derived distribution when no flex hint is present', () => {
    const plainRow: Block = {
      ...weightedRow,
      id: 'row-2',
      children: [
        { id: 'p-1', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content: 'A' } },
        { id: 'p-2', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content: 'B' } },
      ],
    }
    const seen = new Map<string, BlockWrapperRenderArgs>()
    const renderBlockWrapper = (args: BlockWrapperRenderArgs): React.ReactNode => {
      seen.set(String(args.wrapperProps['data-block-id']), args)
      return <div style={args.wrapperProps.style}>{args.children}</div>
    }
    render(
      <SurfaceRenderer
        surface={{ blocks: [plainRow] }}
        components={components}
        renderBlockWrapper={renderBlockWrapper}
      />
    )
    // Default full-span children → equal distribution preserved (unchanged behavior).
    const a = seen.get('p-1')!.wrapperProps.style as React.CSSProperties
    expect(a.flexGrow).toBe(1)
    expect(a.flexBasis).toBe('0')
    expect(a.flex).toBeUndefined()
  })
})

describe('dynamic block layout (regression)', () => {
  it('applies grid-column span to the DYNAMIC-block wrapper — full-span sections must stack, not auto-place side-by-side', () => {
    // Regression: dynamic (installed) blocks returned BEFORE layout was computed,
    // so their wrapper had no gridColumn → full-span sections collapsed side-by-side
    // in published/runtime render. Now every path applies computeBlockLayoutStyle.
    const descriptor: DynamicBlockDescriptor = {
      blockType: 'hero-x',
      moduleUrl: 'https://example.com/blocks/hero-x/1.0.0/dist/bundle.mjs',
      integrity: 'sha256-abc',
      publisher: 'Test',
      publisherVerified: true,
      definition: {
        name: 'Hero',
        category: 'layout',
        defaultProps: {},
        canHaveChildren: true,
        propertySchema: [],
      },
    }
    const surface: RenderableSurface = {
      blocks: [{ id: 'hero-1', type: 'hero-x', layout: DEFAULT_BLOCK_LAYOUT, props: {} }],
    }
    const { container } = render(
      <DynamicArtifactProvider dynamicBlocks={[descriptor]}>
        <SurfaceRenderer surface={surface} components={components} />
      </DynamicArtifactProvider>
    )
    const wrapper = container.querySelector('[data-dynamic-block="hero-x"]') as HTMLElement | null
    expect(wrapper).not.toBeNull()
    expect(wrapper!.style.gridColumn).toContain('span')
  })
})

/**
 * Fragment anchors.
 *
 * A wrapper that carries `data-block-id` and no `id` gives the browser nothing
 * to scroll to, so every `#`-fragment link would be dead. A same-page table of
 * contents is basic to a documentation app.
 *
 * The block id is the anchor namespace rather than a new `anchor` prop: block
 * ids are already author-chosen strings, unique within a surface, and they are
 * what a fragment would name anyway.
 */
describe('fragment anchors', () => {
  it('emits the block id as a DOM id so `#text-1` reaches the block', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)

    const anchored = container.querySelector('#text-1')
    expect(anchored).not.toBeNull()
    // The SAME element the selectors already address — an anchor that landed on
    // a different node than the one styling targets would scroll to the wrong box.
    expect(anchored).toBe(container.querySelector('[data-block-id="text-1"]'))
  })

  it('hands the id to a decorator instead of emitting its own wrapper', () => {
    // Red when: the runtime emits a bare `id` div AND the editor emits its own,
    // putting two elements with the same id in one document. The editor owns the
    // wrapper; the runtime only states what the id should be.
    const seen: string[] = []
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(
      <SurfaceRenderer
        surface={surface}
        components={components}
        renderBlockWrapper={({ children, wrapperProps }: BlockWrapperRenderArgs) => {
          seen.push(String((wrapperProps as { id?: string }).id))
          return <section data-testid="decorated">{children}</section>
        }}
      />
    )
    expect(seen).toEqual(['text-1'])
    expect(container.querySelectorAll('#text-1')).toHaveLength(0)
  })
})
