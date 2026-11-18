// @vitest-environment jsdom
/**
 * Focus is kept when `visibleWhen` hides the focused block: a wizard's "Next"
 * hid its own step, and focus fell to `<body>`. It moves to the region that
 * just became visible — its first control, else its first heading.
 *
 * @module @pwfabric/runtime/render/__tests__/focus-keeper.dom
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
const Heading = ({ props }: { props: Record<string, unknown> }) => <h2>{String(props.text ?? '')}</h2>
const Input = ({ block }: { block: Block }) => <input data-testid={block.id} aria-label={block.id} />
const components: Partial<BlockComponentRegistry> = { button: Btn as never, heading: Heading as never, input: Input as never }

const step = (n: number, children: Block[]): Block =>
  ({ id: `step${n}`, type: 'section', layout: L, props: {}, visibleWhen: `{{state.step == ${n}}}`, children }) as Block

function wizard(second: Block[]): never {
  return {
    id: 'wizard',
    blocks: [
      step(1, [{ id: 'next', type: 'button', layout: L, props: { label: 'Next', action: { type: 'setState', key: 'step', value: 2 } } } as Block]),
      step(2, second),
    ],
    capabilities: [{ capability: 'platform/persistence', config: { initialState: { step: 1 } } }],
  } as never
}

const Section = ({ children }: { children?: React.ReactNode }) => <section>{children}</section>
;(components as Record<string, unknown>).section = Section

async function clickNext(): Promise<void> {
  await waitFor(() => expect(screen.queryByTestId('next')).not.toBeNull())
  const next = screen.getByTestId('next')
  next.focus()
  expect(document.activeElement).toBe(next)
  await act(async () => next.click())
}

describe('focus when visibleWhen hides the focused block', () => {
  it('moves to the first control of the step that appeared', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={wizard([
          { id: 'h', type: 'heading', layout: L, props: { text: 'Your details' } } as Block,
          { id: 'name', type: 'input', layout: L, props: {} } as Block,
        ])}
        components={components}
        interactionMode="live"
      />
    )
    await clickNext()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('name')))
  })

  it('moves to its heading when the step has no control', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={wizard([{ id: 'h', type: 'heading', layout: L, props: { text: 'Done' } } as Block])}
        components={components}
        interactionMode="live"
      />
    )
    await clickNext()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Done'))
    expect(document.activeElement?.getAttribute('tabindex')).toBe('-1')
  })
})
