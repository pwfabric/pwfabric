/**
 * The app session — the platform door's half.
 *
 * Storage is where a token quietly outlives its usefulness, so the cases that
 * matter are the ones that throw it away: an expired token must not be
 * presented to a gate that will refuse it and be reported to the visitor as
 * "sign-in failed", and two apps on one origin must never share one.
 *
 * @module @pwfabric/runner/app-session.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  appSessionKey,
  clearAppSession,
  readAppSession,
  readAuthError,
  readGatewaySession,
  signIn,
  signOut,
  startSocialSignIn,
  writeAppSession,
} from './app-session.js'
import type { KeyValueStorage } from './pkce.js'

function memory(): KeyValueStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const future = new Date(Date.now() + 60_000).toISOString()
const past = new Date(Date.now() - 60_000).toISOString()

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('storage', () => {
  it('round-trips a session', () => {
    const s = memory()
    writeAppSession(s, 'grocer', { token: 'tok', expiresAt: future })
    expect(readAppSession(s, 'grocer')?.token).toBe('tok')
  })

  it('keys by app, so two apps on one origin never share a token', () => {
    const s = memory()
    writeAppSession(s, 'grocer', { token: 'a', expiresAt: future })
    writeAppSession(s, 'kasap', { token: 'b', expiresAt: future })
    expect(readAppSession(s, 'grocer')?.token).toBe('a')
    expect(readAppSession(s, 'kasap')?.token).toBe('b')
    expect(appSessionKey('grocer')).not.toBe(appSessionKey('kasap'))
  })

  it('throws away an expired token instead of presenting it', () => {
    // Presenting it means the gate refuses it and the visitor is told their
    // sign-in failed, when in fact it simply ended.
    const s = memory()
    writeAppSession(s, 'grocer', { token: 'stale', expiresAt: past })
    expect(readAppSession(s, 'grocer')).toBeNull()
    expect(s.dump()).toEqual({})
  })

  it('survives a corrupted entry by discarding it', () => {
    const s = memory()
    s.setItem(appSessionKey('grocer'), 'not json')
    expect(readAppSession(s, 'grocer')).toBeNull()
    expect(s.dump()).toEqual({})
  })

  it('clears on request', () => {
    const s = memory()
    writeAppSession(s, 'grocer', { token: 'tok', expiresAt: future })
    clearAppSession(s, 'grocer')
    expect(readAppSession(s, 'grocer')).toBeNull()
  })
})

describe('signIn', () => {
  const ok = (body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body })))

  it('returns the session the door minted', async () => {
    ok({ data: { token: 'tok', expiresAt: future, principal: { id: 'p1' } } })
    const result = await signIn('https://api.example/login', { email: 'a@b.c', password: 'x' })
    expect(result).toEqual({
      ok: true,
      session: { token: 'tok', expiresAt: future, principal: { id: 'p1' } },
    })
  })

  it('passes the server’s own refusal through rather than improving on it', async () => {
    // The API answers one message for every credential failure on purpose;
    // telling an unknown address apart from a wrong password enumerates the
    // shop's customers.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is wrong' } }),
      }))
    )
    const result = await signIn('https://api.example/login', { email: 'a@b.c', password: 'x' })
    expect(result).toEqual({ ok: false, message: 'Email or password is wrong' })
  })

  it('reports an unreachable server as such, not as bad credentials', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await signIn('https://api.example/login', { email: 'a@b.c', password: 'x' }, 'tr')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/ulaşılamadı/)
  })

  it('speaks the app’s language — English unless told otherwise', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const result = await signIn('https://api.example/login', { email: 'a@b.c', password: 'x' })
    expect(result.ok === false && result.message).toMatch(/Could not reach the server/)
  })

  it('says the answer was unreadable when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => { throw new Error('html') } }))
    )
    const result = await signIn('https://api.example/login', { email: 'a@b.c', password: 'x' }, 'en')
    expect(result.ok === false && result.message).toMatch(/unexpected response/)
  })

  it('refuses a 200 that carries no token', async () => {
    ok({ data: {} })
    const result = await signIn('https://api.example/login', { email: 'a@b.c', password: 'x' })
    expect(result.ok).toBe(false)
  })
})

describe('signOut', () => {
  const GATEWAY_LOGOUT = {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-pwapp-request': '1' },
  }

  it('revokes at the door AND clears the gateway cookie', async () => {
    const spy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', spy)
    await signOut({ logoutUrl: 'https://api.example/logout' }, 'tok')
    expect(spy).toHaveBeenCalledWith('https://api.example/logout', {
      method: 'POST',
      headers: { 'x-app-session': 'tok' },
    })
    // The cookie is HttpOnly: only the gateway that wrote it can delete it.
    expect(spy).toHaveBeenCalledWith('/_auth/logout', GATEWAY_LOGOUT)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('uses the gateway logout address the export declared', async () => {
    const spy = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', spy)
    await signOut({ gatewayLogoutUrl: '/app/_auth/logout' }, 'tok')
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('/app/_auth/logout', GATEWAY_LOGOUT)
  })

  it('does not throw when the server is unreachable', async () => {
    // The local clear happens either way — refusing to sign someone out
    // because the network is down is the wrong side to err on.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(
      signOut({ logoutUrl: 'https://api.example/logout' }, 'tok')
    ).resolves.toBeUndefined()
  })

  it('is a no-op when the app declared no auth at all', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    await signOut(undefined, 'tok')
    await signOut(null, 'tok')
    expect(spy).not.toHaveBeenCalled()
  })
})

/**
 * The social door, after the browser stopped spending codes.
 *
 * The runner's whole part is now three small acts: leave for the gateway's
 * start address, ask the gateway who the cookie belongs to, and read back the
 * error code a failed round trip left in the address bar. Each case below is
 * one way those acts could hand a visitor to the wrong place or the wrong
 * session.
 */
