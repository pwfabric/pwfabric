/**
 * The gate: an app that says sign-in is required must not render without one.
 *
 * `authRequired` was asked in the plan, stored on the project and drawn on the
 * canvas card, and nothing in a published app could read it — so an app that
 * "requires sign-in" served every page to whoever had the URL. These cases are
 * the enforcement, and the three that are easy to get wrong: an app that never
 * asked must not be gated, a returning visitor must not hit the wall, and an
 * export that declares sign-in with no provider must fail visibly rather than
 * quietly letting everyone in.
 *
 * @module @pwfabric/runner/sign-in-gate.test
 */

// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { isGated, mountSignInGate } from './sign-in-gate.js'
import type { PwappAuth } from './types.js'
import type { AuthBridge } from './auth.js'
import type { PwappProject } from './types.js'

const OPEN: PwappProject = { entrySurfaceId: 'home', surfaceOrder: ['home'] }
const GATED: PwappProject = { ...OPEN, title: 'Manav', identity: { required: true } }

function fakeBridge(overrides?: Partial<AuthBridge>): AuthBridge {
  const listeners = new Set<() => void>()
  return {
    session: undefined,
    lastError: undefined,
    init: vi.fn(),
    loginWithPkce: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(),
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    ...overrides,
  } as AuthBridge
}

let container: HTMLElement

beforeEach(() => {
  document.body.innerHTML = ''
  container = document.createElement('div')
  document.body.append(container)
})

describe('isGated', () => {
  it('an app that never asked for sign-in is never gated', () => {
    expect(isGated(OPEN, null)).toBe(false)
    expect(isGated(OPEN, fakeBridge())).toBe(false)
  })

  it('a required-sign-in app with no session is gated', () => {
    expect(isGated(GATED, fakeBridge())).toBe(true)
  })

  it('a signed-in visitor passes', () => {
    expect(isGated(GATED, fakeBridge({ session: { state: 'authenticated' } as never }))).toBe(false)
  })

  it('is gated when the export declared sign-in but shipped no provider', () => {
    // A broken export, not an anonymous app. Letting the visitor through on
    // the technicality of a missing auth.json is exactly the silent downgrade
    // this whole seam exists to stop.
    expect(isGated(GATED, null)).toBe(true)
  })
})

describe('mountSignInGate', () => {
  it('covers the app and offers a way in', () => {
    const bridge = fakeBridge()
    mountSignInGate(container, GATED, bridge)
    const gate = container.querySelector('#pwapp-sign-in-gate')
    expect(gate).toBeTruthy()
    const button = gate?.querySelector('button') as HTMLButtonElement
    expect(button.disabled).toBe(false)
    button.click()
    expect(bridge.loginWithPkce).toHaveBeenCalled()
  })

  it('renders nothing for an app that allows anonymous visitors', () => {
    mountSignInGate(container, OPEN, fakeBridge())
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
  })

  it('disables the button and says why when no provider was shipped', () => {
    mountSignInGate(container, GATED, null, { locale: 'tr' })
    const button = container.querySelector('#pwapp-sign-in-gate button') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(container.querySelector('[data-gate-error]')?.textContent).toMatch(
      /kimlik sağlayıcı tanımlanmamış/
    )
  })

  it('removes itself the moment a session appears', () => {
    // The returning-visitor case: the redirect from the issuer lands on the
    // app, and the wall the visitor already passed must not still be up.
    let notify: () => void = () => {}
    const bridge = fakeBridge({
      subscribe: (l: () => void) => {
        notify = l
        return () => {}
      },
    })
    mountSignInGate(container, GATED, bridge)
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeTruthy()

    ;(bridge as { session?: unknown }).session = { state: 'authenticated' }
    notify()
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
  })

  it('surfaces a failed login without stacking a second gate', () => {
    let notify: () => void = () => {}
    const bridge = fakeBridge({
      subscribe: (l: () => void) => {
        notify = l
        return () => {}
      },
    })
    mountSignInGate(container, GATED, bridge)
    ;(bridge as { lastError?: string }).lastError = 'Oturum açılamadı'
    notify()
    expect(container.querySelectorAll('#pwapp-sign-in-gate')).toHaveLength(1)
    expect(container.querySelector('[data-gate-error]')?.textContent).toBe('Oturum açılamadı')
  })
})

