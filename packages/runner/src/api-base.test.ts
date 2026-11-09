import { describe, expect, it } from 'vitest'
import { isOwnApiRef, ownApiBaseOf } from './api-base.js'
import type { PwappAuth } from './types.js'

const PAGE = 'https://app.example/shop/'

describe('ownApiBaseOf', () => {
  it('reads the base out of a password door, as before', () => {
    expect(ownApiBaseOf({ provider: 'password', loginUrl: 'https://api.example/apps/a/login' } as PwappAuth)).toBe(
      'https://api.example/apps/a'
    )
    expect(ownApiBaseOf({ loginUrl: '/_host/login' })).toBe('/_host')
  })

  it('reads the same base out of a provider-only door whose gateway listens under it', () => {
    const gateway = {
      provider: 'platform',
      providers: [{ method: 'phiwebs' }],
      startUrl: 'https://api.example/apps/a/_auth/start',
      gatewaySessionUrl: 'https://api.example/apps/a/_auth/session',
      gatewayLogoutUrl: 'https://api.example/apps/a/_auth/logout',
    } as PwappAuth
    expect(ownApiBaseOf(gateway)).toBe('https://api.example/apps/a')
    expect(ownApiBaseOf({ gatewaySessionUrl: '/_host/_auth/session' })).toBe('/_host')
  })

  it('prefers a stated apiBase over every door address', () => {
    expect(ownApiBaseOf({ apiBase: 'https://api.example/apps/b/', loginUrl: 'https://other/login' })).toBe(
      'https://api.example/apps/b'
    )
  })

  it('gives nothing when no address names a base', () => {
    expect(ownApiBaseOf(null)).toBeNull()
    expect(ownApiBaseOf({})).toBeNull()
    // A gateway on the app's own origin: the base is not in the address.
    expect(ownApiBaseOf({ startUrl: '/_auth/start', gatewaySessionUrl: '/_auth/session' })).toBeNull()
    expect(ownApiBaseOf({ loginUrl: 'https://api.example/signin' })).toBeNull()
  })
})

describe('isOwnApiRef', () => {
  it('matches the base as written or resolved against the page', () => {
    expect(isOwnApiRef('/_host', '/_host', PAGE)).toBe(true)
    expect(isOwnApiRef('/_host/', '/_host', PAGE)).toBe(true)
    expect(isOwnApiRef('https://app.example/_host', '/_host', PAGE)).toBe(true)
  })

  it('never matches another address, an absent ref or an absent base', () => {
    expect(isOwnApiRef('https://third-party.example/api', '/_host', PAGE)).toBe(false)
    expect(isOwnApiRef('/_host/records', '/_host', PAGE)).toBe(false)
    expect(isOwnApiRef(undefined, '/_host', PAGE)).toBe(false)
    expect(isOwnApiRef('/_host', null, PAGE)).toBe(false)
  })
})
