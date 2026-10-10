/**
 * Shared OAuth scope-list reader tests
 *
 * @module @pwfabric/core/__tests__/oauth-scopes
 */

import { describe, it, expect } from 'vitest'
import { isScopeToken, readScopeList } from '../oauth-scopes.js'

describe('isScopeToken', () => {
  it.each([
    'User.Read',
    'Sites.Read.All',
    'offline_access',
    'openid',
    'https://graph.microsoft.com/Mail.Read',
    'api://11111111-2222-3333-4444-555555555555/access_as_user',
  ])('accepts %s', (token) => {
    expect(isScopeToken(token)).toBe(true)
  })

  it.each([
    ['["Sites.Read.All"', 'the shard a stringified JSON array splits into'],
    ['"User.Read"]', 'its trailing twin'],
    ['Sites.Read.All User.Read', 'whitespace — the OAuth delimiter itself'],
    ['Sites.Read.All,User.Read', 'a comma'],
    ["'User.Read'", 'single quotes'],
    ['{User.Read}', 'braces'],
    ['', 'empty'],
  ])('rejects %j — %s', (token) => {
    expect(isScopeToken(token)).toBe(false)
  })
})

describe('readScopeList', () => {
  it('reads a well-formed list', () => {
    const r = readScopeList(['User.Read', 'Sites.Read.All'])
    expect(r.scopes).toEqual(['User.Read', 'Sites.Read.All'])
    expect(r.rejected).toEqual([])
    expect(r.malformed).toBe(false)
  })

  it('treats absent and empty as an empty list, not a fault', () => {
    for (const v of [undefined, null, []]) {
      const r = readScopeList(v)
      expect(r.scopes).toEqual([])
      expect(r.rejected).toEqual([])
      expect(r.malformed).toBe(false)
    }
  })

  it('de-duplicates while preserving first-seen order', () => {
    expect(readScopeList(['b', 'a', 'b']).scopes).toEqual(['b', 'a'])
  })

  /**
   * THE REGRESSION THIS MODULE EXISTS FOR.
   *
   * A reader that accepts a string here and splits it on `/[\s,]+/` turns the
   * JSON TEXT below into `["Sites.Read.All"` and `"User.Read"]`, which an
   * identity provider refuses (`AADSTS650053`). A scope list is a list; a
   * string is a malformed value, and shredding it hides the fault.
   */
  it('refuses to parse a JSON-text scope list', () => {
    const r = readScopeList('["Sites.Read.All","User.Read"]')
    expect(r.malformed).toBe(true)
    expect(r.scopes).toEqual([])
    // The raw value is carried back so a surface can SHOW what it refused —
    // the original bug was invisible precisely because nothing surfaced it.
    expect(r.rejected).toEqual(['["Sites.Read.All","User.Read"]'])
  })

  it('refuses a space-delimited string too', () => {
    const r = readScopeList('User.Read Sites.Read.All')
    expect(r.malformed).toBe(true)
    expect(r.scopes).toEqual([])
  })

  /**
   * A reader runs at RENDER time against data already in the database. It
   * must not throw — the canvas would go blank over a bad row. It keeps what
   * is usable, sets aside what is not, and lets the surface show both.
   */
  it('keeps the good entries and sets aside the bad ones', () => {
    const r = readScopeList(['User.Read', '["Sites.Read.All"', 42, '', 'Mail.Read'])
    expect(r.scopes).toEqual(['User.Read', 'Mail.Read'])
    expect(r.rejected).toEqual(['["Sites.Read.All"', '42', ''])
    expect(r.malformed).toBe(false)
  })

  it('never throws on any shape', () => {
    for (const v of [{}, 0, true, Symbol('x'), () => 1, new Date(0)]) {
      expect(() => readScopeList(v)).not.toThrow()
    }
  })
})
