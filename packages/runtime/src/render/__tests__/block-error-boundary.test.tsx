/**
 * BlockErrorBoundary Tests
 *
 * @module @pwfabric/runtime/render/__tests__/block-error-boundary
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { BlockErrorBoundary, misfitProps } from '../BlockErrorBoundary.js'

// Suppress console.error from error boundary
afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================
// Helper component that throws
// ============================================================

function SafeComponent(): React.ReactElement {
  return React.createElement('div', null, 'safe content')
}

// ============================================================
// BlockErrorBoundary
// ============================================================

describe('BlockErrorBoundary', () => {
  it('renders children when no error', () => {
    const html = renderToString(
      React.createElement(
        BlockErrorBoundary,
        { blockId: 'blk-1', blockType: 'text' },
        React.createElement(SafeComponent)
      )
    )
    expect(html).toContain('safe content')
  })

  it('renders children content when no error occurs', () => {
    const html = renderToString(
      React.createElement(
        BlockErrorBoundary,
        { blockId: 'blk-safe', blockType: 'text' },
        React.createElement('span', null, 'child rendered')
      )
    )
    expect(html).toContain('child rendered')
  })

  it('getDerivedStateFromError returns hasError=true state', () => {
    const error = new Error('test error')
    const state = BlockErrorBoundary.getDerivedStateFromError(error)
    expect(state.hasError).toBe(true)
    expect(state.error).toBe(error)
  })

  it('renders error fallback UI when hasError=true', () => {
    // Subclass with error state pre-set to bypass the need for jsdom error triggering
    class ErrorStateBlockBoundary extends BlockErrorBoundary {
      constructor(props: ConstructorParameters<typeof BlockErrorBoundary>[0]) {
        super(props)
        this.state = { hasError: true, error: new Error('Render explosion') }
      }
    }

    const html = renderToString(
      React.createElement(
        ErrorStateBlockBoundary,
        { blockId: 'blk-err', blockType: 'heading' },
        React.createElement('div', null, 'child')
      )
    )

    // Quiet-shape contract: NO visible copy — the technical message lives in
    // the title tooltip, the block type in a data attribute.
    expect(html).toContain('data-block-error="blk-err"')
    expect(html).toContain('data-block-error-type="heading"')
    expect(html).toContain('title="Render explosion"')
    expect(html).not.toContain('>Render explosion<')
    expect(html).not.toContain('Block render error:')
  })

  it('writes no word of its own when the error has no message (E-4)', () => {
    class ErrorStateBoundary extends BlockErrorBoundary {
      constructor(props: ConstructorParameters<typeof BlockErrorBoundary>[0]) {
        super(props)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.state = { hasError: true, error: null as any }
      }
    }

    const html = renderToString(
      React.createElement(
        ErrorStateBoundary,
        { blockId: 'blk-noMsg', blockType: 'text' },
        React.createElement('div', null, 'child')
      )
    )

    expect(html).toContain('data-block-error="blk-noMsg"')
    expect(html).not.toContain('title=')
  })

  it('componentDidCatch logs error to console', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    // Instantiate directly to call componentDidCatch
    const instance = new BlockErrorBoundary({
      blockId: 'blk-direct',
      blockType: 'image',
      children: null,
    })

    const err = new Error('direct error')
    instance.componentDidCatch(err, { componentStack: '\n    at SomeComponent' })

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PWFabric] Block render error: image#blk-direct'),
      err,
      expect.any(String)
    )
  })

  describe('under pwf dev, a crash names the props that did not fit their shape', () => {
    const declared = [
      { name: 'items', jsonSchema: { type: 'array' as const, items: { type: 'object' as const, properties: { label: { type: 'string' as const } } } } },
      { name: 'title', jsonSchema: { type: 'string' as const } },
    ]
    afterEach(() => {
      delete (globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev
    })

    it('misfitProps lists the declared props whose value does not fit, by prop name', () => {
      expect(misfitProps({ items: 'oops', title: 'ok' }, declared)).toEqual(['items'])
      expect(misfitProps({ items: [{ label: { a: 1 } }], title: 'ok' }, declared)).toEqual(['items'])
      expect(misfitProps({ items: [], title: 'ok' }, declared)).toEqual([])
      expect(misfitProps({ items: 'x' }, undefined)).toEqual([])
    })

    it('warns with the misfit prop under pwf dev, and says nothing to a visitor', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const instance = new BlockErrorBoundary({ blockId: 'b1', blockType: 'list', children: null, props: { items: 'oops' }, declared })
      instance.componentDidCatch(new Error('items.map is not a function'), { componentStack: '' })
      expect(warn).not.toHaveBeenCalled()
      ;(globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev = true
      instance.componentDidCatch(new Error('items.map is not a function'), { componentStack: '' })
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toMatch(/block "list" \(#b1\) threw while "items" did not fit its declared shape/)
    })

    it('stays quiet under pwf dev when every prop fits (the crash is its own)', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      ;(globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev = true
      const instance = new BlockErrorBoundary({ blockId: 'b2', blockType: 'list', children: null, props: { items: [] }, declared })
      instance.componentDidCatch(new Error('boom'), { componentStack: '' })
      expect(warn).not.toHaveBeenCalled()
    })
  })
})
