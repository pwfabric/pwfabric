/**
 * `__auth` — who is signed in, how one may sign in, and why it failed, as
 * state a page reads. No token, no sentence.
 */
import { describe, expect, it } from 'vitest'
import type { AuthSession } from '@pwfabric/runtime/auth'
import { authErrorCode, authMethodsOf, authStateOf, authUserOf } from './auth-state.js'
import type { AuthBridge } from './auth.js'
import type { PwappAuth, PwappProject } from './types.js'

const PROJECT: PwappProject = { entrySurfaceId: 'home', surfaceOrder: ['home'] }

describe('authUserOf — either door, one record', () => {
  it('reads the platform principal, with its roles', () => {
    expect(
      authUserOf({
        appSession: { token: 'secret', expiresAt: '', principal: { id: 'u1', email: 'a@b.c', displayName: 'Ada', roles: ['staff'] } },
      })
    ).toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c', roles: ['staff'] })
  })

  it('reads an issuer session, roles from the user or its claims', () => {
    const session = { id: 's', user: { id: 'i1', name: 'Bo', claims: { roles: ['admin', 3] } } } as unknown as AuthSession
    expect(authUserOf({ bridgeSession: session })).toEqual({ id: 'i1', name: 'Bo', roles: ['admin'] })
  })

  it('a session without a profile is still someone; nobody is null', () => {
    expect(authUserOf({ appSession: { token: 't', expiresAt: '' } })).toEqual({ id: '', roles: [] })
    expect(authUserOf({})).toBeNull()
  })
})

describe('authStateOf', () => {
  it('carries no token and no session id', () => {
    const state = authStateOf({
      appSession: { token: 'secret-token', expiresAt: '2099', principal: { id: 'u1' } },
      methods: ['password'],
      error: null,
    })
    expect(JSON.stringify(state)).not.toContain('secret-token')
    expect(state).toEqual({ signedIn: true, user: { id: 'u1', roles: [] }, methods: ['password'], registration: 'closed', error: null })
  })

  it('a signed-in visitor has no error to read', () => {
    expect(authStateOf({ appSession: { token: 't', expiresAt: '' }, methods: [], error: 'refused' }).error).toBeNull()
    expect(authStateOf({ methods: [], registration: 'invite', error: 'refused' })).toEqual({ signedIn: false, user: null, methods: [], registration: 'invite', error: 'refused' })
  })
})

describe('authMethodsOf — the ways in', () => {
  it('password, then each provider, then the issuer', () => {
    const auth = { provider: 'password', loginUrl: '/l', providers: [{ method: 'google' }, { method: 'microsoft' }] } as PwappAuth
    expect(authMethodsOf({ project: PROJECT, auth, bridge: {} as AuthBridge })).toEqual(['password', 'google', 'microsoft', 'issuer'])
  })

  it('no password for an external-topology app; nothing without a door', () => {
    const external: PwappProject = { ...PROJECT, identity: { required: true, topology: 'external' } }
    expect(authMethodsOf({ project: external, auth: { provider: 'password', loginUrl: '/l' } as PwappAuth, bridge: null })).toEqual([])
    expect(authMethodsOf({ project: PROJECT, auth: null, bridge: null })).toEqual([])
  })
})

describe('authErrorCode', () => {
  it('passes a plain code on lower-cased, and never echoes anything else', () => {
    expect(authErrorCode('ACCESS_DENIED')).toBe('access_denied')
    expect(authErrorCode('provider_unavailable')).toBe('provider_unavailable')
    expect(authErrorCode('<script>')).toBe('error')
    expect(authErrorCode('')).toBeNull()
    expect(authErrorCode(null)).toBeNull()
  })
})
