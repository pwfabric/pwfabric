import { describe, expect, it } from 'vitest'
import {
  FIRST_FRAME_USER,
  firstFrameAuthState,
  firstFrameDoorOf,
  firstFrameLocale,
  firstFrameOptions,
  pageSurfaceOf,
} from './first-frame.js'
import { addressStateKeys, queryStateSeed } from './helpers.js'
import { runnerMessages } from './messages.js'
import type { PwappProject, SurfaceReceipt } from './types.js'

const project = (over: Partial<PwappProject> = {}): PwappProject =>
  ({ id: 'app', surfaceOrder: ['home', 'dish'], entrySurfaceId: 'home', ...over }) as PwappProject

const receipt: SurfaceReceipt = {
  blocks: [
    { id: 'nav', type: 'navbar', props: { brand: 'Cafe' } },
    { id: 'go', type: 'link', props: { href: 'dish', label: '{{state.id}}' } },
  ],
  capabilities: [
    {
      capability: 'platform/persistence',
      config: { initialState: { tab: 'all' }, urlState: ['tab'], successRedirect: 'home' },
    },
  ],
} as unknown as SurfaceReceipt

const ctx = (user = FIRST_FRAME_USER) => ({
  entry: 'home',
  toHref: (k: string) => `#/${k}`,
  navigation: { navbar: { links: [{ label: 'Dish', href: 'dish' }] } },
  door: false,
  user,
  messages: runnerMessages(undefined),
})

describe('the first frame (pwapp-format §2.5)', () => {
  it('is the page as the runner draws it with nothing read from the address', () => {
    const first = pageSurfaceOf(receipt, 'home', new URLSearchParams(), ctx())
    // Hrefs in the router's form, the capabilities carried with their links rewritten.
    expect(JSON.stringify(first.blocks)).toContain('"#/dish"')
    const config = (first.capabilities[0] as { config: Record<string, unknown> }).config
    expect(config['initialState']).toEqual({ tab: 'all' })
    expect(config['successRedirect']).toBe('#/home')
  })

  it('an address that seeds the page gives a different surface — that visit is not the build’s first frame', () => {
    const seeded = pageSurfaceOf(receipt, 'home', new URLSearchParams('tab=new&id=3'), ctx())
    const config = (seeded.capabilities[0] as { config: Record<string, unknown> }).config
    expect(config['initialState']).toEqual({ tab: 'new', id: '3' })
    // What the shell's first-paint script checks: a key of this list in the query.
    expect(addressStateKeys(receipt).sort()).toEqual(['id', 'tab'])
    expect(Object.keys(queryStateSeed(receipt, new URLSearchParams('utm_source=x')))).toEqual([])
  })

  it('nobody is signed in, nothing is reported, and who the visitor is is not known yet (E-6)', () => {
    expect(firstFrameAuthState({ door: true, methods: ['password'], registration: 'open' })).toEqual({
      signedIn: false,
      user: null,
      methods: ['password'],
      registration: 'open',
      error: null,
      pending: true,
    })
    // An app with no way in has nobody to wait for.
    expect(firstFrameAuthState({ door: false, methods: [], registration: 'closed' })).not.toHaveProperty('pending')
    expect(FIRST_FRAME_USER).toBeNull()
  })

  it('the door is the app’s declaration (project.json identity), never the deployment’s auth.json', () => {
    // conference-companion: a password door the build has no auth.json for.
    const declared = project({ identity: { required: false, topology: 'app', methods: ['google', 'password'], registration: 'closed', door: false } })
    expect(firstFrameDoorOf(declared)).toEqual({ door: true, methods: ['password', 'google'], registration: 'closed' })
    expect(firstFrameDoorOf(project({ identity: { required: true, topology: 'external' } }))).toEqual({
      door: true,
      methods: ['issuer'],
      registration: 'closed',
    })
    // Declared entry with no way in, and no identity at all.
    expect(firstFrameDoorOf(project({ identity: { required: false, topology: 'app', methods: [] } }))).toEqual({
      door: false,
      methods: [],
      registration: 'open',
    })
    expect(firstFrameDoorOf(project())).toEqual({ door: false, methods: [], registration: 'open' })
  })

  it('is written in the app’s locale, and in English when it names none (never the build machine’s)', () => {
    expect(firstFrameLocale(project({ locale: 'tr-TR' } as Partial<PwappProject>))).toBe('tr-TR')
    expect(firstFrameLocale(project())).toBe('en')
    // The visit's options keep the app's own (absent: the visitor's).
    const opts = firstFrameOptions({ project: project(), appearanceRef: undefined, receipt, entry: 'home', toHref: (k) => `#/${k}` })
    expect(opts['locale']).toBeUndefined()
    expect(opts['loadingStrategy']).toBe('immediate')
  })
})
