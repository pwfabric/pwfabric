/**
 * DataService — a REST answer carries its HTTP status and, when `returns`
 * plucked the list out of the body, the rest of that body (`envelope`).
 * DummyJSON's `{ products, total, skip, limit }` is the measured shape.
 *
 * @module @pwfabric/runtime/data/__tests__/manager-envelope
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { DataService } from '../manager.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

function reply(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: status < 400, status, statusText: status === 404 ? 'Not Found' : 'OK', json: async () => body })) as never
  )
}

describe('DataService — status and envelope', () => {
  it('returns: "products" → rows, status 200 and { total, skip, limit }', async () => {
    reply(200, { products: [{ id: 1 }, { id: 2 }], total: 194, skip: 0, limit: 30 })
    const ds = new DataService()
    ds.registerSource({ id: 'p', kind: 'rest', endpoint: 'https://dummyjson.com/products', returns: 'products' })
    const r = await ds.fetchData('p')
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data).toEqual([{ id: 1 }, { id: 2 }])
    expect(r.metadata.status).toBe(200)
    expect(r.metadata.envelope).toEqual({ total: 194, skip: 0, limit: 30 })
  })

  it('a nested returns path leaves every top-level field but its head', async () => {
    reply(200, { data: { items: [1] }, page: 3 })
    const ds = new DataService()
    ds.registerSource({ id: 'p', kind: 'rest', endpoint: '/x', returns: 'data.items' })
    const r = await ds.fetchData('p')
    expect(r.success && r.metadata.envelope).toEqual({ page: 3 })
  })

  it('no returns → no envelope; a transform still applies to the rows', async () => {
    reply(200, [{ id: 1 }])
    const ds = new DataService()
    ds.registerSource({ id: 'p', kind: 'rest', endpoint: '/x', transform: (d) => (d as unknown[]).length })
    const r = await ds.fetchData('p')
    expect(r.success && r.data).toBe(1)
    expect(r.success && r.metadata.envelope).toBeUndefined()
    expect(r.success && r.metadata.status).toBe(200)
  })

  it('a 404 is a failure that carries status 404', async () => {
    reply(404, { message: "Cart with id '999' not found" })
    const ds = new DataService()
    ds.registerSource({ id: 'c', kind: 'rest', endpoint: 'https://dummyjson.com/carts/999', returns: 'products' })
    const r = await ds.fetchData('c')
    expect(r.success).toBe(false)
    if (r.success) return
    expect(r.error.status).toBe(404)
  })

  it('a static source has no status', async () => {
    const ds = new DataService()
    ds.registerSource({ id: 's', kind: 'static', staticData: [1] })
    const r = await ds.fetchData('s')
    expect(r.success && r.metadata.status).toBeUndefined()
  })
})
