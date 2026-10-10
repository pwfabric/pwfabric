// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { mountSessionPill, sessionLabel } from './session-pill.js'
import type { AuthBridge } from './auth.js'
import type { AuthSession } from '@pwfabric/runtime/auth'
import type { PwappAuth } from './types.js'

function fakeBridge(overrides?: Partial<AuthBridge>): AuthBridge & { fire(): void } {
  const listeners = new Set<() => void>()
  const bridge = {
    session: undefined as AuthSession | undefined,
    lastError: undefined,
    init: vi.fn(),
    loginWithPkce: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(),
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    fire: () => listeners.forEach((l) => l()),
    ...overrides,
  }
  return bridge as unknown as AuthBridge & { fire(): void }
}

const issuerSession = (email?: string): AuthSession =>
  ({
    id: 's1',
    state: 'authenticated',
    provider: 'oidc',
    createdAt: 0,
    ...(email ? { user: { id: 'u1', email } } : {}),
  }) as unknown as AuthSession

const DOOR = { provider: 'password', logoutUrl: 'https://api.example/logout' } as PwappAuth

function pill(): HTMLElement | null {
  return document.getElementById('pwapp-session-pill')
}

beforeEach(() => {
  document.body.innerHTML = ''
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sessionLabel', () => {
  it('prefers the platform principal, then the issuer user, then a plain state', () => {
    expect(sessionLabel(undefined, { token: 't', expiresAt: '', principal: { id: 'p', email: 'a@x' } })).toBe('a@x')
    expect(sessionLabel({ email: 'b@x' }, null)).toBe('b@x')
    expect(sessionLabel({ name: 'Ayşe' }, null)).toBe('Ayşe')
    expect(sessionLabel(undefined, null)).toBe('Signed in')
    expect(sessionLabel(undefined, null, 'tr')).toBe('Oturum açık')
  })
})

