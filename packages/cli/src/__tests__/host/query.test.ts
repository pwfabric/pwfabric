import { describe, expect, it } from 'vitest'
import { aggregate, matches, parseFilter, parseSort, sortRows } from '../../host/query.js'
import { TokenStore } from '../../host/tokens.js'

const rows = [
  { id: 'a', name: 'Tea', price: 4, tags: ['hot'], meta: { color: 'green' }, done: true },
  { id: 'b', name: 'Coffee', price: '6', tags: ['hot', 'strong'], meta: { color: 'brown' }, done: false },
  { id: 'c', name: 'Juice', price: null, tags: [], meta: null, done: false },
  { id: 'd', name: 'water', price: 'free', tags: 'cold' },
]
const ids = (f: Parameters<typeof matches>[1]): string[] => rows.filter((r) => matches(r, f)).map((r) => r.id)

describe('query language', () => {
  it('applies every operator the way the runtime does', () => {
    expect(ids({ field: 'price', operator: 'eq', value: 6 })).toEqual(['b'])
    expect(ids({ field: 'price', operator: 'neq', value: 4 })).toEqual(['b', 'c', 'd'])
    expect(ids({ field: 'price', operator: 'gt', value: 4 })).toEqual(['b', 'd'])
    expect(ids({ field: 'price', operator: 'gte', value: 4 })).toEqual(['a', 'b', 'd'])
    expect(ids({ field: 'price', operator: 'lt', value: 6 })).toEqual(['a'])
    expect(ids({ field: 'price', operator: 'lte', value: 'free' })).toEqual(['a', 'b', 'd'])
    expect(ids({ field: 'name', operator: 'in', value: ['Tea', 'Juice'] })).toEqual(['a', 'c'])
    expect(ids({ field: 'name', operator: 'in', value: 'Tea' })).toEqual(['a'])
    expect(ids({ field: 'tags', operator: 'contains', value: 'strong' })).toEqual(['b'])
    expect(ids({ field: 'name', operator: 'contains', value: 'OFF' })).toEqual(['b'])
    expect(ids({ field: 'meta.color', operator: 'startsWith', value: 'GR' })).toEqual(['a'])
    expect(ids({ field: 'meta.color.deep', operator: 'eq', value: 'x' })).toEqual([])
    expect(ids({ field: 'meta', operator: 'eq', value: { color: 'green' } })).toEqual([])
    expect(ids({ field: 'done', operator: 'gt', value: 0 })).toEqual(['a'])
    expect(ids({ field: 'name', operator: 'regex', value: '.' })).toEqual([])
    expect(ids({ field: 'name', operator: 'eq' })).toEqual(['a', 'b', 'c', 'd'])
    expect(ids({ field: 'price', operator: 'contains', value: 'x' })).toEqual([])
    expect(ids({ field: 'price', operator: 'startsWith', value: 'f' })).toEqual(['d'])
    expect(
      ids({ and: [{ field: 'tags', operator: 'contains', value: 'hot' }], or: [{ field: 'name', operator: 'eq', value: 'Tea' }, { field: 'price', operator: 'eq', value: '6' }] })
    ).toEqual(['a', 'b'])
  })

  it('sorts numbers before text, nulls last, stably', () => {
    expect(sortRows(rows, [{ field: 'price', direction: 'asc' }]).map((r) => r.id)).toEqual(['a', 'b', 'd', 'c'])
    expect(sortRows(rows, [{ field: 'price', direction: 'desc' }]).map((r) => r.id)).toEqual(['d', 'b', 'a', 'c'])
    expect(sortRows(rows, [{ field: 'missing', direction: 'asc' }, { field: 'name', direction: 'asc' }]).map((r) => r.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(sortRows(rows, [{ field: 'missing', direction: 'asc' }]).map((r) => r.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('parses the connector wire format', () => {
    expect(parseSort('a:desc, b ,:asc,c:ASC,')).toEqual([
      { field: 'a', direction: 'desc' },
      { field: 'b', direction: 'asc' },
      { field: 'c', direction: 'asc' },
    ])
    expect(parseSort(null)).toEqual([])
    expect(parseFilter(null)).toBeUndefined()
    expect(parseFilter('  ')).toBeUndefined()
    expect(() => parseFilter('null')).toThrow()
    expect(parseFilter('{"field":"a"}')).toEqual({ field: 'a' })
  })

  it('aggregates over numbers it can read', () => {
    expect(aggregate(rows, 'sum', 'price')).toEqual({ fn: 'sum', field: 'price', value: 10, count: 4 })
    expect(aggregate(rows, 'avg', 'price')).toEqual({ fn: 'avg', field: 'price', value: 5, count: 4 })
    expect(aggregate(rows, 'sum', undefined)).toEqual({ fn: 'sum', value: null, count: 4 })
  })
})

describe('token store', () => {
  it('forgets an expired token on lookup and ignores missing ones', () => {
    const store = new TokenStore<{ expiresAt: number }>()
    const live = store.issue({ expiresAt: Date.now() + 60_000 })
    const dead = store.issue({ expiresAt: Date.now() - 1 })
    expect(store.get(live)).toBeDefined()
    expect(store.get(dead)).toBeUndefined()
    expect(store.get(undefined)).toBeUndefined()
    expect(store.take(undefined)).toBeUndefined()
    store.revoke(undefined)
    expect(store.take(live)).toBeDefined()
    expect(store.get(live)).toBeUndefined()
  })
})
