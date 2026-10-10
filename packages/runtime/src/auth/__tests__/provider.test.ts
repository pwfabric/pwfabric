/**
 * Auth Provider Tests
 *
 * Tests for authentication providers
 *
 * @module @pwfabric/runtime/auth/__tests__/provider
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  MsalAuthProvider,
  ApiKeyAuthProvider,
  OAuth2PkceAuthProvider,
  createAuthProvider,
} from '../provider.js'
import type { MsalConfig, ApiKeyConfig, OAuth2Config } from '../types.js'

describe('MsalAuthProvider', () => {
  let provider: MsalAuthProvider
  const config: MsalConfig = {
    type: 'msal',
    clientId: 'test-client-id',
    worldId: 'test-tenant-id',
    redirectUri: 'http://localhost:3000',
    scopes: ['user.read'],
  }

  beforeEach(() => {
    provider = new MsalAuthProvider(config)
  })

  describe('initialize', () => {
    it('should initialize provider', async () => {
      await provider.initialize()
      // Provider should be ready after initialization
      expect(provider.type).toBe('msal')
    })
  })

  describe('login', () => {
    it('should fail if not initialized', async () => {
      const result = await provider.login()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('invalid_config')
      }
    })

    it('should create session after login', async () => {
      await provider.initialize()

      const result = await provider.login()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.state).toBe('authenticated')
        expect(result.session.token).toBeDefined()
        expect(result.session.user).toBeDefined()
      }
    })

    it('should use custom scopes if provided', async () => {
      await provider.initialize()

      const result = await provider.login({ scopes: ['mail.read'] })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.token.scopes).toEqual(['mail.read'])
      }
    })
  })

  describe('logout', () => {
    it('should clear session', async () => {
      await provider.initialize()
      await provider.login()

      await provider.logout()

      expect(provider.getSession()).toBeUndefined()
      expect(provider.isAuthenticated()).toBe(false)
    })
  })

  describe('getSession', () => {
    it('should return undefined when not logged in', () => {
      expect(provider.getSession()).toBeUndefined()
    })

    it('should return session when logged in', async () => {
      await provider.initialize()
      await provider.login()

      const session = provider.getSession()

      expect(session).toBeDefined()
      expect(session?.state).toBe('authenticated')
    })
  })

  describe('acquireTokenSilent', () => {
    it('should fail if no session', async () => {
      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('token_expired')
      }
    })

    it('should return token if session exists', async () => {
      await provider.initialize()
      await provider.login()

      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.token.accessToken).toBeDefined()
      }
    })
  })

  describe('isAuthenticated', () => {
    it('should return false when not logged in', () => {
      expect(provider.isAuthenticated()).toBe(false)
    })

    it('should return true when logged in', async () => {
      await provider.initialize()
      await provider.login()

      expect(provider.isAuthenticated()).toBe(true)
    })
  })

  describe('getUser', () => {
    it('should return undefined when not logged in', () => {
      expect(provider.getUser()).toBeUndefined()
    })

    it('should return user when logged in', async () => {
      await provider.initialize()
      await provider.login()

      const user = provider.getUser()

      expect(user).toBeDefined()
      expect(user?.id).toBeDefined()
    })
  })
})

describe('ApiKeyAuthProvider', () => {
  let provider: ApiKeyAuthProvider
  const config: ApiKeyConfig = {
    type: 'api-key',
    headerName: 'X-API-Key',
  }

  beforeEach(() => {
    provider = new ApiKeyAuthProvider(config)
  })

  describe('initialize', () => {
    it('should initialize without error', async () => {
      await provider.initialize()
      expect(provider.type).toBe('api-key')
    })
  })

  describe('login', () => {
    it('should fail if API key not set', async () => {
      const result = await provider.login()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('invalid_credentials')
      }
    })

    it('should succeed after setting API key', async () => {
      provider.setApiKey('test-api-key')

      const result = await provider.login()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.token.accessToken).toBe('test-api-key')
      }
    })
  })

  describe('setApiKey', () => {
    it('should allow setting API key', async () => {
      provider.setApiKey('my-key')

      // Verify key is set by attempting login
      const result = await provider.login()
      expect(result).toMatchObject({ success: true })
    })
  })

  describe('logout', () => {
    it('should clear session and API key', async () => {
      provider.setApiKey('test-key')
      await provider.login()

      await provider.logout()

      expect(provider.getSession()).toBeUndefined()
      expect(provider.isAuthenticated()).toBe(false)
    })
  })

  describe('getUser', () => {
    it('should return undefined (API key auth has no user)', async () => {
      provider.setApiKey('test-key')
      await provider.login()

      expect(provider.getUser()).toBeUndefined()
    })
  })

  describe('acquireTokenSilent', () => {
    it('should fail when no session (no key set, no login)', async () => {
      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('token_expired')
      }
    })

    it('should return token when session exists', async () => {
      provider.setApiKey('my-api-key')
      await provider.login()

      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(true)
    })
  })
})

describe('createAuthProvider', () => {
  it('should create MSAL provider', () => {
    const config: MsalConfig = {
      type: 'msal',
      clientId: 'test-client',
      redirectUri: 'http://localhost',
      scopes: [],
    }

    const provider = createAuthProvider(config)

    expect(provider).toBeInstanceOf(MsalAuthProvider)
  })

  it('should create API key provider', () => {
    const config: ApiKeyConfig = {
      type: 'api-key',
      headerName: 'Authorization',
    }

    const provider = createAuthProvider(config)

    expect(provider).toBeInstanceOf(ApiKeyAuthProvider)
  })

  it('should create OAuth2 PKCE provider', () => {
    const config: OAuth2Config = {
      type: 'oauth2',
      clientId: 'client-id',
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      redirectUri: 'http://localhost/callback',
      scopes: ['openid'],
    }

    const provider = createAuthProvider(config)

    expect(provider).toBeInstanceOf(OAuth2PkceAuthProvider)
  })

  it('should throw for unknown provider type', () => {
    const config = { type: 'unknown' } as never

    expect(() => createAuthProvider(config)).toThrow('Unknown auth provider type')
  })
})

// ============================================================
// OAuth2PkceAuthProvider
// ============================================================

describe('OAuth2PkceAuthProvider', () => {
  let provider: OAuth2PkceAuthProvider
  const config: OAuth2Config = {
    type: 'oauth2',
    clientId: 'test-client-id',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    redirectUri: 'http://localhost:3000/callback',
    scopes: ['openid', 'profile'],
  }

  beforeEach(() => {
    provider = new OAuth2PkceAuthProvider(config)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialize', () => {
    it('should initialize without error', async () => {
      await provider.initialize()
      expect(provider.type).toBe('oauth2')
    })
  })

  describe('login', () => {
    it('should fail if not initialized', async () => {
      const result = await provider.login()
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('invalid_config')
      }
    })

    it('should return PKCE redirect URL after initialize', async () => {
      await provider.initialize()
      const result = await provider.login()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('provider_error')
        expect(result.error.message).toBe('PKCE_REDIRECT_REQUIRED')
        // The redirect URL is embedded in error.code
        expect(result.error.code).toContain('response_type=code')
        expect(result.error.code).toContain('client_id=test-client-id')
        expect(result.error.code).toContain('code_challenge_method=S256')
      }
    })

    it('should include custom scopes in redirect URL', async () => {
      await provider.initialize()
      const result = await provider.login({ scopes: ['openid', 'email'] })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toContain('scope=openid+email')
      }
    })

    it('should include prompt in redirect URL when provided', async () => {
      await provider.initialize()
      const result = await provider.login({ prompt: 'consent' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toContain('prompt=consent')
      }
    })

    it('should include login_hint in redirect URL when provided', async () => {
      await provider.initialize()
      const result = await provider.login({ loginHint: 'user@example.com' })

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.code).toContain('login_hint=user%40example.com')
      }
    })
  })

  describe('exchangeCode', () => {
    it('should fail when no PKCE flow in progress (no prior login)', async () => {
      const result = await provider.exchangeCode('auth-code')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('invalid_config')
        expect(result.error.message).toContain('login() first')
      }
    })

    it('should create session on successful token exchange', async () => {
      await provider.initialize()
      await provider.login() // sets codeVerifier

      // Build a mock JWT payload
      const payload = { sub: 'user-123', name: 'Test User', email: 'test@example.com' }
      const encodedPayload = btoa(JSON.stringify(payload))
      const mockIdToken = `header.${encodedPayload}.signature`

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'access-token-value',
            id_token: mockIdToken,
            expires_in: 3600,
            scope: 'openid profile',
          }),
        })
      )

      const result = await provider.exchangeCode('auth-code-123')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.state).toBe('authenticated')
        expect(result.session.token.accessToken).toBe('access-token-value')
        expect(result.session.user?.id).toBe('user-123')
        expect(result.session.user?.name).toBe('Test User')
      }
    })

    it('should handle token exchange when id_token has no sub', async () => {
      await provider.initialize()
      await provider.login()

      const payload = {} // no sub, name, email
      const encodedPayload = btoa(JSON.stringify(payload))
      const mockIdToken = `header.${encodedPayload}.signature`

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'access-token',
            id_token: mockIdToken,
            expires_in: 3600,
          }),
        })
      )

      const result = await provider.exchangeCode('code')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.user?.id).toBe('unknown')
      }
    })

    it('should handle response with no id_token (uses access_token for user decode)', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'plain-access-token',
            refresh_token: 'refresh-token-value',
            expires_in: 3600,
          }),
        })
      )

      const result = await provider.exchangeCode('code')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.token.refreshToken).toBe('refresh-token-value')
      }
    })

    it('should return error when token endpoint returns 4xx', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 400,
          text: async () => 'invalid_grant',
        })
      )

      const result = await provider.exchangeCode('bad-code')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('provider_error')
        expect(result.error.message).toContain('400')
      }
    })

    it('should return network_error when fetch throws', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network failure')))

      const result = await provider.exchangeCode('code')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('network_error')
        expect(result.error.message).toBe('Network failure')
      }
    })
  })

  describe('logout', () => {
    it('should clear session and code verifier', async () => {
      await provider.initialize()
      await provider.login()

      await provider.logout()

      expect(provider.getSession()).toBeUndefined()
      expect(provider.isAuthenticated()).toBe(false)
    })
  })

  describe('getSession', () => {
    it('should return undefined before exchange', async () => {
      expect(provider.getSession()).toBeUndefined()
    })
  })

  describe('acquireTokenSilent', () => {
    it('should fail when no session', async () => {
      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('token_expired')
      }
    })

    it('should return token when session is valid', async () => {
      await provider.initialize()
      await provider.login()

      const payload = { sub: 'u1' }
      const mockToken = `h.${btoa(JSON.stringify(payload))}.s`

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: mockToken,
            expires_in: 3600,
            scope: 'openid',
          }),
        })
      )

      await provider.exchangeCode('code')

      const result = await provider.acquireTokenSilent()
      expect(result.success).toBe(true)
    })

    it('should fail with no refresh token when token expired', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'access',
            expires_in: -1, // already expired
            scope: 'openid',
          }),
        })
      )

      await provider.exchangeCode('code')

      const result = await provider.acquireTokenSilent()
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('token_expired')
      }
    })

    it('should use refresh token when token expired and refresh token available', async () => {
      await provider.initialize()
      await provider.login()

      // First exchange: set expired session with refresh token
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              access_token: 'old-token',
              refresh_token: 'refresh-token-123',
              expires_in: -1, // expired
              scope: 'openid',
            }),
          })
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              access_token: 'new-token',
              refresh_token: 'refresh-token-123',
              expires_in: 3600,
              scope: 'openid',
            }),
          })
      )

      await provider.exchangeCode('code')
      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.token.accessToken).toBe('new-token')
      }
    })

    it('should return network_error when refresh fetch throws', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              access_token: 'old',
              refresh_token: 'rt',
              expires_in: -1,
              scope: 'openid',
            }),
          })
          .mockRejectedValueOnce(new Error('refresh network error'))
      )

      await provider.exchangeCode('code')
      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('network_error')
      }
    })

    it('should return token_expired when refresh endpoint returns 4xx', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({
              access_token: 'old',
              refresh_token: 'rt',
              expires_in: -1,
              scope: 'openid',
            }),
          })
          .mockResolvedValueOnce({
            ok: false,
            status: 401,
          })
      )

      await provider.exchangeCode('code')
      const result = await provider.acquireTokenSilent()

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('token_expired')
      }
    })
  })

  describe('isAuthenticated', () => {
    it('should return false before login', () => {
      expect(provider.isAuthenticated()).toBe(false)
    })
  })

  describe('getUser', () => {
    it('should return undefined before login', () => {
      expect(provider.getUser()).toBeUndefined()
    })

    it('should return user after successful token exchange', async () => {
      await provider.initialize()
      await provider.login()

      const payload = { sub: 'u-xyz', name: 'Jane Doe', email: 'jane@example.com', wid: 'tenant1' }
      const mockToken = `h.${btoa(JSON.stringify(payload))}.s`

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: mockToken,
            expires_in: 3600,
          }),
        })
      )

      await provider.exchangeCode('code')

      const user = provider.getUser()
      expect(user?.id).toBe('u-xyz')
      expect(user?.name).toBe('Jane Doe')
      expect(user?.email).toBe('jane@example.com')
      expect(user?.worldId).toBe('tenant1')
    })
  })

  describe('decodeUserFromToken edge cases', () => {
    it('should handle invalid JWT (not 3 parts) gracefully', async () => {
      await provider.initialize()
      await provider.login()

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: 'not-a-jwt',
            expires_in: 3600,
          }),
        })
      )

      // Should not throw — decodeUserFromToken returns undefined for invalid JWT
      const result = await provider.exchangeCode('code')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.session.user).toBeUndefined()
      }
    })

    it('should handle malformed base64 JWT payload gracefully', async () => {
      await provider.initialize()
      await provider.login()

      // Valid 3-part structure but invalid base64 in the payload part → catch block
      const malformedToken = 'header.!!!invalid_base64!!!.signature'

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            access_token: malformedToken,
            expires_in: 3600,
          }),
        })
      )

      const result = await provider.exchangeCode('code')
      expect(result.success).toBe(true)
      if (result.success) {
        // decodeUserFromToken returns undefined on exception → user is undefined
        expect(result.session.user).toBeUndefined()
      }
    })

    it('should handle roles in JWT payload', async () => {
      await provider.initialize()
      await provider.login()

      const payload = { sub: 'u1', roles: ['admin', 'editor'] }
      const mockToken = `h.${btoa(JSON.stringify(payload))}.s`

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ access_token: mockToken, expires_in: 3600 }),
        })
      )

      await provider.exchangeCode('code')
      const user = provider.getUser()
      expect(user?.roles).toEqual(['admin', 'editor'])
    })
  })
})
