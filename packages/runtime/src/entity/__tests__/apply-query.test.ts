import { describe, it, expect } from 'vitest'
import { applyEntityQuery, matchesEntityFilter, sortEntities } from '../apply-query.js'

const rows = [
  { id: 1, title: 'Alpha', severity: 'high', status: 'new', created: '2026-09-01T10:00:00Z', score: 9, tags: ['a', 'b'] },
  { id: 2, title: 'Bravo', severity: 'medium', status: 'resolved', created: '2026-09-02T10:00:00Z', score: 5, tags: ['b'] },
  { id: 3, title: 'Charlie', severity: 'low', status: 'new', created: '2026-08-30T10:00:00Z', score: 2, tags: [] },
  { id: 4, title: 'Delta', severity: 'high', status: 'inProgress', created: '2026-09-03T10:00:00Z', score: 7, tags: ['c'] },
  { id: 5, title: 'Echo', severity: null, status: 'new', created: null, score: undefined, owner: { name: 'Zed' } },
]

describe('a filter with nothing to compare against is not a constraint', () => {
  // The "All" segment and an empty search box both write '' into state, and
  // resolveQueryState drops a key that resolves to nothing. The leaf that
  // arrives here therefore has no `value` — and read literally that used to
  // mean `field eq undefined`, which emptied the very list the control was
  // meant to widen.
  it('an absent value matches every row instead of none', () => {
    const kept = rows.filter((r) => matchesEntityFilter(r, { field: 'severity', operator: 'eq' })).map((r) => r.id)
    expect(kept).toEqual([1, 2, 3, 4, 5])
  })

  it('an explicit null is still a real comparison', () => {
    const kept = rows.filter((r) => matchesEntityFilter(r, { field: 'severity', operator: 'eq', value: null })).map((r) => r.id)
    expect(kept).toEqual([5])
  })

  it('a valueless leaf does not disable the branches beside it', () => {
    const kept = rows
      .filter((r) =>
        matchesEntityFilter(r, {
          field: 'severity',
          operator: 'eq',
          and: [{ field: 'status', operator: 'eq', value: 'new' }],
        })
      )
      .map((r) => r.id)
    expect(kept).toEqual([1, 3, 5])
  })
})

describe('matchesEntityFilter — 9 operators', () => {
  const m = (filter: Parameters<typeof matchesEntityFilter>[1]) => rows.filter((r) => matchesEntityFilter(r, filter)).map((r) => r.id)

  it('eq / neq (loose: string vs number; null eq null matches)', () => {
    expect(m({ field: 'severity', operator: 'eq', value: 'high' })).toEqual([1, 4])
    expect(m({ field: 'id', operator: 'eq', value: '2' })).toEqual([2])
    expect(m({ field: 'severity', operator: 'neq', value: 'high' })).toEqual([2, 3, 5])
    expect(m({ field: 'severity', operator: 'eq', value: null })).toEqual([5])
  })
  it('gt / gte / lt / lte on numbers and ISO dates; nullish never matches', () => {
    expect(m({ field: 'score', operator: 'gt', value: 5 })).toEqual([1, 4])
    expect(m({ field: 'score', operator: 'gte', value: 5 })).toEqual([1, 2, 4])
    expect(m({ field: 'score', operator: 'lt', value: 5 })).toEqual([3])
    expect(m({ field: 'score', operator: 'lte', value: 5 })).toEqual([2, 3])
    expect(m({ field: 'created', operator: 'gte', value: '2026-09-02' })).toEqual([2, 4])
  })
  it('in / contains / startsWith', () => {
    expect(m({ field: 'status', operator: 'in', value: ['new', 'resolved'] })).toEqual([1, 2, 3, 5])
    expect(m({ field: 'title', operator: 'contains', value: 'ar' })).toEqual([3])
    expect(m({ field: 'tags', operator: 'contains', value: 'b' })).toEqual([1, 2])
    expect(m({ field: 'title', operator: 'startsWith', value: 'd' })).toEqual([4])
  })
  it('dotted path reads nested fields', () => {
    expect(m({ field: 'owner.name', operator: 'eq', value: 'Zed' })).toEqual([5])
  })
  it('and / or combinators, pure-combinator node without field', () => {
    expect(
      m({ field: 'status', operator: 'eq', value: 'new', and: [{ field: 'severity', operator: 'eq', value: 'high' }] })
    ).toEqual([1])
    expect(
      m({
        field: '',
        operator: 'eq',
        value: undefined,
        or: [
          { field: 'severity', operator: 'eq', value: 'low' },
          { field: 'status', operator: 'eq', value: 'resolved' },
        ],
      })
    ).toEqual([2, 3])
  })
})

describe('sortEntities', () => {
  it('sorts asc/desc, nullish last both ways, stable on ties', () => {
    expect(sortEntities(rows, [{ field: 'score', direction: 'asc' }]).map((r) => r.id)).toEqual([3, 2, 4, 1, 5])
    expect(sortEntities(rows, [{ field: 'score', direction: 'desc' }]).map((r) => r.id)).toEqual([1, 4, 2, 3, 5])
    expect(
      sortEntities(rows, [
        { field: 'status', direction: 'asc' },
        { field: 'id', direction: 'desc' },
      ]).map((r) => r.id)
    ).toEqual([4, 5, 3, 1, 2])
  })
  it('does not mutate input', () => {
    const copy = [...rows]
    sortEntities(rows, [{ field: 'id', direction: 'desc' }])
    expect(rows).toEqual(copy)
  })
})

