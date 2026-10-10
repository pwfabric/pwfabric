/**
 * The address seeds page state.
 *
 *  A2  seedStateFromQuery — allow-list of read keys; reserved, `__`, prototype,
 *      selectionKey, statusKeys and host/single-expression keys never seeded;
 *      receipt initialState is the base, the address writes over it
 *  A3  hash mode: `#/product?id=12` → page `product` + query `id=12`
 *  A4  path mode: `/product?id=12` → `?id=13` re-renders (queryOnly change)
 *  A5  rewriteHrefs keeps the query in hash mode
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRouter, type RouteChange } from './router.js'
import { queryStateSeed, rewriteHrefs, seedStateFromQuery, stateKeysRead, unseedableStateKeys } from './helpers.js'
import type { SurfaceReceipt } from './types.js'

// ============================================================
// A2 — seeding
// ============================================================

function receipt(over: Partial<SurfaceReceipt> = {}): SurfaceReceipt {
  return {
    blocks: [{ id: 't', type: 'text', props: { text: 'Product {{state.id}} / {{state.q}}' } }],
    capabilities: [
      {
        capability: 'platform/persistence',
        config: {
          dataSources: [{ id: 'product', kind: 'rest', endpoint: 'https://api.example.org/products/{{state.id}}' }],
          initialState: { q: '', page: 1 },
        },
      },
    ],
    ...over,
  } as SurfaceReceipt
}
const qs = (s: string) => new URLSearchParams(s)
const initialStateOf = (r: SurfaceReceipt) =>
  r.capabilities?.find((c) => c.capability === 'platform/persistence')?.config?.initialState as Record<string, unknown>

describe('the address seeds only what the page reads', () => {
  it('seeds a read key as a raw string, over the receipt initialState', () => {
    const out = seedStateFromQuery(receipt(), qs('id=12&q=shoes'))
    expect(initialStateOf(out)).toEqual({ q: 'shoes', page: 1, id: '12' })
  })

  it('an unread parameter (utm_source) is not seeded; nothing to seed returns the receipt itself', () => {
    const r = receipt()
    expect(queryStateSeed(r, qs('utm_source=mail'))).toEqual({})
    expect(seedStateFromQuery(r, qs('utm_source=mail'))).toBe(r)
  })

  it('reserved, __-prefixed and prototype keys are never seeded, even when read', () => {
    const r = receipt({
      blocks: [
        {
          id: 't',
          type: 'text',
          props: { text: '{{state.code}} {{state.state}} {{state.error}} {{state.iss}} {{state.returnTo}} {{state.__show}} {{state.__proto__}} {{state.constructor}} {{state.prototype}}' },
        },
      ],
    })
    expect(queryStateSeed(r, qs('code=x&state=y&error=z&iss=i&returnTo=/r&__show=1&__proto__=p&constructor=c&prototype=p'))).toEqual({})
  })

  it('a split-view selectionKey (default sec) and formBinding statusKeys are never seeded', () => {
    const r = receipt({
      blocks: [
        { id: 'sv', type: 'split-view', props: {} },
        { id: 'sv2', type: 'split-view', props: { selectionKey: 'pick' } },
        { id: 't', type: 'text', props: { text: '{{state.sec}} {{state.pick}} {{state.saved}} {{state.failed}} {{state.id}}' } },
      ],
      capabilities: [
        { capability: 'platform/persistence', config: {} },
        { capability: 'platform/entities', config: { formBindings: [{ formId: 'f', sourceId: 's', statusKeys: { success: 'saved', error: 'failed' } }] } },
      ],
    })
    expect(queryStateSeed(r, qs('sec=1&pick=2&saved=true&failed=true&id=9'))).toEqual({ id: '9' })
  })

  it('a key read in a single-expression endpoint or in the scheme/host part is never seeded', () => {
    const r = receipt({
      capabilities: [
        {
          capability: 'persistence',
          config: {
            dataSources: [
              { id: 'a', kind: 'rest', endpoint: '{{state.url}}' },
              { id: 'b', kind: 'rest', endpoint: 'https://{{state.host}}/x/{{state.id}}' },
              { id: 'c', kind: 'rest', endpoint: '{{state.base}}/items?q={{state.q}}' },
            ],
          },
        },
      ],
    })
    expect([...unseedableStateKeys(r)].sort()).toEqual(['base', 'host', 'url'])
    expect(queryStateSeed(r, qs('url=https://evil&host=evil&base=//evil&id=1&q=ok'))).toEqual({ id: '1', q: 'ok' })
  })

  it('first value wins, values are cut at 512, and exactly . or .. becomes empty', () => {
    const r = receipt()
    expect(queryStateSeed(r, qs('id=1&id=2')).id).toBe('1')
    expect(queryStateSeed(r, qs(`id=${'x'.repeat(600)}`)).id).toHaveLength(512)
    expect(queryStateSeed(r, qs('id=..')).id).toBe('')
    expect(queryStateSeed(r, qs('id=.')).id).toBe('')
    expect(queryStateSeed(r, qs('id=...')).id).toBe('...')
  })

  it('a receipt without persistence gets the capability; the input is not mutated', () => {
    const r = { blocks: [{ id: 't', type: 'text', props: { text: '{{state.step}}' } }] } as SurfaceReceipt
    const out = seedStateFromQuery(r, qs('step=2'))
    expect(out.capabilities).toEqual([{ capability: 'platform/persistence', config: { initialState: { step: '2' } } }])
    expect(r.capabilities).toBeUndefined()
  })

  it('stateKeysRead is the gate’s scan: every state.<key> in the receipt text', () => {
    expect([...stateKeysRead(receipt())].sort()).toEqual(['id', 'q'])
  })
})

// ============================================================
// Router stubs
// ============================================================

const realLocation = (globalThis as { location?: unknown }).location
const realWindow = (globalThis as { window?: unknown }).window
const realDocument = (globalThis as { document?: unknown }).document
const realHistory = (globalThis as { history?: unknown }).history

afterEach(() => {
  ;(globalThis as Record<string, unknown>).location = realLocation
  ;(globalThis as Record<string, unknown>).window = realWindow
  ;(globalThis as Record<string, unknown>).document = realDocument
  ;(globalThis as Record<string, unknown>).history = realHistory
})

type Listener = (ev: unknown) => void

/** A browser just big enough for `start()`: listeners, pushState, scroll. */
function stubBrowser(pathname: string, search = '', hash = '') {
  const loc = {
    pathname,
    search,
    hash,
    origin: 'https://app.example',
    get href() {
      return `https://app.example${this.pathname}${this.search}${this.hash}`
    },
  }
  const win: Record<string, Listener[]> = {}
  const doc: Record<string, Listener[]> = {}
  const scrollTo = vi.fn()
  ;(globalThis as Record<string, unknown>).location = loc
  ;(globalThis as Record<string, unknown>).window = {
    addEventListener: (t: string, f: Listener) => (win[t] ??= []).push(f),
    removeEventListener: () => {},
    scrollTo,
    setTimeout: () => 0,
  }
  ;(globalThis as Record<string, unknown>).document = {
    addEventListener: (t: string, f: Listener) => (doc[t] ??= []).push(f),
    getElementById: () => null,
  }
  ;(globalThis as Record<string, unknown>).history = {
    pushState: (_s: unknown, _t: string, url: string) => {
      const u = new URL(url, loc.href)
      loc.pathname = u.pathname
      loc.search = u.search
      loc.hash = u.hash
    },
  }
  const click = (href: string) => {
    const anchor = { href: new URL(href, loc.href).href, target: '', getAttribute: () => href }
    const ev = {
      defaultPrevented: false,
      button: 0,
      target: { closest: () => anchor },
      preventDefault() {
        this.defaultPrevented = true
      },
    }
    for (const f of doc.click ?? []) f(ev)
  }
  const hashTo = (h: string) => {
    loc.hash = h
    for (const f of win.hashchange ?? []) f({})
  }
  const fire = (t: string, ev: unknown = {}) => { for (const f of win[t] ?? []) f(ev) }
  return { loc, click, hashTo, scrollTo, fire }
}

