/**
 * The account belongs to the app's shell.
 *
 * The sign-in state does not live in a floating pill (it would cover the
 * bottom-bar's last tab), and a host-door visitor (password or a host
 * provider door) must reach the navbar as well as a PKCE bridge session does.
 * These cases pin that: one `account` prop, built from EITHER door, injected into whichever shell block
 * the app declared, with its links rewritten like every other app link.
 *
 * @module @pwfabric/runner/account.test
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import type { AuthSession } from '@pwfabric/runtime/auth'
import {
  accountUserFrom,
  applyAccountControl,
  applyAccountToSurface,
  buildAccountProp,
} from './apply-auth.js'
import { runnerMessages } from './messages.js'
import { createAccountController, hasDoor } from './account-controller.js'
import { withProfile } from './app-session.js'
import type { SurfaceBlockNode, PwappAccountDeclaration, PwappAuth, PwappProject } from './types.js'
import type { AuthBridge } from './auth.js'

const hashHref = (key: string): string => `#/${key}`

/** An app that writes its account words in Turkish (`plan.json` `messages`). */
const TR = runnerMessages({
  'account.signIn': 'Oturum aç',
  'account.signOut': 'Çıkış yap',
  'account.profile': 'Profil',
  'account.greeting': 'Hoş geldin, {name}',
})

const issuer = (user?: AuthSession['user']): AuthSession =>
  ({ id: 's', state: 'authenticated', provider: 'oidc', createdAt: 0, ...(user ? { user } : {}) }) as AuthSession

afterEach(() => vi.unstubAllGlobals())

describe('accountUserFrom — either door', () => {
  it('reads the platform session principal (password / our provider door)', () => {
    expect(
      accountUserFrom({
        appSession: {
          token: 't',
          expiresAt: '',
          principal: { id: 'p', email: 'ayse@x.com', displayName: 'Ayşe', avatarUrl: 'https://i/a.png' },
        },
      })
    ).toEqual({ name: 'Ayşe', email: 'ayse@x.com', avatarSrc: 'https://i/a.png' })
  })

  it('reads the PKCE bridge user, with the picture claim as avatar', () => {
    expect(
      accountUserFrom({
        bridgeSession: issuer({ id: 'u', name: 'Ali', email: 'ali@x.com', claims: { picture: 'https://i/b.png' } }),
      })
    ).toEqual({ name: 'Ali', email: 'ali@x.com', avatarSrc: 'https://i/b.png' })
  })

  it('a session with no profile is still signed in', () => {
    expect(accountUserFrom({ appSession: { token: 't', expiresAt: '' } })).toEqual({})
    expect(accountUserFrom({ bridgeSession: issuer() })).toEqual({})
  })

  it('no session from either door is signed out', () => {
    expect(accountUserFrom({})).toBeNull()
    expect(accountUserFrom({ appSession: null, bridgeSession: undefined })).toBeNull()
  })

  it('the platform session wins when both exist — the door that issued it can revoke it', () => {
    const user = accountUserFrom({
      appSession: { token: 't', expiresAt: '', principal: { id: 'p', email: 'door@x.com' } },
      bridgeSession: issuer({ id: 'u', email: 'issuer@x.com' }),
    })
    expect(user?.email).toBe('door@x.com')
  })
})

