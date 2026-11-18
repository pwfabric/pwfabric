/**
 * What happens when the page asks for sign-in, registration or sign-out.
 *
 * ANY BLOCK MAY ASK. A shell's account control, a chip, a button, a form's
 * submit: each fires an `auth:signIn` (optionally with a `method`),
 * `auth:register` or `auth:signOut` action — as its `action` prop, a
 * behavior's action, or the action its event carries (`payload.action`). The
 * runtime dispatches them like any action and hands them to the host (its
 * `auth.onAction`), which is this controller: signing in is the published
 * app's business, not something an editor preview or a platform surface acts
 * on, and a host without identity leaves them undone.
 *
 * A form's submit carries its field values; the password door takes `email`,
 * `password` and, to register, `name`. A click carries none: then there is
 * nothing to send, and the visitor is shown where to type it — the app's
 * sign-in screen, or the runner's dialog when the app has none.
 *
 * @module @pwfabric/runner/account-controller
 */

import type { AuthAction } from '@pwfabric/runtime'
import type { AuthBridge } from './auth.js'
import { signIn as postCredentials, signOut as revokeAppSession, type AppSession, type DoorFailure } from './app-session.js'
import type { PwappAuth, PwappProject } from './types.js'
import type { RunnerMessages } from './messages.js'

/** What the visitor is asked for on a sign-in screen. */
export type SignInMode = 'login' | 'register'

export interface AccountControllerDeps {
  readonly project: PwappProject
  readonly auth: PwappAuth | null | undefined
  readonly bridge: AuthBridge | null
  readonly getAppSession: () => AppSession | null
  /** Forget the platform session locally (storage + the runner's binding). */
  readonly clearAppSession: () => void
  /** Drop everything read with the old credential: data rows, connectors. */
  readonly clearCaches: () => void
  /** Put the wall back (a no-op for apps that do not require sign-in). */
  readonly regate: () => void
  /** Draw the current route again under the new state. */
  readonly rerender: () => void
  /** Show where to sign in (the app's sign-in screen, or the runner's dialog). */
  readonly openSignIn: (mode: SignInMode) => void
  /** Leave for a social provider (the runner wires `startSocialSignIn`). */
  readonly startProvider: (method: string) => void
  /** The password door let the visitor in. */
  readonly onSignedIn: (session: AppSession) => void
  /**
   * A sign-in did not succeed, or cannot be tried: the page reads the code
   * (`__auth.error`). `unavailable` — the method is not one this app offers.
   */
  readonly onFailed: (code: DoorFailure | 'unavailable') => void
  /** The app's words, for the door's own messages (console only). */
  readonly messages?: RunnerMessages | undefined
}

/**
 * WHETHER THIS APP HAS ANY WAY IN AT ALL.
 *
 * Three doors, the same three the sign-in gate draws: the platform's password
 * door (`loginUrl`, never for an external-topology app — its visitors sign in
 * at the owner's issuer), the gateway's provider buttons, and a PKCE bridge to
 * an issuer. Any one of them is a door.
 *
 * None of them is what an app without `auth.json` has — and, since the identity
 * pack, that is a normal app rather than a broken one: a world without the pack
 * gets apps with no sign-in. Such an app may still declare `navigation.account`
 * (a catalog shell carries the slot whether or not the app signs anyone in), and
 * drawing a "Sign in" button there offers the visitor a door that opens onto a
 * dialog saying no provider is configured. So no door means no account control,
 * and a `signIn` that reaches the controller anyway does nothing.
 *
 * The same verdict also covers an `auth.json` that names no usable door (an
 * issuer without a client id, an unsupported provider): the button would lead
 * to the same dead dialog. An app that REQUIRES sign-in and has no door is
 * still walled — that is the gate's business, and it says so there.
 */
export function hasDoor(input: {
  readonly project: PwappProject
  readonly auth: PwappAuth | null | undefined
  readonly bridge: AuthBridge | null
}): boolean {
  const auth = input.auth
  if (!auth) return false
  const passwordDoor = Boolean(auth.loginUrl) && input.project.identity?.topology !== 'external'
  const providers = (auth.providers ?? []).length > 0
  return passwordDoor || providers || input.bridge !== null
}

export interface AccountController {
  /** An `auth:*` action, with the values of the form that fired it. */
  perform(action: AuthAction, values?: Readonly<Record<string, unknown>>): void
  /** Start signing in: by `method`, or the app's one way in, or by asking. */
  signIn(method?: string, values?: Readonly<Record<string, unknown>>): void
  register(values?: Readonly<Record<string, unknown>>): void
  signOut(): Promise<void>
}

