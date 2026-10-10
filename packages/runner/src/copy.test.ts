/**
 * The runner's words, in both languages it ships.
 *
 * Every string the runner draws comes from one table per language. The cases
 * here keep the two tables in step: a key added to one language and
 * forgotten in the other would render `undefined` on the page.
 *
 * @module @pwfabric/runner/copy.test
 */

import { describe, expect, it } from 'vitest'
import { AUTH_ERROR_CODES, RUNNER_COPY, authErrorMessage, copyFor } from './copy.js'

function keysOf(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([k, v]) => keysOf(v, prefix ? `${prefix}.${k}` : k))
    .sort()
}

function valuesOf(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return [value]
  return Object.values(value as Record<string, unknown>).flatMap(valuesOf)
}

describe('RUNNER_COPY', () => {
  it('has the same key set in English and Turkish', () => {
    expect(keysOf(RUNNER_COPY.tr)).toEqual(keysOf(RUNNER_COPY.en))
  })

  it('has no empty string anywhere', () => {
    for (const locale of ['en', 'tr'] as const) {
      for (const v of valuesOf(RUNNER_COPY[locale])) {
        expect(typeof v).toBe('string')
        expect((v as string).length).toBeGreaterThan(0)
      }
    }
  })

  it('labels the host-account door in both languages', () => {
    expect(RUNNER_COPY.en.gate.providers.host).toBe('Continue with your account')
    expect(RUNNER_COPY.tr.gate.providers.host).toBe('Hesabınızla devam edin')
  })

  it('answers every declared auth_error code in both languages', () => {
    for (const code of AUTH_ERROR_CODES) {
      expect(RUNNER_COPY.en.authErrors[code]).toBeTruthy()
      expect(RUNNER_COPY.tr.authErrors[code]).toBeTruthy()
    }
  })
})

describe('copyFor', () => {
  it('falls back to English for anything it does not ship', () => {
    expect(copyFor('tr')).toBe(RUNNER_COPY.tr)
    expect(copyFor('en')).toBe(RUNNER_COPY.en)
    expect(copyFor(undefined)).toBe(RUNNER_COPY.en)
    expect(copyFor('de')).toBe(RUNNER_COPY.en)
  })
})

describe('authErrorMessage', () => {
  it('translates a known code', () => {
    expect(authErrorMessage('en', 'access_denied')).toBe(RUNNER_COPY.en.authErrors.access_denied)
    expect(authErrorMessage('tr', 'expired')).toBe(RUNNER_COPY.tr.authErrors.expired)
  })

  it('falls back to the generic text for an unknown code, quoting it for an operator', () => {
    const msg = authErrorMessage('en', 'weird_thing')
    expect(msg).toContain(RUNNER_COPY.en.authErrors.generic)
    expect(msg).toContain('weird_thing')
  })

  it('does not echo a code that is not a plain identifier', () => {
    // The code comes off the address bar; anything a person could craft into
    // a sentence is left out.
    expect(authErrorMessage('tr', 'Call +1 555 now')).toBe(RUNNER_COPY.tr.authErrors.generic)
  })

  it('reads the uppercase codes the API sends', () => {
    expect(authErrorMessage('en', 'ACCESS_DENIED')).toBe(RUNNER_COPY.en.authErrors.access_denied)
    expect(authErrorMessage('tr', 'METHOD_UNAVAILABLE')).toBe(
      RUNNER_COPY.tr.authErrors.method_unavailable
    )
    for (const code of AUTH_ERROR_CODES) {
      expect(authErrorMessage('en', code.toUpperCase())).toBe(RUNNER_COPY.en.authErrors[code])
    }
  })

  it('maps the gateway’s own defaults onto the nearest sentence', () => {
    expect(authErrorMessage('en', 'SIGN_IN_FAILED')).toBe(RUNNER_COPY.en.authErrors.server_error)
    expect(authErrorMessage('tr', 'PROVIDER_REFUSED')).toBe(RUNNER_COPY.tr.authErrors.access_denied)
    expect(authErrorMessage('en', 'sign_in_failed')).toBe(RUNNER_COPY.en.authErrors.server_error)
  })

  it('does not treat GENERIC as a code of its own', () => {
    expect(authErrorMessage('en', 'GENERIC')).toBe(`${RUNNER_COPY.en.authErrors.generic} (GENERIC)`)
  })

  it('does not treat inherited object keys as codes', () => {
    expect(authErrorMessage('en', 'toString')).toContain(RUNNER_COPY.en.authErrors.generic)
  })
})
