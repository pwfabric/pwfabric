/**
 * the two seams that make `HttpEntityConnector` the base
 * every engine can sit on.
 *
 * `token` may be a resolver: a delegated PKCE token expires within the hour,
 * so an engine needing a live token could not wrap this class with a fixed
 * string, and would have to reimplement the transport (without retry,
 * timeout or envelope).
 *
 * The response half: `entityPathMapper` lets a caller say how an entity type
 * becomes a URL, and `responseMapper` how the answer comes back — so a vendor
 * replying `{ value: [{ id, fields }] }` can use this class too.
 *
 * @module @pwfabric/runtime/entity/__tests__/http-connector.auth
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { HttpEntityConnector } from '../http-connector.js'
import type { EntityTypeId } from '../types.js'

const captured: Array<Record<string, string>> = []

function stubFetch(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) => {
      captured.push((init.headers ?? {}) as Record<string, string>)
      return { ok: true, status: 200, json: async () => body } as unknown as Response
    })
  )
}

describe('HttpEntityConnector — a callable token', () => {
  beforeEach(() => {
    captured.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('accepts a resolver and sends what it answered', async () => {
    stubFetch({ items: [] })
    const c = new HttpEntityConnector('graph', {
      baseUrl: 'https://graph.test',
      auth: { type: 'bearer', token: async () => 'live-token' },
    })

    await c.query('Adaylar' as EntityTypeId, {})

    expect(captured[0]?.['Authorization']).toBe('Bearer live-token')
  })

  it('re-invokes the resolver on EVERY request — the reason it is a function', async () => {
    stubFetch({ items: [] })
    let n = 0
    const c = new HttpEntityConnector('graph', {
      baseUrl: 'https://graph.test',
      auth: { type: 'bearer', token: async () => `token-${++n}` },
    })

    await c.query('Adaylar' as EntityTypeId, {})
    await c.query('Oylar' as EntityTypeId, {})

    expect(captured.map((h) => h['Authorization'])).toEqual(['Bearer token-1', 'Bearer token-2'])
  })

  it('a plain string token behaves exactly as before — the widening is additive', async () => {
    stubFetch({ items: [] })
    const c = new HttpEntityConnector('api', {
      baseUrl: 'https://api.test',
      auth: { type: 'bearer', token: 'static-token' },
    })

    await c.query('Thing' as EntityTypeId, {})

    expect(captured[0]?.['Authorization']).toBe('Bearer static-token')
  })

  it('a resolver answering null sends no header rather than an empty one', async () => {
    stubFetch({ items: [] })
    const c = new HttpEntityConnector('graph', {
      baseUrl: 'https://graph.test',
      auth: { type: 'bearer', token: async () => null },
    })

    await c.query('Adaylar' as EntityTypeId, {})

    expect(captured[0]?.['Authorization']).toBeUndefined()
  })
})

describe('HttpEntityConnector — responseMapper', () => {
  beforeEach(() => {
    captured.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('accepts a vendor shape this class would otherwise reject', async () => {
    // Graph's real answer for a SharePoint list.
    stubFetch({ value: [{ id: '1', fields: { Title: 'Elif' } }, { id: '2', fields: { Title: 'Kaan' } }] })
    const c = new HttpEntityConnector('graph-lists', {
      baseUrl: 'https://graph.test',
      responseMapper: (raw) => ({
        items: ((raw as { value?: unknown[] }).value ?? []).map((r) => {
          const row = r as { id: string; fields?: Record<string, unknown> }
          return { id: row.id, ...(row.fields ?? {}) }
        }),
      }),
    })

    const res = await c.query('Adaylar' as EntityTypeId, {})

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items).toEqual([
      { id: '1', Title: 'Elif' },
      { id: '2', Title: 'Kaan' },
    ])
    expect(res.result.total).toBe(2)
  })

  it('without a mapper the built-in shapes are unchanged', async () => {
    stubFetch({ items: [{ id: 'a' }], total: 1 })
    const c = new HttpEntityConnector('api', { baseUrl: 'https://api.test' })

    const res = await c.query('Thing' as EntityTypeId, {})

    expect(res.success).toBe(true)
    if (!res.success) return
    expect(res.result.items).toEqual([{ id: 'a' }])
  })
})