// ── the platform door ────────────────────────────────────────────────────────

describe('mountSignInGate — the password door', () => {
  const DOOR = { provider: 'password', loginUrl: 'https://api.example/login' } as PwappAuth

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function form(): HTMLFormElement {
    return container.querySelector('#pwapp-sign-in-gate form') as HTMLFormElement
  }
  function fill(email: string, password: string): void {
    const f = form()
    ;(f.querySelector('input[name=email]') as HTMLInputElement).value = email
    ;(f.querySelector('input[name=password]') as HTMLInputElement).value = password
  }

  it('renders credentials, not a redirect button', () => {
    // A password door has no redirect, no verifier and no discovery document.
    // Reusing the PKCE button would send the visitor nowhere.
    mountSignInGate(container, GATED, null, { auth: DOOR })
    expect(form()).toBeTruthy()
    expect(form().querySelector('input[type=password]')).toBeTruthy()
  })

  it('takes the gate down and reports the session on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { token: 'tok', expiresAt: '2099-01-01T00:00:00.000Z' } }),
      }))
    )
    const onSignedIn = vi.fn()
    mountSignInGate(container, GATED, null, { auth: DOOR, onSignedIn })

    fill('ali@example.com', 'hunter2000')
    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled())

    expect(onSignedIn.mock.calls[0]?.[0]).toMatchObject({ token: 'tok' })
    // The route that was refused has to be re-fetched, so the wall must be
    // gone by the time the caller re-renders it.
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
  })

  it('keeps the wall up and shows the server’s message on a bad password', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: { message: 'Email or password is wrong' } }),
      }))
    )
    mountSignInGate(container, GATED, null, { auth: DOOR })
    fill('ali@example.com', 'wrongpass')
    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))

    await vi.waitFor(() =>
      expect(container.querySelector('[data-gate-error]')?.textContent).toBe(
        'Email or password is wrong'
      )
    )
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeTruthy()
    // Re-rendering must not throw away what the visitor typed.
    expect((form().querySelector('input[name=email]') as HTMLInputElement).value).toBe(
      'ali@example.com'
    )
  })

  it('an app already holding a session is not gated', () => {
    // Either door satisfies it: the app asked for a signed-in visitor, not for
    // a particular way of becoming one.
    expect(isGated(GATED, null, true)).toBe(false)
    expect(isGated(GATED, null, false)).toBe(true)
  })

  it('an external-issuer app never gets the password form', () => {
    const external = { ...GATED, identity: { required: true, topology: 'external' as const } }
    mountSignInGate(container, external, fakeBridge(), { auth: DOOR })
    expect(container.querySelector('#pwapp-sign-in-gate form')).toBeNull()
  })
})

