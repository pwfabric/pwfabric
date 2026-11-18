/**
 * The visitor's identity as the page reads it — `{{__auth.*}}`, `{{me.*}}`.
 *
 * STATE, NOT WORDS. The runner knows who came in, through which door, and why
 * the last attempt failed; the app decides what to say about it and where.
 * So what crosses into the page is a small, read-only record — who, how one
 * may sign in, and a failure CODE — and never a sentence, a token or a
 * session id.
 *
 * Both doors end in the same record: a platform session (password, provider
 * gateway) and an issuer session (PKCE bridge) are both "signed in", and the
 * page cannot tell them apart, nor should it need to.
 *
 * @module @pwfabric/runner/auth-state
 */

import type { AuthSession } from '@pwfabric/runtime/auth'
import type { SurfaceAuthState, SurfaceAuthUser } from '@pwfabric/runtime'
import type { AuthBridge } from './auth.js'
import type { AppSession } from './app-session.js'
import type { PwappAuth, PwappProject } from './types.js'

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const roleList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(nonEmpty) : [])

/**
 * Who is signed in, from whichever door let them in — or null.
 *
 * The platform session wins when both exist, as it does for the account
 * control (`accountUserFrom`): it is the door this deployment issued.
 */
export function authUserOf(doors: {
  readonly appSession?: AppSession | null | undefined
  readonly bridgeSession?: AuthSession | null | undefined
}): SurfaceAuthUser | null {
  const app = doors.appSession
  if (app) {
    const p = app.principal
    return {
      id: nonEmpty(p?.id) ? p.id : '',
      ...(nonEmpty(p?.displayName) ? { name: p.displayName } : {}),
      ...(nonEmpty(p?.email) ? { email: p.email } : {}),
      roles: roleList(p?.roles),
    }
  }
  const session = doors.bridgeSession
  if (session) {
    const u = session.user
    return {
      id: nonEmpty(u?.id) ? u.id : '',
      ...(nonEmpty(u?.name) ? { name: u.name } : {}),
      ...(nonEmpty(u?.email) ? { email: u.email } : {}),
      roles: roleList(u?.roles ?? u?.claims?.['roles']),
    }
  }
  return null
}

/**
 * The ways in this app offers, in the order a sign-in screen would list them:
 * `password` (the platform door; never for an external-topology app), each
 * provider method the gateway serves, and `issuer` for a PKCE bridge to an
 * external issuer. Empty: no door — the same verdict as `hasDoor`.
 */
export function authMethodsOf(input: {
  readonly project: PwappProject
  readonly auth: PwappAuth | null | undefined
  readonly bridge: AuthBridge | null
}): string[] {
  const auth = input.auth
  if (!auth) return []
  const methods: string[] = []
  if (auth.loginUrl && input.project.identity?.topology !== 'external') methods.push('password')
  for (const p of auth.providers ?? []) if (nonEmpty(p.method) && !methods.includes(p.method)) methods.push(p.method)
  if (input.bridge) methods.push('issuer')
  return methods
}

/** A code short and plain enough to hand a page: lower-case letters, digits, `_`. */
const CODE = /^[a-z0-9_]{1,64}$/

/**
 * A failure as the page reads it (`__auth.error`).
 *
 * `?auth_error=ACCESS_DENIED` arrives in any case and names the cause; it is
 * passed on lower-cased. Anything that is not a plain identifier came off the
 * address bar and is not echoed: it becomes `error`.
 */
export function authErrorCode(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === '') return null
  const code = raw.toLowerCase()
  return CODE.test(code) ? code : 'error'
}

export function authStateOf(input: {
  readonly appSession?: AppSession | null | undefined
  readonly bridgeSession?: AuthSession | null | undefined
  readonly methods: readonly string[]
  readonly registration?: 'open' | 'invite' | 'closed' | undefined
  readonly error: string | null
}): SurfaceAuthState {
  const user = authUserOf(input)
  return {
    signedIn: user !== null,
    user,
    methods: [...input.methods],
    // What the door said; a door that said nothing takes no new accounts.
    registration: input.registration ?? 'closed',
    // A visitor who is in has nothing to be told about getting in.
    error: user ? null : input.error,
  }
}
