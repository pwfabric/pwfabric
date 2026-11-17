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
 *  - `__errors.<id>` — a sentence a visitor can read. Never the internal
 *    detail: "No entity facade available" and "HTTP 500: Internal Server
 *    Error" are for the console, not the page.
 *  - `__errorCodes.<id>` — why, as a value a page can branch on: the HTTP
 *    status (`401`, `403`, `404`, `500` …), `"network"` when no answer
 *    arrived, `"error"` for any other failure, and `"unconnected"` when the
 *    source has nothing to serve it at all.
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

/** The visitor-readable sentence `__errors.<id>` binds for a code. */
export function sourceFailureMessage(code: SourceFailureCode): string {
  if (code === 'unconnected') return 'Not connected — showing sample data.'
  if (code === 'network') return 'The server could not be reached. Check your connection and try again.'
  if (code === 401) return 'Sign in to see this.'
  if (code === 403) return 'You do not have access to this.'
  if (code === 404) return 'This could not be found.'
  if (typeof code === 'number' && code >= 500) return 'The server could not answer. Try again later.'
  return 'This could not be loaded.'
}