const PAGES = ['home', 'products', 'product']

// ============================================================
// A3 — hash mode reads the query
// ============================================================

describe('hash mode: the route ends at "?"', () => {
  it('#/product?id=12 is page product with query id=12', () => {
    stubBrowser('/', '', '#/product?id=12')
    const router = createRouter('hash', PAGES, 'home')
    expect(router.current()).toBe('product')
    expect(router.query()).toBe('id=12')
  })

  it('route, query and anchor together: #/product?id=12#reviews', () => {
    stubBrowser('/', '', '#/product?id=12#reviews')
    const router = createRouter('hash', PAGES, 'home')
    expect(router.current()).toBe('product')
    expect(router.query()).toBe('id=12')
  })

  it('an unknown page with a query is still refused', () => {
    stubBrowser('/', '', '#/nope?id=1')
    expect(createRouter('hash', PAGES, 'home').current()).toBeNull()
  })

  it('same page, new query → a queryOnly change; same query → only a scroll', () => {
    const b = stubBrowser('/', '', '#/product?id=12')
    const router = createRouter('hash', PAGES, 'home')
    const changes: (RouteChange | undefined)[] = []
    router.start((c) => changes.push(c))
    router.current()
    b.hashTo('#/product?id=13')
    expect(changes).toEqual([{ queryOnly: true }])
    router.current()
    b.hashTo('#/product?id=13#reviews')
    expect(changes).toHaveLength(1)
  })
})

