// @vitest-environment jsdom
/**
 * A breakpoint change re-renders the page; it does not remount it.
 *
 * Reported: "resizing the viewport resets every state key to initialState".
 * Measured: the runtime keeps page state across a breakpoint change (this
 * file); the reset came from `pwf dev` reloading the page when a screenshot
 * was written into the app folder (cli dev/server). This guards the runtime
 * half: state written by a click survives lg → xs → lg, and the layout still
 * follows the breakpoint.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-viewport-keeps-state.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block, BreakpointName } from '@pwfabric/core'
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
const components: Partial<BlockComponentRegistry> = { button: Btn as never, text: Text as never }

const surface = (): never =>
  ({
    id: 'cart',
    blocks: [
      { id: 'count', type: 'text', layout: L, props: { text: 'lines={{length(state.lines)}}' } },
      {
        id: 'rm',
        type: 'button',
        layout: L,
        props: { label: 'Remove', action: { type: 'setState', key: 'lines', value: '{{state.lines.slice(1)}}' } },
      },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { initialState: { lines: ['a', 'b'] } } }],
  }) as never

describe('a breakpoint change keeps page state', () => {
  it('state written before lg → xs → lg is still there, and the layout follows the breakpoint', async () => {
    const page = (viewport: BreakpointName) => (
      <DataBoundSurfaceRenderer surface={surface()} components={components} interactionMode="live" viewport={viewport} />
    )
    const { rerender, container } = render(page('lg'))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('lines=2'))
    const node = screen.getByTestId('count')
    await act(async () => screen.getByTestId('rm').click())
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('lines=1'))

    rerender(page('xs'))
    expect(container.querySelector('[data-viewport]')?.getAttribute('data-viewport')).toBe('xs')
    expect(screen.getByTestId('count').textContent).toBe('lines=1')

    rerender(page('lg'))
    expect(container.querySelector('[data-viewport]')?.getAttribute('data-viewport')).toBe('lg')
    expect(screen.getByTestId('count').textContent).toBe('lines=1')
    // Same element: re-rendered, never remounted.
    expect(screen.getByTestId('count')).toBe(node)
  })
})
