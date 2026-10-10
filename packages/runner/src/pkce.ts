/**
 * PKCE helpers — pure, storage-injected, unit-testable.
 *
 * Ported from the proven flow in an earlier React AuthProvider.tsx
 * + @pwfabric/runtime's OAuth2PkceAuthProvider, with ONE
 * deliberate structural change: the runner uses a FULL-PAGE redirect (the
 * shell itself is the redirect_uri — works on any static host with no
 * registered server callback route), so the code_verifier CANNOT live in an
 * in-memory instance field (the redirect destroys the JS heap — the exact
 * reason that provider had to use a popup). Instead the pending
 * {state, verifier, redirectUri} triple is persisted in sessionStorage across
 * the redirect and consumed exactly once on return.
 *
 * @module @pwfabric/runner/pkce
 */

import type { PwappAuth } from './types.js'

/** Minimal storage seam (sessionStorage in the browser; a stub in tests). */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

// ============================================================
// SCOPED STORAGE KEYS
// ============================================================

/**
 * Storage keys are scoped by the token's REAL identity — (tenant, client,
 * scopes) — never by app name and never a fixed literal. A fixed key leaks a
 * refresh token between apps sharing one origin (live-caught in that provider:
 * one app silently reused another's token and every scope mismatch surfaced
 * as "empty panels", not errors). FNV-1a produces the namespace only — no
 * secret in the key, the token itself is the value.
 */
export function authScopeKey(auth: Pick<PwappAuth, 'issuer' | 'clientId' | 'scopes'>): string {
  const id = `${auth.issuer}|${auth.clientId}|${[...(auth.scopes ?? [])].sort().join(' ')}`
  let h = 2166136261 // FNV-1a
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36)
}

export const pendingKeyFor = (scopeKey: string): string => `pwapp_pkce_pending:${scopeKey}`
export const refreshTokenKeyFor = (scopeKey: string): string => `pwapp_pkce_rt:${scopeKey}`

// ============================================================
// VERIFIER / CHALLENGE (RFC 7636, S256)
// ============================================================

