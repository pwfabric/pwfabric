// @vitest-environment jsdom
/**
 * SurfaceRenderer — REAL DOM render tests (@testing-library/react)
 *
 * The sibling `renderer.test.tsx` exercises the renderer via
 * `react-dom/server` `renderToString`, asserting on an HTML *string*.
 * That proves markup but never mounts a live component tree, so it
 * cannot observe effects, context propagation across a mounted tree,
 * error boundaries catching at runtime, or user interaction.
 *
 * This file mounts the renderer into a real jsdom DOM with
 * `@testing-library/react`, then queries the rendered DOM and drives
 * interactions with `@testing-library/user-event`.
 *
 * @module @pwfabric/runtime/render/__tests__/renderer.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SurfaceRenderer, BlockRenderer } from '../renderer.js'
import type { RenderableSurface, BlockComponentRegistry } from '../types.js'
import { EntitlementProvider } from '../capability-gate.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ============================================================
// FIXTURES
// ============================================================

const textBlock: Block = {
  id: 'text-1',
  type: 'text',
  layout: DEFAULT_BLOCK_LAYOUT,
  props: { content: 'Hello, DOM!' },
}

/** A custom component registry that renders real, queryable DOM. */
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
  // A component that always throws — proves the runtime error boundary.
  crasher: (() => {
    throw new Error('block exploded during render')
  }) as never,
}

// ============================================================
// MOUNT + QUERY
// ============================================================

describe('SurfaceRenderer — real DOM mount', () => {
  it('mounts the surface wrapper into the document', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)

    const root = container.querySelector('[data-pw-surface]')
    expect(root).not.toBeNull()
    expect(root?.hasAttribute('data-surface-renderer')).toBe(true)
  })

  it('renders custom block components as live DOM nodes', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    render(<SurfaceRenderer surface={surface} components={components} />)

    const node = screen.getByTestId('text-block')
    expect(node.textContent).toBe('Hello, DOM!')
    expect(node.tagName).toBe('P')
  })

  it('renders unregistered types without a visible placeholder', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    // No `components` map → text has no registered component.
    const { container } = render(<SurfaceRenderer surface={surface} />)

    // No visible "Unknown block" text leaks to end users…
    expect(container.textContent).not.toContain('Unknown block')
    // …but the wrapper is still tagged for diagnostics.
    expect(container.querySelector('[data-unknown-type="text"]')).not.toBeNull()
  })

  it('reflects the theme and viewport props onto the root DOM node', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(
      <SurfaceRenderer
        surface={surface}
        components={components}
        theme="dark"
        viewport="md"
      />
    )

    const root = container.querySelector('[data-pw-surface]')
    expect(root?.getAttribute('data-theme')).toBe('dark')
    expect(root?.getAttribute('data-viewport')).toBe('md')
  })

  it('injects the scoped box-sizing reset as the first child of the surface root', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)

    const root = container.querySelector('[data-pw-surface]')
    expect(root).not.toBeNull()

    // The base CSS standard ships from the runtime as a <style> element.
    const styleEl = root?.querySelector('style[data-pw-base-css]')
    expect(styleEl).not.toBeNull()

    // First child so it applies before any block paints.
    expect(root?.firstElementChild).toBe(styleEl)

    const css = styleEl?.textContent ?? ''
    // box-sizing does not inherit → a descendant selector is required, not
    // just the root. Assert the descendant rule + the border-box value, and
    // that the rule stays scoped to [data-pw-surface] (no global `*{}` leak).
    expect(css).toContain('box-sizing:border-box')
    expect(css).toContain('[data-pw-surface] *')
    expect(css).toContain('[data-pw-surface] *::before')
    expect(css).toContain('[data-pw-surface] *::after')
    // Scoping guard: every selector is prefixed with [data-pw-surface].
    expect(css).not.toMatch(/(^|[,{])\s*\*/)

    // iOS safe-area insets: the surface root takes the horizontal insets and
    // navbar/footer block roots take the vertical ones, so sticky navbars clear
    // the notch and trailing footers clear the home indicator. max(N,env) keeps
    // each ≥ its normal value when no inset exists (every published surface —
    // embed/preview/host app — inherits this from the runtime).
    expect(css).toContain('padding-left:max(0px,env(safe-area-inset-left))')
    expect(css).toContain('padding-right:max(0px,env(safe-area-inset-right))')
    expect(css).toContain('[data-pw-surface] [data-block-type="navbar"]')
    expect(css).toContain('padding-top:max(12px,env(safe-area-inset-top))')
    expect(css).toContain('[data-pw-surface] [data-block-type="footer"]')
    expect(css).toContain('padding-bottom:max(48px,env(safe-area-inset-bottom))')
    // Safe-area rules stay scoped to the surface subtree.
    expect(css).not.toMatch(/(^|})\s*\[data-block-type/)
  })

  it('ships a spring ENTRANCE keyframe (pw-spring-in) driven by the theme bounce easing', () => {
    // pw-bounce is a vertical LOOP and the bounce easing token had no entrance
    // animation to ride on, so delivered apps reached for pw-pulse instead
    //. The overshoot lives in the keyframe's own timing
    // function, so `animation: pw-spring-in .4s` springs even when the block
    // names no easing; the token stays themeable with the canonical fallback.
    const surface: RenderableSurface = { blocks: [textBlock] }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)
    const css = container.querySelector('style[data-pw-base-css]')?.textContent ?? ''
    const rule = /@keyframes pw-spring-in\{[^@]*\}/.exec(css)?.[0] ?? ''
    expect(rule).not.toBe('')
    expect(rule).toContain('from{')
    expect(rule).toContain('opacity:0')
    expect(rule).toContain('to{transform:scale(1);opacity:1}')
    expect(rule).toContain('animation-timing-function:var(--pw-easing-bounce,cubic-bezier(0.34, 1.56, 0.64, 1))')
    // Still beside the loop keyframe, both reduced-motion gated by the same rule.
    expect(css).toContain('@keyframes pw-bounce{')
    expect(css).toContain('@media (prefers-reduced-motion:reduce)')
  })

  it('binds the theme BODY FONT on the surface root, so the canvas matches publish', () => {
    // Only the published theme.css bound the body font (html,body); on the
    // canvas and in an embed a serif-bodied theme read in the host font.
    const surface: RenderableSurface = {
      blocks: [textBlock],
      appearance: {
        config: { theme: { typography: { fontFamily: '"EB Garamond", Georgia, serif', bodyLineHeight: '1.75' } } },
      },
    }
    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)
    const root = container.querySelector('[data-pw-surface]') as HTMLElement | null
    const css = root?.querySelector('style[data-pw-base-css]')?.textContent ?? ''
    const rootRule = /\[data-pw-surface\]\{background:[^}]*\}/.exec(css)?.[0] ?? ''
    expect(rootRule).toContain('font-family:var(--pw-font-family,inherit)')
    expect(rootRule).toContain('font-size:var(--pw-font-size-base,inherit)')
    expect(rootRule).toContain('line-height:var(--pw-line-height-body,inherit)')
    // The variable it reads carries the family on the same root.
    expect(root?.style.getPropertyValue('--pw-font-family')).toContain('EB Garamond')
  })

  it('puts the project dark overrides on top of the derived dark', () => {
    const surface: RenderableSurface = { blocks: [textBlock], appearance: { config: { theme: {} } } }
    const { container } = render(
      <SurfaceRenderer
        surface={surface}
        components={components}
        projectTheme={{ colors: { primary: '#22c55e' } }}
        projectDarkTheme={{ colors: { accent: '#a3e635' } }}
      />
    )
    const css = Array.from(container.querySelectorAll('style'))
      .map((el) => el.textContent ?? '')
      .join('\n')
    expect(css).toContain('--pw-color-accent:#a3e635 !important')
    expect(css).not.toContain('--pw-color-background:#ffffff !important')
  })
})

