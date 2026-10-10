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

/** True when any string inside the query carries an expression. */
export function queryHasState(query: unknown): boolean {
  if (typeof query === 'string') return query.includes('{{')
  if (Array.isArray(query)) return query.some(queryHasState)
  if (query && typeof query === 'object') return Object.values(query as Record<string, unknown>).some(queryHasState)
  return false
}