describe('startSocialSignIn', () => {
  function stubLocation(): ReturnType<typeof vi.fn> {
    const assign = vi.fn()
    vi.stubGlobal('location', { origin: 'https://shop.example', assign })
    return assign
  }

  it('leaves for the gateway start address with the method and the way back', () => {
    const assign = stubLocation()
    startSocialSignIn({}, 'google', '/program/?week=2')
    expect(assign).toHaveBeenCalledWith('/_auth/start/google?returnTo=%2Fprogram%2F%3Fweek%3D2')
  })

  it('keeps the hash, so a hash-router app comes back to the same page', () => {
    const assign = stubLocation()
    startSocialSignIn({}, 'google', '/?tab=1#/program')
    expect(assign).toHaveBeenCalledWith(
      `/_auth/start/google?returnTo=${encodeURIComponent('/?tab=1#/program')}`
    )
  })

  it('still refuses a foreign address that only looks like a hash route', () => {
    const assign = stubLocation()
    startSocialSignIn({}, 'google', '//evil.example/#/program')
    expect(assign).toHaveBeenCalledWith('/_auth/start/google?returnTo=%2F')
  })

  it('uses the declared start address, without doubling a trailing slash', () => {
    const assign = stubLocation()
    startSocialSignIn({ startUrl: '/base/_auth/start/' }, 'host', '/')
    expect(assign).toHaveBeenCalledWith('/base/_auth/start/host?returnTo=%2F')
  })

  it('works with no auth declaration at all, on the default address', () => {
    const assign = stubLocation()
    startSocialSignIn(null, 'github', '/x')
    expect(assign).toHaveBeenCalledWith('/_auth/start/github?returnTo=%2Fx')
  })

  it.each([
    ['an absolute URL', 'https://evil.example/'],
    ['a protocol-relative URL', '//evil.example/'],
    ['a backslash trick', '/\\evil.example/'],
    ['a relative path', 'program/'],
    ['an empty string', ''],
  ])('refuses %s as the way back and returns home instead', (_label, returnTo) => {
    const assign = stubLocation()
    startSocialSignIn({}, 'google', returnTo)
    expect(assign).toHaveBeenCalledWith('/_auth/start/google?returnTo=%2F')
  })

  it('escapes the method so it cannot rewrite the path', () => {
    const assign = stubLocation()
    startSocialSignIn({}, '../logout', '/')
    expect(assign).toHaveBeenCalledWith('/_auth/start/..%2Flogout?returnTo=%2F')
  })
})

