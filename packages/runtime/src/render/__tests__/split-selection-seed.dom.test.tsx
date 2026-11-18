// @vitest-environment jsdom
/**
 * payments-api-docs `#/reference?endpoint=nope`: the split view selects
 * nothing (right), and its empty text took the "Pick an entry" branch of
 * `{{state.endpoint ? 'There is no such entry…' : 'Pick an entry…'}}`, as if
 * `state.endpoint` were never seeded from the address.
 *
 * It is seeded, before the first expression is evaluated: the first render
 * reads `nope`. What follows is the split shell holding its selection as page
 * state — the shown item's id, or `null` when the address names an item it
 * does not have (data-protocol §1.1, 6) — so once it mounts `state.endpoint`
 * is `null`, exactly as when the address names nothing. A page cannot tell
 * the two apart from that key: the receipt's condition is the app's to change.
 *
 * @module @pwfabric/runtime/render/__tests__/split-selection-seed.dom
 */
import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useShellSelection } from '../shell-selection.js'
import type { SurfaceAddress } from '../address.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(cleanup)

const firstTexts: string[] = []
const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => {
  const text = String(props.text ?? '')
  if (firstTexts.length === 0) firstTexts.push(text)
  return <div data-testid={block.id}>{text}</div>
}
// The split view's selection, as the foundation block holds it: its rows' ids, no fallback (it has an empty text).
const Split = () => {
  const [selected] = useShellSelection('endpoint', { ids: ['create-payment', 'create-refund'] })
  return <div data-testid="split">{selected ?? 'none'}</div>
}
const components: Partial<BlockComponentRegistry> = { text: Text as never, split: Split as never }

const address = (query: string): SurfaceAddress => ({ query: () => query, writeQuery: () => undefined, notFound: () => undefined })

function page(initialState: Record<string, unknown>): never {
  return {
    id: 'reference',
    blocks: [
      { id: 'split', type: 'split', layout: DEFAULT_BLOCK_LAYOUT, props: {} },
      { id: 'empty', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { text: "{{state.endpoint ? 'named:' + state.endpoint : 'pick'}}" } },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { initialState } }],
  } as never
}

describe('a split view opened on an address naming an entry it does not have', () => {
  it('the address seed is in the first render; the split shell then holds null, as for no address', () => {
    firstTexts.length = 0
    // The runner merges the address seed into initialState before the first render (envelope §4).
    render(<DataBoundSurfaceRenderer surface={page({ endpoint: 'nope' })} components={components} address={address('endpoint=nope')} />)
    expect(firstTexts[0]).toBe('named:nope')
    expect(screen.getByTestId('split').textContent).toBe('none')
    expect(screen.getByTestId('empty').textContent).toBe('pick')
  })

  it('a known entry stays selected and readable', () => {
    render(
      <DataBoundSurfaceRenderer surface={page({ endpoint: 'create-refund' })} components={components} address={address('endpoint=create-refund')} />
    )
    expect(screen.getByTestId('split').textContent).toBe('create-refund')
    expect(screen.getByTestId('empty').textContent).toBe('named:create-refund')
  })
})
