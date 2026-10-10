/**
 * Authentication Module
 *
 * Authentication provider interface + implementations (MSAL/API-key).
 *
 * RBAC, session management and SSO (OIDC/SAML) are not part of this module:
 * they belong to the host that serves the app. Keeping them here would also
 * ship Node-only code (SAML's `node:util`/`node:zlib` XML parsing) inside
 * the browser-facing `embed.js` IIFE.
 *
 * @module @pwfabric/runtime/auth
 */

// Types
export type {
  AuthProviderType,
  AuthState,
  UserIdentity,
  AuthToken,
  AuthSession,
  AuthProviderConfig,
  MsalConfig,
  OAuth2Config,
  ApiKeyConfig,
  AuthResult,
  TokenResult,
  AuthError,
} from './types.js'

// Provider
export type { AuthProvider, LoginOptions } from './provider.js'
export { MsalAuthProvider, ApiKeyAuthProvider, createAuthProvider } from './provider.js'
