// @vitest-environment jsdom
/**
 * Another page in the same mount (`pageKey`) keeps the blocks both pages
 * draw — an app layout's (receipt §4) — mounted, and starts the page's own
 * state from its seeds, as a fresh mount would.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-page-change-keeps-layout.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())

const L = DEFAULT_BLOCK_LAYOUT

const Btn = ({ block, props }: { block: Block; props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button type="button" data-testid={block.id} onClick={() => emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}>
      {String(props.label ?? '')}
    </button>
  )
}
const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => (
  <div data-testid={block.id}>{String(props.text ?? '')}</div>
)
/** A block with state of its own: an open menu. */
const Menu = ({ block }: { block: Block }) => {
  const [open, setOpen] = React.useState(false)
  return (
    <button type="button" data-testid={block.id} onClick={() => setOpen(true)}>
      {open ? 'open' : 'closed'}
    </button>
  )
}
const Section = ({ children }: { children?: React.ReactNode }) => <section>{children}</section>
const components: Partial<BlockComponentRegistry> = { button: Btn as never, text: Text as never, menu: Menu as never, section: Section as never }

/** A page assembled into a layout: the menu, then the page's blocks inside `main`. */
const page = (key: string, count: string): never =>
  ({
    id: 'app',
    blocks: [
      { id: 'menu', type: 'menu', layout: L, props: {} },
      {
        id: 'main',
        type: 'section',
        layout: L,
        children: [
          { id: `${key}-count`, type: 'text', layout: L, props: { text: `n={{state.n}}` } },
          { id: `${key}-inc`, type: 'button', layout: L, props: { label: '+', action: { type: 'setState', key: 'n', value: '{{state.n + 1}}' } } },
        ],
      },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { initialState: { n: Number(count) } } }],
  }) as never

describe('another page in the same mount', () => {
  it('keeps the layout blocks mounted and their own state, and seeds the new page afresh', async () => {
    const view = (key: string, n: string) => <DataBoundSurfaceRenderer surface={page(key, n)} pageKey={key} components={components} interactionMode="live" loadingStrategy="immediate" />
    const { rerender } = render(view('a', '1'))
    await waitFor(() => expect(screen.getByTestId('a-count').textContent).toBe('n=1'))
    const menu = screen.getByTestId('menu')
    await act(async () => menu.click())
    await act(async () => screen.getByTestId('a-inc').click())
    await waitFor(() => expect(screen.getByTestId('a-count').textContent).toBe('n=2'))

    rerender(view('b', '1'))
    await waitFor(() => expect(screen.getByTestId('b-count').textContent).toBe('n=1'))
    expect(screen.queryByTestId('a-count')).toBeNull()
    // The layout's block: the same element, its own state kept.
    expect(screen.getByTestId('menu')).toBe(menu)
    expect(menu.textContent).toBe('open')
  })

  it('keeps page state when the page key stays (an update of the same page)', async () => {
    const view = (n: string) => <DataBoundSurfaceRenderer surface={page('a', n)} pageKey="a" components={components} interactionMode="live" />
    const { rerender } = render(view('1'))
    await waitFor(() => expect(screen.getByTestId('a-count').textContent).toBe('n=1'))
    await act(async () => screen.getByTestId('a-inc').click())
    await waitFor(() => expect(screen.getByTestId('a-count').textContent).toBe('n=2'))
    rerender(view('1'))
    expect(screen.getByTestId('a-count').textContent).toBe('n=2')
  })
})
