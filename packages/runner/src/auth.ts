/**
 * Auth bridge — framework-free PKCE session, ported from an earlier React
 * AuthProvider.tsx with plain
 * module state + change listeners instead of React context.
 *
 * Differences from that provider, all deliberate:
 * - FULL-PAGE redirect instead of a popup: redirect_uri is the app BASE
 *   (passed in via options by run-app from the router's base; falls back to
 *   `location.origin + location.pathname`), so the flow works on any static
 *   host without a registered `/auth/callback` route AND needs only ONE
 *   registered SPA redirect URI per app even under the path router, where
 *   every page has its own pathname. The pending record's `returnTo`
 *   restores the page login started from. The PKCE verifier is persisted
 *   across the redirect (see pkce.ts) instead of living in an in-memory
 *   provider field. Backward compat: if the current URL equals
 *   `auth.redirectPath`, a `?code=&state=` callback is honored there too
 *   (the pending record stores whichever redirect_uri started the flow).
 * - Token exchange / refresh are implemented directly against the Entra
 *   token endpoint rather than through runtime's OAuth2PkceAuthProvider —
 *   the provider's `exchangeCode()` requires its own in-memory verifier
 *   (destroyed by our redirect) and isn't on the public AuthProvider
 *   interface anyway (a known upstream gap).
 * - Session/user/token SHAPES stay aligned with
 *   `@pwfabric/runtime/auth` types (type-only import).
 *
 * Kept identical to that provider: refresh-token persistence in
 * sessionStorage under a (tenant|client|scopes)-scoped key, silent restore on
 * boot with single-flight + rotation, SPFx `window.__pwfabric_getToken` host seam.
 *
 * @module @pwfabric/runner/auth
 */

import type { AuthSession, AuthToken, UserIdentity } from '@pwfabric/runtime/auth'
import type { PwappAuth } from './types.js'
import { copyFor, type RunnerLocale } from './copy.js'
import {
  authScopeKey,
  buildAuthorizeUrl,
  generateCodeChallenge,
  generateCodeVerifier,
  pendingKeyFor,
  refreshTokenKeyFor,
  doorScopeOf,
  savePendingPkce,
  takePendingPkce,
  resolveEndpoints,
} from './pkce.js'

// ============================================================
// TOKEN RESPONSE PARSING
// ============================================================

interface TokenEndpointResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in: number
  scope?: string
}

/** Decode user identity from JWT claims (port of OAuth2PkceAuthProvider). */
function decodeUserFromToken(token: AuthToken): UserIdentity | undefined {
  const jwt = token.idToken ?? token.accessToken
  try {
    const parts = jwt.split('.')
    if (parts.length !== 3) return undefined
    const encoded = parts[1]
    if (!encoded) return undefined
    const payload = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/'))) as {
      sub?: string
      name?: string
      email?: string
      preferred_username?: string
      roles?: string[]
    }
    const email = payload.email ?? payload.preferred_username
    return {
      id: payload.sub ?? 'unknown',
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(email !== undefined ? { email } : {}),
      ...(payload.roles !== undefined ? { roles: payload.roles } : {}),
    }
  } catch {
    return undefined
  }
}

function toAuthToken(data: TokenEndpointResponse, fallbackScopes: readonly string[]): AuthToken {
  return {
    accessToken: data.access_token,
    ...(data.refresh_token !== undefined ? { refreshToken: data.refresh_token } : {}),
    ...(data.id_token !== undefined ? { idToken: data.id_token } : {}),
    expiresAt: Date.now() + data.expires_in * 1000,
    scopes: data.scope?.split(' ') ?? fallbackScopes,
  }
}

function toSession(token: AuthToken, previous?: AuthSession): AuthSession {
  const user = decodeUserFromToken(token) ?? previous?.user
  return {
    id: previous?.id ?? `session_${Date.now()}`,
    state: 'authenticated',
    ...(user !== undefined ? { user } : {}),
    token,
    provider: 'oauth2',
    createdAt: previous?.createdAt ?? Date.now(),
    expiresAt: token.expiresAt,
  }
}

// ============================================================
// AUTH BRIDGE
// ============================================================

