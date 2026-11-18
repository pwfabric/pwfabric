/**
 * A form bound to a record that does not exist must CREATE, not PATCH the
 * collection — and a server refusal must arrive as a reason code, with the
 * server's own words kept as the developer's detail.
 *
 * The case: a Profile form's source (`me` → Attendee) has no loaded record;
 * "Save profile" must not send `PATCH /records/Attendee` (collection path, no
 * id) → 404 "Route not found", with the page saying "Check the highlighted
 * fields" and nothing highlighted.
 */

import { describe, it, expect } from 'vitest'
import {
  resolveFormWriteTarget,
  toFormWriteError,
  writeFailureDetail,
  writeFailureFields,
  writeFailureReason,
} from '../form-write-target.js'

describe('resolveFormWriteTarget — the verb follows the record', () => {
  it('PATCH with no bound record becomes a create (POST to the collection)', () => {
    expect(resolveFormWriteTarget('PATCH', undefined)).toEqual({ method: 'POST' })
    expect(resolveFormWriteTarget('PATCH', [])).toEqual({ method: 'POST' })
    expect(resolveFormWriteTarget('PUT', null)).toEqual({ method: 'POST' })
  })

  it('PATCH with a bound record addresses that record by id', () => {
    expect(resolveFormWriteTarget('PATCH', [{ id: 'r-1', name: 'Rivka' }])).toEqual({
      method: 'PATCH',
      recordId: 'r-1',
    })
    // A single-record source binds an object, not a list.
    expect(resolveFormWriteTarget('PUT', { id: 42 })).toEqual({ method: 'PUT', recordId: '42' })
  })

  it('a bound record without an id cannot be addressed — create', () => {
    expect(resolveFormWriteTarget('PATCH', [{ name: 'no id here' }])).toEqual({ method: 'POST' })
  })

  it('POST never becomes an update, even when a record is loaded', () => {
    expect(resolveFormWriteTarget('POST', [{ id: 'r-1' }])).toEqual({ method: 'POST' })
  })
})

describe('toFormWriteError — the server speaks, the form does not guess', () => {
  it('a 400 validation refusal is a validation error carrying the field paths', () => {
    const err = toFormWriteError({
      type: 'network',
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'name: Required; email: Invalid email',
    })
    expect(err.type).toBe('validation')
    expect(writeFailureReason(err)).toBe('validation')
    expect(writeFailureFields(err)).toEqual(['name', 'email'])
    expect(err.details).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: ['name', 'email'],
      detail: 'name: Required; email: Invalid email',
    })
  })

  it('a 404 is NOT a validation error — the server refusing; its words are the detail, not the message', () => {
    const err = toFormWriteError({
      type: 'network',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Route not found',
    })
    expect(err.type).toBe('not_found')
    expect(writeFailureReason(err)).toBe('error')
    expect((err.details as { detail: string }).detail).toBe('404 NOT_FOUND: Route not found')
  })

  it('a 5xx is a connector error, reason server, with the status in the detail', () => {
    const err = toFormWriteError({ type: 'network', status: 503, message: 'HTTP 503: Service Unavailable' })
    expect(err.type).toBe('connector')
    expect(writeFailureReason(err)).toBe('server')
    expect(writeFailureDetail(err)).toBe('503: HTTP 503: Service Unavailable')
  })

  it('401/403 is unauthorized — reasons unauthenticated and forbidden', () => {
    const e401 = toFormWriteError({ type: 'network', status: 401, message: 'SIGN_IN_REQUIRED' })
    const e403 = toFormWriteError({ type: 'network', status: 403, message: 'FORBIDDEN' })
    expect([e401.type, e403.type]).toEqual(['unauthorized', 'unauthorized'])
    expect([writeFailureReason(e401), writeFailureReason(e403)]).toEqual(['unauthenticated', 'forbidden'])
  })

  it('no status at all (timeout, DNS) is a connector error, reason network', () => {
    const err = toFormWriteError({ type: 'timeout', message: 'Request was aborted' })
    expect(err.type).toBe('connector')
    expect(writeFailureReason(err)).toBe('network')
    expect((err.details as { detail: string }).detail).toBe('Could not reach the server: Request was aborted')
  })
})

describe('writeFailureReason — a code for the page to write its own words for', () => {
  it('names each case, and never a sentence', () => {
    const reason = (status: number | undefined, code?: string) =>
      writeFailureReason(toFormWriteError({ type: 'network', status, message: 'x', ...(code ? { code } : {}) } as never))
    expect(reason(400, 'VALIDATION_FAILED')).toBe('validation')
    expect(reason(401)).toBe('unauthenticated')
    expect(reason(403)).toBe('forbidden')
    expect(reason(500)).toBe('server')
    expect(reason(undefined)).toBe('network')
    expect(reason(409, 'CONFLICT')).toBe('error')
    expect(writeFailureReason({ type: 'unauthorized', message: '' })).toBe('forbidden')
  })
})
