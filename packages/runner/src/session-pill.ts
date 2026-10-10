/**
 * Floating session pill — the one place a visitor can enter and leave.
 *
 * Both doors end here. With a PKCE bridge and no session the pill offers
 * "Sign in"; with a session of either kind (an issuer session on the bridge,
 * or a host session from the password door) it shows who is signed in and
 * offers "Sign out". Without a bridge and without a session it stays hidden —
 * the password door draws its own gate over the page.
 *
 * Sign-out is the runner's business, not the pill's: the pill calls the door's
 * logout (bridge.logout() or POST logoutUrl) and then reports through
 * `onSignedOut`, and the runner clears its own state and re-routes. That keeps
 * the pill free of storage keys and route logic, the same split the gate has.
 *
 * @module @pwfabric/runner/session-pill
 */
import type { AuthBridge } from './auth.js'
import { signOut, type AppSession } from './app-session.js'
import type { PwappAuth } from './types.js'
import { applyThemeVars, ensureShellStyles } from './shell-theme.js'
import { copyFor, type RunnerLocale } from './copy.js'

const PILL_ID = 'pwapp-session-pill'
const ERROR_ID = 'pwapp-login-error'

export interface SessionPillOptions {
  readonly bridge: AuthBridge | null
  /** The export's auth declaration, for `logoutUrl`. */
  readonly auth?: PwappAuth | null | undefined
  /** The live platform session, read on every refresh. */
  readonly getAppSession: () => AppSession | null
  /** Called after the door's logout has run; the runner clears its state. */
  readonly onSignedOut: () => void
  /**
   * The runner's whole sign-out sequence. When given, the pill calls this
   * INSTEAD of running the door logouts and `onSignedOut` itself.
   */
  readonly onSignOut?: (() => void | Promise<void>) | undefined
  /**
   * The app declared `navigation.account` — its shell draws the account, so
   * the pill is not drawn at all. It is the fallback, never a second control.
   */
  readonly accountSlot?: boolean | undefined
  /** The app's resolved appearance variables (see `shellThemeVars`). */
  readonly themeVars?: Readonly<Record<string, string>> | undefined
  /** The app's content locale. Default `en`. */
  readonly locale?: RunnerLocale | undefined
}

export interface SessionPill {
  /** Re-read both doors and redraw. Call after a platform sign-in or sign-out. */
  refresh(): void
  /** Drop the bridge subscription and remove the elements. */
  unmount(): void
}

/** What the pill shows for a signed-in visitor: an address, a name, or a plain state. */
export function sessionLabel(
  bridgeUser: { name?: string | undefined; email?: string | undefined } | undefined,
  appSession: AppSession | null,
  locale?: RunnerLocale
): string {
  return (
    appSession?.principal?.email ??
    bridgeUser?.email ??
    bridgeUser?.name ??
    copyFor(locale).pill.signedIn
  )
}

export function mountSessionPill(options: SessionPillOptions): SessionPill {
  const { bridge } = options
  if (options.accountSlot) return { refresh: () => {}, unmount: () => {} }
  ensureShellStyles()
  const copy = copyFor(options.locale).pill

  let pill = document.getElementById(PILL_ID) as HTMLDivElement | null
  if (!pill) {
    pill = document.createElement('div')
    pill.id = PILL_ID
    document.body.appendChild(pill)
  }

  // Failure note. Without it a rejected callback was invisible: the user came
  // back from the issuer to the same anonymous page with the same pill and no
  // way to tell a failed login from one they never started.
  let note = document.getElementById(ERROR_ID) as HTMLDivElement | null
  if (!note) {
    note = document.createElement('div')
    note.id = ERROR_ID
    note.setAttribute('role', 'alert')
    note.style.display = 'none'
    document.body.appendChild(note)
  }

  if (options.themeVars) {
    applyThemeVars(pill, options.themeVars)
    applyThemeVars(note, options.themeVars)
  }

  let busy = false

  const signOutEverywhere = async (): Promise<void> => {
    if (busy) return
    busy = true
    if (options.onSignOut) {
      try {
        await options.onSignOut()
      } finally {
        busy = false
      }
      return
    }
    try {
      const app = options.getAppSession()
      if (app) await signOut(options.auth, app.token)
      // The bridge notifies its subscribers, which redraws the pill; the
      // platform door has no subscribers, so `onSignedOut` is what redraws it.
      if (bridge?.session) bridge.logout()
    } finally {
      busy = false
    }
    options.onSignedOut()
  }

  const render = (): void => {
    if (!pill || !note) return
    const app = options.getAppSession()
    const signedIn = Boolean(bridge?.session) || app !== null

    pill.replaceChildren()
    if (signedIn) {
      pill.setAttribute('data-session', 'in')
      const who = document.createElement('span')
      who.setAttribute('data-session-label', '')
      who.textContent = sessionLabel(bridge?.session?.user, app, options.locale)
      const out = document.createElement('button')
      out.type = 'button'
      out.setAttribute('data-session-signout', '')
      out.textContent = copy.signOut
      out.addEventListener('click', () => void signOutEverywhere())
      pill.append(who, out)
      pill.style.display = 'flex'
    } else if (bridge) {
      pill.setAttribute('data-session', 'out')
      const login = document.createElement('button')
      login.type = 'button'
      login.setAttribute('data-session-signin', '')
      login.textContent = copy.signIn
      login.addEventListener('click', () => bridge.loginWithPkce())
      pill.append(login)
      pill.style.display = 'flex'
    } else {
      // The password door's gate is the way in; nothing to offer here.
      pill.setAttribute('data-session', 'none')
      pill.style.display = 'none'
    }

    const message = signedIn ? undefined : bridge?.lastError
    note.textContent = message ?? ''
    note.style.display = message ? 'block' : 'none'
  }

  const unsubscribe = bridge ? bridge.subscribe(render) : (): void => {}
  render()

  return {
    refresh: render,
    unmount: () => {
      unsubscribe()
      pill?.remove()
      note?.remove()
    },
  }
}

/**
 * @deprecated The pill serves both doors; use `mountSessionPill`.
 * Kept so the runner's public surface only grows in a patch release. Behaves
 * as the old floating login button did: a bridge-only pill with no sign-out
 * callback into the host.
 */
export function mountLoginButton(bridge: AuthBridge): void {
  mountSessionPill({ bridge, getAppSession: () => null, onSignedOut: () => {} })
}
