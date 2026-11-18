/**
 * A write sends the record's fields only (data-protocol §4.1): a helper
 * control (a one-time code) stays on the page instead of making the server
 * refuse the whole write with a 400.
 *
 * @module @pwfabric/runtime/render/__tests__/source-writer-fields
 */
import { describe, it, expect, vi } from 'vitest'
import { createSourceWriter } from '../source-writer.js'
import type { SurfaceDataSourceDefinition } from '../data-binding-types.js'

function dataService() {
  return {
    fetchData: vi.fn(async (_id: string, _opts: { body?: unknown }) => ({
      success: true as const,
      data: { data: { id: 'b1' } },
      metadata: {},
    })),
  }
}

const bookings = (fields?: Record<string, string>): SurfaceDataSourceDefinition =>
  ({ id: 'bookings', kind: 'rest', endpoint: 'http://localhost/api/records/Booking', ...(fields ? { fields } : {}) }) as SurfaceDataSourceDefinition

const typed = { treatment: 'assessment', name: 'Ada', code: '123456' }

describe('a write sends the record fields only', () => {
  it('a source that knows its fields drops every other named value', async () => {
    const ds = dataService()
    const write = createSourceWriter({ dataSources: [bookings({ treatment: 'enum', name: 'text', note: 'text' })], entityFacade: null, dataService: ds as never })
    const res = await write('bookings', { op: 'create', values: typed })
    expect(res.success).toBe(true)
    expect(ds.fetchData.mock.calls[0]?.[1].body).toEqual({ treatment: 'assessment', name: 'Ada' })
  })

  it('an update is cut the same way', async () => {
    const ds = dataService()
    const write = createSourceWriter({ dataSources: [bookings({ name: 'text' })], entityFacade: null, dataService: ds as never })
    await write('bookings', { op: 'update', id: 'b1', values: typed })
    expect(ds.fetchData.mock.calls[0]?.[1].body).toEqual({ name: 'Ada' })
  })

  it('a source that does not know its fields sends what was gathered', async () => {
    const ds = dataService()
    const write = createSourceWriter({ dataSources: [bookings()], entityFacade: null, dataService: ds as never })
    await write('bookings', { op: 'create', values: typed })
    expect(ds.fetchData.mock.calls[0]?.[1].body).toEqual(typed)
  })

  it('the entity facade path is cut too', async () => {
    const create = vi.fn(async () => ({ success: true, id: 'b1', data: {} }))
    const facade = { store: { create } }
    const source = { id: 'bookings', kind: 'entity', entityType: 'Booking', fields: { name: 'text' } } as SurfaceDataSourceDefinition
    const write = createSourceWriter({ dataSources: [source], entityFacade: facade as never, dataService: null })
    await write('bookings', { op: 'create', values: typed })
    expect(create).toHaveBeenCalledWith('Booking', { name: 'Ada' })
  })

  it('sends each field as its declared type: a slider numeral is a number, a checkbox is a boolean', async () => {
    const ds = dataService()
    const source = bookings({ threshold: 'number', alerts: 'boolean', muted: 'boolean', note: 'text', limit: 'number' })
    const write = createSourceWriter({ dataSources: [source], entityFacade: null, dataService: ds as never })
    await write('bookings', { op: 'create', values: { threshold: '10', alerts: 'on', muted: 'false', note: '10', limit: 'ten' } })
    expect(ds.fetchData.mock.calls[0]?.[1].body).toEqual({ threshold: 10, alerts: true, muted: false, note: '10', limit: 'ten' })
  })

  it('a file in the values is refused with the field named, and nothing is sent', async () => {
    const ds = dataService()
    const write = createSourceWriter({ dataSources: [bookings()], entityFacade: null, dataService: ds as never })
    const res = await write('bookings', { op: 'create', values: { logo: new Blob(['x']), name: 'Ada' } })
    expect(res.success).toBe(false)
    expect(res.success === false && res.error.message).toContain('"logo" holds a file')
    expect(ds.fetchData).not.toHaveBeenCalled()
  })
})
