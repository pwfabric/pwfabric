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
 * form can highlight them (`statusKeys.fields`).
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
 * Why a write failed — the value `statusKeys.reason` binds. The page writes
 * its own words for each (envelope §2: the app owns every word); the engine
 * gives the state, never a sentence.
 */
export type FormWriteReason = 'validation' | 'conflict' | 'unauthenticated' | 'forbidden' | 'server' | 'network' | 'error'

/**
 * The reason of a write failure (data-protocol §4.2): decided by the HTTP
 * status when there is one (`details.status`), else by the error's type.
 * "HTTP 500: Internal Server Error" and "This form writes to \"x\", which
 * this page does not declare" are true, and they go to `statusKeys.detail`
 * — for the developer, not the visitor.
 */
export function writeFailureReason(error: EntityOperationError): FormWriteReason {
  const details = (error.details ?? {}) as { status?: unknown; network?: unknown }
  const status = typeof details.status === 'number' ? details.status : undefined
  if (error.type === 'validation') return 'validation'
  // A 409: the record would repeat one another holds under a unique key (an
  // e-mail already on the list). The page says "already signed up", not
  // "something went wrong".
  if (status === 409 || error.type === 'conflict') return 'conflict'
  if (status === 401) return 'unauthenticated'
  if (status === 403 || error.type === 'unauthorized') return 'forbidden'
  if (status !== undefined && status >= 500) return 'server'
  if (status === undefined && details.network === true) return 'network'
  return 'error'
}

/** The field names a refusal named — what `statusKeys.fields` binds. */
export function writeFailureFields(error: EntityOperationError): string[] {
  const fields = (error.details as { fields?: unknown } | undefined)?.fields
  return Array.isArray(fields) ? fields.filter((f): f is string => typeof f === 'string') : []
}

/** The writer's own words — what `statusKeys.detail` binds. */
export function writeFailureDetail(error: EntityOperationError): string {
  const detail = (error.details as { detail?: unknown } | undefined)?.detail
  return typeof detail === 'string' ? detail : error.message
}

/**
 * Translate a data-layer refusal into what the form should know.
 *
 * `validation` is reserved for a 400 that names fields (or names no code).
 * Anything else is the server refusing; the status and the server's own
 * words travel in `details` (`detail` is what `statusKeys.detail` binds,
 * `fields` what `statusKeys.fields` binds), and `message` repeats the
 * detail for a caller that logs it.
 */
export function toFormWriteError(err: DataFetchError): EntityOperationError {
  const { status, code, message } = err
  if (status === undefined) {
    const detail = `Could not reach the server: ${message}`
    return { type: 'connector', message: detail, details: { network: true, detail } }
  }
  if (status === 400 && (code === undefined || VALIDATION_CODES.has(code))) {
    return { type: 'validation', message, details: { status, code, fields: fieldPathsOf(message), detail: message } }
  }
  const type: EntityOperationError['type'] =
    status === 404 ? 'not_found' : status === 409 ? 'conflict' : status === 401 || status === 403 ? 'unauthorized' : 'connector'
  const detail = `${status}${code ? ` ${code}` : ''}: ${message}`
  // A conflict names the unique key's fields the way a validation refusal
  // names its fields (`email: is already used …`), so a form can mark them.
  const fields = status === 409 ? fieldPathsOf(message) : undefined
  return { type, message: detail, details: { status, code, detail, ...(fields ? { fields } : {}) } }
}
