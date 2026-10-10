/**
 * HttpEntityConnector.aggregate — the wire shape of a counter.
 *
 * The platform answers `GET <records>/<type>/count` and
 * `GET <records>/<type>/aggregate?fn=&field=&filter=` with
 * `{ data: { fn, field?, value, count, numericCount? }, meta }`
 * (the host's records route). Before this the runtime
 * could only list the collection and count the page it got back.
 *
 * @module @pwfabric/runtime/entity/__tests__/http-connector.aggregate
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { HttpEntityConnector } from '../http-connector.js'
import type { EntityTypeId } from '../types.js'

const urls: string[] = []

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      urls.push(url)
      return {
        ok: status < 400,
        status,
        statusText: 'x',
        json: async () => body,
        text: async () => JSON.stringify(body),
      } as unknown as Response
    })
  )
}

const RSVP = 'Rsvp' as EntityTypeId
const base = 'https://api.test/api/app/w1/p1/records'
const noRetry = { maxRetries: 0, baseDelay: 0, maxDelay: 0, retryableStatuses: [] }

describe('HttpEntityConnector.aggregate', () => {
  beforeEach(() => {
    urls.length = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('count with no field and no filter hits the bare /count route', async () => {
    stubFetch({ data: { fn: 'count', value: 7, count: 7 }, meta: { scope: 'project' } })
    const c = new HttpEntityConnector('records', { baseUrl: base, retry: noRetry })

    const res = await c.aggregate(RSVP, { fn: 'count' })

    expect(urls).toEqual([`${base}/Rsvp/count`])
    expect(res).toEqual({ success: true, result: { fn: 'count', value: 7, count: 7 } })
  })

  it('count with a filter still uses /count and carries the filter as JSON', async () => {
    stubFetch({ data: { fn: 'count', value: 3, count: 3 } })
    const c = new HttpEntityConnector('records', { baseUrl: base })
    const filter = { field: 'status', operator: 'eq' as const, value: 'yes' }

    await c.aggregate(RSVP, { fn: 'count', filter })

    const u = new URL(urls[0] ?? '')
    expect(u.pathname).toBe('/api/app/w1/p1/records/Rsvp/count')
    expect(u.searchParams.get('filter')).toBe(JSON.stringify(filter))
    expect(u.searchParams.has('fn')).toBe(false)
  })

  it('sum over a field goes to /aggregate with fn, field and filter', async () => {
    stubFetch({ data: { fn: 'sum', field: 'guests', value: 42, count: 10, numericCount: 9 } })
    const c = new HttpEntityConnector('records', { baseUrl: base, defaultQueryParams: { 'api-version': '1' } })
    const filter = { field: 'status', operator: 'eq' as const, value: 'yes' }

    const res = await c.aggregate(RSVP, { fn: 'sum', field: 'guests', filter })

    const u = new URL(urls[0] ?? '')
    expect(u.pathname).toBe('/api/app/w1/p1/records/Rsvp/aggregate')
    expect(u.searchParams.get('fn')).toBe('sum')
    expect(u.searchParams.get('field')).toBe('guests')
    expect(u.searchParams.get('filter')).toBe(JSON.stringify(filter))
    // Constants ride along like on every other read.
    expect(u.searchParams.get('api-version')).toBe('1')
    expect(res).toEqual({ success: true, result: { fn: 'sum', field: 'guests', value: 42, count: 10 } })
  })

  it('honours entityPathMapper like every other route', async () => {
    stubFetch({ data: { fn: 'count', value: 1, count: 1 } })
    const c = new HttpEntityConnector('records', {
      baseUrl: 'https://x.test',
      entityPathMapper: (t) => `/v2/${String(t).toLowerCase()}s`,
    })
    await c.aggregate(RSVP, { fn: 'count' })
    expect(urls[0]).toBe('https://x.test/v2/rsvps/count')
  })

  it('a non-2xx answer is an honest failure, not a zero', async () => {
    stubFetch({ error: { code: 'RECORDS_NOT_PUBLIC' } }, 403)
    const c = new HttpEntityConnector('records', { baseUrl: base, retry: noRetry })
    const res = await c.aggregate(RSVP, { fn: 'count' })
    expect(res.success).toBe(false)
    if (!res.success) expect(res.error).toContain('403')
  })

  it('a body without the data envelope is read as the result itself', async () => {
    stubFetch({ fn: 'count', value: 5, count: 5 })
    const c = new HttpEntityConnector('records', { baseUrl: base })
    const res = await c.aggregate(RSVP, { fn: 'count' })
    expect(res).toEqual({ success: true, result: { fn: 'count', value: 5, count: 5 } })
  })
})
