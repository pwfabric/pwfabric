/**
 * Auth bridge — the FAILURE-VISIBILITY seam.
 *
 * `src/auth.ts` is excluded from this package's coverage thresholds as a
 * browser-orchestration module, and that exclusion still holds: DOM mounting
 * and the full-page redirect itself are proven by the pwapp export self-test.
 * What IS unit-testable in node — and what this file covers — is the branch
 * that used to fail silently: a callback that comes back from Entra and gets
 * REJECTED. Before `lastError` that path was a lone `console.warn`, so the
 * user landed on the same anonymous page with no signal at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAuthBridge } from './auth.js'
import { pendingKeyFor, authScopeKey, savePendingPkce } from './pkce.js'
import type { PwappAuth } from './types.js'

const AUTH: PwappAuth = {
  provider: 'oauth2-pkce',
  issuer: 'https://id.example/tenant-123/v2.0',
  authorizeUrl: 'https://id.example/tenant-123/oauth2/v2.0/authorize',
  tokenUrl: 'https://id.example/tenant-123/oauth2/v2.0/token',
  clientId: 'client-abc',
  scopes: ['User.Read', 'offline_access'],
}

/** base64url-encoded JWT with the claims decodeUserFromToken() reads. */
function fakeJwt(claims: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(claims))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
  return `header.${body}.signature`
}

function memorySessionStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage
}

const g = globalThis as Record<string, unknown>
let replaceState: ReturnType<typeof vi.fn>
let assign: ReturnType<typeof vi.fn>

beforeEach(() => {
  replaceState = vi.fn()
  assign = vi.fn()
  g.sessionStorage = memorySessionStorage()
  g.history = { replaceState }
  g.location = {
    origin: 'https://app.example',
    pathname: '/',
    hash: '',
    search: '',
    assign,
  }
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
  delete g.sessionStorage
  delete g.history
  delete g.location
  delete g.fetch
})

describe('createAuthBridge — failure visibility', () => {
  it('starts with no error and no session', () => {
    const bridge = createAuthBridge(AUTH)
    expect(bridge.lastError).toBeUndefined()
    expect(bridge.session).toBeUndefined()
  })

  it('reports a rejected callback instead of only warning to the console', async () => {
    // A ?code=&state= pair with NO matching pending record — the stale or
    // replayed callback. Nothing is stored, so takePendingPkce returns null.
    ;(g.location as Record<string, unknown>).search = '?code=abc&state=does-not-match'
    const bridge = createAuthBridge(AUTH, { locale: 'tr' })
    const listener = vi.fn()
    bridge.subscribe(listener)

    await bridge.init()

    expect(bridge.lastError).toMatch(/geçersiz|süresi/i)
    expect(bridge.session).toBeUndefined()
    expect(listener).toHaveBeenCalled() // subscribers see it — the button can render it
    expect(console.error).toHaveBeenCalled()
  })

  it('reports a rejected callback in English unless told otherwise', async () => {
    ;(g.location as Record<string, unknown>).search = '?code=abc&state=does-not-match'
    const bridge = createAuthBridge(AUTH)
    await bridge.init()
    expect(bridge.lastError).toBe('This sign-in link is invalid or has expired. Try again.')
  })

  it('reports a failed token exchange', async () => {
    const scopeKey = authScopeKey(AUTH)
    savePendingPkce(g.sessionStorage as Storage, pendingKeyFor(scopeKey), {
      state: 'st-1',
      verifier: 'v-1',
      redirectUri: 'https://app.example/',
      returnTo: '/reports',
    })
    ;(g.location as Record<string, unknown>).search = '?code=abc&state=st-1'
    g.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'invalid_grant' })

    const bridge = createAuthBridge(AUTH, { locale: 'tr' })
    await bridge.init()

    expect(bridge.lastError).toMatch(/jeton değişimi/i)
    expect(bridge.session).toBeUndefined()
  })

  it('leaves no error behind on a successful exchange and restores returnTo', async () => {
    const scopeKey = authScopeKey(AUTH)
    savePendingPkce(g.sessionStorage as Storage, pendingKeyFor(scopeKey), {
      state: 'st-2',
      verifier: 'v-2',
      redirectUri: 'https://app.example/',
      returnTo: '/reports?tab=2',
    })
    ;(g.location as Record<string, unknown>).search = '?code=abc&state=st-2'
    g.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: fakeJwt({ sub: 'u1', name: 'Ada', email: 'ada@example.com' }),
        refresh_token: 'rt-1',
        expires_in: 3600,
      }),
    })

    const bridge = createAuthBridge(AUTH)
    await bridge.init()

    expect(bridge.lastError).toBeUndefined()
    expect(bridge.session?.state).toBe('authenticated')
    expect(bridge.session?.user?.email).toBe('ada@example.com')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/reports?tab=2')
  })

  it('clears a previous error when a new login starts', async () => {
    ;(g.location as Record<string, unknown>).search = '?code=abc&state=stale'
    const bridge = createAuthBridge(AUTH)
    await bridge.init()
    expect(bridge.lastError).toBeDefined()

    bridge.loginWithPkce()

    // Cleared synchronously — the async redirect work happens after.
    expect(bridge.lastError).toBeUndefined()

    // Let the async challenge+redirect finish inside the test, so the IIFE
    // does not touch `location` after teardown has removed it (that surfaced
    // as an unhandled rejection). Also proves the redirect actually fires.
    await vi.waitFor(() => expect(assign).toHaveBeenCalled())
    // The declared issuer's own authorize address — no vendor hostname is
    // reachable from here any more, which is the whole point of the change.
    expect(String(assign.mock.calls[0]?.[0])).toContain(AUTH.authorizeUrl as string)
  })

  it('does not treat an expired stored refresh token as a user-visible error', async () => {
    // Boot with a stale refresh token and no callback: the correct outcome is
    // the login button, NOT an alarm. Over-reporting here would put a red note
    // on every cold start.
    const scopeKey = authScopeKey(AUTH)
    ;(g.sessionStorage as Storage).setItem(`pwapp_pkce_rt:${scopeKey}`, 'expired-rt')
    g.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'expired' })

    const bridge = createAuthBridge(AUTH)
    await bridge.init()

    expect(bridge.session).toBeUndefined()
    expect(bridge.lastError).toBeUndefined()
    expect((g.sessionStorage as Storage).getItem(`pwapp_pkce_rt:${scopeKey}`)).toBeNull()
  })
})