describe('buildAccountProp', () => {
  const declaration: PwappAccountDeclaration = {
    placement: 'bottom-bar',
    profileHref: '/profile/',
    links: [
      { label: 'Taleplerim', href: '/ticket/' },
      { label: 'Help', href: 'https://help.example.com' },
    ],
  }

  it('signed in: carries the user and rewrites every href with the router', () => {
    const prop = buildAccountProp({
      declaration,
      user: { name: 'Ayşe', email: 'a@x' },
      entry: 'home',
      toHref: hashHref,
      messages: TR,
    })
    expect(prop).toEqual({
      state: 'signed-in',
      name: 'Ayşe',
      email: 'a@x',
      profileHref: '#/profile',
      links: [
        { label: 'Taleplerim', href: '#/ticket' },
        { label: 'Help', href: 'https://help.example.com' },
      ],
      signInLabel: 'Oturum aç',
      signOutLabel: 'Çıkış yap',
      profileLabel: 'Profil',
      greetingLabel: 'Hoş geldin, Ayşe',
    })
  })

  it('signed out: state only plus labels — no stale profile', () => {
    const prop = buildAccountProp({ declaration, user: null, entry: 'home', toHref: hashHref })
    expect(prop.state).toBe('signed-out')
    expect(prop.name).toBeUndefined()
    expect(prop.signInLabel).toBe('Sign in')
    expect(prop.signOutLabel).toBe('Sign out')
    expect(prop.profileLabel).toBe('Profile')
    // Links still travel: an app may list public destinations in the menu.
    expect(prop.profileHref).toBe('#/profile')
  })

  it('path router: the base is applied the same way nav links get it', () => {
    const prop = buildAccountProp({
      declaration: { placement: 'navbar', profileHref: '/profile/' },
      user: {},
      entry: 'home',
      toHref: (k) => `/apps/x/${k}`,
    })
    expect(prop.profileHref).toBe('/apps/x/profile')
    expect(prop.links).toBeUndefined()
  })
})

describe('applyAccountToSurface — by placement', () => {
  const tree = (): SurfaceBlockNode[] => [
    { id: 'n', type: 'navbar', props: { links: [] } },
    {
      id: 'shell',
      type: 'app-shell',
      props: {},
      children: [
        { id: 'rail', type: 'app-rail', props: { items: [] } },
        { id: 'bb', type: 'bottom-bar', props: { items: [] } },
      ],
    },
  ]
  const account = { state: 'signed-in' as const, name: 'A' }

  it.each([
    ['navbar', 'n'],
    ['bottom-bar', 'bb'],
    ['app-rail', 'rail'],
  ] as const)('%s receives the prop, and only it', (placement, id) => {
    const out = applyAccountToSurface(tree(), account, placement)
    const found: Record<string, unknown> = {}
    const walk = (nodes: SurfaceBlockNode[]): void =>
      nodes.forEach((n) => {
        found[n.id as string] = n.props?.account
        if (n.children) walk(n.children)
      })
    walk(out)
    for (const [key, value] of Object.entries(found)) {
      expect(value, key).toEqual(key === id ? account : undefined)
    }
  })

  it('does not mutate the input tree', () => {
    const input = tree()
    applyAccountToSurface(input, account, 'navbar')
    expect(input[0]?.props?.account).toBeUndefined()
  })

  it('a block with no props still gets one', () => {
    const out = applyAccountToSurface([{ type: 'navbar' }], account, 'navbar')
    expect(out[0]?.props).toEqual({ account })
  })
})

describe('the runner rewrites none of the app’s text', () => {
  it('a navbar greeting the app wrote stays as written, whoever signs in', () => {
    // It used to be found by its English/Turkish prefix and overwritten; an
    // app writes `{{me.name}}` instead.
    const blocks: SurfaceBlockNode[] = [
      { id: 'n', type: 'navbar', props: { rightInfo: [{ value: 'Welcome, guest' }], avatarName: 'guest' } },
    ]
    const out = applyAccountControl(blocks, {
      declaration: undefined,
      door: true,
      user: { name: 'Ada', email: 'ada@x' },
      entry: 'home',
      toHref: hashHref,
    })
    expect(out).toEqual(blocks)
  })

  it('the greeting the account control draws is the app’s account.greeting, signed in only', () => {
    const declaration: PwappAccountDeclaration = { placement: 'navbar' }
    const signedIn = buildAccountProp({ declaration, user: { email: 'a@x' }, entry: 'home', toHref: hashHref })
    expect(signedIn.greetingLabel).toBe('Welcome, a@x')
    const out = buildAccountProp({ declaration, user: null, entry: 'home', toHref: hashHref })
    expect(out).not.toHaveProperty('greetingLabel')
  })
})

function fakeBridge(session?: AuthSession): AuthBridge {
  return {
    session,
    lastError: undefined,
    init: vi.fn(),
    loginWithPkce: vi.fn(),
    logout: vi.fn(),
    getAccessToken: vi.fn(),
    getDoorToken: vi.fn(),
    subscribe: () => () => {},
  } as unknown as AuthBridge
}

const PROJECT: PwappProject = { entrySurfaceId: 'home', surfaceOrder: ['home'] }

