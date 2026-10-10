/**
 * The shell refuses to render an app whose visitor has not signed in.
 *
 * WHY A GATE AND NOT A REDIRECT. A published app is static files on a CDN;
 * there is no server in front of it to bounce an anonymous request. Whatever
 * enforcement exists has to happen before the first surface is mounted, in the
 * shell itself — and the API enforces the same thing again on every read, so
 * a visitor who defeats this sees an app full of 401s rather than data.
 *
 * That double enforcement is deliberate. This gate is what makes the app
 * HONEST; `appAuth` on the API is what makes it SAFE. Neither substitutes for
 * the other: without the gate, a required-sign-in app renders empty pages and
 * looks broken; without the API check, hiding the UI would be the whole of the
 * security, which is no security at all.
 *
 * @module @pwfabric/runner/sign-in-gate
 */

import type { AuthBridge } from './auth.js'
import type { PwappAuth, PwappProject } from './types.js'
import { signIn, type AppSession } from './app-session.js'
import { applyThemeVars, ensureShellStyles } from './shell-theme.js'
import { copyFor, type ProviderLabelKey, type RunnerCopy, type RunnerLocale } from './copy.js'

const GATE_ID = 'pwapp-sign-in-gate'

/** True when the app said sign-in is required and nobody is signed in. */
export function isGated(
  project: PwappProject,
  bridge: AuthBridge | null,
  hasAppSession = false
): boolean {
  if (!project.identity?.required) return false
  // Either door satisfies it: an issuer session from PKCE, or a platform
  // session from the password door. The app asked for a signed-in visitor,
  // not for a particular way of becoming one.
  return !bridge?.session && !hasAppSession
}

/**
 * Draw the gate over the mount point, and keep it in step with the session.
 *
 * Returns an unsubscribe. The gate removes itself the moment a session
 * appears, so the redirect coming back from the issuer lands on the app rather
 * than on a wall the visitor has already passed.
 */
export interface SignInGateOptions {
  /** The platform door's addresses, when the export declared one. */
  readonly auth?: PwappAuth | null | undefined
  /** The app's content locale; every word the gate draws follows it. Default `en`. */
  readonly locale?: RunnerLocale | undefined
  /**
   * A message to show the moment the gate mounts — how a failed arrival from a
   * provider becomes visible instead of a wall that simply reappeared.
   */
  readonly initialError?: string | undefined
  /**
   * Start a provider flow. Supplied by the runner because leaving the page is
   * its business, not the gate's — the gate draws and reports, it does not
   * navigate.
   */
  readonly onProviderSignIn?: ((method: string) => void) | undefined
  /** Called once a password sign-in succeeds, so the refused route re-renders. */
  readonly onSignedIn?: ((session: AppSession) => void) | undefined
  /**
   * The app's resolved appearance variables (see `shellThemeVars`). The gate
   * sits outside the surface root that carries them, so it is handed them.
   */
  readonly themeVars?: Readonly<Record<string, string>> | undefined
  /**
   * Opened by an account control rather than by the app's sign-in rule: shown
   * while nobody is signed in whether or not the app requires it, and
   * dismissible (close button, Escape). A required gate is never dismissible.
   */
  readonly onDemand?: boolean | undefined
  /** Called when an on-demand gate is dismissed without signing in. */
  readonly onDismiss?: (() => void) | undefined
}

/**
 * What each button says.
 *
 * A visitor recognises "Google", not `google`. Unknown methods fall back to
 * their own name rather than being hidden — a door we cannot label is still a
 * door, and hiding it would be the silent kind of failure this gate exists to
 * end.
 */
function providerLabel(copy: RunnerCopy, method: string): string {
  return Object.prototype.hasOwnProperty.call(copy.gate.providers, method)
    ? copy.gate.providers[method as ProviderLabelKey]
    : method
}

/**
 * The order the buttons stand in, whatever order the export wrote them.
 * The host's own account first, then the providers most visitors hold. Unknown
 * methods keep their relative order at the end.
 */
const PROVIDER_ORDER: readonly string[] = ['host', 'microsoft', 'google', 'github']

