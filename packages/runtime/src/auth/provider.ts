/**
 * Authentication Provider
 *
 * Authentication provider interface and implementations
 *
 * @module @pwfabric/runtime/auth/provider
 */

import type {
  AuthProviderType,
  AuthProviderConfig,
  MsalConfig,
  OAuth2Config,
  ApiKeyConfig,
  AuthSession,
  AuthResult,
  TokenResult,
  AuthToken,
  UserIdentity,
} from './types.js'

// ============================================================
// AUTH PROVIDER INTERFACE
// ============================================================

/**
 * Authentication provider interface
 */
export interface AuthProvider {
  readonly type: AuthProviderType
  readonly config: AuthProviderConfig

  /**
   * Initialize the provider
   */
  initialize(): Promise<void>

  /**
   * Start authentication flow
   */
  login(options?: LoginOptions): Promise<AuthResult>

  /**
   * End authentication session
   */
  logout(): Promise<void>

  /**
   * Get current session
   */
  getSession(): AuthSession | undefined

  /**
   * Acquire token silently
   */
  acquireTokenSilent(scopes?: readonly string[]): Promise<TokenResult>

  /**
   * Check if authenticated
   */
  isAuthenticated(): boolean

  /**
   * Get current user
   */
  getUser(): UserIdentity | undefined
}

/**
 * Login options
 */
export interface LoginOptions {
  readonly scopes?: readonly string[]
  readonly prompt?: 'login' | 'consent' | 'select_account' | 'none'
  readonly loginHint?: string
}

// ============================================================
// MSAL AUTH PROVIDER (Stub)
// ============================================================

/**
 * MSAL authentication provider
 *
 * Note: This is a stub implementation. In production, this would
 * integrate with @azure/msal-browser or @azure/msal-node.
 */
export class MsalAuthProvider implements AuthProvider {
  readonly type: AuthProviderType = 'msal'
  readonly config: MsalConfig

  private session: AuthSession | undefined
  private initialized = false

  constructor(config: MsalConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    // In production: Initialize MSAL instance
    this.initialized = true
  }

  async login(options?: LoginOptions): Promise<AuthResult> {
    if (!this.initialized) {
      return {
        success: false,
        error: {
          type: 'invalid_config',
          message: 'Provider not initialized',
        },
      }
    }

    // Stub: Create mock session
    const scopes = options?.scopes ?? this.config.scopes
    const token: AuthToken = {
      accessToken: 'mock_access_token',
      idToken: 'mock_id_token',
      expiresAt: Date.now() + 3600000, // 1 hour
      scopes,
    }

    const user: UserIdentity = {
      id: 'mock_user_id',
      name: 'Mock User',
      email: 'mock@example.com',
      ...(this.config.worldId !== undefined ? { worldId: this.config.worldId } : {}),
    }

    this.session = {
      id: `session_${Date.now()}`,
      state: 'authenticated',
      user,
      token,
      provider: 'msal',
      createdAt: Date.now(),
      expiresAt: token.expiresAt,
    }

    return { success: true, session: this.session }
  }

  async logout(): Promise<void> {
    this.session = undefined
  }

  getSession(): AuthSession | undefined {
    return this.session
  }

  async acquireTokenSilent(_scopes?: readonly string[]): Promise<TokenResult> {
    if (!this.session?.token) {
      return {
        success: false,
        error: {
          type: 'token_expired',
          message: 'No active session',
        },
      }
    }

    // Check if token is expired
    if (this.session.token.expiresAt < Date.now()) {
      return {
        success: false,
        error: {
          type: 'token_expired',
          message: 'Token has expired',
        },
      }
    }

    return { success: true, token: this.session.token }
  }

  isAuthenticated(): boolean {
    return this.session?.state === 'authenticated'
  }

  getUser(): UserIdentity | undefined {
    return this.session?.user
  }
}

// ============================================================
// OAUTH2 PKCE AUTH PROVIDER
// ============================================================

/**
 * Generate a cryptographically random code verifier for PKCE
 */
