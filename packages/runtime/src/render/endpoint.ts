/**
 * resolveEndpoint — place surface state into a REST source's `endpoint`.
 *
 * EVERY VALUE IS URL-ENCODED WHEN THE ENDPOINT MIXES TEXT AND EXPRESSIONS.
 *
 * A raw interpolation would be harmless if state could only come from the
 * page's own controls, but a published app can seed state from its address
 * (`/product?id=12`): `?id=12/../../admin` or `?id=1%26role=owner` would
 * rewrite the path or the query of a request the visitor's credential rides on. A space or a `ü`
 * was always encoded by `fetch`; what this adds is `& # + % ? /`.
 *
 * Three rules:
 *
 *   - mixed endpoint (`/products/{{state.id}}`, `?q={{state.q}}`): each value
 *     goes through `encodeURIComponent` — ALL values, not only the ones that
 *     came from the address, because the renderer cannot tell them apart;
 *   - a value that is exactly `.` or `..` becomes `''` — `encodeURIComponent`
 *     leaves both alone, and a lone `..` segment still climbs a directory;
 *   - an endpoint that is ONE expression (`"{{state.url}}"`) is left as it
 *     resolves, unencoded — today's behaviour. The published-app runner never
 *     seeds a key read there (nor one read in the scheme/host part), so the
 *     address cannot reach it.
 *
 * A failed expression leaves the endpoint as authored, as it always did.
 *
 * @module @pwfabric/runtime/render/endpoint
 */
import { createExpressionContext, evaluate, interpolate } from '../surface/expression.js'

/** `"{{ expr }}"` and nothing else (surrounding whitespace allowed). */
const WHOLE = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/

/** One `{{ … }}` placeholder — the same shape `interpolate` walks. */
const PLACEHOLDER = /\{\{(.+?)\}\}/g

/** The form a single state value takes inside a mixed endpoint. */
export function encodeEndpointValue(value: unknown): string {
  const s = String(value ?? '')
  if (s === '.' || s === '..') return ''
  return encodeURIComponent(s)
}

export function resolveEndpoint(endpoint: string, state: Readonly<Record<string, unknown>>): string {
  if (!endpoint.includes('{{')) return endpoint
  const ctx = createExpressionContext({ state: state as Record<string, unknown> })

  // One expression: resolved as before, no encoding (see module note).
  if (WHOLE.test(endpoint)) {
    const r = interpolate(endpoint, ctx)
    return r.success ? r.value : endpoint
  }

  let failed = false
  const out = endpoint.replace(PLACEHOLDER, (_match, expression: string) => {
    if (failed) return ''
    const r = evaluate(expression.trim(), ctx)
    if (!r.success) {
      failed = true
      return ''
    }
    return encodeEndpointValue(r.value)
  })
  return failed ? endpoint : out
}

/**
 * Would this endpoint be requested with a required value MISSING?
 *
 * A detail source is authored as `/carts/{{state.numara}}`. Until the visitor
 * types a number, `numara` is empty and the request would go to `/carts/` —
 * the whole collection (DummyJSON redirects there), which then fails `returns`
 * and opens the page on an error. A placeholder in the PATH is
 * required: when it resolves to nothing (`''`, `null`, `undefined`) or cannot
 * be evaluated, the source is not fetched at all and stays idle.
 *
 * A placeholder in the QUERY STRING (`?q={{state.q}}`) is not required — an
 * empty search box legitimately means "no constraint". An endpoint that is
 * ONE expression (`{{state.url}}`) is required as a whole.
 */
export function endpointMissingPathValue(
  endpoint: string,
  state: Readonly<Record<string, unknown>>
): boolean {
  if (!endpoint.includes('{{')) return false
  const ctx = createExpressionContext({ state: state as Record<string, unknown> })
  const empty = (expression: string): boolean => {
    const r = evaluate(expression.trim(), ctx)
    return !r.success || r.value === undefined || r.value === null || String(r.value).trim() === ''
  }
  const whole = WHOLE.exec(endpoint)
  if (whole) return empty(whole[1] ?? '')

  // The path part ends at the first `?` or `#` that is not inside a placeholder.
  let pathEnd = endpoint.length
  for (let i = 0, depth = 0; i < endpoint.length; i++) {
    if (endpoint.startsWith('{{', i)) {
      depth++
      i++
    } else if (endpoint.startsWith('}}', i) && depth > 0) {
      depth--
      i++
    } else if (depth === 0 && (endpoint[i] === '?' || endpoint[i] === '#')) {
      pathEnd = i
      break
    }
  }
  for (const m of endpoint.slice(0, pathEnd).matchAll(PLACEHOLDER)) {
    if (empty(m[1] ?? '')) return true
  }
  return false
}