/** Cryptographically random code verifier — 64 lowercase-hex chars. */
export function generateCodeVerifier(): string {
  const buffer = new Uint8Array(32)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** S256 code challenge — base64url(SHA-256(verifier)), no padding. */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// ============================================================
// ENDPOINTS — STATED, OR DISCOVERED. NEVER GUESSED.
// ============================================================

/**
 * The two endpoints a PKCE flow needs.
 *
 * These used to be two template literals containing a vendor's hostname, which
 * is why an app could only ever authenticate against that vendor. An issuer
 * that states its endpoints is believed; one that does not is ASKED, at the
 * address the standard reserves for the question. Neither branch invents a URL
 * shape — the moment you derive `{issuer}/oauth2/v2.0/authorize` you have
 * hardcoded one vendor again, just with an extra step.
 */
export interface OAuthEndpoints {
  readonly authorizeUrl: string
  readonly tokenUrl: string
}

/** `{issuer}/.well-known/openid-configuration` — the standard's own answer. */
export function discoveryUrlOf(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

/**
 * Resolved documents, keyed by issuer.
 *
 * Module-level rather than per-bridge: two surfaces of one app build two
 * bridges against the same issuer, and asking twice for a document that cannot
 * change within a page load is a round trip the login button waits on.
 */
const discovered = new Map<string, Promise<OAuthEndpoints>>()

/** Test seam — a resolved document must not leak between test files. */
export function clearDiscoveryCache(): void {
  discovered.clear()
}

async function fetchDiscovery(issuer: string): Promise<OAuthEndpoints> {
  const res = await fetch(discoveryUrlOf(issuer))
  if (!res.ok) {
    throw new Error(`[pwapp] issuer discovery ${res.status} at ${discoveryUrlOf(issuer)}`)
  }
  const doc = (await res.json()) as {
    authorization_endpoint?: string
    token_endpoint?: string
  }
  if (!doc.authorization_endpoint || !doc.token_endpoint) {
    throw new Error(`[pwapp] issuer ${issuer} published no authorize/token endpoint`)
  }
  return { authorizeUrl: doc.authorization_endpoint, tokenUrl: doc.token_endpoint }
}

/**
 * Both endpoints for this binding. Stated pair short-circuits; otherwise one
 * discovery per issuer per page load.
 *
 * A partially stated binding still discovers: half an answer is the case where
 * a gateway rewrote one endpoint and not the other, and preferring the stated
 * half of a document we are about to fetch anyway saves nothing.
 */
export async function resolveEndpoints(auth: PwappAuth): Promise<OAuthEndpoints> {
  if (auth.authorizeUrl && auth.tokenUrl) {
    return { authorizeUrl: auth.authorizeUrl, tokenUrl: auth.tokenUrl }
  }
  if (!auth.issuer) throw new Error('[pwapp] auth.json states no issuer and no endpoints')
  let pending = discovered.get(auth.issuer)
  if (!pending) {
    // A failed lookup must not be cached: the visitor presses "Sign in" again
    // after the network comes back, and a stored rejection makes that button
    // permanently dead for the rest of the page load.
    pending = fetchDiscovery(auth.issuer)
    pending.catch(() => discovered.delete(auth.issuer))
    discovered.set(auth.issuer, pending)
  }
  return pending
}

/**
 * The scope that yields a token for the app's own API — the DOOR token.
 *
 * `/.default` asks for every permission the API exposes, which for an app's
 * own registration is the one `access_as_user`-style scope it declared. The
 * form is Entra's; it is also the only issuer family this topology ships
 * against today. Used on the TOKEN endpoint only (refresh grant), never on
 * the authorize request. Nothing when the app declares no audience.
 */
export function doorScopeOf(auth: Pick<PwappAuth, 'audience'>): string | undefined {
  const audience = auth.audience?.replace(/[/]+$/, '')
  return audience ? `${audience}/.default` : undefined
}

export function buildAuthorizeUrl(
  auth: PwappAuth,
  params: {
    readonly challenge: string
    readonly state: string
    readonly redirectUri: string
    readonly authorizeUrl: string
  }
): string {
  const url = new URL(params.authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', auth.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  // THE DATA SCOPES ONLY. The door scope is `<audience>/.default`, and Entra
  // refuses `.default` beside resource-specific scopes on the authorize
  // request (AADSTS70011). It is redeemed from the
  // refresh token instead — see AuthBridge.getDoorToken — which needs no
  // consent screen when the owner pre-authorized the client for its API.
  url.searchParams.set('scope', (auth.scopes ?? []).join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ============================================================
// PENDING FLOW STATE (roundtrips the redirect)
// ============================================================

export interface PkcePending {
  readonly state: string
  readonly verifier: string
  readonly redirectUri: string
  /**
   * The in-app location (path + search + hash) the user was on when login
   * started. The redirect always lands on the app BASE (one registered URI
   * per app); after the code exchange the shell restores this location so
   * the user resumes on the page where they pressed "Sign in". Optional —
   * records written by older shells simply resume on the base.
   */
  readonly returnTo?: string
}

export function savePendingPkce(storage: KeyValueStorage, key: string, pending: PkcePending): void {
  storage.setItem(key, JSON.stringify(pending))
}

/**
 * Consumes the pending PKCE state — returns it only when `state` matches the
 * stored value, and ALWAYS removes the record (single-use: a mismatched or
 * replayed callback must not leave a usable verifier behind).
 */
export function takePendingPkce(storage: KeyValueStorage, key: string, state: string): PkcePending | null {
  const raw = storage.getItem(key)
  if (raw === null) return null
  storage.removeItem(key)
  try {
    const pending = JSON.parse(raw) as PkcePending
    if (!pending || typeof pending !== 'object') return null
    return pending.state === state && typeof pending.verifier === 'string' ? pending : null
  } catch {
    return null
  }
}
