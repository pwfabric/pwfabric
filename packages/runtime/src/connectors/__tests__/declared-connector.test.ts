/**
 * an engine built from its declaration.
 *
 * The fixture is the real graph-lists engine, stated as data. It replaces a
 * 317-line class whose only unique content was these seven facts — and whose
 * class-ness is what let a written engine take one options object where the
 * runtime passes two positional arguments (`lists/undefined`).
 *
 * @module @pwfabric/runtime/connectors/__tests__/declared-connector
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createDeclaredConnector, VALUE_TRANSFORMS } from '../declared-connector.js'
import type { EntityTypeId } from '../../entity/types.js'

const calls: Array<{ url: string; auth?: string; method: string; body?: string }> = []

function stubFetch(listBody: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url)
      const headers = (init?.headers ?? {}) as Record<string, string>
      calls.push({
        url: u,
        auth: headers['Authorization'],
        method: init?.method ?? 'GET',
        ...(typeof init?.body === 'string' ? { body: init.body } : {}),
      })
      if (!u.includes('/lists/')) {
        return { ok: true, status: 200, json: async () => ({ id: 'site-abc' }) } as unknown as Response
      }
      return { ok: true, status: 200, json: async () => listBody } as unknown as Response
    })
  )
}

/** graph-lists — the whole engine. */
const GRAPH_LISTS = {
  host: 'graph.microsoft.com/v1.0',
  resolve: { path: '/sites/{siteHostname}:{sitePath}', field: 'id', as: 'siteId' },
  path: '/sites/{siteId}/lists/{entityType}/items',
  params: { expand: 'fields' },
  auth: { type: 'bearer' as const },
  read: { items: 'value', id: 'id', flatten: 'fields', lift: ['webUrl'] },
  write: { bodyWrap: 'fields' },
  transforms: [{ field: 'Icon', use: 'hosted-file-url' }],
}

const CONFIG = { siteHostname: 'contoso.sharepoint.com', sitePath: '/sites/dev' }

const BODY = {
  value: [
    { id: '1', webUrl: 'https://x/1', fields: { Title: 'Elif', Department: 'Engineering' } },
    { id: '2', fields: { Title: 'Kaan' } },
  ],
}

function engine(overrides: Partial<typeof GRAPH_LISTS> = {}, token = async () => 'tok') {
  return createDeclaredConnector({
    name: 'graph-lists',
    declaration: { ...GRAPH_LISTS, ...overrides } as never,
    config: CONFIG,
    getAccessToken: token,
  })
}

