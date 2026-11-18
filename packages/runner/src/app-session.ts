/**
 * The app's own session — the platform door's half of identity.
 *
 * TWO WAYS IN, AND THEY ARE NOT THE SAME MECHANISM. `auth.json` with an issuer
 * drives PKCE (see `auth.ts`): the visitor is redirected, comes back with a
 * code, and the token is the issuer's. The platform door is the other kind —
 * an email and a password posted to an address the export handed us, answered
 * with an opaque session token the session server itself minted. There is no
 * redirect, no verifier, no discovery document.
 *
 * Conflating them was tempting and would have been wrong: PKCE's storage is
 * keyed by (issuer, client, scopes) because a token's identity is the tuple it
 * was issued against, while an app session's identity is just the app. One
 * app, one session.
 *
 * WHY THE TOKEN IS STORED AT ALL. The session server refuses a receipt
 * without it, so a page navigation needs it as much as the first render does,
 * and a reload must not sign the visitor out. `sessionStorage`, not
 * `localStorage`: closing the tab ends the session, which is the weaker and
 * more honest default for a token we cannot rotate from here.
 *
 * @module @pwfabric/runner/app-session
 */

import type { KeyValueStorage } from './pkce.js'
import type { PwappAuth } from './types.js'
import { NO_MESSAGES, type RunnerMessages } from './messages.js'

/** The gateway's sign-in addresses when the export names none. */
export const DEFAULT_START_URL = '/_auth/start'
export const DEFAULT_GATEWAY_SESSION_URL = '/_auth/session'
export const DEFAULT_GATEWAY_LOGOUT_URL = '/_auth/logout'

/**
 * Marks a request as the runner's own. The gateway answers `/_auth/session`
 * only with it, so a cross-site `<img>` or form cannot read a session out.
 */
const RUNNER_REQUEST_HEADER = { 'x-pwapp-request': '1' } as const

/** Where the export said this app's door is. Addresses, never hostnames. */
export interface AppDoor {
  readonly loginUrl: string
  readonly registerUrl?: string | undefined
  readonly logoutUrl?: string | undefined
  readonly sessionUrl?: string | undefined
}

/**
 * Who the platform door says the visitor is — `AppPrincipalRecord` on the API.
 * Login, register and the provider exchange all answer with it beside the
 * token, so a fresh session usually carries it already.
 */
export interface AppSessionPrincipal {
  readonly id: string
  readonly email?: string | null
  readonly displayName?: string | null
  /** Not issued by the API today; read when a door supplies one. */
  readonly avatarUrl?: string | null
  /** The app roles the visitor holds (`access.roles`), when the door says. */
  readonly roles?: readonly string[] | null
}

export interface AppSession {
  readonly token: string
  readonly expiresAt: string
  readonly principal?: AppSessionPrincipal | undefined
}

/** Scoped by the app's own id so two apps on one origin cannot share a token. */
export function appSessionKey(appId: string): string {
  return `pwapp_session:${appId}`
}

export function readAppSession(storage: KeyValueStorage, appId: string): AppSession | null {
  const raw = storage.getItem(appSessionKey(appId))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AppSession
    if (!parsed?.token) return null
    // An expired token is not a session. Checked on read rather than by a
    // timer: a tab restored from the background must not present a token the
    // gate will refuse and then report as "sign-in failed".
    if (parsed.expiresAt && Date.parse(parsed.expiresAt) < Date.now()) {
      storage.removeItem(appSessionKey(appId))
      return null
    }
    return parsed
  } catch {
    storage.removeItem(appSessionKey(appId))
    return null
  }
}

export function writeAppSession(
  storage: KeyValueStorage,
  appId: string,
  session: AppSession
): void {
  storage.setItem(appSessionKey(appId), JSON.stringify(session))
}

export function clearAppSession(storage: KeyValueStorage, appId: string): void {
  storage.removeItem(appSessionKey(appId))
}

