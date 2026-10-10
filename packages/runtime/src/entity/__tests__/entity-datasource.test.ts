/**
 * EntityDataSource Tests
 *
 * createEntityDataSource() wraps EntityStore.query() as a
 * DataSource adapter.
 *
 * @module @pwfabric/runtime/entity/__tests__/entity-datasource
 */

import { describe, it, expect, vi } from 'vitest'
import { createEntityDataSource } from '../entity-datasource.js'
import { createEntityFacade } from '../facade.js'
import type { EntityTypeId, EntityQueryResult } from '../types.js'

const EMPLOYEE_TYPE = 'Employee' as EntityTypeId

// ============================================================
// HELPERS
// ============================================================

function makeQueryResult(overrides?: Partial<EntityQueryResult>): EntityQueryResult {
  return {
    items: [],
    total: 0,
    ...overrides,
  }
}

// ============================================================
// TESTS
// ============================================================

describe('createEntityDataSource', () => {
  it('returns an EntityDataSource with type "entity"', () => {
    const facade = createEntityFacade()
    const ds = createEntityDataSource(facade, { id: 'employees', entityType: EMPLOYEE_TYPE })
    expect(ds.type).toBe('entity')
  })

  it('returns the configured id', () => {
    const facade = createEntityFacade()
    const ds = createEntityDataSource(facade, { id: 'employees', entityType: EMPLOYEE_TYPE })
    expect(ds.id).toBe('employees')
  })

  it('fetch() calls facade.resolveBinding with the configured entityType', async () => {
    const facade = createEntityFacade()
    const expected = makeQueryResult({ items: [{ id: '1', name: 'Alice' }], total: 1 })
    const spy = vi.spyOn(facade, 'resolveBinding').mockResolvedValueOnce(expected)

    const ds = createEntityDataSource(facade, { id: 'employees', entityType: EMPLOYEE_TYPE })
    const result = await ds.fetch()

    expect(spy).toHaveBeenCalledWith(EMPLOYEE_TYPE, undefined)
    expect(result).toBe(expected)
  })

  it('fetch() passes query to facade.resolveBinding when query is provided', async () => {
    const facade = createEntityFacade()
    const query = { sort: [{ field: 'name', direction: 'asc' as const }] }
    const spy = vi.spyOn(facade, 'resolveBinding').mockResolvedValueOnce(makeQueryResult())

    const ds = createEntityDataSource(facade, {
      id: 'employees',
      entityType: EMPLOYEE_TYPE,
      query,
    })
    await ds.fetch()

    expect(spy).toHaveBeenCalledWith(EMPLOYEE_TYPE, query)
  })

  it('fetch() returns the EntityQueryResult from resolveBinding', async () => {
    const facade = createEntityFacade()
    const expected = makeQueryResult({
      items: [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
      total: 2,
    })
    vi.spyOn(facade, 'resolveBinding').mockResolvedValueOnce(expected)

    const ds = createEntityDataSource(facade, { id: 'users', entityType: EMPLOYEE_TYPE })
    const result = await ds.fetch()

    expect(result).toEqual(expected)
    expect(result.items).toHaveLength(2)
    expect(result.total).toBe(2)
  })

  it('each call to fetch() invokes resolveBinding independently', async () => {
    const facade = createEntityFacade()
    const spy = vi
      .spyOn(facade, 'resolveBinding')
      .mockResolvedValueOnce(makeQueryResult({ total: 1 }))
      .mockResolvedValueOnce(makeQueryResult({ total: 2 }))

    const ds = createEntityDataSource(facade, { id: 'employees', entityType: EMPLOYEE_TYPE })
    const r1 = await ds.fetch()
    const r2 = await ds.fetch()

    expect(spy).toHaveBeenCalledTimes(2)
    expect(r1.total).toBe(1)
    expect(r2.total).toBe(2)
  })
})
