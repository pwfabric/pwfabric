/**
 * D1 — a connector failure says WHY, as a code a page can branch on.
 *
 * The renderer binds `__errorCodes.<id>` from it (data-protocol §2.5); without
 * the code an engine-served source could only report the internal string
 * "HTTP 403: …".
 *
 * @module @pwfabric/runtime/entity/__tests__/http-connector.failure-code
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

import { HttpEntityConnector } from '../http-connector.js'
import type { EntityTypeId } from '../types.js'

const T = 'Order' as EntityTypeId
const connector = (): HttpEntityConnector =>
  new HttpEntityConnector('shop', { baseUrl: 'https://api.example.com', retry: { maxRetries: 0, baseDelay: 0, maxDelay: 0, retryableStatuses: [] } })

describe('HttpEntityConnector — failure codes', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('a refused read carries the HTTP status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, statusText: 'Forbidden', text: async () => '' }) as unknown as Response)
    )
    const res = await connector().query(T, {})
    expect(res).toMatchObject({ success: false, code: 403 })
  })

  it('no answer at all is "network"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    const res = await connector().query(T, {})
    expect(res).toMatchObject({ success: false, code: 'network' })
  })
})
