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
 * What a write failure tells the VISITOR — a sentence, never the server's or
 * the runtime's internal words (data-protocol §4.2). "HTTP 500: Internal
 * Server Error" and "This form writes to \"x\", which this page does not
 * declare" are true, and they go to `statusKeys.detail`; the page reads this.
 *
 * Decided by the HTTP status when there is one (`details.status`), else by
 * the error's type.
 */
export function writeFailureSentence(error: EntityOperationError): string {
  const details = (error.details ?? {}) as { status?: unknown; fields?: unknown }
  const status = typeof details.status === 'number' ? details.status : undefined
  const fields = Array.isArray(details.fields) ? details.fields.filter((f): f is string => typeof f === 'string') : []
  if (error.type === 'validation') {
    return fields.length > 0 ? `Check the highlighted fields: ${fields.join(', ')}.` : 'Check the fields and try again.'
  }
  if (status === 401) return 'Sign in to save this.'
  if (status === 403 || error.type === 'unauthorized') return 'You are not allowed to save this.'
  if (status !== undefined && status >= 500) return 'The server could not save this. Try again later.'
  if (status === undefined && (details as { network?: unknown }).network === true) {
    return 'The server could not be reached. Check your connection and try again.'
  }
  return 'This could not be saved.'
}

/**
 * Translate a data-layer refusal into what the form should say.
 *
 * "Check the highlighted fields" is reserved for a 400 that names fields (or
 * names no code). Anything else is the server refusing; the status and the
 * server's own words travel in `details` (`detail` is what
 * `statusKeys.detail` binds), and `message` is the visitor's sentence.
 */
export function toFormWriteError(err: DataFetchError): EntityOperationError {
  const { status, code, message } = err
  if (status === undefined) {
    const error: EntityOperationError = {
      type: 'connector',
      message: '',
      details: { network: true, detail: `Could not reach the server: ${message}` },
    }
    return { ...error, message: writeFailureSentence(error) }
  }
  if (status === 400 && (code === undefined || VALIDATION_CODES.has(code))) {
    const error: EntityOperationError = {
      type: 'validation',
      message: '',
      details: { status, code, fields: fieldPathsOf(message), detail: message },
    }
    return { ...error, message: writeFailureSentence(error) }
  }
  const type: EntityOperationError['type'] =
    status === 404 ? 'not_found' : status === 401 || status === 403 ? 'unauthorized' : 'connector'
  const error: EntityOperationError = {
    type,
    message: '',
    details: { status, code, detail: `${status}${code ? ` ${code}` : ''}: ${message}` },
  }
  return { ...error, message: writeFailureSentence(error) }
}
