/**
 * Every word the runner itself draws — the app's, and only the app's.
 *
 * THE APP WRITES EVERY WORD (envelope §2, "Messages"). The gate, the pill,
 * the account labels, the not-found page and the session errors are drawn by
 * the runner, around the app's content; their words are the app's all the
 * same. An app sets them in `app/plan.json` `messages` (a flat map, in its
 * `plan.locale`), `pwf build` carries the map into `project.json`, and the
 * runner looks each word up there.
 *
 * THE ENGINE WRITES NO VISITOR WORD (founder decision, 3.0.1). There is no
 * fallback table: a message the app does not set is drawn as nothing, and
 * under `pwf dev` the console names the id once. `pwf validate` reports every
 * id the app can reach and does not set as an error (MESSAGES_MISSING). Where
 * an empty word would leave a control without an accessible name — a button,
 * a field, a link, a dialog's title — the control is named by the message id
 * itself (`labelWith`): never an invented sentence, and the id says what the
 * app has to write.
 *
 * Placeholders are `{name}`, `{code}` and `{n}`.
 *
 * @module @pwfabric/runner/messages
 */

import { messageOf, type AppMessages, type MessageVars } from '@pwfabric/runtime/render/messages'

export { pluralProblems } from '@pwfabric/runtime/render/messages'

/** The renderer's own ids (`ui.retry`, `ui.loading`), beside the runner's: what `pwf validate` checks too. */
export { RENDERER_MESSAGE_IDS } from '@pwfabric/runtime/render/messages'

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
 * The runner's message ids — every word it can draw, all of them the app's.
 *
 * `gate.*` — the runner's sign-in screen; `pill.*` — the fallback session
 * pill; `account.*` — the labels handed to the app's account control;
 * `notFound.*` — the runner's not-found page; `session.*` — the password
 * door; `bridge.*` — an external issuer's PKCE bridge; `auth.error.*` — a
 * refused sign-in round trip (`?auth_error=`). `pwf validate` checks an app
 * against this list (MESSAGES_MISSING).
 */
export const RUNNER_MESSAGE_IDS = [
  'gate.title',
  'gate.body',
  'gate.email',
  'gate.password',
  'gate.name',
  'gate.signIn',
  'gate.register',
  'gate.toRegister',
  'gate.toSignIn',
  'gate.or',
  'gate.close',
  'gate.noProvider',
  'gate.provider.password',
  'gate.provider.phiwebs',
  'gate.provider.microsoft',
  'gate.provider.google',
  'gate.provider.github',
  'pill.region',
  'pill.signedIn',
  'pill.signIn',
  'pill.signOut',
  'account.signIn',
  'account.signOut',
  'account.profile',
  'account.greeting',
  'notFound.title',
  'notFound.body',
  'notFound.home',
  // The visitor's language, offered in an app with locales (envelope §2.3).
  'locale.suggestion',
  'locale.switch',
  'locale.dismiss',
  'session.unreachable',
  'session.unexpected',
  'session.failed',
  'session.refused',
  'bridge.exchangeFailed',
  'bridge.invalidCallback',
  'bridge.issuerUnreachable',
  'auth.error.access_denied',
  'auth.error.invalid_request',
  'auth.error.invalid_state',
  'auth.error.expired',
  'auth.error.provider_error',
  'auth.error.method_unavailable',
  'auth.error.server_error',
  'auth.error.generic',
  'auth.error.unknown',
] as const

export type RunnerMessageId = (typeof RUNNER_MESSAGE_IDS)[number]

/** A word of the runner's: the app's message for `id`, placeholders filled — or `''` when the app sets none. */
export type RunnerMessages = (id: RunnerMessageId, vars?: MessageVars) => string

/** The runner's words for an app's `messages` (`project.json`), their plurals in the app's `locale` (`en` without one). */
export function runnerMessages(app?: AppMessages | null, locale?: string): RunnerMessages {
  return (id, vars) => messageOf(app, id, undefined, vars, locale)
}

/** No app messages at all: every word is `''` (for a caller that was handed none). */
export const NO_MESSAGES: RunnerMessages = runnerMessages(null)

/**
 * Writes `text` into a control, and names the control by `id` when the app
 * set no word for it: an empty button, link, field or dialog title has no
 * accessible name. `attribute` is `'text'` for the visible label, else the
 * attribute that carries the name (`aria-label`).
 */
export function labelWith(el: Element, text: string, id: string, attribute: 'text' | 'aria-label' = 'text'): void {
  if (attribute === 'text') {
    el.textContent = text
    if (text) el.removeAttribute('aria-label')
    else el.setAttribute('aria-label', id)
    return
  }
  el.setAttribute('aria-label', text || id)
}

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
