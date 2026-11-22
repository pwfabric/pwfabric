// @vitest-environment jsdom
/**
 * An `initialState` value may be an expression — a seed derived from the
 * page's data, such as a facet's counts (data-protocol §1.1). It was written
 * into state as the literal template. It is evaluated once, when the first
 * data pass has settled, against the whole page scope; a key already written
 * (by the address) keeps its value.
 *
 * @module @pwfabric/runtime/render/__tests__/derived-initial-state.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())
const L = DEFAULT_BLOCK_LAYOUT
const Text = ({ props }: { props: Record<string, unknown> }) => <div data-testid="t">{String(props.content ?? '')}</div>
const components: Partial<BlockComponentRegistry> = { text: Text as never }

const facade = {
  resolveBinding: async () => ({
    items: [{ id: 'a', diet: 'vegan' }, { id: 'b', diet: 'meat' }, { id: 'c', diet: 'vegan' }],
    total: 3,
    offset: 0,
    limit: 50,
    hasMore: false,
  }),
}

function page(initialState: Record<string, unknown>): never {
  return {
    id: 'menu',
    blocks: [{ id: 't', type: 'text', layout: L, props: { content: 'all={{state.all}}|label={{state.label}}|vegan={{state.vegan}}|plain={{state.plain}}' } }],
    capabilities: [
      {
        capability: 'platform/persistence',
        config: { dataSources: [{ id: 'dishes', kind: 'entity', entityType: 'Dish' }], initialState },
      },
    ],
  } as never
}

describe('a derived initialState seed', () => {
  it('is evaluated against the settled data, once', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={page({
          all: '{{dishes.length}}',
          label: 'All ({{dishes.length}})',
          vegan: '{{dishes.filter(d => d)}}',
          plain: 'x',
        })}
        components={components}
        entityFacade={facade as never}
      />
    )
    await waitFor(() => expect(screen.getByTestId('t').textContent).toContain('all=3'))
    // An unevaluable seed is no value, never its template.
    expect(screen.getByTestId('t').textContent).toBe('all=3|label=All (3)|vegan=|plain=x')
  })

  it('never binds the template itself', async () => {
    render(<DataBoundSurfaceRenderer surface={page({ all: '{{dishes.length}}' })} components={components} entityFacade={facade as never} />)
    await waitFor(() => expect(screen.getByTestId('t').textContent).toContain('all=3'))
    expect(screen.getByTestId('t').textContent).not.toContain('{{')
  })
})

describe('a derived seed on a page whose host changes while its data loads', () => {
  it('waits for the data in flight, as a hydrated page whose visitor becomes known does', async () => {
    let release: () => void = () => undefined
    const slow = {
      resolveBinding: () =>
        new Promise((done) => {
          release = () => done({ items: [{ id: 'a' }, { id: 'b' }], total: 2, offset: 0, limit: 50, hasMore: false })
        }),
    }
    const surface = page({ all: '{{dishes.length}}' })
    const pending = { state: { signedIn: false, pending: true, user: null, methods: [], registration: 'open', error: null }, onAction: () => undefined }
    const known = { state: { signedIn: false, user: null, methods: [], registration: 'open', error: null }, onAction: () => undefined }
    const view = (identity: unknown) => (
      <DataBoundSurfaceRenderer surface={surface} components={components} entityFacade={slow as never} identity={identity as never} loadingStrategy="immediate" />
    )
    const { rerender } = render(view(pending))
    // The visitor becomes known before the rows arrive (the update after hydration).
    rerender(view(known))
    await new Promise((r) => setTimeout(r, 20))
    release()
    await waitFor(() => expect(screen.getByTestId('t').textContent).toContain('all=2'))
  })
})
