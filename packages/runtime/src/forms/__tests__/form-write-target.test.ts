/**
 * A form bound to a record that does not exist must CREATE, not PATCH the
 * collection — and a server refusal must arrive as the server's own words.
 *
 * The case: a Profile form's source (`me` → Attendee) has no loaded record;
 * "Save profile" must not send `PATCH /records/Attendee` (collection path, no
 * id) → 404 "Route not found", with the page saying "Check the highlighted
 * fields" and nothing highlighted.
 */

import { describe, it, expect } from 'vitest'
import { resolveFormWriteTarget, toFormWriteError } from '../form-write-target.js'

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
    expect(err.message).toMatch(/^Check the highlighted fields/)
    expect(err.message).toContain('name: Required')
    expect(err.details).toEqual({
      status: 400,
      code: 'VALIDATION_FAILED',
      fields: ['name', 'email'],
    })
  })

  it('a 404 is NOT a validation error — it is the server refusing, in its own words', () => {
    const err = toFormWriteError({
      type: 'network',
      status: 404,
      code: 'NOT_FOUND',
      message: 'Route not found',
    })
    expect(err.type).toBe('not_found')
    expect(err.message).toBe('The server could not save this record (404): Route not found')
    expect(err.message).not.toMatch(/highlighted/)
  })

  it('a 5xx is a connector error with the status in the message', () => {
    const err = toFormWriteError({ type: 'network', status: 503, message: 'HTTP 503: Service Unavailable' })
    expect(err.type).toBe('connector')
    expect(err.message).toBe('The server could not save this record (503): HTTP 503: Service Unavailable')
  })

  it('401/403 is unauthorized', () => {
    expect(toFormWriteError({ type: 'network', status: 401, message: 'SIGN_IN_REQUIRED' }).type).toBe(
      'unauthorized'
    )
    expect(toFormWriteError({ type: 'network', status: 403, message: 'FORBIDDEN' }).type).toBe(
      'unauthorized'
    )
  })

  it('no status at all (timeout, DNS) is a connector error that says the server was not reached', () => {
    const err = toFormWriteError({ type: 'timeout', message: 'Request was aborted' })
    expect(err.type).toBe('connector')
    expect(err.message).toBe('Could not reach the server: Request was aborted')
  })
})