const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined)

/** The password door's credentials out of a form's values, or null when there are none to send. */
function credentialsOf(
  values: Readonly<Record<string, unknown>> | undefined
): { email: string; password: string; displayName?: string } | null {
  const email = text(values?.['email'])
  const password = text(values?.['password'])
  if (!email || !password) return null
  const name = text(values?.['name']) ?? text(values?.['displayName'])
  return { email: email.trim(), password, ...(name ? { displayName: name.trim() } : {}) }
}

export function createAccountController(deps: AccountControllerDeps): AccountController {
  let signingOut: Promise<void> | null = null
  let submitting = false

  /** One credential post at a time; a second press while it is out is the same request. */
  const submit = async (
    url: string,
    credentials: { email: string; password: string; displayName?: string; invitation?: string }
  ): Promise<void> => {
    if (submitting) return
    submitting = true
    try {
      const result = await postCredentials(url, credentials, deps.messages)
      if (result.ok) deps.onSignedIn(result.session)
      else {
        console.warn(`[pwapp] sign-in refused (${result.code}): ${result.message}`)
        deps.onFailed(result.code)
      }
    } finally {
      submitting = false
    }
  }

  const signOut = async (): Promise<void> => {
    const app = deps.getAppSession()
    // Best effort: `revokeAppSession` swallows a network failure, and the
    // local clear below happens either way.
    if (app) await revokeAppSession(deps.auth, app.token)
    if (deps.bridge?.session) deps.bridge.logout()
    deps.clearAppSession()
    // Before anything is drawn again: a re-render must never show the previous
    // visitor's rows, not even as "yesterday's" cache.
    deps.clearCaches()
    deps.regate()
    deps.rerender()
  }

  const controller: AccountController = {
    signOut(): Promise<void> {
      // A second press while the first is in flight is the same request.
      signingOut ??= signOut().finally(() => {
        signingOut = null
      })
      return signingOut
    },

    perform(action, values) {
      if (action.type === 'auth:signOut') void controller.signOut()
      else if (action.type === 'auth:register') controller.register(values)
      else controller.signIn(action.method, values)
    },

    signIn(method, values): void {
      // Defence in depth: the runner draws no account control for an app with
      // no door, but any block can still fire `auth:signIn`. With no door
      // there is nothing to open.
      if (!hasDoor(deps)) return
      const auth = deps.auth
      const providers: string[] = (auth?.providers ?? []).map((p) => p.method)
      const passwordDoor = Boolean(auth?.loginUrl) && deps.project.identity?.topology !== 'external'
      const credentials = credentialsOf(values)

      if (method !== undefined) {
        if (method === 'password' && passwordDoor) {
          if (credentials) void submit(auth?.loginUrl as string, credentials)
          else deps.openSignIn('login')
        } else if (providers.includes(method)) deps.startProvider(method)
        else if (method === 'issuer' && deps.bridge) deps.bridge.loginWithPkce()
        else deps.onFailed('unavailable')
        return
      }
      // Credentials and a password door: they are what the visitor meant.
      if (credentials && passwordDoor) {
        void submit(auth?.loginUrl as string, credentials)
        return
      }
      // One way in and nothing to type: take it, no screen in between.
      if (!passwordDoor && providers.length === 1 && providers[0]) {
        deps.startProvider(providers[0])
        return
      }
      if (!passwordDoor && providers.length === 0 && deps.bridge) {
        deps.bridge.loginWithPkce()
        return
      }
      deps.openSignIn('login')
    },

    register(values): void {
      if (!hasDoor(deps)) return
      const registerUrl = deps.auth?.registerUrl
      const registration = deps.auth?.registration
      // `closed` has no register door; `invite` has one, for an invitation.
      if (!registerUrl || deps.project.identity?.topology === 'external' || (registration !== 'open' && registration !== 'invite')) {
        deps.onFailed('unavailable')
        return
      }
      const credentials = credentialsOf(values)
      const invitation = text(values?.['invitation'])
      if (registration === 'invite' && !invitation) {
        // Nothing an invited visitor would type: the token came with the link.
        deps.onFailed('unavailable')
        return
      }
      if (credentials) void submit(registerUrl, { ...credentials, ...(invitation ? { invitation } : {}) })
      else deps.openSignIn('register')
    },
  }
  return controller
}