export interface AuthBridge {
  /** Current session, undefined when logged out. */
  readonly session: AuthSession | undefined
  /**
   * Last user-visible auth failure, or undefined when there is none.
   *
   * Exists because a failed callback used to be a `console.warn` and nothing
   * else: the user pressed "Sign in", came back from Entra, and landed on the
   * same anonymous page with no indication anything had gone wrong. Set on a
   * rejected callback (stale/replayed `state`) and on a failed code exchange;
   * cleared when a new login starts or a session is established. An expired
   * refresh token on boot is NOT an error — it degrades to the login button,
   * which is already the correct thing to show.
   */
  readonly lastError: string | undefined
  /** Handle a redirect callback and/or silently restore a session. */
  init(): Promise<void>
  /** Start the PKCE flow — full-page redirect to the issuer's authorize URL. */
  loginWithPkce(): void
  logout(): void
  /** Fresh access token (SPFx host seam first, then session, then refresh). */
  getAccessToken(): Promise<string | undefined>
  /**
   * The token this app presents to ITS OWN door — `aud` = the app's audience.
   *
   * Distinct from `getAccessToken`, which is for the data the app reads: a
   * Graph token names Graph, and the platform door rightly refuses it. This
   * one is redeemed from the refresh token for `<audience>/.default` on
   * first use and kept until it nears expiry. Undefined when the app
   * declares no audience, or when nobody is signed in.
   */
  getDoorToken(): Promise<string | undefined>
  /** Subscribe to login/logout; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
}

export interface AuthBridgeOptions {
  /**
   * Fixed redirect URI for the PKCE flow — the app's base URL (origin +
   * router base). One app = one registered SPA redirect URI in Entra,
   * regardless of which page login starts from; the pending record's
   * `returnTo` restores the starting page after the exchange. When omitted,
   * falls back to the historical per-location behavior (origin + pathname).
   */
  readonly redirectUri?: string
  /** The app's content locale, for the errors the bridge reports. Default `en`. */
  readonly locale?: RunnerLocale
}