// ============================================================
// INTERACTION
// ============================================================

describe('SurfaceRenderer — user interaction', () => {
  it('routes a click on a rendered button block through the onEvent callback', async () => {
    const onEvent = vi.fn()
    const buttonBlock: Block = {
      id: 'btn-1',
      type: 'button',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { label: 'Submit' },
    }
    const surface: RenderableSurface = { blocks: [buttonBlock] }

    render(<SurfaceRenderer surface={surface} components={components} onEvent={onEvent} />)

    const button = screen.getByRole('button', { name: 'Submit' })
    await userEvent.click(button)

    expect(onEvent).toHaveBeenCalledTimes(1)
    expect(onEvent).toHaveBeenCalledWith({ type: 'click', label: 'Submit' })
  })
})

// ============================================================
// ERROR BOUNDARY — only observable in a live (mounted) tree
// ============================================================

describe('SurfaceRenderer — block error isolation', () => {
  it('catches a crashing block and renders the BlockErrorBoundary fallback', () => {
    // Error boundaries log via console.error; silence it for a clean run.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const crashBlock: Block = {
      id: 'crash-1',
      type: 'crasher',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
    }
    const surface: RenderableSurface = { blocks: [crashBlock, textBlock] }

    const { container } = render(<SurfaceRenderer surface={surface} components={components} />)

    // The crasher's slot shows the quiet fallback (no visible copy — the
    // message lives in the title tooltip), not a white-screen crash.
    const fallback = container.querySelector('[data-block-error="crash-1"]')
    expect(fallback).not.toBeNull()
    expect(fallback?.getAttribute('title')).toBeTruthy()
    // The sibling block still rendered — isolation held.
    expect(screen.getByTestId('text-block')).not.toBeNull()

    errSpy.mockRestore()
  })
})

// ============================================================
// ENTITLEMENT CONTEXT — propagation across the mounted tree
// ============================================================

describe('SurfaceRenderer — entitlement gating', () => {
  it('shows a gated placeholder for blocks not in the entitlement set', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }

    const { container } = render(
      <EntitlementProvider entitlements={{ blocks: ['heading'], capabilities: [] }}>
        <SurfaceRenderer surface={surface} components={components} />
      </EntitlementProvider>
    )

    // `text` is not entitled → placeholder, not the custom component.
    expect(container.querySelector('[data-gated-block="text"]')).not.toBeNull()
    expect(screen.queryByTestId('text-block')).toBeNull()
  })

  it('renders the real block when its type is entitled', () => {
    const surface: RenderableSurface = { blocks: [textBlock] }

    render(
      <EntitlementProvider entitlements={{ blocks: ['text'], capabilities: [] }}>
        <SurfaceRenderer surface={surface} components={components} />
      </EntitlementProvider>
    )

    expect(screen.getByTestId('text-block')).not.toBeNull()
  })
})

// ============================================================
// BlockRenderer (standalone, mounted)
// ============================================================

describe('BlockRenderer — real DOM mount', () => {
  it('mounts a single block without a surface wrapper', () => {
    const { container } = render(<BlockRenderer block={textBlock} components={components} />)

    expect(screen.getByTestId('text-block').textContent).toBe('Hello, DOM!')
    // No surface root element for a standalone block render.
    expect(container.querySelector('[data-pw-surface]')).toBeNull()
  })
})
