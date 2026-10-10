/**
 * applyEntityQuery — the ONE place an `EntityQuery` is actually applied.
 *
 * Engines typically read the filter only as a NAMED-PARAMETER lookup
 * (`ctx.filter('siteId')`) and apply neither `operator` nor sort/pagination,
 * so a pattern that declared
 * `{ filter: { field: 'isRead', operator: 'eq', value: false } }` would be
 * silently ignored. Connectors call this on their result envelope so the
 * declared query is honoured client-side regardless of what the upstream API
 * supports.
 *
 * Semantics:
 *   - filter: one node = `field operator value`; `and[]` / `or[]` combine
 *     child nodes with the node's own test (a node with no `field` is pure
 *     combinator). Missing fields compare as `undefined`.
 *   - sort: stable multi-key; numbers/dates/strings compared natively,
 *     `null`/`undefined` last in both directions.
 *   - pagination: `{ offset, limit }` slice AFTER filter+sort; `total` is the
 *     filtered count, `hasMore` is offset+limit < total.
 *
 * @module @pwfabric/runtime/entity/apply-query
 */
import type {
  EntityAggregate,
  EntityAggregateResult,
  EntityFilter,
  EntityQuery,
  EntityQueryResult,
  EntitySortField,
} from './types.js'

type Row = Record<string, unknown>

function readField(row: Row, field: string): unknown {
  if (field in row) return row[field]
  // dotted path (`owner.displayName`)
  let cur: unknown = row
  for (const part of field.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Row)[part]
  }
  return cur
}

function toComparable(v: unknown): number | string | undefined {
  if (v === null || v === undefined) return undefined
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v instanceof Date) return v.getTime()
  return String(v)
}

/** Loose equality for filter values: `'3' eq 3`, `true eq 'true'`, dates by time. */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : new Date(String(a)).getTime()
    const tb = b instanceof Date ? b.getTime() : new Date(String(b)).getTime()
    return Number.isFinite(ta) && ta === tb
  }
  if (typeof a === 'object' || typeof b === 'object') return false
  return String(a) === String(b)
}

/** A string that is a number and nothing else — `"95"`, `"-3.5"`, `"1e3"`; not `""`, not a date. */
const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i

/** The number a comparable reads as, or undefined when it is not number-looking. */
function numericValue(v: number | string): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (!NUMERIC.test(v)) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function compareOrdered(a: unknown, b: unknown): number | undefined {
  const ca = toComparable(a)
  const cb = toComparable(b)
  if (ca === undefined || cb === undefined) return undefined
  if (typeof ca === 'number' && typeof cb === 'number') return ca - cb
  // A number-looking string is a number here. A form saves what was typed, so
  // `price` is "95" on one row and 100 on the next; compared as strings
  // "95" > "100", and `price gt 100` would keep the cheaper item.
  //
  // TOTAL ORDER: number-looking values are one class, compared
  // numerically, and sort BEFORE every other value; the rest (ISO dates,
  // text) compare as strings. Comparing a number with text as text made a
  // cycle on a mixed column ("2" < "10" < "1a" < "2") and the sort order
  // depended on the input. Note: "007" reads as 7 — leading-zero codes sort
  // numerically and tie their unpadded value.
  const na = numericValue(ca)
  const nb = numericValue(cb)
  if (na !== undefined && nb !== undefined) return na - nb
  if (na !== undefined) return -1
  if (nb !== undefined) return 1
  // ISO date strings compare correctly as strings; text compares as text
  const sa = String(ca)
  const sb = String(cb)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function testLeaf(actual: unknown, operator: EntityFilter['operator'], expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return looseEq(actual, expected)
    case 'neq':
      return !looseEq(actual, expected)
    case 'gt': {
      const c = compareOrdered(actual, expected)
      return c !== undefined && c > 0
    }
    case 'gte': {
      const c = compareOrdered(actual, expected)
      return c !== undefined && c >= 0
    }
    case 'lt': {
      const c = compareOrdered(actual, expected)
      return c !== undefined && c < 0
    }
    case 'lte': {
      const c = compareOrdered(actual, expected)
      return c !== undefined && c <= 0
    }
    case 'in': {
      const set = Array.isArray(expected) ? expected : [expected]
      return set.some((e) => looseEq(actual, e))
    }
    case 'contains': {
      if (Array.isArray(actual)) return actual.some((x) => looseEq(x, expected))
      if (actual === null || actual === undefined) return false
      return String(actual).toLowerCase().includes(String(expected).toLowerCase())
    }
    case 'startsWith': {
      if (actual === null || actual === undefined) return false
      return String(actual).toLowerCase().startsWith(String(expected).toLowerCase())
    }
    default:
      return false
  }
}

/** Evaluate one filter node (leaf test + and/or combinators) against a row. */
export function matchesEntityFilter(row: Row, filter: EntityFilter): boolean {
  // A leaf needs something to compare against. Every operator in the union
  // takes a value, so `value: undefined` is not a constraint the author wrote —
  // it is a control with no selection (see resolveQueryState) — and a node
  // without a constraint matches, rather than eliminating every row.
  const hasLeaf =
    typeof filter.field === 'string' &&
    filter.field !== '' &&
    filter.operator !== undefined &&
    filter.value !== undefined
  const leaf = hasLeaf ? testLeaf(readField(row, filter.field), filter.operator, filter.value) : true
  const andOk = filter.and && filter.and.length > 0 ? filter.and.every((f) => matchesEntityFilter(row, f)) : true
  const orOk = filter.or && filter.or.length > 0 ? filter.or.some((f) => matchesEntityFilter(row, f)) : true
  return leaf && andOk && orOk
}