describe('createDeclaredConnector', () => {
  beforeEach(() => {
    calls.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('resolves the pre-flight, then reads through the base and returns rows', async () => {
    stubFetch(BODY)
    const res = await engine().query('Adaylar' as EntityTypeId, {})

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items).toEqual([
      { id: '1', webUrl: 'https://x/1', Title: 'Elif', Department: 'Engineering' },
      { id: '2', Title: 'Kaan' },
    ])
    expect(calls[0]?.url).toContain('/sites/contoso.sharepoint.com:/sites/dev')
    expect(calls[1]?.url).toContain('/sites/site-abc/lists/Adaylar/items')
  })

  it("puts the declaration's params in the QUERY STRING and keeps the surface query OUT of it", async () => {
    // With `expand` inside the PATH, a paginated read would produce
    // `...?expand=fields?limit=50`. And: the platform's wire params (`filter=<json>&sort=&limit=&offset=`)
    // mean nothing to a foreign API — Graph answers 400 to `filter=`.
    stubFetch(BODY)
    await engine().query('Adaylar' as EntityTypeId, {
      pagination: { offset: 0, limit: 50 },
      filter: { field: 'Title', operator: 'eq', value: 'Kaan' },
      sort: [{ field: 'Title', direction: 'asc' }],
    })

    const listUrl = calls.find((c) => c.url.includes('/lists/'))!.url
    expect(listUrl).toContain('?')
    expect(listUrl.split('?')).toHaveLength(2)
    expect(listUrl).toContain('expand=fields')
    expect(listUrl).not.toMatch(/[?&](filter|sort|limit|offset)=/)
  })

  it('applies filter, sort and pagination LOCALLY — one query language for every declared engine', async () => {
    stubFetch({
      value: [
        { id: '1', fields: { Title: 'Elif', Pinned: true } },
        { id: '2', fields: { Title: 'Kaan', Pinned: false } },
        { id: '3', fields: { Title: 'Ada', Pinned: true } },
      ],
    })
    const res = await engine().query('Announcements' as EntityTypeId, {
      filter: { field: 'Pinned', operator: 'eq', value: true },
      sort: [{ field: 'Title', direction: 'asc' }],
      pagination: { offset: 0, limit: 1 },
    })
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items.map((r) => r['Title'])).toEqual(['Ada'])
    expect(res.result.total).toBe(2)
    expect(res.result.hasMore).toBe(true)
  })

  it('resolves the pre-flight ONCE and reuses it', async () => {
    stubFetch(BODY)
    const e = engine()
    await e.query('Adaylar' as EntityTypeId, {})
    await e.query('Oylar' as EntityTypeId, {})

    expect(calls.filter((c) => !c.url.includes('/lists/'))).toHaveLength(1)
  })

  it('re-reads the token per request', async () => {
    stubFetch(BODY)
    let n = 0
    const e = engine({}, async () => `tok-${++n}`)
    await e.query('Adaylar' as EntityTypeId, {})
    await e.query('Oylar' as EntityTypeId, {})

    expect(calls.filter((c) => c.url.includes('/lists/')).map((c) => c.auth)).toEqual([
      'Bearer tok-2',
      'Bearer tok-3',
    ])
  })

  it('applies a named transform to the field that declares it', async () => {
    stubFetch({
      value: [
        {
          id: '1',
          fields: {
            Icon: JSON.stringify({ serverUrl: 'https://c.sharepoint.com', serverRelativeUrl: '/x/a.png' }),
          },
        },
      ],
    })
    const res = await engine().query('AppStore' as EntityTypeId, {})

    expect(res.success).toBe(true)
    if (!res.success) return
    expect((res.result.items[0] as Record<string, unknown>).Icon).toBe('https://c.sharepoint.com/x/a.png')
  })

  it('wraps the write body as declared — the layer says the shape, the base posts it', async () => {
    stubFetch(BODY)
    await engine().create('Oylar' as EntityTypeId, { AdayAd: 'Selin', Puan: '4' })

    const post = calls.find((c) => c.method === 'POST')
    expect(post).toBeDefined()
    expect(JSON.parse(post!.body!)).toEqual({ fields: { AdayAd: 'Selin', Puan: '4' } })
  })

  it('throws at CONSTRUCTION on an unknown transform, naming it', () => {
    expect(() => engine({ transforms: [{ field: 'Icon', use: 'no-such-transform' }] })).toThrow(
      /no-such-transform/
    )
  })

  it('the transform registry is closed and named for behaviour, not for a vendor', () => {
    expect(Object.keys(VALUE_TRANSFORMS).sort()).toEqual(['hosted-file-url', 'numeric-string'])
    expect(Object.keys(VALUE_TRANSFORMS).join(' ')).not.toMatch(/graph|sharepoint|microsoft/i)
  })

  it('a query naming its own binding addresses that target, not the default', async () => {
    stubFetch(BODY)
    await engine().query('Clubs' as EntityTypeId, { sitePath: '/sites/social' } as never)

    expect(calls[0]?.url).toContain('/sites/contoso.sharepoint.com:/sites/social')
  })

  it('INHERITS retry from the base — a 429 then a 200 succeeds, and no retry is written here', async () => {
    let attempts = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url)
        calls.push({ url: u, method: 'GET' })
        if (!u.includes('/lists/')) {
          return { ok: true, status: 200, json: async () => ({ id: 'site-abc' }) } as unknown as Response
        }
        attempts++
        if (attempts === 1) {
          return { ok: false, status: 429, statusText: 'Too Many Requests', json: async () => ({}) } as unknown as Response
        }
        return { ok: true, status: 200, json: async () => BODY } as unknown as Response
      })
    )

    const res = await engine().query('Adaylar' as EntityTypeId, {})

    expect(res.success).toBe(true)
    expect(attempts).toBeGreaterThan(1)
  }, 20_000)
  /**
   * THE THREE THINGS THAT STOPPED A GENERIC REST ENGINE FROM BEING DECLARABLE.
   *
   * Without them a plain REST connection reaches the runner carrying neither
   * a declaration nor a bundled engine, and `entity-facade` drops it with a
   * console warning — the app draws every page and leaves the panels empty,
   * while an editor preview shows data.
   *
   * The declared-engine design says a new API should be "a connection record rather than code".
   * These three tests are what that sentence needs to be true: if `fill()`
   * reached `resolve.path` and `path` but not `read.*`, the response SHAPE
   * would have to be hardcoded per atom — one atom for `{data:[…]}`, another for
   * `{results:[…]}` — which is code by another name.
   */
  it('fills read.items and read.id from config, so ONE declaration serves many response shapes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push({ url: String(url), method: 'GET' })
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: [{ ref: 'r-1', Baslik: 'Zeynep' }] }),
        } as unknown as Response
      })
    )

    const rest = createDeclaredConnector({
      name: 'rest',
      declaration: {
        host: '{baseUrl}',
        path: '/{entityType}',
        auth: { type: 'none' as const },
        read: { items: '{itemsPath}', id: '{idField}', flatten: '*' },
      } as never,
      config: { baseUrl: 'api.example.com', itemsPath: 'results', idField: 'ref' },
      getAccessToken: async () => null,
    })

    const res = await rest.query('products' as EntityTypeId, {})
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items).toEqual([{ id: 'r-1', ref: 'r-1', Baslik: 'Zeynep' }])
    expect(calls[0]?.url).toContain('https://api.example.com/products')
  })

  it('auth "none" never sends the visitor token to the host', async () => {
    stubFetch({ results: [] })
    const rest = createDeclaredConnector({
      name: 'rest',
      declaration: {
        host: '{baseUrl}',
        path: '/lists/{entityType}',
        auth: { type: 'none' as const },
        read: { items: 'results', id: 'id', flatten: '*' },
      } as never,
      config: { baseUrl: 'third-party.example.com' },
      getAccessToken: async () => 'visitor-session-token',
    })
    await rest.query('items' as EntityTypeId, {})
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.auth).toBeUndefined()
  })

  it('read.flatten "*" spreads the ITEM ITSELF, which is the shape flat REST returns', async () => {
    // Without this a flat row arrives carrying only `id`: `mapRow` starts from
    // `{ id }` and adds a bag only when `flatten` names one. Graph's bag is
    // `fields`; a plain REST item has no bag because the item IS the bag.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push({ url: String(url), method: 'GET' })
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 7, ad: 'Kalem', fiyat: 12 }] }),
        } as unknown as Response
      })
    )

    const rest = createDeclaredConnector({
      name: 'rest',
      declaration: {
        host: '{baseUrl}',
        path: '/{entityType}',
        auth: { type: 'none' as const },
        read: { items: 'data', id: 'id', flatten: '*' },
      } as never,
      config: { baseUrl: 'api.example.com' },
      getAccessToken: async () => null,
    })

    const res = await rest.query('products' as EntityTypeId, {})
    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items).toEqual([{ id: 7, ad: 'Kalem', fiyat: 12 }])
  })

  it('leaves graph-lists untouched — a literal read path fills to itself', async () => {
    // The whole change is additive on exactly this evidence: `fill()` on a
    // string with no `{name}` in it returns that string. If this test moves,
    // the change was not additive.
    stubFetch(BODY)
    const res = await engine().query('Adaylar' as EntityTypeId, {})

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items[0]).toEqual({
      id: '1',
      webUrl: 'https://x/1',
      Title: 'Elif',
      Department: 'Engineering',
    })
  })
})