describe('createAuthBridge — the door token', () => {
  const DOOR = { ...AUTH, audience: 'api://client-abc' }

  async function signedInBridge(auth: PwappAuth, tokenFetch: ReturnType<typeof vi.fn>) {
    const scopeKey = authScopeKey(auth)
    savePendingPkce(g.sessionStorage as Storage, pendingKeyFor(scopeKey), {
      state: 'st-d',
      verifier: 'v-d',
      redirectUri: 'https://app.example/',
      returnTo: '/',
    })
    ;(g.location as Record<string, unknown>).search = '?code=abc&state=st-d'
    g.fetch = tokenFetch
    const bridge = createAuthBridge(auth)
    await bridge.init()
    return bridge
  }

  function tokenEndpoint(answers: Record<string, unknown>[]): ReturnType<typeof vi.fn> {
    const queue = [...answers]
    return vi.fn().mockImplementation(async () => ({ ok: true, json: async () => queue.shift() ?? answers[answers.length - 1] }))
  }

  const GRAPH = { access_token: fakeJwt({ sub: 'u1', name: 'Ada' }), refresh_token: 'rt-1', expires_in: 3600 }
  const DOOR_TOKEN = { access_token: 'door-jwt', refresh_token: 'rt-2', expires_in: 3600 }

  it('is nothing when the app declares no audience — and asks the issuer for nothing', async () => {
    const fetchMock = tokenEndpoint([GRAPH])
    const bridge = await signedInBridge(AUTH, fetchMock)
    expect(await bridge.getDoorToken()).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1) // the code exchange only
  })

  it('redeems the refresh token for the audience, leaving the data token untouched', async () => {
    const fetchMock = tokenEndpoint([GRAPH, DOOR_TOKEN])
    const bridge = await signedInBridge(DOOR, fetchMock)
    expect(await bridge.getDoorToken()).toBe('door-jwt')
    const body = fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt-1')
    expect(body.get('scope')).toBe('api://client-abc/.default')
    expect(body.get('client_id')).toBe('client-abc')
    expect(bridge.session?.token?.accessToken).toBe(GRAPH.access_token)
  })

  it('keeps the door token until it expires instead of redeeming per request', async () => {
    const fetchMock = tokenEndpoint([GRAPH, DOOR_TOKEN])
    const bridge = await signedInBridge(DOOR, fetchMock)
    await bridge.getDoorToken()
    await bridge.getDoorToken()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('carries the rotated refresh token forward so the data token can still renew', async () => {
    const fetchMock = tokenEndpoint([GRAPH, DOOR_TOKEN])
    const bridge = await signedInBridge(DOOR, fetchMock)
    await bridge.getDoorToken()
    expect((g.sessionStorage as Storage).getItem(`pwapp_pkce_rt:${authScopeKey(DOOR)}`)).toBe('rt-2')
  })

  it('is nothing without a session, and forgets the token on logout', async () => {
    const fetchMock = tokenEndpoint([GRAPH, DOOR_TOKEN])
    const bridge = await signedInBridge(DOOR, fetchMock)
    await bridge.getDoorToken()
    bridge.logout()
    expect(await bridge.getDoorToken()).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
