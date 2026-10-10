/**
 * Authentication Types
 *
 * Authentication system types
 *
 * @module @pwfabric/runtime/auth/types
 */

// ============================================================
// AUTH PROVIDER TYPES
// ============================================================

/**
 * Authentication provider type
 */
export type AuthProviderType = 'msal' | 'oauth2' | 'api-key' | 'custom'

/**
 * Authentication state
 */
export type AuthState = 'unauthenticated' | 'authenticating' | 'authenticated' | 'error' | 'expired'

/**
 * User identity
 */
export interface UserIdentity {
  readonly id: string
  readonly name?: string
  readonly email?: string
  readonly worldId?: string
  readonly roles?: readonly string[]
  readonly claims?: Record<string, unknown>
}

/**
 * Authentication token
 */
export interface AuthToken {
  readonly accessToken: string
  readonly refreshToken?: string
  readonly idToken?: string
  readonly expiresAt: number
  readonly scopes: readonly string[]
}

/**
 * Authentication session
 */
export interface AuthSession {
  readonly id: string
  readonly state: AuthState
  readonly user?: UserIdentity
  readonly token?: AuthToken
  readonly provider: AuthProviderType
  readonly createdAt: number
  readonly expiresAt?: number
}

// ============================================================
// AUTH CONFIGURATION
// ============================================================

/**
 * Base auth provider configuration
 */
export interface AuthProviderConfig {
  readonly type: AuthProviderType
  readonly clientId?: string
  readonly authority?: string
  readonly scopes?: readonly string[]
  readonly redirectUri?: string
}

/**
 * MSAL configuration
 */
export interface MsalConfig extends AuthProviderConfig {
  readonly type: 'msal'
  readonly clientId: string
  readonly authority: string
  readonly scopes: readonly string[]
  readonly redirectUri: string
  readonly worldId?: string
}

/**
 * OAuth2 configuration
 */
export interface OAuth2Config extends AuthProviderConfig {
  readonly type: 'oauth2'
  readonly authorizationEndpoint: string
  readonly tokenEndpoint: string
  readonly clientId: string
  readonly scopes: readonly string[]
  readonly redirectUri: string
}

/**
 * API Key configuration
 */
export interface ApiKeyConfig extends AuthProviderConfig {
  readonly type: 'api-key'
  readonly headerName: string
  readonly keyPrefix?: string
}

// ============================================================
// AUTH RESULT TYPES
// ============================================================

/**
 * Authentication result
 */
export type AuthResult =
  | { readonly success: true; readonly session: AuthSession }
  | { readonly success: false; readonly error: AuthError }

/**
 * Token acquisition result
 */
export type TokenResult =
  | { readonly success: true; readonly token: AuthToken }
  | { readonly success: false; readonly error: AuthError }

/**
 * Authentication error
 */
export interface AuthError {
  readonly type:
    | 'invalid_config'
    | 'network_error'
    | 'invalid_credentials'
    | 'token_expired'
    | 'insufficient_scope'
    | 'provider_error'
  readonly message: string
  readonly code?: string
  readonly cause?: unknown
}

