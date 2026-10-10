/**
 * What happens when the visitor presses "Sign in" or "Sign out" in the app's
 * shell.
 *
 * The shell block only dispatches `{ type: 'auth:signIn' }` /
 * `{ type: 'auth:signOut' }` as its event's `payload.action`. The runtime's
 * surface-action dispatcher does not know these types and leaves them alone;
 * the renderer forwards every block event to the host's `onEvent`, which is
 * where the runner reads them (`accountActionOf`). Keeping them out of the
 * runtime is deliberate: signing in is a property of the published app's
 * shell, not something an editor preview or a platform surface should act on.
 *
 * @module @pwfabric/runner/account-controller
 */

import type { AuthBridge } from './auth.js'
import { signOut as revokeAppSession, type AppSession } from './app-session.js'
import type { PwappAuth, PwappProject } from './types.js'

export type AccountAction = 'signIn' | 'signOut'

const ACTIONS: Readonly<Record<string, AccountAction>> = {
  'auth:signIn': 'signIn',
  'auth:signOut': 'signOut',
}

/** The account action a block event carries, or null. */
export function accountActionOf(event: unknown): AccountAction | null {
  if (!event || typeof event !== 'object') return null
  const payload = (event as { payload?: unknown }).payload
  if (!payload || typeof payload !== 'object') return null
  const action = (payload as { action?: unknown }).action
  if (!action || typeof action !== 'object') return null
  const type = (action as { type?: unknown }).type
  return typeof type === 'string' ? (ACTIONS[type] ?? null) : null
}

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
  /** Show the sign-in dialog on demand. */
  readonly openGate: () => void
  /** Leave for a social provider (the runner wires `startSocialSignIn`). */
  readonly startProvider: (method: string) => void
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
  signIn(): void
  signOut(): Promise<void>
}

export function createAccountController(deps: AccountControllerDeps): AccountController {
  let signingOut: Promise<void> | null = null

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

  return {
    signOut(): Promise<void> {
      // A second press while the first is in flight is the same request.
      signingOut ??= signOut().finally(() => {
        signingOut = null
      })
      return signingOut
    },

    signIn(): void {
      // Defence in depth: the runner does not draw the control for an app
      // with no door, but a pack block can still dispatch `auth:signIn` on its
      // own. Opening the gate then would only show "no provider configured".
      if (!hasDoor(deps)) return
      const auth = deps.auth
      const providers = auth?.providers ?? []
      const passwordDoor = Boolean(auth?.loginUrl) && deps.project.identity?.topology !== 'external'
      // One way in and nothing to type: take it, no dialog in between.
      if (!passwordDoor && providers.length === 1 && providers[0]) {
        deps.startProvider(providers[0].method)
        return
      }
      if (!passwordDoor && providers.length === 0 && deps.bridge) {
        deps.bridge.loginWithPkce()
        return
      }
      deps.openGate()
    },
  }
}