describe('applyEntityQuery — envelope', () => {
  it('empty query returns everything with total', () => {
    const r = applyEntityQuery(rows, undefined)
    expect(r.items).toHaveLength(5)
    expect(r.total).toBe(5)
    expect(r.hasMore).toBe(false)
  })
  it('filter → sort → paginate; total is the filtered count', () => {
    const r = applyEntityQuery(rows, {
      filter: { field: 'status', operator: 'eq', value: 'new' },
      sort: [{ field: 'id', direction: 'desc' }],
      pagination: { offset: 0, limit: 2 },
    })
    expect(r.items.map((x) => x.id)).toEqual([5, 3])
    expect(r.total).toBe(3)
    expect(r.hasMore).toBe(true)
    const page2 = applyEntityQuery(rows, {
      filter: { field: 'status', operator: 'eq', value: 'new' },
      sort: [{ field: 'id', direction: 'desc' }],
      pagination: { offset: 2, limit: 2 },
    })
    expect(page2.items.map((x) => x.id)).toEqual([1])
    expect(page2.hasMore).toBe(false)
  })
  it('offset beyond total yields empty page, hasMore false', () => {
    const r = applyEntityQuery(rows, { pagination: { offset: 10, limit: 5 } })
    expect(r.items).toEqual([])
    expect(r.hasMore).toBe(false)
  })
})

describe('compareOrdered — a number-looking string compares as a number', () => {
  // A form field saves what the visitor typed, so `price` arrives as "95" on
  // one row and 100 on another. Compared as strings, "95" > "100" — so
  // `price gt 100` kept the 95-lira item and `price asc` put 100 before 95.
  // Dates stay strings (ISO order is string order) and so does plain text.
  const priced = [
    { id: 'a', price: '95', when: '2026-01-02', name: 'abc' },
    { id: 'b', price: 100, when: '2026-01-10', name: 'abd' },
    { id: 'c', price: '1000', when: '2025-12-31', name: 'Abe' },
  ]
  const m = (filter: Parameters<typeof matchesEntityFilter>[1]) =>
    priced.filter((r) => matchesEntityFilter(r, filter)).map((r) => r.id)

  it('"95" vs "100": both numeric strings compare numerically', () => {
    expect(m({ field: 'price', operator: 'gt', value: '100' })).toEqual(['c'])
    expect(m({ field: 'price', operator: 'lt', value: '100' })).toEqual(['a'])
    expect(m({ field: 'price', operator: 'gte', value: '100' })).toEqual(['b', 'c'])
  })

  it('95 vs "100": a number against a numeric string compares numerically', () => {
    expect(m({ field: 'price', operator: 'gt', value: 100 })).toEqual(['c'])
    expect(m({ field: 'price', operator: 'lte', value: 100 })).toEqual(['a', 'b'])
  })

  it('"2026-01-02" vs "2026-01-10": ISO dates still compare as strings', () => {
    expect(m({ field: 'when', operator: 'gt', value: '2026-01-02' })).toEqual(['b'])
    expect(m({ field: 'when', operator: 'lt', value: '2026-01-02' })).toEqual(['c'])
  })

  it('"abc" vs "abd": plain text still compares as text', () => {
    expect(m({ field: 'name', operator: 'gt', value: 'abc' })).toEqual(['b'])
    expect(m({ field: 'name', operator: 'lt', value: 'abc' })).toEqual(['c'])
  })

  it('sorting a mixed number/numeric-string column orders by value', () => {
    expect(sortEntities(priced, [{ field: 'price', direction: 'asc' }]).map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(sortEntities(priced, [{ field: 'price', direction: 'desc' }]).map((r) => r.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('compareOrdered — a mixed column sorts in one total order', () => {
  // "2" < "10" as numbers, "10" < "1a" as text, "1a" < "2" as text: a cycle,
  // and Array.prototype.sort then returns an order that depends on the input.
  // Number-looking values now form one class sorted numerically, before every
  // other value, which sorts as text — so any input order sorts the same.
  const values = ['2', '10', '1a', 7, 'b', '0.5']
  const permutations = (xs: unknown[]): unknown[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]))

  it('every input order sorts to the same result, numbers first', () => {
    const results = new Set(
      permutations(values).map((p) =>
        JSON.stringify(sortEntities(p.map((v) => ({ v })), [{ field: 'v', direction: 'asc' }]).map((r) => r.v))
      )
    )
    expect([...results]).toEqual([JSON.stringify(['0.5', '2', 7, '10', '1a', 'b'])])
  })

  it('desc is the exact reverse', () => {
    const out = sortEntities(values.map((v) => ({ v })), [{ field: 'v', direction: 'desc' }]).map((r) => r.v)
    expect(out).toEqual(['b', '1a', '10', 7, '2', '0.5'])
  })

  it('"007" is the number 7: a tie, so the stable sort keeps input order', () => {
    // Design note: leading-zero codes (postcodes, phone numbers) sort as
    // numbers and "007" ties "7". A field that must keep text order should
    // not look like a number.
    expect(sortEntities([{ v: '007' }, { v: 7 }], [{ field: 'v', direction: 'asc' }]).map((r) => r.v)).toEqual(['007', 7])
    expect(sortEntities([{ v: 7 }, { v: '007' }], [{ field: 'v', direction: 'asc' }]).map((r) => r.v)).toEqual([7, '007'])
  })
})