export function createAuthBridge(auth: PwappAuth, options?: AuthBridgeOptions): AuthBridge {
  const scopeKey = authScopeKey(auth)
  const pendingKey = pendingKeyFor(scopeKey)
  const rtKey = refreshTokenKeyFor(scopeKey)
  const copy = copyFor(options?.locale).bridge

  let session: AuthSession | undefined
  let lastError: string | undefined
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const setSession = (next: AuthSession | undefined): void => {
    session = next
    if (next) lastError = undefined // a live session supersedes any past failure
    notify()
  }

  const setError = (message: string | undefined): void => {
    lastError = message
    notify()
  }

  const persistRefreshToken = (s: AuthSession | undefined): void => {
    const rt = s?.token?.refreshToken
    if (rt) sessionStorage.setItem(rtKey, rt)
  }

  async function postTokenEndpoint(body: Record<string, string>): Promise<TokenEndpointResponse | null> {
    try {
      // Resolved here rather than at construction: the endpoints may come from
      // the issuer's discovery document, and building a bridge must not become
      // an async act — `run-app` constructs one before it has a chance to
      // await anything, and every surface would pay the round trip.
      const { tokenUrl } = await resolveEndpoints(auth)
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body),
      })
      if (!res.ok) {
        console.error(`[pwapp] token endpoint ${res.status}:`, (await res.text()).slice(0, 300))
        return null
      }
      return (await res.json()) as TokenEndpointResponse
    } catch (err) {
      console.error('[pwapp] token endpoint unreachable:', err)
      return null
    }
  }

  async function exchangeCode(code: string, verifier: string, redirectUri: string): Promise<boolean> {
    const data = await postTokenEndpoint({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: auth.clientId,
      code_verifier: verifier,
    })
    if (!data) return false
    const next = toSession(toAuthToken(data, auth.scopes))
    persistRefreshToken(next)
    setSession(next)
    return true
  }

  async function refreshWith(refreshToken: string): Promise<boolean> {
    const data = await postTokenEndpoint({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: auth.clientId,
    })
    if (!data) return false
    // Entra SPA refresh tokens ROTATE — keep the old one when none returned.
    const token = toAuthToken({ ...data, refresh_token: data.refresh_token ?? refreshToken }, auth.scopes)
    const next = toSession(token, session)
    persistRefreshToken(next)
    setSession(next)
    return true
  }

  // Single-flight the silent restore (mirrors that provider's restorePromise
  // guard — a refresh token is single-use, two racing calls would burn it).
  let restorePromise: Promise<boolean> | null = null

  // THE DOOR TOKEN IS A SECOND TOKEN, NOT A SECOND SESSION.
  //
  // The session's token is for the data the app reads. The door token is for
  // the app itself, minted from the same refresh token for a different
  // audience. Kept beside the session, never inside it: `getAccessToken`
  // must keep returning the data token, and a sign-out drops both.
  let doorToken: { readonly value: string; readonly expiresAt: number } | undefined
  let doorPromise: Promise<string | undefined> | null = null

  async function redeemDoorToken(scope: string): Promise<string | undefined> {
    const refreshToken = session?.token?.refreshToken
    if (!refreshToken) return undefined
    const data = await postTokenEndpoint({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: auth.clientId,
      scope,
    })
    if (!data) return undefined
    doorToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 }
    // An issuer may rotate the refresh token on every redemption. Carry the
    // new one into the session — silently, without touching the data token —
    // so the data token's own renewal does not fail on a retired credential.
    if (data.refresh_token && session?.token && data.refresh_token !== session.token.refreshToken) {
      session = { ...session, token: { ...session.token, refreshToken: data.refresh_token } }
      persistRefreshToken(session)
    }
    return doorToken.value
  }

  return {
    get session() {
      return session
    },

    get lastError() {
      return lastError
    },

    async init(): Promise<void> {
      // 1) Redirect callback? (`?code=&state=` on the shell URL — or, for
      // backward compat, on auth.redirectPath: the check is URL-agnostic and
      // the pending record carries whichever redirect_uri started the flow.)
      const params = new URLSearchParams(location.search)
      const code = params.get('code')
      const state = params.get('state')
      if (code && state) {
        const pending = takePendingPkce(sessionStorage, pendingKey, state)
        if (pending) {
          const exchanged = await exchangeCode(code, pending.verifier, pending.redirectUri)
          if (!exchanged) {
            setError(copy.exchangeFailed)
          }
          // Restore the page login started from (the redirect landed on the
          // app base). Runs BEFORE the first route (run-app awaits init), so
          // the router's first render picks the restored path up. Fallback:
          // clean the query string, keep path + hash so the router routes.
          history.replaceState(null, '', pending.returnTo ?? location.pathname + location.hash)
          return
        }
        console.error('[pwapp] auth callback ignored — no matching PKCE state (stale or replayed)')
        setError(copy.invalidCallback)
      }

      // 2) Silent restore from a persisted refresh token — no user prompt.
      const storedRt = sessionStorage.getItem(rtKey)
      if (!storedRt) return
      if (!restorePromise) restorePromise = refreshWith(storedRt)
      const ok = await restorePromise
      restorePromise = null
      if (!ok) sessionStorage.removeItem(rtKey) // stale/expired → back to the login button
    },

    loginWithPkce(): void {
      setError(undefined) // a fresh attempt clears the previous failure
      void (async () => {
        const verifier = generateCodeVerifier()
        const state = generateCodeVerifier().slice(0, 32)
        const challenge = await generateCodeChallenge(verifier)
        // The redirect target is the app BASE (options.redirectUri) — one
        // registered SPA redirect URI per app even under the path router,
        // where every page has its own pathname. `returnTo` brings the user
        // back to the page they pressed "Sign in" on. Without options the
        // shell's own location is the target (hash-router-era behavior).
        const redirectUri = options?.redirectUri ?? location.origin + location.pathname
        const returnTo = location.pathname + location.search + location.hash
        // The issuer is asked BEFORE the pending record is written: a failed
        // lookup must not leave a verifier in storage that no redirect will
        // ever come back to consume.
        let authorizeUrl: string
        try {
          authorizeUrl = (await resolveEndpoints(auth)).authorizeUrl
        } catch (err) {
          console.error('[pwapp] identity issuer unreachable:', err)
          setError(copy.issuerUnreachable)
          return
        }
        savePendingPkce(sessionStorage, pendingKey, { state, verifier, redirectUri, returnTo })
        location.assign(buildAuthorizeUrl(auth, { challenge, state, redirectUri, authorizeUrl }))
      })()
    },

    logout(): void {
      sessionStorage.removeItem(rtKey)
      restorePromise = null
      doorToken = undefined
      doorPromise = null
      setSession(undefined)
    },
    async getDoorToken(): Promise<string | undefined> {
      const scope = doorScopeOf(auth)
      if (!scope || !session) return undefined
      if (doorToken && doorToken.expiresAt - 30_000 > Date.now()) return doorToken.value
      if (!doorPromise) {
        doorPromise = redeemDoorToken(scope).finally(() => {
          doorPromise = null
        })
      }
      return doorPromise
    },

    async getAccessToken(): Promise<string | undefined> {
      // SPFx host seam: inside a SharePoint web part the host brokers tokens
      // (AADTokenProvider) — no PKCE flow at all. Use it when present.
      const hostToken = window.__pwfabric_getToken
      if (typeof hostToken === 'function') {
        try {
          const t = await hostToken('https://graph.microsoft.com')
          if (t) return t
        } catch {
          /* fall through to the PKCE session */
        }
      }
      const token = session?.token
      if (!token) return undefined
      // 30s clock-skew guard before the hard expiry.
      if (token.expiresAt - 30_000 > Date.now()) return token.accessToken
      if (token.refreshToken && (await refreshWith(token.refreshToken))) {
        return session?.token?.accessToken
      }
      return undefined
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
