// @vitest-environment jsdom
/**
 * N6 + N7 + pagination envelope — REST sources as a generator writes them,
 * against DummyJSON's shapes.
 *
 * N6  `endpoint: "https://dummyjson.com/carts/{{state.numara}}"`, `returns: "products"`:
 *     - with `numara` empty it fetched `/carts/` (the whole collection) and
 *       the page opened with an error → now the source stays IDLE, no request;
 *     - a 404 landed in `__errors` exactly like a network failure → now
 *       `__status.<id>` carries the HTTP status and `__notFound.<id>` is true;
 *     - on error the previous cart stayed on screen → now the data is cleared
 *       when the failing request is not the one that produced it.
 * N7  every setState refetched every source: typing into a draft input with a
 *     `stateKey` fetched on each keystroke and flashed the loading state → now
 *     only sources whose resolved request changed are fetched.
 *  +  `returns` unwrapped the list and dropped the envelope (`total`, `skip`,
 *     `limit`) → now `__meta.<id>` carries the envelope's other fields.
 *
 * @module @pwfabric/runtime/render/__tests__/rest-detail-and-refetch.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { endpointMissingPathValue } from '../endpoint.js'
import { dataSourceCacheKey } from '../data-cache.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT

// ---- DummyJSON, as measured ---------------------------------------------

const CART_1 = {
  id: 1,
  products: [
    { id: 168, title: 'Charger SXT RWD', price: 32999.99, quantity: 3 },
    { id: 78, title: 'Apple MacBook Pro 14 Inch Space Grey', price: 1999.99, quantity: 2 },
  ],
  total: 103774.85,
  discountedTotal: 89686.65,
  userId: 33,
  totalProducts: 2,
  totalQuantity: 5,
}
const CART_2 = { ...CART_1, id: 2, products: [{ id: 144, title: 'Cricket Helmet', price: 44.99, quantity: 4 }], total: 179.96 }
const PRODUCTS_PAGE = {
  products: [{ id: 1, title: 'Essence Mascara' }, { id: 2, title: 'Eyeshadow Palette' }],
  total: 194,
  skip: 0,
  limit: 30,
}

type Reply = { status: number; body: unknown } | 'network-error'

let calls: string[] = []
function serve(route: (url: string) => Reply): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const r = route(url)
      if (r === 'network-error') throw new TypeError('Failed to fetch')
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        statusText: r.status === 404 ? 'Not Found' : 'OK',
        json: async () => r.body,
      }
    }) as never
  )
}

const dummyjson = (url: string): Reply => {
  if (url.endsWith('/carts/1')) return { status: 200, body: CART_1 }
  if (url.endsWith('/carts/2')) return { status: 200, body: CART_2 }
  if (url.endsWith('/carts/999')) return { status: 404, body: { message: "Cart with id '999' not found" } }
  if (url.endsWith('/carts/500')) return 'network-error'
  if (url.includes('/products')) return { status: 200, body: PRODUCTS_PAGE }
  return { status: 200, body: { carts: [CART_1, CART_2], total: 50, skip: 0, limit: 30 } }
}

beforeEach(() => {
  calls = []
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// ---- blocks ---------------------------------------------------------------

type P = { block: Block; props: Record<string, unknown> }
const Text = ({ block, props }: P) => <div data-testid={block.id}>{String(props.text ?? '')}</div>
/** A button that writes one state value (a stand-in for an input with a stateKey). */
const Btn = ({ block, props }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() => emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}
    >
      {String(props.label ?? '')}
    </button>
  )
}
const components: Partial<BlockComponentRegistry> = { text: Text as never, button: Btn as never }

const set = (id: string, key: string, value: unknown): Block =>
  ({ id, type: 'button', layout: L, props: { label: id, action: { type: 'setState', key, value } } }) as Block
const text = (id: string, t: string): Block => ({ id, type: 'text', layout: L, props: { text: t } }) as Block

function surface(dataSources: unknown[], blocks: Block[], initialState: Record<string, unknown> = {}): never {
  return {
    id: 'tracking',
    blocks,
    capabilities: [{ capability: 'platform/persistence', config: { dataSources, initialState } }],
  } as never
}

const click = async (id: string): Promise<void> => {
  await act(async () => screen.getByTestId(id).click())
}
const textOf = (id: string): string => screen.getByTestId(id).textContent ?? ''

// A generated order-tracking source, verbatim
const ORDERS = {
  id: 'orders',
  kind: 'rest',
  method: 'GET',
  returns: 'products',
  endpoint: 'https://dummyjson.com/carts/{{state.numara}}',
}

const probe = text(
  'probe',
  'loading={{__loading.orders}} idle={{__idle.orders}} err={{__errors.orders}} status={{__status.orders}} nf={{__notFound.orders}} first={{orders[0].title}} total={{__meta.orders.total}}'
)

// ============================================================
// N6
// ============================================================