describe('createAccountController — sign-out', () => {
  it('clears the platform session, the bridge and the data cache, then re-gates and re-renders', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    const bridge = fakeBridge(issuer({ id: 'u' }))
    const order: string[] = []
    const deps = {
      project: PROJECT,
      auth: { provider: 'password', logoutUrl: 'https://api/x/logout' } as PwappAuth,
      bridge,
      getAppSession: () => ({ token: 'tok', expiresAt: '' }),
      clearAppSession: vi.fn(() => order.push('session')),
      clearCaches: vi.fn(() => order.push('caches')),
      regate: vi.fn(() => order.push('regate')),
      rerender: vi.fn(() => order.push('rerender')),
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    const controller = createAccountController(deps)
    await controller.signOut()

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api/x/logout',
      expect.objectContaining({ method: 'POST', headers: { 'x-app-session': 'tok' } })
    )
    // And the gateway's HttpOnly cookie, which only the gateway can delete.
    expect(fetchMock).toHaveBeenCalledWith(
      '/_auth/logout',
      expect.objectContaining({ method: 'POST', credentials: 'same-origin' })
    )
    expect(bridge.logout).toHaveBeenCalled()
    expect(deps.clearAppSession).toHaveBeenCalled()
    expect(deps.clearCaches).toHaveBeenCalled()
    // The caches are gone BEFORE anything is drawn again — a re-render must
    // never show the previous visitor's rows.
    expect(order).toEqual(['session', 'caches', 'regate', 'rerender'])
  })

  it('a network failure on revoke still signs the visitor out locally', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    const deps = {
      project: PROJECT,
      auth: { provider: 'password', logoutUrl: 'https://api/x/logout' } as PwappAuth,
      bridge: null,
      getAppSession: () => ({ token: 'tok', expiresAt: '' }),
      clearAppSession: vi.fn(),
      clearCaches: vi.fn(),
      regate: vi.fn(),
      rerender: vi.fn(),
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    await createAccountController(deps).signOut()
    expect(deps.clearAppSession).toHaveBeenCalled()
    expect(deps.rerender).toHaveBeenCalled()
  })

  it('a second click while signing out is ignored', async () => {
    // Sign-out asks two places (the door and the gateway); hold both.
    const pending: (() => void)[] = []
    const release = (): void => pending.forEach((r) => r())
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((r) => pending.push(() => r({ ok: true }))))
    )
    const deps = {
      project: PROJECT,
      auth: { provider: 'password', logoutUrl: 'https://api/x/logout' } as PwappAuth,
      bridge: null,
      getAppSession: () => ({ token: 'tok', expiresAt: '' }),
      clearAppSession: vi.fn(),
      clearCaches: vi.fn(),
      regate: vi.fn(),
      rerender: vi.fn(),
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    const controller = createAccountController(deps)
    const first = controller.signOut()
    const second = controller.signOut()
    release()
    await Promise.all([first, second])
    expect(deps.rerender).toHaveBeenCalledTimes(1)
  })
})

