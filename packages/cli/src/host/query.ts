/**
 * The data protocol's query language (data-protocol §3), applied by the host.
 *
 * The runtime applies the same query to the rows it receives, so a server
 * need not filter to be correct. The host filters anyway — the HTTP connector
 * sends `filter`, `sort`, `offset` and `limit`, and a paged list is only
 * honest when the page is cut after filtering. The semantics follow the
 * runtime's own applier: loose equality, number-looking strings compare as
 * numbers, `contains`/`startsWith` ignore case, a leaf with no value matches.
 */

export type Row = Record<string, unknown>

export interface Filter {
  readonly field?: string
  readonly operator?: string
  readonly value?: unknown
  readonly and?: readonly Filter[]
  readonly or?: readonly Filter[]
}

export interface SortField {
  readonly field: string
  readonly direction: 'asc' | 'desc'
}

function readField(row: Row, field: string): unknown {
  if (field in row) return row[field]
  let cur: unknown = row
  for (const part of field.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Row)[part]
  }
  return cur
}

const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i

function numeric(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string' || !NUMERIC.test(v)) return undefined
  return Number(v)
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (typeof a === 'object' || typeof b === 'object') return false
  return String(a) === String(b)
}

/** Numbers (and number-looking strings) first and numerically; the rest as text. */
function compare(a: unknown, b: unknown): number | undefined {
  if (a === null || a === undefined || b === null || b === undefined) return undefined
  const na = numeric(a)
  const nb = numeric(b)
  if (na !== undefined && nb !== undefined) return na - nb
  if (na !== undefined) return -1
  if (nb !== undefined) return 1
  const sa = String(a)
  const sb = String(b)
  return sa < sb ? -1 : sa > sb ? 1 : 0
}

function leaf(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return looseEq(actual, expected)
    case 'neq':
      return !looseEq(actual, expected)
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const c = compare(actual, expected)
      if (c === undefined) return false
      return operator === 'gt' ? c > 0 : operator === 'gte' ? c >= 0 : operator === 'lt' ? c < 0 : c <= 0
    }
    case 'in':
      return (Array.isArray(expected) ? expected : [expected]).some((e) => looseEq(actual, e))
    case 'contains':
      if (Array.isArray(actual)) return actual.some((x) => looseEq(x, expected))
      return actual !== null && actual !== undefined && String(actual).toLowerCase().includes(String(expected).toLowerCase())
    case 'startsWith':
      return actual !== null && actual !== undefined && String(actual).toLowerCase().startsWith(String(expected).toLowerCase())
    default:
      return false
  }
}

export function matches(row: Row, filter: Filter): boolean {
  const hasLeaf = typeof filter.field === 'string' && filter.field !== '' && typeof filter.operator === 'string' && filter.value !== undefined
  const ok = hasLeaf ? leaf(readField(row, filter.field as string), filter.operator as string, filter.value) : true
  const andOk = filter.and && filter.and.length > 0 ? filter.and.every((f) => matches(row, f)) : true
  const orOk = filter.or && filter.or.length > 0 ? filter.or.some((f) => matches(row, f)) : true
  return ok && andOk && orOk
}

export function sortRows<T extends Row>(rows: readonly T[], sort: readonly SortField[]): T[] {
  return rows
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
        const c = compare(va, vb) ?? 0
        if (c !== 0) return s.direction === 'desc' ? -c : c
      }
      return a.index - b.index
    })
    .map((x) => x.item)
}

/** `sort=<field>:<direction>,…` as the HTTP connector writes it. */
export function parseSort(value: string | null): SortField[] {
  if (!value) return []
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const at = part.lastIndexOf(':')
      const field = (at === -1 ? part : part.slice(0, at)).trim()
      const dir = at === -1 ? 'asc' : part.slice(at + 1).trim().toLowerCase()
      return field ? [{ field, direction: dir === 'desc' ? ('desc' as const) : ('asc' as const) }] : []
    })
}

/** `filter=<json>`; `undefined` when absent. Throws on JSON that is not a filter object. */
export function parseFilter(value: string | null): Filter | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('filter must be a JSON object')
  return parsed as Filter
}

export interface AggregateResult {
  readonly fn: 'count' | 'sum' | 'avg'
  readonly field?: string
  readonly value: number | null
  readonly count: number
}

export function aggregate(rows: readonly Row[], fn: 'count' | 'sum' | 'avg', field: string | undefined): AggregateResult {
  const base = { fn, ...(field ? { field } : {}), count: rows.length }
  if (fn === 'count') return { ...base, value: rows.length }
  if (!field) return { ...base, value: null }
  const nums: number[] = []
  for (const r of rows) {
    const v = readField(r, field)
    if (v === null || v === undefined || v === '') continue
    const n = typeof v === 'number' ? v : Number(v)
    if (Number.isFinite(n)) nums.push(n)
  }
  if (nums.length === 0) return { ...base, value: null }
  const sum = nums.reduce((a, b) => a + b, 0)
  return { ...base, value: fn === 'sum' ? sum : sum / nums.length }
}
