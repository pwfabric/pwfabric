import { describe, expect, it } from 'vitest'
import { consentStorageKey, createConsent, scriptsOf } from './consent.js'

/** A page to load scripts into, and a storage, both observable. */
function page(stored?: string) {
  const added: { src: string; async?: boolean; integrity?: string; crossOrigin?: string }[] = []
  const events: unknown[] = []
  const store = new Map<string, string>(stored === undefined ? [] : [[consentStorageKey('cafe'), stored]])
  class FakeEvent {
    constructor(
      readonly type: string,
      readonly init: { detail: unknown }
    ) {}
  }
  const win = {
    CustomEvent: FakeEvent as unknown as typeof CustomEvent,
    dispatchEvent: (e: Event) => {
      events.push({ type: (e as unknown as FakeEvent).type, detail: (e as unknown as FakeEvent).init.detail })
      return true
    },
  }
  const doc = {
    createElement: () => ({}) as HTMLScriptElement,
    head: { appendChild: (el: Node) => added.push(el as unknown as { src: string }) },
  }
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
  return { added, events, store, win, doc, storage }
}

const scripts = [
  { key: 'visits', src: 'https://cdn.example.com/v.js', consent: 'analytics' },
  { key: 'chat', src: 'https://chat.example.com/c.js', integrity: 'sha384-abc', consent: 'support' },
  { key: 'more', src: 'https://cdn.example.com/m.js', consent: 'analytics' },
]

describe('createConsent', () => {
  it('names each category once, in declaration order, and has no answers by default', () => {
    const p = page()
    const c = createConsent({ appId: 'cafe', scripts, storage: p.storage, win: p.win, doc: p.doc })
    expect(c.categories).toEqual(['analytics', 'support'])
    expect(c.answers()).toEqual({})
    c.start()
    expect(p.added).toEqual([])
    expect(p.events).toEqual([])
  })

  it('loads nothing before start, then every script of a consented category, once', () => {
    const p = page()
    const c = createConsent({ appId: 'cafe', scripts, storage: p.storage, win: p.win, doc: p.doc })
    c.set({ analytics: true })
    expect(p.added).toEqual([])
    c.start()
    expect(p.added.map((s) => s.src)).toEqual(['https://cdn.example.com/v.js', 'https://cdn.example.com/m.js'])
    expect(p.added[0]?.async).toBe(true)
    c.set({ support: true })
    c.set({ analytics: true, support: true })
    expect(p.added.map((s) => s.src)).toEqual(['https://cdn.example.com/v.js', 'https://cdn.example.com/m.js', 'https://chat.example.com/c.js'])
    expect(p.added[2]).toMatchObject({ integrity: 'sha384-abc', crossOrigin: 'anonymous' })
  })

  it('stores the answers, merged, ignores an unknown category, and announces each change', () => {
    const p = page()
    const c = createConsent({ appId: 'cafe', scripts, storage: p.storage, win: p.win, doc: p.doc })
    let changes = 0
    c.subscribe(() => changes++)
    c.set({ analytics: false, ads: true })
    c.set({ support: true })
    expect(c.answers()).toEqual({ analytics: false, support: true })
    expect(JSON.parse(p.store.get('pwapp_consent:cafe') as string)).toEqual({ analytics: false, support: true })
    expect(changes).toBe(2)
    expect(p.events).toEqual([
      { type: 'pw:consent', detail: { analytics: false } },
      { type: 'pw:consent', detail: { analytics: false, support: true } },
    ])
  })

  it('reads stored answers back, announces them once at start and loads what they consent to', () => {
    const p = page(JSON.stringify({ support: true, analytics: false, ads: true }))
    const c = createConsent({ appId: 'cafe', scripts, storage: p.storage, win: p.win, doc: p.doc })
    expect(c.answers()).toEqual({ support: true, analytics: false })
    c.start()
    c.start()
    expect(p.events).toEqual([{ type: 'pw:consent', detail: { support: true, analytics: false } }])
    expect(p.added.map((s) => s.src)).toEqual(['https://chat.example.com/c.js'])
  })

  it('is not stopped by storage that cannot be read or written, or a corrupt entry', () => {
    const p = page('{not json')
    const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
    const c = createConsent({ appId: 'cafe', scripts, storage: broken, win: p.win, doc: p.doc })
    c.start()
    c.set({ analytics: true })
    expect(c.answers()).toEqual({ analytics: true })
    expect(p.added).toHaveLength(2)
    expect(createConsent({ appId: 'cafe', scripts, storage: p.storage, win: p.win, doc: p.doc }).answers()).toEqual({})
  })
})

describe('scriptsOf', () => {
  it('keeps only scripts with a key, an https src and a category', () => {
    expect(
      scriptsOf([
        scripts[0],
        { key: 'x', src: 'http://cdn.example.com/x.js', consent: 'a' },
        { key: 'y', src: 'javascript:alert(1)', consent: 'a' },
        { key: 'z', src: 'https://cdn.example.com/z.js' },
        'nope',
      ])
    ).toEqual([scripts[0]])
  })
})
