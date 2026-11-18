/**
 * Every word the runner itself draws — the app's, else a neutral fallback.
 *
 * THE APP WRITES EVERY WORD (envelope §2, "Messages"). The gate, the pill,
 * the account labels, the not-found page and the session errors are drawn by
 * the runner, around the app's content; their words are the app's all the
 * same. An app sets them in `app/plan.json` `messages` (a flat map, in its
 * `plan.locale`), `pwf build` carries the map into `project.json`, and the
 * runner looks each word up there first.
 *
 * What is left here is one NEUTRAL fallback per id, in English: for a screen
 * the app did not write. The runner ships no other language — an app in
 * another language sets its messages (`pwf validate` reports the ones it can
 * reach and does not set: MESSAGES_MISSING).
 *
 * Placeholders are `{name}`, `{code}` and `{n}`.
 *
 * @module @pwfabric/runner/messages
 */

import { messageOf, type AppMessages, type MessageVars } from '@pwfabric/runtime/render/messages'

/**
 * The `?auth_error=` codes the gateway and the API send a visitor back with.
 *
 * Anything else is still shown — as `auth.error.unknown` with the code
 * quoted, so a new code on the server never renders as silence. Matched
 * without regard to case: the API and gateway send them uppercase
 * (`ACCESS_DENIED`). The gateway's own `SIGN_IN_FAILED` and
 * `PROVIDER_REFUSED` are aliases.
 */
export const AUTH_ERROR_CODES = [
  'access_denied',
  'invalid_request',
  'invalid_state',
  'expired',
  'provider_error',
  'method_unavailable',
  'server_error',
] as const

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number]

/** The sign-in methods the gate has a label for (`gate.provider.<method>`). */
export const PROVIDER_LABEL_METHODS = ['password', 'phiwebs', 'microsoft', 'google', 'github'] as const

/**
 * The runner's message ids and their neutral fallbacks.
 *
 * `gate.*` — the runner's sign-in screen; `pill.*` — the fallback session
 * pill; `account.*` — the labels handed to the app's account control;
 * `notFound.*` — the runner's not-found page; `session.*` — the password
 * door; `bridge.*` — an external issuer's PKCE bridge; `auth.error.*` — a
 * refused sign-in round trip (`?auth_error=`).
 */
export const RUNNER_MESSAGES = {
  'gate.title': 'Sign in',
  'gate.body': 'You need to sign in to view this app.',
  'gate.email': 'Email',
  'gate.password': 'Password',
  'gate.name': 'Name',
  'gate.signIn': 'Sign in',
  'gate.register': 'Sign up',
  'gate.toRegister': "Don't have an account? Sign up",
  'gate.toSignIn': 'Already have an account? Sign in',
  'gate.or': 'or',
  'gate.close': 'Close',
  'gate.noProvider': 'This app requires sign-in, but no identity provider is configured.',
  'gate.provider.password': 'Email and password',
  'gate.provider.phiwebs': 'Continue with your account',
  'gate.provider.microsoft': 'Continue with Microsoft',
  'gate.provider.google': 'Continue with Google',
  'gate.provider.github': 'Continue with GitHub',
  'pill.region': 'Account',
  'pill.signedIn': 'Signed in',
  'pill.signIn': 'Sign in',
  'pill.signOut': 'Sign out',
  'account.signIn': 'Sign in',
  'account.signOut': 'Sign out',
  'account.profile': 'Profile',
  'account.greeting': 'Welcome, {name}',
  'notFound.title': 'Page not found',
  'notFound.body': 'This address does not name a page in this app.',
  'notFound.home': 'Go to the home page',
  'session.unreachable': 'Could not reach the server. Check your connection.',
  'session.unexpected': 'The server sent an unexpected response.',
  'session.failed': 'Could not sign in.',
  'session.refused': 'Could not sign in. Check your details and try again.',
  'bridge.exchangeFailed': 'Could not sign in: the token exchange failed. Details are in the console.',
  'bridge.invalidCallback': 'This sign-in link is invalid or has expired. Try again.',
  'bridge.issuerUnreachable': 'Could not reach the sign-in provider. Try again.',
  'auth.error.access_denied': 'Sign-in was cancelled or refused by the provider.',
  'auth.error.invalid_request': 'The sign-in request was not valid. Try again.',
  'auth.error.invalid_state': 'This sign-in attempt was not recognised. Try again.',
  'auth.error.expired': 'This sign-in attempt has expired. Try again.',
  'auth.error.provider_error': 'The sign-in provider returned an error. Try again later.',
  'auth.error.method_unavailable': 'This sign-in method is not available for this app.',
  'auth.error.server_error': 'Sign-in could not be completed. Try again later.',
  'auth.error.generic': 'Sign-in failed. Try again.',
  'auth.error.unknown': 'Sign-in failed ({code}). Try again.',
} as const satisfies Readonly<Record<string, string>>

export type RunnerMessageId = keyof typeof RUNNER_MESSAGES

/** The ids, in table order — what `pwf validate` checks an app against. */
export const RUNNER_MESSAGE_IDS = Object.keys(RUNNER_MESSAGES) as RunnerMessageId[]

/** A word of the runner's: the app's message for `id`, else the fallback, placeholders filled. */
export type RunnerMessages = (id: RunnerMessageId, vars?: MessageVars) => string

/** The runner's words for an app's `messages` (`project.json`). */
export function runnerMessages(app?: AppMessages | null): RunnerMessages {
  return (id, vars) => messageOf(app, id, RUNNER_MESSAGES[id], vars)
}

/** The fallbacks alone, for a caller that was handed no app messages. */
export const NEUTRAL_MESSAGES: RunnerMessages = runnerMessages(null)

/** A code short and plain enough to quote to a visitor. */
const QUOTABLE = /^[a-z0-9_]{1,64}$/i

/**
 * The words for an `?auth_error=` code.
 *
 * An unknown code is not hidden: it becomes `auth.error.unknown` with the
 * code in `{code}`, which is what an operator needs to find the cause. A
 * value that is not a plain identifier is not echoed at all — it came off the
 * address bar — and reads `auth.error.generic`.
 */
export function authErrorMessage(say: RunnerMessages, code: string): string {
  const known = authErrorCodeOf(code)
  if (known) return say(`auth.error.${known}`)
  return QUOTABLE.test(code) ? say('auth.error.unknown', { code }) : say('auth.error.generic')
}

/** The gate's label for a sign-in method; an unknown method is named as itself. */
export function providerLabel(say: RunnerMessages, method: string): string {
  return (PROVIDER_LABEL_METHODS as readonly string[]).includes(method)
    ? say(`gate.provider.${method as (typeof PROVIDER_LABEL_METHODS)[number]}`)
    : method
}

/**
 * The gateway's own fallback codes, read as the code that fits them. The
 * gateway answers these when the API gave it nothing it may forward.
 */
const AUTH_ERROR_ALIASES: Readonly<Record<string, AuthErrorCode>> = {
  sign_in_failed: 'server_error',
  provider_refused: 'access_denied',
}

/**
 * A code in any case, as one of ours — or null.
 *
 * The API and the gateway send `ACCESS_DENIED`; the table is keyed
 * `access_denied`. Both are the same code, so the comparison is on lowercase.
 */
function authErrorCodeOf(code: string): AuthErrorCode | null {
  const key = code.toLowerCase()
  if ((AUTH_ERROR_CODES as readonly string[]).includes(key)) return key as AuthErrorCode
  return Object.prototype.hasOwnProperty.call(AUTH_ERROR_ALIASES, key)
    ? (AUTH_ERROR_ALIASES[key] as AuthErrorCode)
    : null
}
