// @vitest-environment jsdom
/**
 * Click writes state and state reaches a REST
 * address safely.
 *
 *  C1  a page carrying only `initialState` + buttons with `action` props takes
 *      the data-bound path — visibleWhen resolves and the button works
 *  C2  a block `action` may be a list, run in order
 *  C3  a block `action` runs on its click only, never on its other events
 *  A1  mixed REST endpoints URL-encode every value; `.`/`..` become ''; a
 *      single-expression endpoint is left unencoded
 *  A1b the cache key is built from the resolved endpoint, so id 12 and id 13
 *      do not share rows
 *
 * @module @pwfabric/runtime/render/__tests__/databound-click-state.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer, surfaceNeedsDataBinding, blockActionsOf } from '../DataBoundSurfaceRenderer.js'
import { resolveEndpoint } from '../endpoint.js'
import { dataSourceCacheKey } from '../data-cache.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const L = DEFAULT_BLOCK_LAYOUT

/** A button that emits a click — or, with `emits`, whatever event it is told to. */
const Btn = ({ block, props }: { block: Block; props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() => emit({ type: (props.emits as string) ?? SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}
    >
      {String(props.label ?? '')}
    </button>
  )
}
const Text = ({ block, props }: { block: Block; props: Record<string, unknown> }) => (
  <div data-testid={block.id}>{String(props.text ?? '')}</div>
)
const components: Partial<BlockComponentRegistry> = { button: Btn as never, text: Text as never }

function persistence(config: Record<string, unknown>) {
  return [{ capability: 'platform/persistence', config }]
}

// ============================================================
// C1 — a state-only wizard is not passed through
// ============================================================

describe('a page with only initialState + button actions is data-bound', () => {
  const wizard = (): never =>
    ({
      id: 'wizard',
      blocks: [
        { id: 'step1', type: 'text', layout: L, props: { text: 'STEP ONE' }, visibleWhen: '{{state.step == 1}}' },
        { id: 'step2', type: 'text', layout: L, props: { text: 'STEP TWO' }, visibleWhen: '{{state.step == 2}}' },
        { id: 'next', type: 'button', layout: L, props: { label: 'Next', action: { type: 'setState', key: 'step', value: 2 } } },
      ],
      capabilities: persistence({ initialState: { step: 1 } }),
    }) as never

  it('resolves visibleWhen from initialState on the first frame', async () => {
    render(<DataBoundSurfaceRenderer surface={wizard()} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByText('STEP ONE')).not.toBeNull())
    expect(screen.queryByText('STEP TWO')).toBeNull()
  })

  it('the button action moves the wizard to the next step', async () => {
    render(<DataBoundSurfaceRenderer surface={wizard()} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('next')).not.toBeNull())
    await act(async () => screen.getByTestId('next').click())
    await waitFor(() => expect(screen.queryByText('STEP TWO')).not.toBeNull())
    expect(screen.queryByText('STEP ONE')).toBeNull()
  })

  it('surfaceNeedsDataBinding: initialState alone, or a block action alone, is enough', () => {
    expect(surfaceNeedsDataBinding({ blocks: [], capabilities: persistence({ initialState: {} }) as never })).toBe(true)
    expect(
      surfaceNeedsDataBinding({
        blocks: [
          {
            id: 's',
            type: 'section',
            layout: L,
            props: {},
            children: [{ id: 'b', type: 'button', layout: L, props: { action: { type: 'refreshAll' } } }],
          } as never,
        ],
      })
    ).toBe(true)
    expect(surfaceNeedsDataBinding({ blocks: [{ id: 't', type: 'text', layout: L, props: { text: 'x' } } as never] })).toBe(false)
    // a form's `action` is its submit URL, not a surface action
    expect(surfaceNeedsDataBinding({ blocks: [{ id: 'f', type: 'form', layout: L, props: { action: '/submit' } } as never] })).toBe(false)
  })
})

// ============================================================
// C2 — a list of actions runs in order
// ============================================================

describe('a block action may be a list, run in order', () => {
  it('runs every action of the list on one click', async () => {
    const surface = {
      blocks: [
        { id: 'out', type: 'text', layout: L, props: { text: 'step={{state.step}} err={{state.stepError}}' } },
        {
          id: 'next',
          type: 'button',
          layout: L,
          props: {
            action: [
              { type: 'setState', key: 'step', value: 2 },
              { type: 'setState', key: 'stepError', value: '' },
            ],
          },
        },
      ],
      capabilities: persistence({ initialState: { step: 1, stepError: 'required' } }),
    } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('step=1 err=required'))
    await act(async () => screen.getByTestId('next').click())
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('step=2 err='))
  })

  it('later actions see earlier ones — the last write to a key wins', async () => {
    const surface = {
      blocks: [
        { id: 'out', type: 'text', layout: L, props: { text: 'v={{state.v}}' } },
        {
          id: 'b',
          type: 'button',
          layout: L,
          props: { action: [{ type: 'setState', key: 'v', value: 'a' }, { type: 'setState', key: 'v', value: 'b' }] },
        },
      ],
      capabilities: persistence({ initialState: { v: '' } }),
    } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('b')).not.toBeNull())
    await act(async () => screen.getByTestId('b').click())
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('v=b'))
  })

  it('blockActionsOf keeps the surface actions of a list and drops junk', () => {
    expect(blockActionsOf({ type: 'refreshAll' })).toEqual([{ type: 'refreshAll' }])
    expect(blockActionsOf([{ type: 'refreshAll' }, { type: 'explode' }, 'x'])).toEqual([{ type: 'refreshAll' }])
    expect(blockActionsOf('/submit')).toEqual([])
    expect(blockActionsOf(undefined)).toEqual([])
  })
})

