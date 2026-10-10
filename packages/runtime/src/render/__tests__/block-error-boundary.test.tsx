/**
 * BlockErrorBoundary Tests
 *
 * @module @pwfabric/runtime/render/__tests__/block-error-boundary
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { BlockErrorBoundary } from '../BlockErrorBoundary.js'

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

  it('shows "Unknown error" when error is null', () => {
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
    expect(html).toContain('title="Unknown error"')
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
})