describe('mountSignInGate — register mode', () => {
  const DOOR_WITH_REGISTER = {
    provider: 'password',
    loginUrl: 'https://api.example/login',
    registerUrl: 'https://api.example/register',
  } as PwappAuth

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function form(): HTMLFormElement {
    return container.querySelector('#pwapp-sign-in-gate form') as HTMLFormElement
  }
  function toggle(): HTMLButtonElement {
    return container.querySelector('[data-gate-toggle]') as HTMLButtonElement
  }

  it('offers the switch only when the export declared registerUrl', () => {
    mountSignInGate(container, GATED, null, {
      auth: { provider: 'password', loginUrl: 'https://api.example/login' } as PwappAuth,
    })
    expect(container.querySelector('[data-gate-toggle]')).toBeNull()
    container.innerHTML = ''
    mountSignInGate(container, GATED, null, { auth: DOOR_WITH_REGISTER, locale: 'tr' })
    expect(toggle().textContent).toBe('Hesabınız yok mu? Kayıt olun')
    expect(form().querySelector('input[name=displayName]')).toBeNull()
  })

  it('switching adds a name field, relabels the submit, and switches back', () => {
    mountSignInGate(container, GATED, null, { auth: DOOR_WITH_REGISTER, locale: 'tr' })
    toggle().click()
    expect(form().querySelector('input[name=displayName]')).toBeTruthy()
    expect((form().querySelector('[data-gate-submit]') as HTMLButtonElement).textContent).toBe(
      'Kayıt ol'
    )
    expect((form().querySelector('input[name=password]') as HTMLInputElement).autocomplete).toBe(
      'new-password'
    )
    expect(toggle().textContent).toBe('Zaten hesabınız var mı? Oturum açın')
    toggle().click()
    expect(form().querySelector('input[name=displayName]')).toBeNull()
    expect((form().querySelector('[data-gate-submit]') as HTMLButtonElement).textContent).toBe(
      'Oturum aç'
    )
  })

  it('registers at registerUrl with the name and takes the gate down on success', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { token: 'new-tok', expiresAt: '2099-01-01T00:00:00.000Z' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const onSignedIn = vi.fn()
    mountSignInGate(container, GATED, null, { auth: DOOR_WITH_REGISTER, onSignedIn })
    toggle().click()
    ;(form().querySelector('input[name=displayName]') as HTMLInputElement).value = '  Ayşe  '
    ;(form().querySelector('input[name=email]') as HTMLInputElement).value = 'ayse@example.com'
    ;(form().querySelector('input[name=password]') as HTMLInputElement).value = 'hunter2000'
    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await vi.waitFor(() => expect(onSignedIn).toHaveBeenCalled())

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example/register')
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'ayse@example.com',
      password: 'hunter2000',
      displayName: 'Ayşe',
    })
    expect(onSignedIn.mock.calls[0]?.[0]).toMatchObject({ token: 'new-tok' })
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
  })

  it('a blank name is not sent', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      json: async () => ({ error: { message: 'Email already registered' } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    mountSignInGate(container, GATED, null, { auth: DOOR_WITH_REGISTER })
    toggle().click()
    ;(form().querySelector('input[name=email]') as HTMLInputElement).value = 'ayse@example.com'
    ;(form().querySelector('input[name=password]') as HTMLInputElement).value = 'hunter2000'
    form().dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }))
    await vi.waitFor(() =>
      expect(container.querySelector('[data-gate-error]')?.textContent).toBe(
        'Email already registered'
      )
    )
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ email: 'ayse@example.com', password: 'hunter2000' })
    // Still in register mode, wall still up.
    expect(form().querySelector('input[name=displayName]')).toBeTruthy()
  })
})

