import { describe, it, expect } from 'vitest'
import { resolveQueryState, queryHasState, queryAsksForNothing } from '../query-state.js'

describe('resolveQueryState — {{state.x}} inside a data-source query', () => {
  const state = { page: 3, pageSize: 20, severity: 'high', tags: ['a', 'b'], empty: undefined }

  it('whole-expression strings resolve to the RAW value (number stays number, array stays array)', () => {
    const q = resolveQueryState(
      {
        pagination: { offset: '{{state.page}}', limit: '{{ state.pageSize }}' },
        filter: { field: 'tags', operator: 'in', value: '{{state.tags}}' },
      },
      state
    )
    expect(q.pagination).toEqual({ offset: 3, limit: 20 })
    expect(q.filter.value).toEqual(['a', 'b'])
  })

  it('mixed strings interpolate to a string; plain strings pass through untouched', () => {
    const q = resolveQueryState({ filter: { field: 'title', operator: 'startsWith', value: 'sev-{{state.severity}}' } }, state)
    expect(q.filter.value).toBe('sev-high')
    expect(q.filter.field).toBe('title')
  })

  it('an unresolved whole expression DROPS the key (no constraint), never a literal undefined', () => {
    const q = resolveQueryState({ filter: { field: 'x', operator: 'eq', value: '{{state.missing}}' } }, state)
    expect('value' in q.filter).toBe(false)
  })

  it('walks nested and/or arrays', () => {
    const q = resolveQueryState(
      { filter: { field: '', operator: 'eq', value: null, or: [{ field: 'severity', operator: 'eq', value: '{{state.severity}}' }] } },
      state
    )
    expect(q.filter.or[0].value).toBe('high')
  })

  it('queryHasState detects expressions anywhere in the tree', () => {
    expect(queryHasState({ pagination: { offset: 0 } })).toBe(false)
    expect(queryHasState({ filter: { and: [{ value: '{{state.a}}' }] } })).toBe(true)
  })
})

describe('an emptied control is no constraint', () => {
  it("a whole expression resolving to '' or null drops its key", () => {
    const q = resolveQueryState(
      { filter: { field: 'severity', operator: 'eq', value: '{{state.severity}}' } },
      { severity: '' }
    )
    expect(q.filter).toEqual({ field: 'severity', operator: 'eq' })
    const q2 = resolveQueryState(
      { filter: { field: 'owner', operator: 'eq', value: '{{state.owner}}' } },
      { owner: null }
    )
    expect(q2.filter).toEqual({ field: 'owner', operator: 'eq' })
  })

  it('a literal empty string an author wrote is left alone', () => {
    const q = resolveQueryState({ filter: { field: 'note', operator: 'eq', value: '' } }, { note: 'x' })
    expect(q.filter.value).toBe('')
  })
})

describe('the caller in a query value: {{me.*}} (E5)', () => {
  const mine = { filter: { field: 'email', operator: 'eq', value: '{{me.email}}' } }

  it('resolves against the signed-in visitor', () => {
    expect(resolveQueryState(mine, {}, { id: 'u-1', email: 'ada@x.io' })).toEqual({
      filter: { field: 'email', operator: 'eq', value: 'ada@x.io' },
    })
    expect(queryAsksForNothing(mine, {}, false, { email: 'ada@x.io' })).toBe(false)
  })

  it('signed out, a condition on the caller matches nothing — it never lists everyone', () => {
    expect(queryAsksForNothing(mine, {}, false, null)).toBe(true)
    expect(queryAsksForNothing(mine, {}, false)).toBe(true)
    const any = { filter: { field: 'members', operator: 'contains', value: '{{me.id}}' } }
    expect(queryAsksForNothing(any, {}, false, null)).toBe(true)
    // Inside an `and`, one such member is enough; an `or` needs every branch.
    const and = { filter: { and: [{ field: 'status', operator: 'eq', value: 'open' }, mine.filter] } }
    expect(queryAsksForNothing(and, {}, false, null)).toBe(true)
    const or = { filter: { or: [{ field: 'public', operator: 'eq', value: true }, mine.filter] } }
    expect(queryAsksForNothing(or, {}, false, null)).toBe(false)
  })

  it('a state value named `me` is not the caller', () => {
    const q = { filter: { field: 'tag', operator: 'eq', value: '{{state.me}}' } }
    expect(queryAsksForNothing(q, {}, false, null)).toBe(false)
  })
})
