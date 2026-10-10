import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authScopeKey,
  buildAuthorizeUrl,
  clearDiscoveryCache,
  discoveryUrlOf,
  generateCodeChallenge,
  generateCodeVerifier,
  pendingKeyFor,
  refreshTokenKeyFor,
  resolveEndpoints,
  savePendingPkce,
  takePendingPkce,
  type KeyValueStorage,
} from './pkce.js'

const AUTH = {
  provider: 'oauth2-pkce',
  issuer: 'https://id.example/tenant-123/v2.0',
  authorizeUrl: 'https://id.example/tenant-123/oauth2/v2.0/authorize',
  tokenUrl: 'https://id.example/tenant-123/oauth2/v2.0/token',
  clientId: 'client-abc',
  scopes: ['User.Read', 'Sites.Read.All', 'offline_access'],
}

function memoryStorage(): KeyValueStorage & { readonly dump: () => Record<string, string> } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  }
}

describe('generateCodeVerifier', () => {
  it('is 64 lowercase-hex chars', () => {
    const v = generateCodeVerifier()
    expect(v).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is unique per call', () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier())
  })
})

describe('generateCodeChallenge', () => {
  it('is base64url(SHA-256(verifier)) without padding', async () => {
    const verifier = 'test-verifier-value'
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(await generateCodeChallenge(verifier)).toBe(expected)
  })

  it('contains no +, / or = characters', async () => {
    for (let i = 0; i < 8; i++) {
      const challenge = await generateCodeChallenge(generateCodeVerifier())
      expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    }
  })
})

describe('authScopeKey', () => {
  it('is stable and scope-order-insensitive', () => {
    const reordered = { ...AUTH, scopes: [...AUTH.scopes].reverse() }
    expect(authScopeKey(AUTH)).toBe(authScopeKey(reordered))
  })

  it('differs when tenant, client or scopes differ', () => {
    expect(authScopeKey(AUTH)).not.toBe(authScopeKey({ ...AUTH, clientId: 'other' }))
    expect(authScopeKey(AUTH)).not.toBe(authScopeKey({ ...AUTH, scopes: ['User.Read'] }))
  })

  it('namespaces the storage keys', () => {
    const key = authScopeKey(AUTH)
    expect(pendingKeyFor(key)).toBe(`pwapp_pkce_pending:${key}`)
    expect(refreshTokenKeyFor(key)).toBe(`pwapp_pkce_rt:${key}`)
  })
})

describe('resolveEndpoints', () => {
  beforeEach(() => {
    clearDiscoveryCache()
  })

  it('believes a binding that states both endpoints, without asking anyone', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(resolveEndpoints(AUTH)).resolves.toEqual({
      authorizeUrl: 'https://id.example/tenant-123/oauth2/v2.0/authorize',
      tokenUrl: 'https://id.example/tenant-123/oauth2/v2.0/token',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('asks the standard address when the binding states only an issuer', async () => {
    // No URL shape is derived from the issuer — this is the hardcode that made
    // one vendor the only identity a published app could have.
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        authorization_endpoint: 'https://any.host/authorize',
        token_endpoint: 'https://any.host/token',
      }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const bare = { provider: 'oauth2-pkce', issuer: 'https://id.example/', clientId: 'c', scopes: [] }
    await expect(resolveEndpoints(bare)).resolves.toEqual({
      authorizeUrl: 'https://any.host/authorize',
      tokenUrl: 'https://any.host/token',
    })
    expect(fetchSpy).toHaveBeenCalledWith(discoveryUrlOf('https://id.example/'))

    // Second call is served from the cache — two surfaces of one app must not
    // each pay the round trip the login button waits on.
    await resolveEndpoints(bare)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('does not cache a failed lookup', async () => {
    // A stored rejection would make "Sign in" permanently dead for the rest of
    // the page load, long after the network came back.
    let attempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        attempt += 1
        if (attempt === 1) return { ok: false, status: 503 }
        return {
          ok: true,
          json: async () => ({
            authorization_endpoint: 'https://any.host/authorize',
            token_endpoint: 'https://any.host/token',
          }),
        }
      })
    )
    const bare = { provider: 'oauth2-pkce', issuer: 'https://id.example', clientId: 'c', scopes: [] }
    await expect(resolveEndpoints(bare)).rejects.toThrow('503')
    await expect(resolveEndpoints(bare)).resolves.toMatchObject({ tokenUrl: 'https://any.host/token' })
    vi.unstubAllGlobals()
  })

  it('refuses a document that publishes no endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })))
    const bare = { provider: 'oauth2-pkce', issuer: 'https://empty.example', clientId: 'c', scopes: [] }
    await expect(resolveEndpoints(bare)).rejects.toThrow('published no authorize/token endpoint')
    vi.unstubAllGlobals()
  })
})