function byProviderOrder<T extends { readonly method: string }>(providers: readonly T[]): T[] {
  const rank = (m: string): number => {
    const i = PROVIDER_ORDER.indexOf(m)
    return i === -1 ? PROVIDER_ORDER.length : i
  }
  return providers
    .map((p, index) => ({ p, index }))
    .sort((a, b) => rank(a.p.method) - rank(b.p.method) || a.index - b.index)
    .map(({ p }) => p)
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

let gateSeq = 0

export function mountSignInGate(
  container: Element,
  project: PwappProject,
  bridge: AuthBridge | null,
  options: SignInGateOptions = {}
): () => void {
  // Two doors, and the declaration picks one. A password door has no
  // redirect, no verifier and no discovery document — treating it as a
  // degenerate PKCE flow is how the two would drift into one confused branch.
  const loginUrl = options.auth?.loginUrl
  const registerUrl = options.auth?.registerUrl
  const usesPassword = Boolean(loginUrl) && project.identity?.topology !== 'external'
  const onDemand = options.onDemand === true
  const copy = copyFor(options.locale)
  const providers = byProviderOrder(options.auth?.providers ?? [])
  const offersProviders = providers.length > 0 && Boolean(options.onProviderSignIn)
  const ids = `pwapp-gate-${++gateSeq}`
  // The export declares `registerUrl` only when the door takes new accounts.
  // Without it the gate is sign-in only; with it the visitor can switch.
  let mode: 'login' | 'register' = 'login'
  let signedIn = false
  let busy = false
  let closed = false
  let message: string | null = options.initialError ?? null
  // Where focus was before the dialog took it, so it can be given back.
  let returnFocus: Element | null = null

  const shouldShow = (): boolean =>
    !closed &&
    (onDemand ? !signedIn && !bridge?.session : isGated(project, bridge, signedIn))

  const takeDown = (): void => {
    const existing = container.querySelector(`#${GATE_ID}`)
    if (!existing) return
    existing.remove()
    if (returnFocus instanceof HTMLElement && returnFocus.isConnected) returnFocus.focus()
    returnFocus = null
  }

  let unsubscribe: () => void = () => {}
  const dismiss = (): void => {
    if (!onDemand || closed) return
    closed = true
    unsubscribe()
    takeDown()
    options.onDismiss?.()
  }

  const render = (): void => {
    const existing = container.querySelector(`#${GATE_ID}`)
    if (!shouldShow()) {
      takeDown()
      return
    }
    if (existing) {
      // Only the message line and the busy state change while the gate is up;
      // rebuilding the panel would throw away what the visitor has typed.
      const note = existing.querySelector('[data-gate-error]')
      if (note) note.textContent = message ?? bridge?.lastError ?? ''
      const submit = existing.querySelector('[data-gate-submit]')
      if (submit instanceof HTMLButtonElement) submit.disabled = busy
      return
    }

    ensureShellStyles()
    const gate = document.createElement('div')
    gate.id = GATE_ID
    gate.setAttribute('role', 'dialog')
    gate.setAttribute('aria-modal', 'true')
    gate.setAttribute('aria-labelledby', `${ids}-title`)
    gate.setAttribute('aria-describedby', `${ids}-body`)
    if (options.themeVars) applyThemeVars(gate, options.themeVars)

    const title = document.createElement('h1')
    title.id = `${ids}-title`
    title.className = 'pwapp-gate-title'
    title.textContent = project.title ?? copy.gate.title

    const body = document.createElement('p')
    body.id = `${ids}-body`
    body.className = 'pwapp-gate-body'
    body.textContent = copy.gate.body

    const error = document.createElement('p')
    error.setAttribute('data-gate-error', '')
    error.setAttribute('aria-live', 'polite')
    error.className = 'pwapp-gate-error'

    const panel = document.createElement('div')
    panel.className = 'pwapp-gate-panel'

    if (usesPassword) {
      // A real form, because the platform door takes credentials rather than a
      // redirect. `<form>` and not two inputs and a button: Enter submits, the
      // browser offers to fill and to save, and a password manager recognises
      // it — none of which a div gets for free.
      const form = document.createElement('form')

      const field = (
        type: string,
        name: string,
        label: string,
        autocomplete: AutoFill
      ): HTMLInputElement => {
        const input = document.createElement('input')
        input.type = type
        input.name = name
        input.required = true
        input.placeholder = label
        input.setAttribute('aria-label', label)
        input.autocomplete = autocomplete
        return input
      }
      const registering = mode === 'register' && Boolean(registerUrl)
      const displayName = registering ? field('text', 'displayName', copy.gate.name, 'name') : null
      if (displayName) displayName.required = false
      const email = field('email', 'email', copy.gate.email, 'username')
      const password = field(
        'password',
        'password',
        copy.gate.password,
        registering ? 'new-password' : 'current-password'
      )

      const submit = document.createElement('button')
      submit.type = 'submit'
      submit.className = 'pwapp-gate-primary'
      submit.setAttribute('data-gate-submit', '')
      submit.textContent = registering ? copy.gate.register : copy.gate.signIn

      form.addEventListener('submit', (event) => {
        event.preventDefault()
        if (busy) return
        busy = true
        message = null
        render()
        const name = displayName?.value.trim()
        void signIn(
          registering ? (registerUrl as string) : (loginUrl as string),
          {
            email: email.value,
            password: password.value,
            ...(registering && name ? { displayName: name } : {}),
          },
          options.locale
        ).then((result) => {
          busy = false
          if (!result.ok) {
            message = result.message
            render()
            return
          }
          // The gate comes down here rather than waiting for a reload: the
          // route that was refused has to be fetched again with the token.
          signedIn = true
          options.onSignedIn?.(result.session)
          render()
        })
      })

      if (displayName) form.append(displayName)
      form.append(email, password, submit)
      panel.append(title, body, form, error)

      if (registerUrl) {
        // One link, two directions. Rebuilding the panel is the only way to
        // change the field set; what the visitor typed is discarded on purpose,
        // since the two forms ask for different things.
        const toggle = document.createElement('button')
        toggle.type = 'button'
        toggle.className = 'pwapp-gate-link'
        toggle.setAttribute('data-gate-toggle', '')
        toggle.textContent = registering ? copy.gate.toSignIn : copy.gate.toRegister
        toggle.addEventListener('click', () => {
          mode = registering ? 'login' : 'register'
          message = null
          // Swapped in place: the focus to give back is the one from before
          // the dialog opened, not the toggle that is about to disappear.
          const keep = returnFocus
          container.querySelector(`#${GATE_ID}`)?.remove()
          render()
          returnFocus = keep
        })
        panel.append(toggle)
      }
    } else if (!bridge && offersProviders) {
      // A social-only door: the provider buttons below ARE the way in, so no
      // dead primary button and no "nothing is configured" complaint.
      panel.append(title, body, error)
    } else {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'pwapp-gate-primary'
      button.setAttribute('data-gate-submit', '')
      button.textContent = copy.gate.signIn
      // No bridge and no password door means the export declared sign-in but
      // shipped no way in — a broken export, not an anonymous app. The gate
      // stays and says so, rather than letting the visitor through on a
      // technicality.
      if (bridge) button.addEventListener('click', () => bridge.loginWithPkce())
      else button.disabled = true
      error.textContent = bridge ? (bridge.lastError ?? '') : copy.gate.noProvider
      panel.append(title, body, button, error)
    }
    // A failed arrival is shown from the first frame, whichever door is drawn.
    if (message && !error.textContent) error.textContent = message

    // ── SOCIAL BUTTONS ─────────────────────────────────────────────────
    //
    // Drawn under whichever door came first, because they are an ADDITION to
    // it rather than an alternative: an app may offer a password and Google,
    // and a visitor picks. Absent when the package carries none, which is what
    // a password-only door — or a deployment without provider credentials —
    // ships.
    if (offersProviders) {
      // "or" only separates the buttons from a door drawn above them.
      if (usesPassword || bridge) {
        const or = document.createElement('div')
        or.className = 'pwapp-gate-or'
        or.textContent = copy.gate.or
        panel.append(or)
      }

      for (const provider of providers) {
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'pwapp-gate-secondary'
        b.setAttribute('data-gate-provider', provider.method)
        b.textContent = providerLabel(copy, provider.method)
        b.addEventListener('click', () => options.onProviderSignIn?.(provider.method))
        panel.append(b)
      }
    }

    if (onDemand) {
      // Last in the DOM so the primary action stays the first thing focused;
      // placed top-right by the sheet.
      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'pwapp-gate-close'
      close.setAttribute('data-gate-close', '')
      close.setAttribute('aria-label', copy.gate.close)
      close.textContent = '×'
      close.addEventListener('click', dismiss)
      panel.append(close)
    }

    // Keyboard: Tab stays inside the dialog; Escape closes it only when the
    // app did not require sign-in.
    gate.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        if (onDemand) {
          event.preventDefault()
          dismiss()
        }
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(gate.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0] as HTMLElement
      const last = items[items.length - 1] as HTMLElement
      const active = document.activeElement
      if (event.shiftKey && (active === first || !gate.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !gate.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    })

    gate.append(panel)
    returnFocus = document.activeElement
    container.append(gate)
    gate.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }

  render()
  unsubscribe = bridge ? bridge.subscribe(render) : () => {}
  return () => {
    unsubscribe()
    closed = true
    takeDown()
  }
}
