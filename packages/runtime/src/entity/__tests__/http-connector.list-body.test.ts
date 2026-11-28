/**
 * A bare JSON array answer (`GET /posts → [ {...} ]`) reaches a response
 * mapper, which is the only thing that can read it; without a mapper it is
 * still refused, as before.
 *
 * @module @pwfabric/runtime/entity/__tests__/http-connector.list-body
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { HttpEntityConnector } from '../http-connector.js'
import type { EntityTypeId } from '../types.js'

const T = 'posts' as EntityTypeId
const NO_RETRY = { maxRetries: 0, baseDelay: 0, maxDelay: 0, retryableStatuses: [] }

function answer(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as unknown as Response)
  )
}

describe('HttpEntityConnector — a bare-array answer', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reaches the response mapper on a query', async () => {
    answer([{ id: 1 }, { id: 2 }])
    const seen: unknown[] = []
    const c = new HttpEntityConnector('rest', {
      baseUrl: 'https://api.example.com',
      retry: NO_RETRY,
      responseMapper: (raw) => {
        seen.push(raw)
        return { items: raw as unknown[] }
      },
    })
    const res = await c.query(T, {})
    expect(seen).toEqual([[{ id: 1 }, { id: 2 }]])
    expect(res).toMatchObject({ success: true, result: { items: [{ id: 1 }, { id: 2 }], total: 2 } })
  })

  it('is still refused without a mapper', async () => {
    answer([{ id: 1 }])
    const c = new HttpEntityConnector('rest', { baseUrl: 'https://api.example.com', retry: NO_RETRY })
    const res = await c.query(T, {})
    expect(res).toMatchObject({ success: false })
  })

  it('is still refused by a single read', async () => {
    answer([{ id: 1 }])
    const c = new HttpEntityConnector('rest', {
      baseUrl: 'https://api.example.com',
      retry: NO_RETRY,
      responseMapper: (raw) => ({ items: raw as unknown[] }),
    })
    const res = await c.read(T, '1')
    expect(res).toMatchObject({ success: false })
  })
})