describe('createAccountController — sign-in', () => {
  const base = {
    project: PROJECT,
    getAppSession: () => null,
    clearAppSession: vi.fn(),
    clearCaches: vi.fn(),
    regate: vi.fn(),
    rerender: vi.fn(),
  }
  const google = { method: 'google' as const }

  it('one provider and no password door: straight to the provider', () => {
    const deps = {
      ...base,
      bridge: null,
      auth: { provider: 'password', providers: [google] } as PwappAuth,
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    createAccountController(deps).signIn()
    expect(deps.startProvider).toHaveBeenCalledWith('google')
    expect(deps.openSignIn).not.toHaveBeenCalled()
  })

  it('an issuer bridge with no platform door: straight to the issuer', () => {
    const bridge = fakeBridge()
    const deps = {
      ...base,
      bridge,
      auth: { provider: 'oauth2-pkce', issuer: 'https://i', clientId: 'c', scopes: [] } as PwappAuth,
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    createAccountController(deps).signIn()
    expect(bridge.loginWithPkce).toHaveBeenCalled()
    expect(deps.openSignIn).not.toHaveBeenCalled()
  })

  it('a password door (with or without providers) opens the gate', () => {
    const deps = {
      ...base,
      bridge: null,
      auth: { provider: 'password', loginUrl: 'https://api/x/login', providers: [google] } as PwappAuth,
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    createAccountController(deps).signIn()
    expect(deps.openSignIn).toHaveBeenCalledWith('login')
    expect(deps.startProvider).not.toHaveBeenCalled()
  })

  it('several providers and no password door: the gate lets the visitor choose', () => {
    const deps = {
      ...base,
      bridge: null,
      auth: { provider: 'password', providers: [google, { method: 'github' }] } as PwappAuth,
      openSignIn: vi.fn(),
      startProvider: vi.fn(),
      onSignedIn: vi.fn(),
      onFailed: vi.fn(),
    }
    createAccountController(deps).signIn()
    expect(deps.openSignIn).toHaveBeenCalled()
  })
})

describe('createAccountController — the auth:* actions any block fires', () => {
  const PASSWORD = { provider: 'password', loginUrl: 'https://api/x/login', registerUrl: 'https://api/x/register', registration: 'open' } as PwappAuth
  const make = (auth: PwappAuth, bridge: AuthBridge | null = null) => ({
    project: PROJECT,
    auth,
    bridge,
    getAppSession: () => null,
    clearAppSession: vi.fn(),
    clearCaches: vi.fn(),
    regate: vi.fn(),
    rerender: vi.fn(),
    openSignIn: vi.fn(),
    startProvider: vi.fn(),
    onSignedIn: vi.fn(),
    onFailed: vi.fn(),
  })

  it('a form submit carries the credentials: the password door is asked, and the session handed on', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: { token: 't', expiresAt: '', principal: { id: 'u', email: 'a@b.c' } } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const deps = make(PASSWORD)
    createAccountController(deps).perform({ type: 'auth:signIn' }, { email: ' a@b.c ', password: 'pw' })
    await vi.waitFor(() => expect(deps.onSignedIn).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('https://api/x/login', expect.objectContaining({ method: 'POST', body: JSON.stringify({ email: 'a@b.c', password: 'pw' }) }))
    expect(deps.onSignedIn).toHaveBeenCalledWith({ token: 't', expiresAt: '', principal: { id: 'u', email: 'a@b.c' } })
    expect(deps.openSignIn).not.toHaveBeenCalled()
  })

  it('a refused password is a code, not a sentence', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'Wrong.' } }) })))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = make(PASSWORD)
    createAccountController(deps).perform({ type: 'auth:signIn', method: 'password' }, { email: 'a@b.c', password: 'x' })
    await vi.waitFor(() => expect(deps.onFailed).toHaveBeenCalledWith('refused'))
    expect(deps.onSignedIn).not.toHaveBeenCalled()
  })

  it('register posts to the register door with the name; an existing account is `exists`', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: {} }) }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const deps = make(PASSWORD)
    createAccountController(deps).perform({ type: 'auth:register' }, { email: 'a@b.c', password: 'x', name: 'Ada' })
    await vi.waitFor(() => expect(deps.onFailed).toHaveBeenCalledWith('exists'))
    expect(fetchMock).toHaveBeenCalledWith('https://api/x/register', expect.objectContaining({ body: JSON.stringify({ email: 'a@b.c', password: 'x', displayName: 'Ada' }) }))
  })

  it('a click carries nothing to send: show where to sign in, or register', () => {
    const deps = make(PASSWORD)
    const c = createAccountController(deps)
    c.perform({ type: 'auth:signIn', method: 'password' })
    c.perform({ type: 'auth:register' })
    expect(deps.openSignIn.mock.calls).toEqual([['login'], ['register']])
  })

  it('a method names the way in: a provider, the issuer — or one the app does not offer', () => {
    const bridge = fakeBridge()
    const deps = make({ ...PASSWORD, providers: [{ method: 'google' }] } as PwappAuth, bridge)
    const c = createAccountController(deps)
    c.perform({ type: 'auth:signIn', method: 'google' })
    c.perform({ type: 'auth:signIn', method: 'issuer' })
    c.perform({ type: 'auth:signIn', method: 'github' })
    expect(deps.startProvider).toHaveBeenCalledWith('google')
    expect(bridge.loginWithPkce).toHaveBeenCalled()
    expect(deps.onFailed).toHaveBeenCalledWith('unavailable')
  })

  it('an invite-only door registers with the invitation the form carries, and without one does not', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ data: { token: 't', expiresAt: '' } }) }))
    vi.stubGlobal('fetch', fetchMock)
    const deps = make({ ...PASSWORD, registration: 'invite' } as PwappAuth)
    const c = createAccountController(deps)
    c.perform({ type: 'auth:register' }, { email: 'a@b.c', password: 'x' })
    expect(deps.onFailed).toHaveBeenCalledWith('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
    c.perform({ type: 'auth:register' }, { email: 'a@b.c', password: 'x', invitation: 'tok' })
    await vi.waitFor(() => expect(deps.onSignedIn).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('https://api/x/register', expect.objectContaining({ body: JSON.stringify({ email: 'a@b.c', password: 'x', invitation: 'tok' }) }))
  })

  it('a closed door takes no registration, whatever the form sends', () => {
    const deps = make({ ...PASSWORD, registration: 'closed' } as PwappAuth)
    createAccountController(deps).perform({ type: 'auth:register' }, { email: 'a@b.c', password: 'x', invitation: 'tok' })
    expect(deps.onFailed).toHaveBeenCalledWith('unavailable')
  })

  it('register on a door that takes no new accounts is `unavailable`', () => {
    const deps = make({ provider: 'password', loginUrl: 'https://api/x/login' } as PwappAuth)
    createAccountController(deps).perform({ type: 'auth:register' }, { email: 'a@b.c', password: 'x' })
    expect(deps.onFailed).toHaveBeenCalledWith('unavailable')
  })

  it('an app with no door does nothing at all', () => {
    const deps = make(null as unknown as PwappAuth)
    const c = createAccountController(deps)
    c.perform({ type: 'auth:signIn' }, { email: 'a@b.c', password: 'x' })
    c.perform({ type: 'auth:register' })
    expect(deps.openSignIn).not.toHaveBeenCalled()
    expect(deps.onFailed).not.toHaveBeenCalled()
  })

  it('auth:signOut signs out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })))
    const deps = make(PASSWORD)
    createAccountController(deps).perform({ type: 'auth:signOut' })
    await vi.waitFor(() => expect(deps.rerender).toHaveBeenCalled())
  })
})

