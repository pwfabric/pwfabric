/**
 * resolveQueryState — substitute `{{state.x}}` (and any expression) inside a
 * data-source `query` object before it reaches the connector.
 *
 * Without it state would be interpolated ONLY in REST `endpoint` strings and
 * connector/entity sources would pass `source.query` to the engine raw, so a
 * pagination block writing `state.page` and a segmented-control writing
 * `state.severity` could never reach `query.pagination.offset` or
 * `query.filter.value`. This walks the query deeply and resolves every string
 * that contains `{{ }}`.
 *
 * A string that is EXACTLY one expression (`"{{state.page}}"`) resolves to
 * the raw value (number stays number, array stays array) so
 * `pagination.limit: "{{state.pageSize}}"` yields a number, not "20".
 * Mixed strings (`"prefix-{{state.x}}"`) resolve to a string.
 */
import { createExpressionContext, evaluate, interpolate } from '../surface/expression.js'

const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/

export function resolveQueryState<T>(query: T, state: Readonly<Record<string, unknown>>): T {
  const ctx = createExpressionContext({ state })
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (!v.includes('{{')) return v
      const whole = WHOLE.exec(v)
      if (whole && whole[1] !== undefined) {
        const r = evaluate(whole[1], ctx)
        if (!r.success) return undefined
        // An "All" segment and an empty search box both write '' (or null) into
        // state. Read literally that is `field eq ''`, which matches no row —
        // the control that was meant to WIDEN the list emptied it. A whole
        // expression resolving to nothing is no constraint, so the key drops.
        // A literal '' written into the query by an author is untouched: only
        // an expression can resolve away.
        if (r.value === '' || r.value === null) return undefined
        return r.value
      }
      const r = interpolate(v, ctx)
      return r.success ? r.value : v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {}
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const w = walk(val)
        // an unresolved whole-expression drops the key so the connector sees
        // "no constraint", not `undefined` as a literal filter value
        if (w !== undefined) out[k] = w
      }
      return out
    }
    return v
  }
  return walk(query) as T
}

/**
 * AN EMPTY RECORD KEY ASKS FOR NO RECORD (data-protocol §1.1).
 *
 * An emptied state value drops its key from the query (above), which is what
 * lets an "All" choice widen a list. On the record's own key it did the
 * opposite of what the page meant: `id eq {{state.id}}` with no `?id=` lost
 * its only constraint and listed EVERY record, so a detail page opened on the
 * first dish and a `notFoundWhenEmpty` source never found itself missing.
 * Pages worked around it with a sentinel (`state.id || 'none'`).
 *
 * An equality whose value is exactly one expression and resolves to nothing
 * (`''`, `null`, absent or unevaluable) MATCHES NOTHING when
 *  - its field is `id`, the record's address — the analogue of a REST path
 *    value (endpoint.ts); or
 *  - the source is `notFoundWhenEmpty`: it is the one record the page shows,
 *    so any key it is looked up by is its address.
 * Elsewhere such a value stays no constraint. True when the whole filter can
 * match nothing: a top-level or `and` member that matches nothing, or an `or`
 * every branch of which does. A source asking for nothing is idle — not
 * fetched, no rows, `__idle.<id>` true.
 */
export function queryAsksForNothing(
  query: unknown,
  state: Readonly<Record<string, unknown>>,
  notFoundWhenEmpty = false
): boolean {
  if (!query || typeof query !== 'object') return false
  const filter = (query as { filter?: unknown }).filter
  if (!filter || typeof filter !== 'object') return false
  const ctx = createExpressionContext({ state })
  const emptyKey = (n: Record<string, unknown>): boolean => {
    if (n.operator !== 'eq' || typeof n.field !== 'string' || n.field === '') return false
    if (!notFoundWhenEmpty && n.field !== 'id') return false
    if (typeof n.value !== 'string') return false
    const whole = WHOLE.exec(n.value)
    if (!whole || whole[1] === undefined) return false
    const r = evaluate(whole[1], ctx)
    return !r.success || r.value === '' || r.value === null || r.value === undefined
  }
  const nothing = (node: unknown): boolean => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    const n = node as Record<string, unknown>
    if (emptyKey(n)) return true
    if (Array.isArray(n.and) && n.and.some(nothing)) return true
    return Array.isArray(n.or) && n.or.length > 0 && n.or.every(nothing)
  }
  return nothing(filter)
}

/** True when any string inside the query carries an expression. */
export function queryHasState(query: unknown): boolean {
  if (typeof query === 'string') return query.includes('{{')
  if (Array.isArray(query)) return query.some(queryHasState)
  if (query && typeof query === 'object') return Object.values(query as Record<string, unknown>).some(queryHasState)
  return false
}