describe('a detail endpoint with an empty path parameter stays idle', () => {
  it('opens without a request and without an error', async () => {
    serve(dummyjson)
    render(<DataBoundSurfaceRenderer surface={surface([ORDERS], [probe])} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('probe')).not.toBeNull())
    expect(calls).toEqual([])
    expect(textOf('probe')).toContain('loading=false idle=true err= status= nf=false')
  })

  it('fetches once the parameter has a value, with the envelope under __meta', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([ORDERS], [probe, set('find-1', 'numara', 1)])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('find-1')).not.toBeNull())
    await click('find-1')
    await waitFor(() => expect(textOf('probe')).toContain('first=Charger SXT RWD'))
    expect(calls).toEqual(['https://dummyjson.com/carts/1'])
    expect(textOf('probe')).toContain('idle=false err= status=200 nf=false')
    expect(textOf('probe')).toContain('total=103774.85')
  })

  it('a 404 reports status 404 and notFound, and clears the previous cart', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([ORDERS], [probe, set('find-1', 'numara', 1), set('find-999', 'numara', 999)])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('find-1')).not.toBeNull())
    await click('find-1')
    await waitFor(() => expect(textOf('probe')).toContain('first=Charger SXT RWD'))
    await click('find-999')
    await waitFor(() => expect(textOf('probe')).toContain('status=404'))
    expect(textOf('probe')).toContain('nf=true')
    expect(textOf('probe')).toContain("err=Cart with id '999' not found".slice(0, 4))
    // the stale cart is gone
    expect(textOf('probe')).toContain('first= ')
    expect(textOf('probe')).toContain('total=')
    expect(textOf('probe')).not.toContain('103774.85')
  })

  it('a network failure is an error without a status and is not "not found"', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([ORDERS], [probe, set('find-500', 'numara', 500)])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('find-500')).not.toBeNull())
    await click('find-500')
    await waitFor(() => expect(textOf('probe')).toContain('err=Failed to fetch'))
    expect(textOf('probe')).toContain('status= nf=false')
  })

  it('clearing the parameter returns the source to idle', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([ORDERS], [probe, set('find-1', 'numara', 1), set('clear', 'numara', '')])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('find-1')).not.toBeNull())
    await click('find-1')
    await waitFor(() => expect(textOf('probe')).toContain('first=Charger SXT RWD'))
    await click('clear')
    await waitFor(() => expect(textOf('probe')).toContain('idle=true'))
    expect(textOf('probe')).toContain('first= ')
    expect(calls).toEqual(['https://dummyjson.com/carts/1'])
  })

  it('the same request failing on a refresh keeps its last good data', async () => {
    let fail = false
    serve((url) => (fail ? 'network-error' : dummyjson(url)))
    render(
      <DataBoundSurfaceRenderer
        surface={surface(
          [ORDERS],
          [probe, set('find-1', 'numara', 1), { id: 'r', type: 'button', layout: L, props: { label: 'r', action: { type: 'refresh', sourceId: 'orders' } } } as Block]
        )}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('find-1')).not.toBeNull())
    await click('find-1')
    await waitFor(() => expect(textOf('probe')).toContain('first=Charger SXT RWD'))
    fail = true
    await click('r')
    await waitFor(() => expect(textOf('probe')).toContain('err=Failed to fetch'))
    expect(textOf('probe')).toContain('first=Charger SXT RWD')
  })

  it('endpointMissingPathValue: path placeholders are required, query-string ones are not', () => {
    expect(endpointMissingPathValue('https://x/carts/{{state.n}}', {})).toBe(true)
    expect(endpointMissingPathValue('https://x/carts/{{state.n}}', { n: '' })).toBe(true)
    expect(endpointMissingPathValue('https://x/carts/{{state.n}}', { n: null })).toBe(true)
    expect(endpointMissingPathValue('https://x/carts/{{state.n}}', { n: 0 })).toBe(false)
    expect(endpointMissingPathValue('https://x/carts/{{state.n}}', { n: 3 })).toBe(false)
    expect(endpointMissingPathValue('https://x/search?q={{state.q}}', {})).toBe(false)
    expect(endpointMissingPathValue('{{state.url}}', {})).toBe(true)
    expect(endpointMissingPathValue('{{state.url}}', { url: 'https://x/y' })).toBe(false)
    expect(endpointMissingPathValue('https://x/carts', {})).toBe(false)
    expect(endpointMissingPathValue('https://x/carts/{{(state.n}}', { n: 1 })).toBe(true)
  })

  it('an idle source has no cache key (nothing stale is seeded)', () => {
    expect(dataSourceCacheKey(ORDERS as never, {})).toBeUndefined()
    expect(dataSourceCacheKey(ORDERS as never, { numara: 1 })).toBeDefined()
  })
})

// ============================================================
// N7
// ============================================================

