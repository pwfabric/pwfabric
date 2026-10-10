/**
 * The order the runner learns who the visitor is, on every page load.
 *
 * `run-app.ts` is browser orchestration and is not unit-tested, so the order
 * lives here where it can be: the error a failed round trip left behind is
 * read (and wiped) first, a stored session is trusted before the network is
 * asked, and the gateway's cookie is consulted only when nothing is stored —
 * and only for an app whose door the gateway actually keeps.
 *
 * @module @pwfabric/runner/boot-session.test
 */

import { describe, expect, it, vi } from 'vitest'
import { bootSession } from './boot-session.js'
import { appSessionKey, writeAppSession } from './app-session.js'
import type { KeyValueStorage } from './pkce.js'
import type { PwappAuth, PwappProject } from './types.js'

function memory(): KeyValueStorage & { dump: () => Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

const APP = 'shop'
const future = new Date(Date.now() + 60_000).toISOString()
const PROJECT: PwappProject = {
  id: APP,
  entrySurfaceId: 'home',
  surfaceOrder: ['home'],
  identity: { required: true, topology: 'app', methods: ['google'] },
}
const AUTH = { provider: 'password', providers: [{ method: 'google' }] } as unknown as PwappAuth

function gateway(status: number, body: unknown = {}): ReturnType<typeof vi.fn> {
  return vi.fn(async () => ({ ok: status === 200, status, json: async () => body }))
}

function address(search = ''): {
  location: { pathname: string; search: string; hash: string }
  history: { replaceState: ReturnType<typeof vi.fn> }
} {
  return {
    location: { pathname: '/program/', search, hash: '' },
    history: { replaceState: vi.fn() },
  }
}

describe('bootSession', () => {
  it('trusts a stored session and never asks the gateway', async () => {
    const storage = memory()
    writeAppSession(storage, APP, { token: 'stored', expiresAt: future })
    const fetchImpl = gateway(200, { token: 'cookie', expiresAt: future })
    const result = await bootSession({
      project: PROJECT,
      auth: AUTH,
      storage,
      appId: APP,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...address(),
    })
    expect(result).toEqual({ session: { token: 'stored', expiresAt: future }, authError: null })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads the gateway cookie when nothing is stored, and stores what it got', async () => {
    const storage = memory()
    const fetchImpl = gateway(200, {
      token: 'cookie',
      expiresAt: future,
      principal: { id: 'p1', email: 'a@b.c' },
    })
    const result = await bootSession({
      project: PROJECT,
      auth: AUTH,
      storage,
      appId: APP,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...address(),
    })
    expect(result.session?.token).toBe('cookie')
    expect(JSON.parse(storage.dump()[appSessionKey(APP)] as string)).toEqual({
      token: 'cookie',
      expiresAt: future,
      principal: { id: 'p1', email: 'a@b.c' },
    })
  })

  it('reports no session and stores nothing when the gateway says 401', async () => {
    const storage = memory()
    const result = await bootSession({
      project: PROJECT,
      auth: AUTH,
      storage,
      appId: APP,
      fetchImpl: gateway(401) as unknown as typeof fetch,
      ...address(),
    })
    expect(result).toEqual({ session: null, authError: null })
    expect(storage.dump()).toEqual({})
  })

  it('reads and wipes the auth error first — even when a session is stored', async () => {
    const storage = memory()
    writeAppSession(storage, APP, { token: 'stored', expiresAt: future })
    const { location, history } = address('?auth_error=access_denied')
    const result = await bootSession({
      project: PROJECT,
      auth: AUTH,
      storage,
      appId: APP,
      fetchImpl: gateway(401) as unknown as typeof fetch,
      location,
      history,
    })
    expect(result.authError).toBe('access_denied')
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/program/')
  })

  it('does not ask the gateway for an external-issuer app', async () => {
    const fetchImpl = gateway(200, { token: 'cookie', expiresAt: future })
    const result = await bootSession({
      project: { ...PROJECT, identity: { required: true, topology: 'external' } },
      auth: { provider: 'oauth2-pkce', issuer: 'https://id', clientId: 'c', scopes: [] },
      storage: memory(),
      appId: APP,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...address(),
    })
    expect(result.session).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not ask the gateway for a PKCE door even if the project omitted its topology', async () => {
    const fetchImpl = gateway(200, { token: 'cookie', expiresAt: future })
    await bootSession({
      project: { ...PROJECT, identity: { required: true } },
      auth: { provider: 'oauth2-pkce', issuer: 'https://id', clientId: 'c', scopes: [] },
      storage: memory(),
      appId: APP,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...address(),
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not ask the gateway for an app with no auth declaration', async () => {
    const fetchImpl = gateway(200, { token: 'cookie', expiresAt: future })
    const result = await bootSession({
      project: { ...PROJECT, identity: undefined },
      auth: null,
      storage: memory(),
      appId: APP,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      ...address(),
    })
    expect(result.session).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reads the real address bar and fetch by default', async () => {
    vi.stubGlobal('location', { pathname: '/', search: '', hash: '' })
    vi.stubGlobal('history', { replaceState: vi.fn() })
    const spy = gateway(401)
    vi.stubGlobal('fetch', spy)
    try {
      const result = await bootSession({ project: PROJECT, auth: AUTH, storage: memory(), appId: APP })
      expect(result).toEqual({ session: null, authError: null })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