function generateCodeVerifier(): string {
  const buffer = new Uint8Array(32)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a code challenge from a code verifier (S256 method)
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * OAuth2 PKCE authentication provider
 *
 * Implements the Authorization Code flow with PKCE (RFC 7636)
 * for secure authentication without client secrets.
 */
export class OAuth2PkceAuthProvider implements AuthProvider {
  readonly type: AuthProviderType = 'oauth2'
  readonly config: OAuth2Config

  private session: AuthSession | undefined
  private codeVerifier: string | undefined
  private initialized = false

  constructor(config: OAuth2Config) {
    this.config = config
  }

  async initialize(): Promise<void> {
    this.initialized = true
  }

  async login(options?: LoginOptions): Promise<AuthResult> {
    if (!this.initialized) {
      return {
        success: false,
        error: { type: 'invalid_config', message: 'Provider not initialized' },
      }
    }

    try {
      // Step 1: Generate PKCE code verifier and challenge
      this.codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(this.codeVerifier)
      const state = generateCodeVerifier().slice(0, 32)

      const scopes = options?.scopes ?? this.config.scopes

      // Step 2: Build authorization URL
      const authUrl = new URL(this.config.authorizationEndpoint)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('client_id', this.config.clientId)
      authUrl.searchParams.set('redirect_uri', this.config.redirectUri)
      authUrl.searchParams.set('scope', scopes.join(' '))
      authUrl.searchParams.set('state', state)
      authUrl.searchParams.set('code_challenge', codeChallenge)
      authUrl.searchParams.set('code_challenge_method', 'S256')

      if (options?.prompt) {
        authUrl.searchParams.set('prompt', options.prompt)
      }
      if (options?.loginHint) {
        authUrl.searchParams.set('login_hint', options.loginHint)
      }

      // Step 3: Return the authorization URL for the caller to open
      // In browser context, this would redirect. In CLI, the caller
      // starts a local server to capture the callback.
      return {
        success: false,
        error: {
          type: 'provider_error',
          message: 'PKCE_REDIRECT_REQUIRED',
          code: authUrl.toString(),
        },
      }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'provider_error',
          message: error instanceof Error ? error.message : 'OAuth2 login failed',
          cause: error,
        },
      }
    }
  }

  /**
   * Exchange authorization code for tokens (PKCE Step 2)
   *
   * Called after the user completes the OAuth flow and the authorization
   * code is received via the redirect URI.
   */
  async exchangeCode(code: string): Promise<AuthResult> {
    if (!this.codeVerifier) {
      return {
        success: false,
        error: { type: 'invalid_config', message: 'No PKCE flow in progress. Call login() first.' },
      }
    }

    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: this.config.redirectUri,
          client_id: this.config.clientId,
          code_verifier: this.codeVerifier,
        }),
      })

      if (!response.ok) {
        const errorBody = await response.text()
        return {
          success: false,
          error: {
            type: 'provider_error',
            message: `Token exchange failed: ${response.status}`,
            code: errorBody,
          },
        }
      }

      const tokenData = (await response.json()) as {
        access_token: string
        refresh_token?: string
        id_token?: string
        expires_in: number
        scope?: string
      }

      const token: AuthToken = {
        accessToken: tokenData.access_token,
        ...(tokenData.refresh_token !== undefined ? { refreshToken: tokenData.refresh_token } : {}),
        ...(tokenData.id_token !== undefined ? { idToken: tokenData.id_token } : {}),
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        scopes: tokenData.scope?.split(' ') ?? this.config.scopes,
      }

      // Decode user info from ID token or access token claims
      const user = this.decodeUserFromToken(token)

      this.session = {
        id: `session_${Date.now()}`,
        state: 'authenticated',
        ...(user !== undefined ? { user } : {}),
        token,
        provider: 'oauth2',
        createdAt: Date.now(),
        expiresAt: token.expiresAt,
      }

      // Clear the code verifier after successful exchange
      this.codeVerifier = undefined

      return { success: true, session: this.session }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: error instanceof Error ? error.message : 'Token exchange failed',
          cause: error,
        },
      }
    }
  }

  async logout(): Promise<void> {
    this.session = undefined
    this.codeVerifier = undefined
  }

  getSession(): AuthSession | undefined {
    return this.session
  }

  async acquireTokenSilent(_scopes?: readonly string[]): Promise<TokenResult> {
    if (!this.session?.token) {
      return {
        success: false,
        error: { type: 'token_expired', message: 'No active session' },
      }
    }

    // Check if token is expired
    if (this.session.token.expiresAt < Date.now()) {
      // Try refresh if refresh token available
      if (this.session.token.refreshToken) {
        return this.refreshToken(this.session.token.refreshToken)
      }
      return {
        success: false,
        error: {
          type: 'token_expired',
          message: 'Token has expired and no refresh token available',
        },
      }
    }

    return { success: true, token: this.session.token }
  }

  isAuthenticated(): boolean {
    if (this.session?.state !== 'authenticated') return false
    if (this.session.token && this.session.token.expiresAt < Date.now()) return false
    return true
  }

  getUser(): UserIdentity | undefined {
    return this.session?.user
  }

  /**
   * Refresh the access token using a refresh token
   */
  private async refreshToken(refreshToken: string): Promise<TokenResult> {
    try {
      const response = await fetch(this.config.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.config.clientId,
        }),
      })

      if (!response.ok) {
        return {
          success: false,
          error: { type: 'token_expired', message: `Refresh failed: ${response.status}` },
        }
      }

      const tokenData = (await response.json()) as {
        access_token: string
        refresh_token?: string
        id_token?: string
        expires_in: number
        scope?: string
      }

      const newRefreshToken = tokenData.refresh_token ?? refreshToken
      const token: AuthToken = {
        accessToken: tokenData.access_token,
        refreshToken: newRefreshToken,
        ...(tokenData.id_token !== undefined ? { idToken: tokenData.id_token } : {}),
        expiresAt: Date.now() + tokenData.expires_in * 1000,
        scopes: tokenData.scope?.split(' ') ?? this.config.scopes,
      }

      // Update session with new token
      const user = this.decodeUserFromToken(token) ?? this.session?.user
      this.session = {
        id: this.session?.id ?? `session_${Date.now()}`,
        state: 'authenticated',
        ...(user !== undefined ? { user } : {}),
        token,
        provider: 'oauth2',
        createdAt: this.session?.createdAt ?? Date.now(),
        expiresAt: token.expiresAt,
      }

      return { success: true, token }
    } catch (error) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: error instanceof Error ? error.message : 'Token refresh failed',
          cause: error,
        },
      }
    }
  }

  /**
   * Decode user identity from JWT token claims
   */
  private decodeUserFromToken(token: AuthToken): UserIdentity | undefined {
    const jwtToDecode = token.idToken ?? token.accessToken
    try {
      const parts = jwtToDecode.split('.')
      if (parts.length !== 3) return undefined

      const encodedPayload = parts[1]
      if (!encodedPayload) return undefined
      const payload = JSON.parse(atob(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'))) as {
        sub?: string
        name?: string
        email?: string
        wid?: string
        roles?: string[]
      }

      return {
        id: payload.sub ?? 'unknown',
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.email !== undefined ? { email: payload.email } : {}),
        ...(payload.wid !== undefined ? { worldId: payload.wid } : {}),
        ...(payload.roles !== undefined ? { roles: payload.roles } : {}),
      }
    } catch {
      return undefined
    }
  }
}

