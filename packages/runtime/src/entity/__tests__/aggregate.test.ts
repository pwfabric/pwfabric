/**
 * aggregateEntities / aggregateThrough — the in-memory half of a counter.
 *
 * The platform connector asks the server. Every other connector (static,
 * declared engines, a host facade that predates `resolveAggregate`) only
 * lists, so the same reduction has to exist here, over the rows a query
 * returns — and the store reaches it when a connector has no `aggregate`.
 *
 * @module @pwfabric/runtime/entity/__tests__/aggregate
 */
import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { aggregateEntities } from '../apply-query.js'
import { aggregateThrough } from '../aggregate.js'
import { DefaultEntityStore } from '../store.js'
import type { EntityStore } from '../store.js'
import { DefaultEntityFacade } from '../facade.js'
import { createEntityLifecycleEngine } from '../behavior.js'
import { InMemoryEntityRegistry } from '../registry.js'
import { InMemoryConnectorRegistry } from '../connector.js'
import { StaticConnector } from '../connectors/static.js'
import type { EntityDefinition, EntityTypeId } from '../types.js'

const rows = [
  { id: 1, status: 'yes', guests: 2 },
  { id: 2, status: 'yes', guests: '3' },
  { id: 3, status: 'no', guests: 1 },
  { id: 4, status: 'yes', guests: null },
  { id: 5, status: 'yes' },
]

describe('aggregateEntities', () => {
  it('count is the row count; the filter narrows it', () => {
    expect(aggregateEntities(rows, { fn: 'count' })).toEqual({ fn: 'count', value: 5, count: 5 })
    expect(
      aggregateEntities(rows, { fn: 'count', filter: { field: 'status', operator: 'eq', value: 'yes' } })
    ).toEqual({ fn: 'count', value: 4, count: 4 })
  })

  it('sum / avg read the field, numeric strings included, nullish skipped', () => {
    expect(aggregateEntities(rows, { fn: 'sum', field: 'guests' })).toEqual({ fn: 'sum', field: 'guests', value: 6, count: 5 })
    expect(aggregateEntities(rows, { fn: 'avg', field: 'guests' })).toEqual({ fn: 'avg', field: 'guests', value: 2, count: 5 })
  })

  it('reduces a large list without spreading it into arguments', () => {
    const big = Array.from({ length: 300_000 }, (_, i) => ({ n: i % 10 }))
    expect(aggregateEntities(big, { fn: 'sum', field: 'n' }).value).toBe(1_350_000)
    expect(aggregateEntities(big, { fn: 'avg', field: 'n' }).value).toBe(4.5)
  })

  it('an fn outside count|sum|avg answers null rather than guessing', () => {
    expect(aggregateEntities(rows, { fn: 'max' as never, field: 'guests' }).value).toBeNull()
  })

  it('a numeric fn over no numeric values is null, not 0', () => {
    expect(aggregateEntities([{ id: 1 }], { fn: 'avg', field: 'guests' })).toEqual({ fn: 'avg', field: 'guests', value: null, count: 1 })
    expect(aggregateEntities([], { fn: 'sum', field: 'guests' })).toEqual({ fn: 'sum', field: 'guests', value: null, count: 0 })
  })

  it('a numeric fn without a field is null', () => {
    expect(aggregateEntities(rows, { fn: 'sum' })).toEqual({ fn: 'sum', value: null, count: 5 })
  })
})

describe('aggregateThrough', () => {
  const T = 'Rsvp' as EntityTypeId
  it('uses the connector aggregate when it has one', async () => {
    const aggregate = vi.fn(async () => ({ success: true as const, result: { fn: 'count' as const, value: 9, count: 9 } }))
    const query = vi.fn()
    const res = await aggregateThrough({ aggregate, query }, T, { fn: 'count' })
    expect(res).toEqual({ success: true, result: { fn: 'count', value: 9, count: 9 } })
    expect(query).not.toHaveBeenCalled()
  })

  it('falls back to a filtered query and reduces the rows when it has none', async () => {
    const query = vi.fn(async () => ({
      success: true as const,
      result: { items: rows.filter((r) => r.status === 'yes'), total: 4, offset: 0, limit: 50, hasMore: false },
    }))
    const filter = { field: 'status', operator: 'eq' as const, value: 'yes' }
    const res = await aggregateThrough({ query }, T, { fn: 'sum', field: 'guests', filter })
    expect(query).toHaveBeenCalledWith(T, { filter })
    expect(res).toEqual({ success: true, result: { fn: 'sum', field: 'guests', value: 5, count: 4 } })
  })

  it('passes a query failure through', async () => {
    const query = vi.fn(async () => ({ success: false as const, error: 'HTTP 403' }))
    const res = await aggregateThrough({ query }, T, { fn: 'count' })
    expect(res).toEqual({ success: false, error: 'HTTP 403' })
  })
})