/** Stable multi-key sort; nullish values sort last in both directions. */
export function sortEntities<T extends Row>(items: readonly T[], sort: readonly EntitySortField[]): T[] {
  if (sort.length === 0) return [...items]
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      for (const s of sort) {
        const va = readField(a.item, s.field)
        const vb = readField(b.item, s.field)
        const na = va === null || va === undefined
        const nb = vb === null || vb === undefined
        if (na && nb) continue
        if (na) return 1
        if (nb) return -1
        const c = compareOrdered(va, vb) ?? 0
        if (c !== 0) return s.direction === 'desc' ? -c : c
      }
      return a.index - b.index
    })
    .map((x) => x.item)
}

/**
 * Every shape a sort is written in, as the one the sorter takes.
 *
 * WHY: the contract says `sort: EntitySortField[]`, but pages and models write
 * a single object far more often: `{ field: 'date', direction: 'asc' }`. It
 * has no `length`, so the old `query.sort.length > 0` test read it as "no
 * sort" and the list came back in storage order, silently. Accepted now:
 *
 *   [{ field, direction }]          the contract shape (invalid entries dropped)
 *   { field, direction? }           one sort key
 *   { date: 'desc', title: 'asc' }  a field → direction map, in key order
 *   'date' | '-date'                a field name, `-` for descending
 *
 * A missing or unknown direction reads as ascending. Anything else is no sort.
 */
export function normalizeEntitySort(sort: unknown): EntitySortField[] {
  const dir = (d: unknown): 'asc' | 'desc' =>
    typeof d === 'string' && d.toLowerCase() === 'desc' ? 'desc' : 'asc'
  const one = (s: unknown): EntitySortField | null => {
    if (typeof s === 'string') {
      const t = s.trim()
      if (!t || t === '-') return null
      return t.startsWith('-') ? { field: t.slice(1), direction: 'desc' } : { field: t, direction: 'asc' }
    }
    if (s && typeof s === 'object' && !Array.isArray(s)) {
      const o = s as Record<string, unknown>
      if (typeof o['field'] === 'string' && o['field']) return { field: o['field'], direction: dir(o['direction']) }
    }
    return null
  }
  if (Array.isArray(sort)) return sort.map(one).filter((s): s is EntitySortField => s !== null)
  const single = one(sort)
  if (single) return [single]
  if (sort && typeof sort === 'object') {
    return Object.entries(sort as Record<string, unknown>)
      .filter(([field, d]) => field.length > 0 && typeof d === 'string')
      .map(([field, d]) => ({ field, direction: dir(d) }))
  }
  return []
}

/**
 * Reduce an in-memory list to ONE NUMBER — the client half of what the
 * platform's `/count` and `/aggregate` routes do server-side, for connectors
 * that only list. `filter` narrows first; `count` is the kept rows; the rest
 * read `field` as a number (a numeric string counts, nullish/NaN is skipped)
 * and answer `null` when nothing was numeric.
 */
export function aggregateEntities(items: readonly Row[], aggregate: EntityAggregate): EntityAggregateResult {
  const filter = aggregate.filter
  const rows = filter ? items.filter((r) => matchesEntityFilter(r, filter)) : items
  const base = { fn: aggregate.fn, ...(aggregate.field ? { field: aggregate.field } : {}), count: rows.length }
  if (aggregate.fn === 'count') return { ...base, value: rows.length }
  if (!aggregate.field) return { ...base, value: null }
  const field = aggregate.field
  const nums: number[] = []
  for (const r of rows) {
    const v = readField(r, field)
    if (v === null || v === undefined || v === '') continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length === 0) return { ...base, value: null }
  // A loop, never a spread: `Math.x(...nums)` overflows the argument limit
  // on the large in-memory lists this path exists for.
  const sum = nums.reduce((a, b) => a + b, 0)
  switch (aggregate.fn) {
    case 'sum':
      return { ...base, value: sum }
    case 'avg':
      return { ...base, value: sum / nums.length }
    default:
      return { ...base, value: null }
  }
}

/**
 * Apply filter → sort → pagination to an in-memory list and return the
 * paginated envelope. An empty/undefined query returns everything.
 */
export function applyEntityQuery<T extends Row>(
  items: readonly T[],
  query: EntityQuery | undefined
): EntityQueryResult<T> {
  let out: T[] = [...items]
  if (query?.filter) {
    const f = query.filter
    out = out.filter((row) => matchesEntityFilter(row, f))
  }
  const sort = normalizeEntitySort(query?.sort)
  if (sort.length > 0) out = sortEntities(out, sort)
  const total = out.length
  const offset = Math.max(0, query?.pagination?.offset ?? 0)
  const limit = query?.pagination?.limit !== undefined ? Math.max(0, query.pagination.limit) : total
  const page = query?.pagination ? out.slice(offset, offset + limit) : out
  return { items: page, total, offset, limit, hasMore: offset + page.length < total }
}
