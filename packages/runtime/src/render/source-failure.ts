/**
 * FAILURE IS A STATE, NOT SAMPLE DATA (data-protocol §2.5).
 *
 * A source that could not be served for a real reason — a refused read, a
 * not-found, a server error, no answer at all — binds NO rows. Its `fallback`
 * used to be bound in every one of those cases, so a page whose detail read
 * was refused showed the sample record as if it were the visitor's, and a
 * 500 looked like a working catalogue.
 *
 * What a failed source binds instead:
 *  - `__errors.<id>` — WHY, as a code the page branches on and writes its
 *    own words for: `unauthenticated` (401), `forbidden` (403), `not_found`
 *    (404), `conflict` (409), `server` (5xx), `network` (no answer), `unconnected` (nothing to
 *    serve it) or `error` (anything else). Always truthy, so `if:` on it
 *    still tells "failed" from "fetched, empty". The engine writes no
 *    sentence here: the app owns every word (envelope §2), and a sentence
 *    in the engine's language was the one thing a page could not override.
 *  - `__errorCodes.<id>` — the HTTP status itself (`401`, `403`, `404`,
 *    `500` …), or `"network"`, `"error"`, `"unconnected"` as above.
 *
 * `"unconnected"` is the one case that binds `fallback`: no connection is
 * configured (a pack gallery, a preview, a runner with no records base), so
 * the sample rows are all there is — and the source's query is applied to
 * them like to live rows, so an `?id=` detail never shows another record.
 *
 * @module @pwfabric/runtime/render/source-failure
 */

/** Why a source failed — the value of `__errorCodes.<id>`. */
export type SourceFailureCode = number | 'network' | 'error' | 'unconnected'

/**
 * The code of a thrown failure: the HTTP status it carries, `"network"` for a
 * fetch that never got an answer (the browser rejects it with a TypeError) or
 * timed out, else `"error"`.
 */
export function failureCodeOf(err: unknown, status?: number | null): SourceFailureCode {
  if (typeof status === 'number' && status > 0) return status
  const carried = (err as { status?: unknown; code?: unknown } | null)?.status ?? (err as { code?: unknown } | null)?.code
  if (typeof carried === 'number' && carried > 0) return carried
  if (carried === 'network') return 'network'
  if (err instanceof TypeError) return 'network'
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'network'
  return 'error'
}

/** What `__errors.<id>` binds: the failure as a code a page branches on. */
export type SourceFailureReason =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'server'
  | 'network'
  | 'unconnected'
  | 'error'

/** The reason `__errors.<id>` binds for a failure code. */
export function sourceFailureReason(code: SourceFailureCode): SourceFailureReason {
  if (code === 'unconnected' || code === 'network' || code === 'error') return code
  if (code === 401) return 'unauthenticated'
  if (code === 403) return 'forbidden'
  if (code === 404) return 'not_found'
  if (code === 409) return 'conflict'
  if (code >= 500) return 'server'
  return 'error'
}