// ============================================================
// API KEY AUTH PROVIDER
// ============================================================

/**
 * API Key authentication provider
 */
export class ApiKeyAuthProvider implements AuthProvider {
  readonly type: AuthProviderType = 'api-key'
  readonly config: ApiKeyConfig

  private session: AuthSession | undefined
  private apiKey: string | undefined

  constructor(config: ApiKeyConfig) {
    this.config = config
  }

  async initialize(): Promise<void> {
    // No initialization needed
  }

  async login(_options?: LoginOptions): Promise<AuthResult> {
    // API key auth doesn't have a login flow
    // The key is typically set via setApiKey()
    if (!this.apiKey) {
      return {
        success: false,
        error: {
          type: 'invalid_credentials',
          message: 'API key not set',
        },
      }
    }

    const token: AuthToken = {
      accessToken: this.apiKey,
      expiresAt: Date.now() + 86400000, // 24 hours
      scopes: [],
    }

    this.session = {
      id: `session_${Date.now()}`,
      state: 'authenticated',
      token,
      provider: 'api-key',
      createdAt: Date.now(),
    }

    return { success: true, session: this.session }
  }

  async logout(): Promise<void> {
    this.session = undefined
    this.apiKey = undefined
  }

  getSession(): AuthSession | undefined {
    return this.session
  }

  async acquireTokenSilent(): Promise<TokenResult> {
    if (!this.session?.token) {
      return {
        success: false,
        error: {
          type: 'token_expired',
          message: 'No active session',
        },
      }
    }

    return { success: true, token: this.session.token }
  }

  isAuthenticated(): boolean {
    return this.session?.state === 'authenticated'
  }

  getUser(): UserIdentity | undefined {
    return undefined // API key auth typically doesn't have user identity
  }

  /**
   * Set the API key
   */
  setApiKey(key: string): void {
    this.apiKey = key
  }
}

// ============================================================
// AUTH PROVIDER FACTORY
// ============================================================

/**
 * Create an authentication provider
 */
export function createAuthProvider(config: AuthProviderConfig): AuthProvider {
  switch (config.type) {
    case 'msal':
      return new MsalAuthProvider(config as MsalConfig)
    case 'oauth2':
      return new OAuth2PkceAuthProvider(config as OAuth2Config)
    case 'api-key':
      return new ApiKeyAuthProvider(config as ApiKeyConfig)
    default:
      throw new Error(`Unknown auth provider type: ${config.type}`)
  }
}