// ============================================================
// THE DOOR
// ============================================================

/** What the API answers with, on the one shape both routes share. */
interface DoorResponse {
  readonly data?: {
    readonly token?: string
    readonly expiresAt?: string
    readonly principal?: AppSessionPrincipal
  }
  readonly error?: { readonly code?: string; readonly message?: string }
}

/**
 * Why the door did not open — the code a page reads as `__auth.error`:
 * `refused` (401/403: the credentials were not accepted), `exists` (409: the
 * account to register exists), `invalid` (any other 4xx: the request was not
 * acceptable), `server` (5xx, or an answer that is not the door's), `network`
 * (no answer at all).
 */
export type DoorFailure = 'refused' | 'exists' | 'invalid' | 'server' | 'network'

function failureOf(status: number): DoorFailure {
  if (status === 401 || status === 403) return 'refused'
  if (status === 409) return 'exists'
  if (status >= 400 && status < 500) return 'invalid'
  return 'server'
}

/**
 * Post credentials and return the session, or the app's words for why not.
 *
 * The API refuses every credential failure the same way on purpose — telling
 * an unknown address apart from a wrong password enumerates the shop's
 * customers. The visitor reads `session.refused` (with the server's code in
 * `{code}`), never the server's own sentence: that is in the server's
 * language, not the app's.
 */
export async function signIn(
  url: string,
  credentials: { email: string; password: string; displayName?: string | undefined; invitation?: string | undefined },
  say: RunnerMessages = NO_MESSAGES
): Promise<{ ok: true; session: AppSession } | { ok: false; code: DoorFailure; message: string }> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    })
  } catch {
    return { ok: false, code: 'network', message: say('session.unreachable') }
  }

  let body: DoorResponse
  try {
    body = (await response.json()) as DoorResponse
  } catch {
    return { ok: false, code: response.ok ? 'server' : failureOf(response.status), message: say('session.unexpected') }
  }

  if (!response.ok || !body.data?.token) {
    const code = body.error?.code
    return {
      ok: false,
      code: response.ok ? 'server' : failureOf(response.status),
      message: body.error ? say('session.refused', { code }) : say('session.failed'),
    }
  }
  return {
    ok: true,
    session: {
      token: body.data.token,
      expiresAt: body.data.expiresAt ?? '',
      ...(body.data.principal ? { principal: body.data.principal } : {}),
    },
  }
}

/**
 * Best-effort revoke, at both places a session lives.
 *
 * The door (`logoutUrl`) revokes the token; the gateway (`gatewayLogoutUrl`)
 * deletes the HttpOnly cookie it wrote, which nothing in the page can touch.
 * Both are asked, in parallel, and neither failure is reported — refusing to
 * sign someone out because the network is down is the wrong side to err on.
 * The local clear is the caller's job and happens either way.
 */
export async function signOut(
  auth: Pick<PwappAuth, 'logoutUrl' | 'gatewayLogoutUrl'> | null | undefined,
  token: string
): Promise<void> {
  if (!auth) return
  const calls: Promise<unknown>[] = []
  if (auth.logoutUrl) {
    calls.push(fetch(auth.logoutUrl, { method: 'POST', headers: { 'x-app-session': token } }))
  }
  calls.push(
    fetch(auth.gatewayLogoutUrl ?? DEFAULT_GATEWAY_LOGOUT_URL, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { ...RUNNER_REQUEST_HEADER },
    })
  )
  await Promise.allSettled(calls)
}

/**
 * A session that knows who it belongs to.
 *
 * Sessions written before the door answered with a principal (or by a door
 * that does not) carry only a token. The account control needs a name, so the
 * profile is asked for ONCE at `sessionUrl` (`GET` → `{ data: { principal } }`)
 * and the caller writes the merged session back — the stored session is the
 * cache. Any failure returns the session unchanged: a missing name is not a
 * reason to sign anyone out.
 */