// ============================================================
// A4 — path mode re-renders on a query change
// ============================================================

describe('path mode: a query change on the same page re-renders', () => {
  it('/product?id=12 → /product?id=13 calls onChange as a queryOnly change', () => {
    const b = stubBrowser('/product', '?id=12')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    const changes: (RouteChange | undefined)[] = []
    router.start((c) => changes.push(c))
    expect(router.current()).toBe('product')
    expect(router.query()).toBe('id=12')
    b.click('/product?id=13')
    expect(changes).toEqual([{ queryOnly: true }])
    expect(router.query()).toBe('id=13')
  })

  it('an in-page anchor with the same query still only scrolls', () => {
    const b = stubBrowser('/product', '?id=12')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    const changes: (RouteChange | undefined)[] = []
    router.start((c) => changes.push(c))
    router.current()
    b.click('/product?id=12#reviews')
    expect(changes).toEqual([])
  })

  it('a different page is a full change', () => {
    const b = stubBrowser('/products', '?q=x')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    const changes: (RouteChange | undefined)[] = []
    router.start((c) => changes.push(c))
    router.current()
    b.click('/product?id=1')
    expect(changes).toEqual([undefined])
  })

  it('popstate is a full change — the DOM event is never passed on as a RouteChange', () => {
    const b = stubBrowser('/product', '?id=12')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    const changes: unknown[] = []
    router.start((c) => changes.push(c))
    b.fire('popstate', { state: null, type: 'popstate' })
    expect(changes).toEqual([undefined])
  })
})

// ============================================================
// A5 — rewriteHrefs keeps the query in hash mode
// ============================================================

describe('a detail link keeps its query in both modes', () => {
  it('hash mode: /product?id={{item.id}} → #/product?id={{item.id}}', () => {
    const out = rewriteHrefs([{ props: { href: '/product?id={{item.id}}' } }], 'home', (k) => `#/${k}`)
    expect(out[0]!.props.href).toBe('#/product?id={{item.id}}')
  })

  it('path mode: /product?id=7 → <base>/product?id=7', () => {
    const out = rewriteHrefs([{ props: { href: '/product?id=7' } }], 'home', (k) => `/apps/x/${k}`)
    expect(out[0]!.props.href).toBe('/apps/x/product?id=7')
  })
})