describe('DefaultEntityStore.aggregate', () => {
  const T = 'Rsvp' as EntityTypeId
  const def: EntityDefinition = {
    id: T,
    name: 'Rsvp',
    fields: [
      { name: 'id', type: 'string', required: true },
      { name: 'status', type: 'string', required: false },
    ],
    relations: [],
    primaryKey: 'id',
    schema: z.object({ id: z.string(), status: z.string().optional() }),
  }

  it('counts through a connector that only lists (static)', async () => {
    const registry = new InMemoryEntityRegistry()
    registry.register(def)
    const connectors = new InMemoryConnectorRegistry()
    connectors.register(new StaticConnector('static'))
    connectors.setDefault('static')
    const store = new DefaultEntityStore(registry, connectors)
    await store.create(T, { id: 'a', status: 'yes' })
    await store.create(T, { id: 'b', status: 'yes' })
    await store.create(T, { id: 'c', status: 'no' })

    const all = await store.aggregate(T, { fn: 'count' })
    expect(all).toEqual({ fn: 'count', value: 3, count: 3 })
    const yes = await store.aggregate(T, { fn: 'count', filter: { field: 'status', operator: 'eq', value: 'yes' } })
    expect(yes.value).toBe(2)
  })

  // A list that cannot be served is honestly empty; a counter that
  // cannot be served is NOT zero. "0 people are coming" on a 403 is a lie, so
  // the store rejects and the renderer binds `fallback` / `__errors.<id>`.
  it('an unregistered type rejects instead of answering 0', async () => {
    const store = new DefaultEntityStore(new InMemoryEntityRegistry(), new InMemoryConnectorRegistry())
    await expect(store.aggregate('Nope' as EntityTypeId, { fn: 'count' })).rejects.toThrow(/Nope/)
  })

  it('a connector failure (403) rejects with its reason instead of answering 0', async () => {
    const registry = new InMemoryEntityRegistry()
    registry.register(def)
    const connectors = new InMemoryConnectorRegistry()
    connectors.register({
      name: 'http',
      type: 'http',
      create: vi.fn(),
      read: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      query: vi.fn(),
      aggregate: vi.fn(async () => ({ success: false as const, error: 'HTTP 403: RECORDS_NOT_PUBLIC' })),
    } as never)
    connectors.setDefault('http')
    const store = new DefaultEntityStore(registry, connectors)
    await expect(store.aggregate(T, { fn: 'count' })).rejects.toThrow('HTTP 403: RECORDS_NOT_PUBLIC')
  })
})

describe('DefaultEntityFacade.resolveAggregate — EntityStore.aggregate is optional', () => {
  it('a store without aggregate is listed and reduced', async () => {
    const query = vi.fn(async () => ({ items: [{ g: 2 }, { g: 5 }], total: 2, offset: 0, limit: 50, hasMore: false }))
    const store = { create: vi.fn(), read: vi.fn(), update: vi.fn(), delete: vi.fn(), query } as unknown as EntityStore
    const facade = new DefaultEntityFacade(
      new InMemoryEntityRegistry(),
      store,
      new InMemoryConnectorRegistry(),
      createEntityLifecycleEngine()
    )
    const filter = { field: 'g', operator: 'gt' as const, value: 0 }
    expect(await facade.resolveAggregate('Rsvp' as EntityTypeId, { fn: 'sum', field: 'g', filter })).toEqual({
      fn: 'sum',
      field: 'g',
      value: 7,
      count: 2,
    })
    expect(query).toHaveBeenCalledWith('Rsvp', { filter })
  })
})