describe('withProfile — the platform session learns who it is, once', () => {
  it('returns the session untouched when it already carries a profile', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const session = { token: 't', expiresAt: '', principal: { id: 'p', email: 'a@x' } }
    expect(await withProfile(session, 'https://api/x/session')).toBe(session)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches GET sessionUrl with the session header and merges the principal', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { principal: { id: 'p', email: 'a@x', displayName: 'Ayşe' } } }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await withProfile({ token: 't', expiresAt: 'z' }, 'https://api/x/session')
    expect(fetchMock).toHaveBeenCalledWith('https://api/x/session', { headers: { 'x-app-session': 't' } })
    expect(out).toEqual({ token: 't', expiresAt: 'z', principal: { id: 'p', email: 'a@x', displayName: 'Ayşe' } })
  })

  it('a failed lookup keeps the session as it was', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })))
    const session = { token: 't', expiresAt: '' }
    expect(await withProfile(session, 'https://api/x/session')).toBe(session)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    expect(await withProfile(session, 'https://api/x/session')).toBe(session)
    expect(await withProfile(session, undefined)).toBe(session)
  })
})

// ── AN APP WITH NO DOOR ────────────────────────────────────────────────
//
// A world without the identity pack builds apps with no `auth.json`. Their
// shell may still declare `navigation.account`; drawing it signed out offered a
// "Sign in" button that opened onto "no provider is configured".

