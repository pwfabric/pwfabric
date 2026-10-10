/**
 * Form write target — WHICH verb, WHICH record, and what a refusal means.
 *
 * A form binding says how it wants to write (`method: 'PATCH'`), but a PATCH
 * has to name a record and the page only knows one from what its source
 * loaded. When nothing loaded there is nothing to patch; the honest write is a
 * create. Otherwise a Profile form would send `PATCH /records/Attendee` — the
 * collection, no id — the API would answer 404 "Route not found", and the
 * page would report it as a field-validation problem with no field
 * highlighted.
 *
 * Two pure functions, so the rule is testable without a DOM and the same
 * answer serves the in-process facade and the HTTP path alike.
 *
 * @module @pwfabric/runtime/forms/form-write-target
 */

import type { DataFetchError } from '../data/types.js'
import type { EntityOperationError } from '../entity/types.js'

export type FormWriteMethod = 'POST' | 'PUT' | 'PATCH'

export interface FormWriteTarget {
  readonly method: FormWriteMethod
  /** Present only for an update — the id of the record the source has loaded. */
  readonly recordId?: string
}

/**
 * The record a source currently binds, if any.
 *
 * A list source binds an array (the platform's record reads always do — see
 * `LIST_KINDS` in DataBoundSurfaceRenderer); a single-record source may bind
 * an object. The FIRST row is the record a form on that page edits: a
 * profile page reads "me", a settings page reads "the one preference row".
 */
function boundRecord(bound: unknown): Record<string, unknown> | undefined {
  const candidate = Array.isArray(bound) ? bound[0] : bound
  return candidate !== null && typeof candidate === 'object' && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined
}

export function resolveFormWriteTarget(method: FormWriteMethod, bound: unknown): FormWriteTarget {
  if (method === 'POST') return { method: 'POST' }
  const id = boundRecord(bound)?.['id']
  const recordId = typeof id === 'string' ? id : typeof id === 'number' ? String(id) : undefined
  return recordId ? { method, recordId } : { method: 'POST' }
}

/**
 * The field paths a validation refusal names.
 *
 * The API answers `VALIDATION_FAILED` with `path: message; path: message`
 * (the host's app-records API). Read the paths out so a
 * form can highlight them; keep the whole sentence so the visitor can too.
 */
function fieldPathsOf(message: string): string[] {
  return message
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes(':'))
    .map((part) => part.slice(0, part.indexOf(':')).trim())
    .filter((path) => path.length > 0 && !/\s/.test(path))
}

const VALIDATION_CODES = new Set(['VALIDATION_FAILED', 'INVALID_BODY'])

/**
 * Translate a data-layer refusal into what the form should say.
 *
 * "Check the highlighted fields" is reserved for a 400 that names fields.
 * Anything else is the server refusing, and the server's own status and
 * words are the message — a 404 on the collection path is a routing fact,
 * not a problem with what the visitor typed.
 */
export function toFormWriteError(err: DataFetchError): EntityOperationError {
  const { status, code, message } = err
  if (status === undefined) {
    return { type: 'connector', message: `Could not reach the server: ${message}` }
  }
  if (status === 400 && (code === undefined || VALIDATION_CODES.has(code))) {
    return {
      type: 'validation',
      message: `Check the highlighted fields — ${message}`,
      details: { status, code, fields: fieldPathsOf(message) },
    }
  }
  const type: EntityOperationError['type'] =
    status === 404 ? 'not_found' : status === 401 || status === 403 ? 'unauthorized' : 'connector'
  return {
    type,
    message: `The server could not save this record (${status}): ${message}`,
    details: { status, code },
  }
}