export async function withProfile(
  session: AppSession,
  sessionUrl: string | undefined
): Promise<AppSession> {
  const known = session.principal
  if (known && (known.email || known.displayName)) return session
  if (!sessionUrl) return session
  try {
    const res = await fetch(sessionUrl, { headers: { 'x-app-session': session.token } })
    if (!res.ok) return session
    const body = (await res.json()) as { data?: { principal?: AppSessionPrincipal | null } }
    const principal = body.data?.principal
    if (!principal) return session
    return { ...session, principal }
  } catch {
    return session
  }
}

// ============================================================
// SOCIAL SIGN-IN (through the gateway)
// ============================================================

/**
 * Only a path on this origin may be the way back.
 *
 * The gateway checks again; this check is what keeps the runner from ever
 * building a start address that names another site. `//host` and `/\host`
 * are protocol-relative to a browser, so they are refused with the rest.
 */
function safeReturnTo(returnTo: string): string {
  if (!returnTo.startsWith('/')) return '/'
  const second = returnTo.charAt(1)
  if (second === '/' || second === '\\') return '/'
  return returnTo
}

/**
 * Send the visitor to a provider — by way of the app's own gateway.
 *
 * The browser no longer holds a verifier or spends a code. The gateway opens a
 * sign-in transaction at the API, keeps its id in a cookie, and redirects to
 * the provider; the code comes back to the gateway (or to the API's central
 * callback), and the visitor comes back to `returnTo` with a session cookie.
 */
export function startSocialSignIn(
  auth: Pick<PwappAuth, 'startUrl'> | null | undefined,
  method: string,
  returnTo: string
): void {
  const base = (auth?.startUrl ?? DEFAULT_START_URL).replace(/\/+$/, '')
  const target = `${base}/${encodeURIComponent(method)}?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`
  location.assign(target)
}

/**
 * Who the gateway's cookie belongs to, or null.
 *
 * Asked once on boot when nothing is stored. A visitor who has not signed in
 * is the ordinary answer, and a door says so with a 200 —
 * `{ data: { signedIn: false } }` (session-protocol §4.2), not a 4xx the
 * browser logs as a failed request. Anything that carries no token is null:
 * that answer, a 401 from a door that still refuses, a static host that
 * serves its index page for every path, a network error — none of them is a
 * session and none of them should stop the app rendering.
 */
export async function readGatewaySession(
  auth: Pick<PwappAuth, 'gatewaySessionUrl'> | null | undefined,
  fetchImpl: typeof fetch = fetch
): Promise<AppSession | null> {
  try {
    const res = await fetchImpl(auth?.gatewaySessionUrl ?? DEFAULT_GATEWAY_SESSION_URL, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { ...RUNNER_REQUEST_HEADER },
    })
    if (!res.ok) return null
    const body = (await res.json()) as
      | (Partial<AppSession> & { data?: Partial<AppSession> })
      | null
    const found = body?.data ?? body
    if (!found || typeof found.token !== 'string' || !found.token) return null
    return {
      token: found.token,
      expiresAt: typeof found.expiresAt === 'string' ? found.expiresAt : '',
      ...(found.principal ? { principal: found.principal } : {}),
    }
  } catch {
    return null
  }
}

/**
 * The error a failed round trip left in the address bar, or null.
 *
 * The gateway and the API send a visitor back to `returnTo?auth_error=<code>`.
 * The parameter is removed at once — a refresh must not show the same failure
 * again, and the router must not read a query string that belongs to the door.
 */
export function readAuthError(
  loc: Pick<Location, 'pathname' | 'search' | 'hash'> = location,
  hist: Pick<History, 'replaceState'> = history
): string | null {
  const params = new URLSearchParams(loc.search)
  if (!params.has('auth_error')) return null
  const code = params.get('auth_error') ?? ''
  params.delete('auth_error')
  const rest = params.toString()
  hist.replaceState(null, '', loc.pathname + (rest ? `?${rest}` : '') + loc.hash)
  return code || null
}