describe('hasDoor — any way in at all', () => {
  const google = { method: 'google' as const }

  it('no auth.json is no door', () => {
    expect(hasDoor({ project: PROJECT, auth: null, bridge: null })).toBe(false)
    expect(hasDoor({ project: PROJECT, auth: undefined, bridge: null })).toBe(false)
  })

  it('an auth.json that names no usable door is no door either', () => {
    // An issuer the runner could not build a bridge for, no loginUrl, no buttons.
    const auth = { provider: 'saml', issuer: 'https://i', clientId: '', scopes: [] } as PwappAuth
    expect(hasDoor({ project: PROJECT, auth, bridge: null })).toBe(false)
  })

  it('the platform password door is a door — but not for an external-topology app', () => {
    const auth = { provider: 'password', loginUrl: 'https://api/x/login' } as PwappAuth
    expect(hasDoor({ project: PROJECT, auth, bridge: null })).toBe(true)
    const external: PwappProject = { ...PROJECT, identity: { required: false, topology: 'external' } }
    expect(hasDoor({ project: external, auth, bridge: null })).toBe(false)
  })

  it('provider buttons are a door', () => {
    const auth = { provider: 'password', providers: [google] } as PwappAuth
    expect(hasDoor({ project: PROJECT, auth, bridge: null })).toBe(true)
  })

  it('an issuer bridge is a door', () => {
    const auth = { provider: 'oauth2-pkce', issuer: 'https://i', clientId: 'c', scopes: [] } as PwappAuth
    expect(hasDoor({ project: PROJECT, auth, bridge: fakeBridge() })).toBe(true)
  })
})

describe('applyAccountControl — the slot is drawn only where there is a door', () => {
  const account: PwappAccountDeclaration = { placement: 'navbar', profileHref: '/profile/' }
  const page = (): SurfaceBlockNode[] => [{ id: 'n', type: 'navbar', props: { links: [] } }]
  const common = { entry: 'home', toHref: hashHref }

  it('no door + account declared + signed out: no account prop, so no "Sign in"', () => {
    const out = applyAccountControl(page(), { ...common, declaration: account, door: false, user: null })
    expect(out[0]?.props).not.toHaveProperty('account')
    expect(out).toEqual(page())
  })

  it('no door + account declared + a stale visitor: no control, and the page as the app wrote it', () => {
    const tree: SurfaceBlockNode[] = [
      { id: 'n', type: 'navbar', props: { rightInfo: [{ value: 'Welcome, guest' }] } },
    ]
    const out = applyAccountControl(tree, {
      ...common,
      declaration: account,
      door: false,
      user: { name: 'Ada' },
    })
    expect(out).toEqual(tree)
  })

  it('a door + account declared + signed out: the "Sign in" control is still drawn', () => {
    const out = applyAccountControl(page(), { ...common, declaration: account, door: true, user: null })
    const prop = out[0]?.props?.['account'] as { state: string; signInLabel: string }
    expect(prop.state).toBe('signed-out')
    expect(prop.signInLabel).toBe('Sign in')
  })

  it('a door + signed in: exactly what buildAccountProp + applyAccountToSurface produce', () => {
    const user = { name: 'Ada', email: 'ada@x' }
    const out = applyAccountControl(page(), { ...common, declaration: account, door: true, user })
    const expected = applyAccountToSurface(
      page(),
      buildAccountProp({ declaration: account, user, ...common }),
      'navbar'
    )
    expect(out).toEqual(expected)
  })

  it('no slot declared: the page as the app wrote it, door or not', () => {
    const out = applyAccountControl(page(), {
      ...common,
      declaration: undefined,
      door: true,
      user: { name: 'Ada' },
    })
    expect(out).toEqual(page())
  })
})

describe('createAccountController — sign-in with no door', () => {
  const deps = (auth: PwappAuth | null) => ({
    project: PROJECT,
    auth,
    bridge: null,
    getAppSession: () => null,
    clearAppSession: vi.fn(),
    clearCaches: vi.fn(),
    regate: vi.fn(),
    rerender: vi.fn(),
    openGate: vi.fn(),
    startProvider: vi.fn(),
  })

  it('no auth.json: signIn does nothing — no "no provider" dialog', () => {
    const d = deps(null)
    createAccountController(d).signIn()
    expect(d.openGate).not.toHaveBeenCalled()
    expect(d.startProvider).not.toHaveBeenCalled()
  })

  it('an auth.json with no usable door: signIn does nothing either', () => {
    const d = deps({ provider: 'saml', issuer: 'https://i', clientId: '', scopes: [] } as PwappAuth)
    createAccountController(d).signIn()
    expect(d.openGate).not.toHaveBeenCalled()
  })
})
