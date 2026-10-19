// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — a static source's `query` is applied.
 *
 * The data protocol says the runtime applies a source's query to the rows it
 * has (data-protocol §3). A rest source's query was applied after the fetch;
 * a static source's was dropped when the source was mapped, so a static list
 * declared `sort: name asc` bound in written order and a `filter` showed
 * every row.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-static-query.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
})

const L = DEFAULT_BLOCK_LAYOUT

const TextBlock = ({ props }: { props: Record<string, unknown> }) => (
  <p data-testid={String(props.testId ?? 'text')}>{String(props.content ?? '')}</p>
)
const PlainButton = ({ context }: { context: { onEvent?: (e: unknown) => void } }) => (
  <button
    data-testid="plain"
    onClick={() => context.onEvent?.({ type: 'click', canonicalType: 'block:click', surfaceId: 's', blockId: 'plain', timestamp: Date.now() })}
  >
    plain
  </button>
)
const components: Partial<BlockComponentRegistry> = {
  text: TextBlock as never,
  'plain-button': PlainButton as never,
}

const rows = [
  { name: 'Fig', kind: 'fruit', price: 3 },
  { name: 'Apple', kind: 'fruit', price: 1 },
  { name: 'Leek', kind: 'veg', price: 2 },
  { name: 'Date', kind: 'fruit', price: 5 },
]

function surfaceWith(config: Record<string, unknown>, blocks: Record<string, unknown>[]) {
  return {
    id: 's',
    blocks: blocks.map((b) => ({ layout: L, props: {}, ...b })),
    capabilities: [{ capability: 'platform/persistence', required: true, config }],
  } as never
}

const names = { id: 'out', type: 'text', props: { testId: 'out', content: '{{list[0].name}},{{list[1].name ?? ""}},{{list[2].name ?? ""}}' } }
const first = { id: 'out', type: 'text', props: { testId: 'out', content: '{{list[0].name}}|{{list.length}}' } }

describe('a static source applies its query', () => {
  it('filters, sorts and pages the static rows', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          {
            dataSources: [
              {
                id: 'list',
                kind: 'static',
                staticData: rows,
                query: {
                  filter: { field: 'kind', operator: 'eq', value: 'fruit' },
                  sort: [{ field: 'name', direction: 'asc' }],
                  pagination: { offset: 0, limit: 2 },
                },
              },
            ],
          },
          [first]
        )}
        components={components as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Apple|2'))
  })

  it('leaves static rows as written when there is no query', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith({ dataSources: [{ id: 'list', kind: 'static', staticData: rows }] }, [first])}
        components={components as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Fig|4'))
  })

  it('leaves a non-list static value alone', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          {
            dataSources: [
              { id: 'site', kind: 'static', staticData: { title: 'Shop' }, query: { sort: [{ field: 'title', direction: 'asc' }] } },
            ],
          },
          [{ id: 'out', type: 'text', props: { testId: 'out', content: '{{site.title}}' } }]
        )}
        components={components as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Shop'))
  })

  it('re-applies a query reading state when that state changes', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          {
            initialState: { kind: 'veg' },
            dataSources: [
              {
                id: 'list',
                kind: 'static',
                staticData: rows,
                query: {
                  filter: { field: 'kind', operator: 'eq', value: '{{state.kind}}' },
                  sort: [{ field: 'price', direction: 'desc' }],
                },
              },
            ],
            behaviors: [
              { id: 'b1', event: 'block:click', targetBlockId: 'plain', actions: [{ type: 'setState', key: 'kind', value: 'fruit' }] },
            ],
          },
          [{ id: 'plain', type: 'plain-button' }, names]
        )}
        components={components as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Leek,,'))
    fireEvent.click(screen.getByTestId('plain'))
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('Date,Fig,Apple'))
  })
})