describe('mountSessionPill', () => {
  it('offers sign-in when there is a bridge and no session', () => {
    const bridge = fakeBridge()
    mountSessionPill({ bridge, getAppSession: () => null, onSignedOut: vi.fn() })
    expect(pill()?.getAttribute('data-session')).toBe('out')
    ;(pill()?.querySelector('[data-session-signin]') as HTMLButtonElement).click()
    expect(bridge.loginWithPkce).toHaveBeenCalled()
  })

  it('hides itself when there is neither a bridge nor a session', () => {
    mountSessionPill({ bridge: null, getAppSession: () => null, onSignedOut: vi.fn() })
    expect(pill()?.getAttribute('data-session')).toBe('none')
    expect(pill()?.style.display).toBe('none')
  })

  it('shows who is signed in and signs the issuer session out through the bridge', () => {
    const bridge = fakeBridge({ session: issuerSession('ali@example.com') })
    const onSignedOut = vi.fn()
    mountSessionPill({ bridge, getAppSession: () => null, onSignedOut })
    expect(pill()?.getAttribute('data-session')).toBe('in')
    expect(pill()?.querySelector('[data-session-label]')?.textContent).toBe('ali@example.com')
    ;(pill()?.querySelector('[data-session-signout]') as HTMLButtonElement).click()
    expect(bridge.logout).toHaveBeenCalled()
  })

  it('signs a platform session out at logoutUrl, then reports so the runner can clear it', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    let session: { token: string; expiresAt: string } | null = { token: 'tok', expiresAt: '' }
    const onSignedOut = vi.fn(() => {
      session = null
    })
    const handle = mountSessionPill({
      bridge: null,
      auth: DOOR,
      getAppSession: () => session,
      onSignedOut,
    })
    expect(pill()?.getAttribute('data-session')).toBe('in')
    ;(pill()?.querySelector('[data-session-signout]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/logout',
      expect.objectContaining({ method: 'POST', headers: { 'x-app-session': 'tok' } })
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/_auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    )
    // The runner cleared its session and asked for a redraw: no session, no
    // bridge — the pill steps aside for the gate.
    handle.refresh()
    expect(pill()?.getAttribute('data-session')).toBe('none')
  })

  it('redraws on bridge events and shows the last error only while signed out', () => {
    const bridge = fakeBridge({ lastError: 'state mismatch' })
    mountSessionPill({ bridge, getAppSession: () => null, onSignedOut: vi.fn() })
    const note = document.getElementById('pwapp-login-error') as HTMLDivElement
    expect(note.style.display).toBe('block')
    ;(bridge as { session: AuthSession | undefined }).session = issuerSession()
    bridge.fire()
    expect(pill()?.getAttribute('data-session')).toBe('in')
    expect(pill()?.querySelector('[data-session-label]')?.textContent).toBe('Signed in')
    expect(note.style.display).toBe('none')
  })

  it('unmount removes the elements and stops listening', () => {
    const bridge = fakeBridge()
    const handle = mountSessionPill({ bridge, getAppSession: () => null, onSignedOut: vi.fn() })
    handle.unmount()
    expect(pill()).toBeNull()
    expect(document.getElementById('pwapp-login-error')).toBeNull()
  })

  it('is not drawn at all when the app declares an account slot — the shell owns the account', () => {
    const handle = mountSessionPill({
      bridge: fakeBridge({ session: issuerSession('ali@example.com') }),
      getAppSession: () => null,
      onSignedOut: vi.fn(),
      accountSlot: true,
    })
    expect(pill()).toBeNull()
    expect(document.getElementById('pwapp-login-error')).toBeNull()
    expect(() => {
      handle.refresh()
      handle.unmount()
    }).not.toThrow()
  })

  it('sits above the bottom-bar: its offset reads --pw-bottom-bar-height', () => {
    mountSessionPill({ bridge: fakeBridge(), getAppSession: () => null, onSignedOut: vi.fn() })
    const css = document.getElementById('pwapp-shell-css')?.textContent ?? ''
    expect(css).toMatch(/#pwapp-session-pill\s*\{[^}]*bottom:\s*calc\(16px \+ var\(--pw-bottom-bar-height,\s*0px\)\)/)
    expect(css).toMatch(/#pwapp-login-error\s*\{[^}]*bottom:\s*calc\(62px \+ var\(--pw-bottom-bar-height,\s*0px\)\)/)
    // No inline position left to override the sheet.
    expect(pill()?.style.bottom).toBe('')
  })

  it("paints with the app's appearance tokens", () => {
    mountSessionPill({
      bridge: fakeBridge(),
      getAppSession: () => null,
      onSignedOut: vi.fn(),
      themeVars: { '--pw-color-card': '#101010', '--pw-font-family': 'Lora, serif' },
    })
    expect(pill()?.style.getPropertyValue('--pw-color-card')).toBe('#101010')
    expect(pill()?.style.getPropertyValue('--pw-font-family')).toBe('Lora, serif')
    const css = document.getElementById('pwapp-shell-css')?.textContent ?? ''
    expect(css).toMatch(/#pwapp-session-pill\s*\{[^}]*background:\s*var\(--pw-color-card,/)
    expect(css).toMatch(/#pwapp-session-pill\s*\{[^}]*font-family:\s*var\(--pw-font-family,/)
  })

  it('hands sign-out to the runner when it supplies one', async () => {
    const bridge = fakeBridge({ session: issuerSession('ali@example.com') })
    const onSignOut = vi.fn(async () => {})
    const onSignedOut = vi.fn()
    mountSessionPill({ bridge, getAppSession: () => null, onSignedOut, onSignOut })
    ;(pill()?.querySelector('[data-session-signout]') as HTMLButtonElement).click()
    await vi.waitFor(() => expect(onSignOut).toHaveBeenCalled())
    // The runner's sign-out owns the whole sequence; the pill does not repeat it.
    expect(bridge.logout).not.toHaveBeenCalled()
    expect(onSignedOut).not.toHaveBeenCalled()
  })
})

describe('the pill speaks the app’s language', () => {
  it('is English by default', () => {
    mountSessionPill({ bridge: fakeBridge(), getAppSession: () => null, onSignedOut: vi.fn() })
    expect(pill()?.querySelector('[data-session-signin]')?.textContent).toBe('Sign in')
    document.body.innerHTML = ''
    mountSessionPill({
      bridge: null,
      getAppSession: () => ({ token: 't', expiresAt: '' }),
      onSignedOut: vi.fn(),
    })
    expect(pill()?.querySelector('[data-session-signout]')?.textContent).toBe('Sign out')
    expect(pill()?.querySelector('[data-session-label]')?.textContent).toBe('Signed in')
  })

  it('is Turkish when the app is', () => {
    mountSessionPill({
      bridge: fakeBridge(),
      getAppSession: () => null,
      onSignedOut: vi.fn(),
      locale: 'tr',
    })
    expect(pill()?.querySelector('[data-session-signin]')?.textContent).toBe('Oturum aç')
    document.body.innerHTML = ''
    mountSessionPill({
      bridge: null,
      getAppSession: () => ({ token: 't', expiresAt: '' }),
      onSignedOut: vi.fn(),
      locale: 'tr',
    })
    expect(pill()?.querySelector('[data-session-signout]')?.textContent).toBe('Çıkış')
    expect(pill()?.querySelector('[data-session-label]')?.textContent).toBe('Oturum açık')
  })
})