describe('readGatewaySession', () => {
  function answer(status: number, body: unknown): ReturnType<typeof vi.fn> {
    return vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }))
  }

  it('asks the gateway same-origin, marked as the runner’s own request', async () => {
    const fetchImpl = answer(401, {})
    await readGatewaySession({}, fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledWith('/_auth/session', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'x-pwapp-request': '1' },
    })
  })

  it('turns a 200 into a session with its principal', async () => {
    const fetchImpl = answer(200, {
      token: 'tok-1',
      expiresAt: '2099-01-01T00:00:00Z',
      principal: { id: 'p1', email: 'a@b.c', displayName: 'Ayşe' },
    })
    const session = await readGatewaySession(
      { gatewaySessionUrl: '/app/_auth/session' },
      fetchImpl as unknown as typeof fetch
    )
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/app/_auth/session')
    expect(session).toEqual({
      token: 'tok-1',
      expiresAt: '2099-01-01T00:00:00Z',
      principal: { id: 'p1', email: 'a@b.c', displayName: 'Ayşe' },
    })
  })

  it('also reads the API’s { data } envelope', async () => {
    const fetchImpl = answer(200, { data: { token: 'tok-2', expiresAt: '2099-01-01T00:00:00Z' } })
    const session = await readGatewaySession({}, fetchImpl as unknown as typeof fetch)
    expect(session).toEqual({ token: 'tok-2', expiresAt: '2099-01-01T00:00:00Z' })
  })

  it('answers null for a visitor with no cookie', async () => {
    expect(await readGatewaySession({}, answer(401, {}) as unknown as typeof fetch)).toBeNull()
  })

  it('answers null for a 200 that carries no token', async () => {
    expect(await readGatewaySession({}, answer(200, {}) as unknown as typeof fetch)).toBeNull()
    expect(await readGatewaySession({}, answer(200, null) as unknown as typeof fetch)).toBeNull()
  })

  it('answers null on a static host that serves its index page for every path', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <')
      },
    }))
    expect(await readGatewaySession({}, fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('answers null when the network fails, instead of breaking the boot', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('offline')
    })
    expect(await readGatewaySession({}, fetchImpl as unknown as typeof fetch)).toBeNull()
  })

  it('uses the global fetch when none is given', async () => {
    const spy = answer(401, {})
    vi.stubGlobal('fetch', spy)
    await readGatewaySession(null)
    expect(spy).toHaveBeenCalled()
  })
})

describe('readAuthError', () => {
  function at(
    search: string,
    hash = ''
  ): {
    loc: { pathname: string; search: string; hash: string }
    hist: { replaceState: ReturnType<typeof vi.fn> }
  } {
    return {
      loc: { pathname: '/program/', search, hash },
      hist: { replaceState: vi.fn() },
    }
  }

  it('reads nothing and touches nothing on an ordinary load', () => {
    const { loc, hist } = at('?week=2')
    expect(readAuthError(loc, hist)).toBeNull()
    expect(hist.replaceState).not.toHaveBeenCalled()
  })

  it('reads the code and strips it, keeping the rest of the address', () => {
    const { loc, hist } = at('?week=2&auth_error=access_denied', '#top')
    expect(readAuthError(loc, hist)).toBe('access_denied')
    // A refresh must not show the same failure again.
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/program/?week=2#top')
  })

  it('leaves no dangling question mark when the code was the only parameter', () => {
    const { loc, hist } = at('?auth_error=expired')
    expect(readAuthError(loc, hist)).toBe('expired')
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/program/')
  })

  it('strips an empty code but reports nothing', () => {
    const { loc, hist } = at('?auth_error=')
    expect(readAuthError(loc, hist)).toBeNull()
    expect(hist.replaceState).toHaveBeenCalledWith(null, '', '/program/')
  })

  it('reads the real address bar by default', () => {
    vi.stubGlobal('location', { pathname: '/', search: '?auth_error=server_error', hash: '' })
    const replaceState = vi.fn()
    vi.stubGlobal('history', { replaceState })
    expect(readAuthError()).toBe('server_error')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/')
  })
})
