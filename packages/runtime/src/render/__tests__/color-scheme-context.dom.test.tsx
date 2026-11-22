// @vitest-environment jsdom
/**
 * The visitor's colour scheme on every block's context (appearance §4.1):
 * `colorScheme` and `setColorScheme`, from the host's store — `"system"` in a
 * page rendered outside a browser (the first frame is every visitor's), the
 * store's choice in the browser, re-read when it changes.
 */
import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { act, cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry, BlockContext, ColorScheme, ColorSchemeStore } from '../types.js'

afterEach(cleanup)

function store(initial: ColorScheme): ColorSchemeStore {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    scheme: () => current,
    set(next) {
      current = next
      for (const l of listeners) l()
    },
    subscribe(l) {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
}

const Toggle = ({ block, context }: { block: Block; context: BlockContext }) => (
  <button type="button" data-testid={block.id} onClick={() => context.setColorScheme?.(context.colorScheme === 'dark' ? 'light' : 'dark')}>
    {context.colorScheme ?? 'none'}
  </button>
)
const components = { toggle: Toggle } as unknown as BlockComponentRegistry
const surface = { id: 's', blocks: [{ id: 't', type: 'toggle', props: {}, layout: DEFAULT_BLOCK_LAYOUT }] }

describe('context.colorScheme', () => {
  it('is the store’s choice in the browser, and follows setColorScheme', async () => {
    render(<DataBoundSurfaceRenderer surface={surface as never} components={components} colorScheme={store('dark')} />)
    expect(screen.getByTestId('t').textContent).toBe('dark')
    await act(async () => screen.getByTestId('t').click())
    expect(screen.getByTestId('t').textContent).toBe('light')
  })

  it('is "system" in a page rendered outside a browser', () => {
    const html = renderToString(<DataBoundSurfaceRenderer surface={surface as never} components={components} colorScheme={store('dark')} />)
    expect(html).toContain('>system<')
  })

  it('is "system" without a store, and setColorScheme does nothing', async () => {
    render(<DataBoundSurfaceRenderer surface={surface as never} components={components} />)
    expect(screen.getByTestId('t').textContent).toBe('system')
    await act(async () => screen.getByTestId('t').click())
    expect(screen.getByTestId('t').textContent).toBe('system')
  })
})