// ============================================================
// C3 — click only
// ============================================================

describe('a block action runs on its click only', () => {
  const surfaceEmitting = (emits: string): never =>
    ({
      blocks: [
        { id: 'out', type: 'text', layout: L, props: { text: 'n={{state.n}}' } },
        { id: 'b', type: 'button', layout: L, props: { emits, action: { type: 'setState', key: 'n', value: 1 } } },
      ],
      capabilities: persistence({ initialState: { n: 0 } }),
    }) as never

  it('a non-click event from the same block does not run it', async () => {
    render(<DataBoundSurfaceRenderer surface={surfaceEmitting('block:hover')} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('b')).not.toBeNull())
    await act(async () => screen.getByTestId('b').click())
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('out').textContent).toBe('n=0')
  })

  it('the click does', async () => {
    render(<DataBoundSurfaceRenderer surface={surfaceEmitting('block:click')} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('b')).not.toBeNull())
    await act(async () => screen.getByTestId('b').click())
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('n=1'))
  })
})

// ============================================================
// A1 — the endpoint encodes what it places
// ============================================================

describe('resolveEndpoint', () => {
  it('encodes a path value, so a slash cannot add a segment', () => {
    expect(resolveEndpoint('/api/products/{{state.id}}', { id: 'a/b' })).toBe('/api/products/a%2Fb')
  })

  it('encodes a query value, so & # + % ? cannot add parameters', () => {
    expect(resolveEndpoint('/api/search?q={{state.q}}&skip={{state.skip}}', { q: 'a&role=owner#x?+%', skip: 20 })).toBe(
      '/api/search?q=a%26role%3Downer%23x%3F%2B%25&skip=20'
    )
  })

  it('a value that is exactly . or .. becomes empty', () => {
    expect(resolveEndpoint('/api/products/{{state.id}}', { id: '..' })).toBe('/api/products/')
    expect(resolveEndpoint('/api/products/{{state.id}}', { id: '.' })).toBe('/api/products/')
    expect(resolveEndpoint('/api/products/{{state.id}}', { id: '...' })).toBe('/api/products/...')
  })

  it('a single-expression endpoint is left unencoded, as before', () => {
    expect(resolveEndpoint('{{state.url}}', { url: 'https://api.example.com/a?b=c' })).toBe('https://api.example.com/a?b=c')
  })

  it('a missing value places nothing; an endpoint without placeholders is untouched', () => {
    expect(resolveEndpoint('/api/products/{{state.id}}', {})).toBe('/api/products/')
    expect(resolveEndpoint('/api/products?x=a/b', {})).toBe('/api/products?x=a/b')
  })
})

describe('the renderer fetches the encoded address', () => {
  it('state carrying a slash reaches fetch as %2F, not as a new path segment', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [{ name: 'x' }] }))
    vi.stubGlobal('fetch', fetchSpy as never)
    const surface = {
      blocks: [{ id: 'out', type: 'text', layout: L, props: { text: 'ok' } }],
      capabilities: persistence({
        dataSources: [{ id: 'product', kind: 'rest', endpoint: '/api/products/{{state.id}}' }],
        initialState: { id: '12/../../admin' },
      }),
    } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(String((fetchSpy.mock.calls[0] as unknown[])[0])).toBe('/api/products/12%2F..%2F..%2Fadmin')
  })
})

// ============================================================
// A1b — the cache key follows the resolved endpoint
// ============================================================

describe('dataSourceCacheKey is built from the resolved endpoint', () => {
  const source = { id: 'product', kind: 'rest' as const, endpoint: '/api/products/{{state.id}}' }

  it('differs per id, so ?id=13 never opens on the rows cached for 12', () => {
    expect(dataSourceCacheKey(source, { id: '12' })).not.toBe(dataSourceCacheKey(source, { id: '13' }))
  })

  it('is stable for the same id', () => {
    expect(dataSourceCacheKey(source, { id: '12' })).toBe(dataSourceCacheKey(source, { id: '12' }))
  })
})