describe('declared host scheme', () => {
  beforeEach(() => {
    calls.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  function restAt(baseUrl: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push({ url: String(url), method: 'GET' })
        return { ok: true, status: 200, json: async () => ({ data: [{ id: 'a' }] }) } as unknown as Response
      })
    )
    return createDeclaredConnector({
      name: 'rest',
      declaration: {
        host: '{baseUrl}',
        path: '/{entityType}',
        auth: { type: 'none' as const },
        read: { items: 'data', id: 'id', flatten: '*' },
      } as never,
      config: { baseUrl },
      getAccessToken: async () => null,
    })
  }

  it.each([
    ['http://127.0.0.1:8787', 'http://127.0.0.1:8787/items'],
    ['http://localhost:3000/api', 'http://localhost:3000/api/items'],
    ['http://[::1]:4000', 'http://[::1]:4000/items'],
    ['http://app.localhost', 'http://app.localhost/items'],
    ['HTTP://LOCALHOST:5000', 'http://LOCALHOST:5000/items'],
  ])('keeps an explicit http:// for the loopback host %s', async (baseUrl, expected) => {
    const res = await restAt(baseUrl).query('items' as EntityTypeId, {})
    expect(res.success).toBe(true)
    expect(calls[0]?.url.toLowerCase()).toBe(expected.toLowerCase())
  })

  it.each([
    ['http://api.example.com', 'https://api.example.com/items'],
    ['http://10.0.0.5:8080', 'https://10.0.0.5:8080/items'],
    ['http://localhost.example.com', 'https://localhost.example.com/items'],
    ['http://127.0.0.2', 'https://127.0.0.2/items'],
  ])('upgrades http:// to https for the non-loopback host %s, as every release before did', async (baseUrl, expected) => {
    const res = await restAt(baseUrl).query('items' as EntityTypeId, {})
    expect(res.success).toBe(true)
    expect(calls[0]?.url).toBe(expected)
  })

  it.each([
    ['api.example.com', 'https://api.example.com/items'],
    ['https://api.example.com', 'https://api.example.com/items'],
    ['localhost:3000', 'https://localhost:3000/items'],
    ['https://127.0.0.1:8787', 'https://127.0.0.1:8787/items'],
  ])('defaults to https for %s, unchanged', async (baseUrl, expected) => {
    const res = await restAt(baseUrl).query('items' as EntityTypeId, {})
    expect(res.success).toBe(true)
    expect(calls[0]?.url).toBe(expected)
  })
})