describe('only sources whose request changed are refetched', () => {
  // A generated source pair, verbatim: `products` depends on `numara`, `fullCart` on
  // `numara` (endpoint) and `searchDraft` (query).
  const PRODUCTS = {
    id: 'products',
    kind: 'rest',
    method: 'GET',
    returns: 'products',
    endpoint: 'https://dummyjson.com/carts/{{state.numara}}',
  }
  const FULL_CART = {
    id: 'fullCart',
    kind: 'rest',
    query: { filter: { field: 'id', value: '{{state.searchDraft}}', operator: 'gte' } },
    method: 'GET',
    returns: 'products',
    endpoint: 'https://dummyjson.com/carts/{{state.numara}}',
  }
  const CATALOGUE = { id: 'catalogue', kind: 'rest', returns: 'products', endpoint: 'https://dummyjson.com/products?limit=30' }

  const blocks = (): Block[] => [
    text('p', 'products={{__loading.products}} full={{__loading.fullCart}} n={{products.length}} f={{fullCart.length}}'),
    set('find-1', 'numara', 1),
    set('type-1', 'searchDraft', '1'),
    set('type-150', 'searchDraft', 150),
    set('menu', 'menuOpen', true),
    set('menu-again', 'menuOpen', true),
  ]

  it('an unrelated state key refetches nothing', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([PRODUCTS, FULL_CART, CATALOGUE], blocks(), { numara: 1 })}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(textOf('p')).toContain('n=2 f=2'))
    const before = calls.length
    expect(before).toBe(3)
    await click('menu')
    await click('menu-again')
    // give any stray fetch a chance to start
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(calls.length).toBe(before)
  })

  it('typing into the draft key refetches only the source whose query reads it', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([PRODUCTS, FULL_CART, CATALOGUE], blocks(), { numara: 1 })}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(textOf('p')).toContain('n=2 f=2'))
    calls = []
    await click('type-150')
    await waitFor(() => expect(textOf('p')).toContain('f=1'))
    expect(calls).toEqual(['https://dummyjson.com/carts/1'])
    // `products` never went back to loading
    expect(textOf('p')).toContain('products=false')
  })

  it('changing the path parameter refetches both sources that read it, not the catalogue', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface([PRODUCTS, FULL_CART, CATALOGUE], [...blocks(), set('find-2', 'numara', 2)], { numara: 1 })}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(textOf('p')).toContain('n=2 f=2'))
    calls = []
    await click('find-2')
    await waitFor(() => expect(textOf('p')).toContain('n=1'))
    expect(calls.sort()).toEqual(['https://dummyjson.com/carts/2', 'https://dummyjson.com/carts/2'])
  })

  it('refreshAll still refetches everything', async () => {
    serve(dummyjson)
    render(
      <DataBoundSurfaceRenderer
        surface={surface(
          [PRODUCTS, CATALOGUE],
          [...blocks(), { id: 'all', type: 'button', layout: L, props: { label: 'all', action: { type: 'refreshAll' } } } as Block],
          { numara: 1 }
        )}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(textOf('p')).toContain('n=2'))
    calls = []
    await click('all')
    await waitFor(() => expect(calls.length).toBe(2))
  })
})

// ============================================================
// envelope — pagination on a `returns` source
// ============================================================

describe('__meta — the envelope of a returns-unwrapped source', () => {
  it('exposes total / skip / limit and pages() derives the page count', async () => {
    serve(dummyjson)
    const CAT = { id: 'catalogue', kind: 'rest', returns: 'products', endpoint: 'https://dummyjson.com/products?limit=30&skip={{state.skip}}' }
    render(
      <DataBoundSurfaceRenderer
        surface={surface(
          [CAT],
          [text('pager', 'rows={{catalogue.length}} total={{__meta.catalogue.total}} limit={{__meta.catalogue.limit}} pages={{pages(__meta.catalogue.total, __meta.catalogue.limit)}} has={{__meta.catalogue.products}}')],
          { skip: 0 }
        )}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(textOf('pager')).toContain('rows=2'))
    expect(textOf('pager')).toBe('rows=2 total=194 limit=30 pages=7 has=')
  })
})

describe('StrictMode — mount, unmount, mount', () => {
  it('the second mount fetches again and settles (no source stuck loading)', async () => {
    serve(dummyjson)
    const CAT = { id: 'catalogue', kind: 'rest', returns: 'products', endpoint: 'https://dummyjson.com/products' }
    render(
      <React.StrictMode>
        <DataBoundSurfaceRenderer
          surface={surface([CAT, ORDERS], [text('s', 'loading={{__anyLoading}} rows={{catalogue.length}} idle={{__idle.orders}}')])}
          components={components}
          interactionMode="live"
        />
      </React.StrictMode>
    )
    await waitFor(() => expect(textOf('s')).toBe('loading=false rows=2 idle=true'))
  })

  it('a removed source is forgotten', async () => {
    serve(dummyjson)
    const CAT = { id: 'catalogue', kind: 'rest', returns: 'products', endpoint: 'https://dummyjson.com/products' }
    const probeBlocks = [text('s', 'rows={{catalogue.length}}')]
    const view = render(
      <DataBoundSurfaceRenderer surface={surface([CAT], probeBlocks)} components={components} interactionMode="live" />
    )
    await waitFor(() => expect(textOf('s')).toBe('rows=2'))
    view.rerender(
      <DataBoundSurfaceRenderer surface={surface([ORDERS], probeBlocks)} components={components} interactionMode="live" />
    )
    await waitFor(() => expect(screen.queryByTestId('s')).not.toBeNull())
  })
})