describe("the gate wears the app's appearance", () => {
  it('carries the resolved theme tokens on the dialog itself', () => {
    mountSignInGate(container, GATED, fakeBridge(), {
      themeVars: { '--pw-color-primary': '#0f766e', '--pw-color-background': '#0b0b0b' },
    })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate.style.getPropertyValue('--pw-color-primary')).toBe('#0f766e')
    expect(gate.style.getPropertyValue('--pw-color-background')).toBe('#0b0b0b')
  })

  it('styles every surface from tokens, keeping the old look only as fallback', () => {
    mountSignInGate(container, GATED, fakeBridge())
    const css = document.getElementById('pwapp-shell-css')?.textContent ?? ''
    for (const token of [
      '--pw-color-background',
      '--pw-color-text',
      '--pw-color-text-muted',
      '--pw-color-primary',
      '--pw-color-text-on-primary',
      '--pw-color-border',
      '--pw-color-error',
      '--pw-font-family',
      '--pw-font-family-heading',
      '--pw-border-radius',
    ]) {
      expect(css, token).toContain(`var(${token},`)
    }
    // The hard-coded look is gone from the elements.
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate.getAttribute('style') ?? '').not.toMatch(/system-ui|#111111|#444444/)
    const button = gate.querySelector('button') as HTMLButtonElement
    expect(button.getAttribute('style')).toBeNull()
  })

  it('is a labelled, described modal dialog', () => {
    mountSignInGate(container, GATED, fakeBridge(), { locale: 'tr' })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate.getAttribute('role')).toBe('dialog')
    expect(gate.getAttribute('aria-modal')).toBe('true')
    const labelledBy = gate.getAttribute('aria-labelledby') ?? ''
    expect(document.getElementById(labelledBy)?.textContent).toBe('Manav')
    const describedBy = gate.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(describedBy)?.textContent).toMatch(/oturum açmanız gerekiyor/)
  })

  it('moves focus into the dialog and keeps Tab inside it', () => {
    const before = document.createElement('button')
    document.body.append(before)
    before.focus()
    mountSignInGate(container, GATED, null, {
      auth: { provider: 'password', loginUrl: 'https://api/x/login' } as PwappAuth,
    })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    const email = gate.querySelector('input[name="email"]') as HTMLInputElement
    expect(document.activeElement).toBe(email)

    const focusables = gate.querySelectorAll<HTMLElement>('input, button:not([disabled])')
    const last = focusables[focusables.length - 1] as HTMLElement
    last.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    last.dispatchEvent(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(email)
  })

  it('a required gate cannot be dismissed with Escape', () => {
    mountSignInGate(container, GATED, fakeBridge())
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    gate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeTruthy()
    expect(gate.querySelector('[data-gate-close]')).toBeNull()
  })
})

describe('the gate on demand — an account control asked for sign-in', () => {
  it('opens on an app that does not require sign-in, and closes with Escape or the close button', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onDismiss = vi.fn()
    mountSignInGate(container, OPEN, fakeBridge(), { onDemand: true, onDismiss })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate).toBeTruthy()
    gate.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(1)
    // Focus goes back to whatever opened it.
    expect(document.activeElement).toBe(opener)

    mountSignInGate(container, OPEN, fakeBridge(), { onDemand: true, onDismiss })
    ;(container.querySelector('[data-gate-close]') as HTMLButtonElement).click()
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(2)
  })

  it('does not open for a visitor who is already signed in', () => {
    mountSignInGate(container, OPEN, fakeBridge({ session: { state: 'authenticated' } as never }), {
      onDemand: true,
    })
    expect(container.querySelector('#pwapp-sign-in-gate')).toBeNull()
  })
})

describe('the gate speaks the app’s language', () => {
  const DOOR = {
    provider: 'password',
    loginUrl: 'https://api.example/login',
    registerUrl: 'https://api.example/register',
  } as PwappAuth
  const UNTITLED: PwappProject = { ...OPEN, identity: { required: true } }

  it('is English by default', () => {
    mountSignInGate(container, UNTITLED, null, { auth: DOOR })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate.querySelector('.pwapp-gate-title')?.textContent).toBe('Sign in')
    expect(gate.querySelector('.pwapp-gate-body')?.textContent).toBe(
      'You need to sign in to view this app.'
    )
    expect(gate.querySelector('[data-gate-submit]')?.textContent).toBe('Sign in')
    expect(gate.querySelector('input[name=email]')?.getAttribute('aria-label')).toBe('Email')
    expect(gate.querySelector('input[name=password]')?.getAttribute('aria-label')).toBe('Password')
    expect(gate.querySelector('[data-gate-toggle]')?.textContent).toBe(
      "Don't have an account? Sign up"
    )
  })

  it('is Turkish when the app is', () => {
    mountSignInGate(container, UNTITLED, null, { auth: DOOR, locale: 'tr' })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate.querySelector('.pwapp-gate-title')?.textContent).toBe('Oturum açın')
    expect(gate.querySelector('input[name=email]')?.getAttribute('aria-label')).toBe('E-posta')
    expect(gate.querySelector('[data-gate-submit]')?.textContent).toBe('Oturum aç')
  })

  it('says in English when no provider was shipped', () => {
    mountSignInGate(container, GATED, null)
    expect(container.querySelector('[data-gate-error]')?.textContent).toMatch(
      /no identity provider is configured/
    )
  })

  it('shows the initial error it was handed', () => {
    mountSignInGate(container, GATED, null, { auth: DOOR, initialError: 'Sign-in was cancelled.' })
    expect(container.querySelector('[data-gate-error]')?.textContent).toBe('Sign-in was cancelled.')
  })

  it('labels the close button in the app’s language', () => {
    mountSignInGate(container, OPEN, fakeBridge(), { onDemand: true, locale: 'tr' })
    expect(container.querySelector('[data-gate-close]')?.getAttribute('aria-label')).toBe('Kapat')
  })
})