describe('discoveryUrlOf', () => {
  it('builds the standard address and tolerates a trailing slash', () => {
    expect(discoveryUrlOf('https://id.example/')).toBe(
      'https://id.example/.well-known/openid-configuration'
    )
  })
})

describe('buildAuthorizeUrl', () => {
  it('never puts the door scope on the authorize request, even with an audience declared', () => {
    // Entra answers AADSTS70011 — ".default scope can't
    // be combined with resource-specific scopes". The data scopes go on the
    // authorize request; the door token is redeemed from the refresh token
    // alone (see AuthBridge.getDoorToken).
    const url = new URL(
      buildAuthorizeUrl(
        { ...AUTH, audience: 'api://client-abc' },
        { challenge: 'C', state: 'S', redirectUri: 'https://host/app/', authorizeUrl: AUTH.authorizeUrl }
      )
    )
    expect(url.searchParams.get('scope')).toBe(AUTH.scopes.join(' '))
  })

  it('asks for nothing extra when no audience is declared', () => {
    const url = new URL(
      buildAuthorizeUrl(AUTH, { challenge: 'C', state: 'S', redirectUri: 'https://host/app/', authorizeUrl: AUTH.authorizeUrl })
    )
    expect(url.searchParams.get('scope')).toBe(AUTH.scopes.join(' '))
  })


  it('carries the full PKCE parameter set', () => {
    const url = new URL(
      buildAuthorizeUrl(AUTH, {
        challenge: 'CHALLENGE',
        state: 'STATE',
        redirectUri: 'https://host/app/',
        authorizeUrl: AUTH.authorizeUrl,
      })
    )
    expect(url.origin + url.pathname).toBe(AUTH.authorizeUrl)
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-abc')
    expect(url.searchParams.get('redirect_uri')).toBe('https://host/app/')
    expect(url.searchParams.get('scope')).toBe('User.Read Sites.Read.All offline_access')
    expect(url.searchParams.get('state')).toBe('STATE')
    expect(url.searchParams.get('code_challenge')).toBe('CHALLENGE')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('pending PKCE state roundtrip', () => {
  const PENDING = { state: 'st-1', verifier: 'v'.repeat(64), redirectUri: 'https://host/app/' }

  it('roundtrips through storage on a matching state', () => {
    const storage = memoryStorage()
    savePendingPkce(storage, 'k', PENDING)
    expect(takePendingPkce(storage, 'k', 'st-1')).toEqual(PENDING)
  })

  it('is single-use — consumed even on success', () => {
    const storage = memoryStorage()
    savePendingPkce(storage, 'k', PENDING)
    takePendingPkce(storage, 'k', 'st-1')
    expect(takePendingPkce(storage, 'k', 'st-1')).toBeNull()
    expect(storage.dump()).toEqual({})
  })

  it('rejects a state mismatch AND clears the record', () => {
    const storage = memoryStorage()
    savePendingPkce(storage, 'k', PENDING)
    expect(takePendingPkce(storage, 'k', 'attacker-state')).toBeNull()
    expect(storage.dump()).toEqual({})
  })

  it('returns null when nothing is pending', () => {
    expect(takePendingPkce(memoryStorage(), 'k', 'st-1')).toBeNull()
  })

  it('survives corrupted storage content', () => {
    const storage = memoryStorage()
    storage.setItem('k', '{not json')
    expect(takePendingPkce(storage, 'k', 'st-1')).toBeNull()
  })

  it('roundtrips returnTo — the page login started from', () => {
    const storage = memoryStorage()
    const withReturn = { ...PENDING, returnTo: '/team-chat?tab=all#top' }
    savePendingPkce(storage, 'k', withReturn)
    expect(takePendingPkce(storage, 'k', 'st-1')?.returnTo).toBe('/team-chat?tab=all#top')
  })

  it('tolerates records written by older shells (no returnTo)', () => {
    const storage = memoryStorage()
    storage.setItem('k', JSON.stringify(PENDING))
    const taken = takePendingPkce(storage, 'k', 'st-1')
    expect(taken).toEqual(PENDING)
    expect(taken?.returnTo).toBeUndefined()
  })
})