describe('the gate’s social buttons', () => {
  const SOCIAL = {
    provider: 'password',
    loginUrl: 'https://api.example/login',
    providers: [{ method: 'github' }, { method: 'google' }, { method: 'host' }, { method: 'microsoft' }],
  } as PwappAuth

  function buttons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-gate-provider]'))
  }

  it('orders them host account, Microsoft, Google, GitHub whatever order they were shipped in', () => {
    mountSignInGate(container, GATED, null, { auth: SOCIAL, onProviderSignIn: vi.fn() })
    expect(buttons().map((b) => b.getAttribute('data-gate-provider'))).toEqual([
      'host',
      'microsoft',
      'google',
      'github',
    ])
  })

  it('labels them in English and Turkish, host account included', () => {
    mountSignInGate(container, GATED, null, { auth: SOCIAL, onProviderSignIn: vi.fn() })
    expect(buttons().map((b) => b.textContent)).toEqual([
      'Continue with your account',
      'Continue with Microsoft',
      'Continue with Google',
      'Continue with GitHub',
    ])
    container.innerHTML = ''
    mountSignInGate(container, GATED, null, {
      auth: SOCIAL,
      onProviderSignIn: vi.fn(),
      locale: 'tr',
    })
    expect(buttons()[0]?.textContent).toBe('Hesabınızla devam edin')
    expect(container.querySelector('.pwapp-gate-or')?.textContent).toBe('ya da')
  })

  it('reports only the method when a button is pressed', () => {
    const onProviderSignIn = vi.fn()
    mountSignInGate(container, GATED, null, { auth: SOCIAL, onProviderSignIn })
    buttons()[0]?.click()
    expect(onProviderSignIn).toHaveBeenCalledWith('host')
  })

  it('keeps an unknown method at the end, under its own name', () => {
    mountSignInGate(container, GATED, null, {
      auth: { ...SOCIAL, providers: [{ method: 'okta' as never }, { method: 'google' }] },
      onProviderSignIn: vi.fn(),
    })
    expect(buttons().map((b) => b.textContent)).toEqual(['Continue with Google', 'okta'])
  })

  it('a social-only door offers its buttons, not a dead button and a complaint', () => {
    mountSignInGate(container, GATED, null, {
      auth: { provider: 'password', providers: [{ method: 'google' }] } as PwappAuth,
      onProviderSignIn: vi.fn(),
    })
    const gate = container.querySelector('#pwapp-sign-in-gate') as HTMLElement
    expect(gate.querySelector('button[disabled]')).toBeNull()
    expect(gate.querySelector('[data-gate-error]')?.textContent).toBe('')
    expect(gate.querySelector('.pwapp-gate-or')).toBeNull()
    expect(buttons()).toHaveLength(1)
  })
})
