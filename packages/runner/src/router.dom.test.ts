/**
 * Router — the browser half: mode resolution, anchor scrolling and the
 * `start()` listeners (hashchange, popstate, link interception).
 *
 * `router.test.ts` covers the pure location math under node. These tests run
 * the same router against jsdom's real `location`, `history` and events, so
 * each defect the module comments describe has a test that would catch it
 * coming back.
 *
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, resolveRouterMode, type RouteChange } from './router.js'

const PAGES = ['home', 'people', 'product']

// ============================================================
// HARNESS
// ============================================================

/**
 * `start()` never removes its listeners (the app lives as long as the page),
 * so a router started in one test would keep reacting in the next. Record
 * every listener added during a test and remove it afterwards.
 */
const added: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []
const realWindowAdd = window.addEventListener.bind(window)
const realDocumentAdd = document.addEventListener.bind(document)

let scrollTo: ReturnType<typeof vi.fn>
let scrolledInto: Element[]

/** What the click did, read after every listener ran. */
let lastClickPrevented: boolean | null

function stopDefaultNavigation(ev: Event): void {
  lastClickPrevented = ev.defaultPrevented
  // jsdom implements no document navigation; keep it from trying.
  ev.preventDefault()
}

beforeEach(() => {
  vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) added.push([window, type, listener])
    realWindowAdd(type, listener, options)
  })
  vi.spyOn(document, 'addEventListener').mockImplementation((type, listener, options) => {
    if (listener) added.push([document, type, listener])
    realDocumentAdd(type, listener, options)
  })
  scrollTo = vi.fn()
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  scrolledInto = []
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledInto.push(this)
  }
  lastClickPrevented = null
  // Window listeners run after document listeners in the bubble phase, so
  // this sees the router's decision.
  realWindowAdd('click', stopDefaultNavigation)
})

afterEach(() => {
  // An anchor watch outlives its test by up to three seconds; reader input
  // ends every open one, before their listeners are removed below.
  window.dispatchEvent(new Event('wheel'))
  for (const [target, type, listener] of added.splice(0)) target.removeEventListener(type, listener)
  window.removeEventListener('click', stopDefaultNavigation)
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  history.replaceState(null, '', '/')
})

function goTo(url: string): void {
  history.replaceState(null, '', url)
}

function fireHashChange(hash: string): void {
  history.replaceState(null, '', hash)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function link(href: string, attrs: Record<string, string> = {}): HTMLAnchorElement {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v)
  document.body.appendChild(a)
  return a
}

function click(el: Element, init: MouseEventInit = {}): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init }))
}

function section(id: string): HTMLElement {
  const el = document.createElement('section')
  el.id = id
  document.body.appendChild(el)
  return el
}

/** Let MutationObserver callbacks run. */
const flush = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve))

// ============================================================
// MODE RESOLUTION
// ============================================================

describe('resolveRouterMode', () => {
  it('an explicit mode is taken as asked', () => {
    expect(resolveRouterMode('hash')).toBe('hash')
    expect(resolveRouterMode('path')).toBe('path')
  })

  it('auto stays on hash unless the server declares SPA fallback', () => {
    expect(resolveRouterMode('auto')).toBe('hash')
  })

  it('auto becomes path when <meta name="pw-router" content="path"> is present', () => {
    document.head.innerHTML = '<meta name="pw-router" content="path">'
    expect(resolveRouterMode('auto')).toBe('path')
  })

  it('a meta naming anything else keeps hash', () => {
    document.head.innerHTML = '<meta name="pw-router" content="hash">'
    expect(resolveRouterMode('auto')).toBe('hash')
  })

  it('without a usable pushState, the declaration is not enough', () => {
    document.head.innerHTML = '<meta name="pw-router" content="path">'
    vi.stubGlobal('history', { pushState: undefined })
    expect(resolveRouterMode('auto')).toBe('hash')
  })
})

// ============================================================
// ANCHOR SCROLLING
// ============================================================

describe('applyScroll — hash mode', () => {
  it('a route with no anchor goes to the top', () => {
    goTo('/index.html#/people')
    createRouter('hash', PAGES, 'home').applyScroll()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('the anchor of a compound #/route#anchor is scrolled into view', () => {
    const target = section('team')
    goTo('/index.html#/people#team')
    createRouter('hash', PAGES, 'home').applyScroll()
    expect(scrolledInto).toContain(target)
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('a percent-encoded anchor finds the element authored with the decoded id', () => {
    const target = section('üst')
    goTo('/index.html#/people#%C3%BCst')
    createRouter('hash', PAGES, 'home').applyScroll()
    expect(scrolledInto).toContain(target)
  })

  it('a malformed escape finds nothing and does not throw', () => {
    goTo('/index.html#/people#%E0%A4%A')
    expect(() => createRouter('hash', PAGES, 'home').applyScroll()).not.toThrow()
    expect(scrolledInto).toHaveLength(0)
    // Never thrown to the top for an anchor it could not find.
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('an element that appears after the route resolves is still scrolled to', async () => {
    goTo('/index.html#/people#late')
    createRouter('hash', PAGES, 'home').applyScroll()
    expect(scrolledInto).toHaveLength(0)

    const target = section('late')
    await flush()
    expect(scrolledInto).toContain(target)
  })

  it('the anchor is re-honoured while content fills in above it', async () => {
    const target = section('team')
    goTo('/index.html#/people#team')
    createRouter('hash', PAGES, 'home').applyScroll()
    expect(scrolledInto).toHaveLength(1)

    document.body.prepend(document.createElement('div'))
    await flush()
    expect(scrolledInto).toEqual([target, target])
  })

  it.each(['wheel', 'touchstart', 'keydown'])('a reader who takes over (%s) ends the watch', async (type) => {
    goTo('/index.html#/people#late')
    createRouter('hash', PAGES, 'home').applyScroll()

    window.dispatchEvent(new Event(type))
    section('late')
    await flush()
    expect(scrolledInto).toHaveLength(0)
  })

  it('the watch ends after three seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    goTo('/index.html#/people#late')
    createRouter('hash', PAGES, 'home').applyScroll()

    vi.advanceTimersByTime(3000)
    section('late')
    await flush()
    expect(scrolledInto).toHaveLength(0)
  })

  it('without MutationObserver it makes the one attempt and stops', async () => {
    vi.stubGlobal('MutationObserver', undefined)
    goTo('/index.html#/people#late')
    createRouter('hash', PAGES, 'home').applyScroll()

    section('late')
    await flush()
    expect(scrolledInto).toHaveLength(0)
  })
})

describe('applyScroll — path mode', () => {
  it('the location fragment is the anchor', () => {
    const target = section('pricing')
    goTo('/product#pricing')
    createRouter('path', PAGES, 'home', { basePath: '/' }).applyScroll()
    expect(scrolledInto).toContain(target)
  })

  it('no fragment goes to the top', () => {
    goTo('/product')
    createRouter('path', PAGES, 'home', { basePath: '/' }).applyScroll()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })
})

// ============================================================
// HASH ROUTER — start()
// ============================================================

describe('hash router start()', () => {
  function started(hash: string) {
    goTo(`/index.html${hash}`)
    const router = createRouter('hash', PAGES, 'home')
    router.current()
    const onChange = vi.fn<(change?: RouteChange) => void>()
    router.start(onChange)
    return { router, onChange }
  }

  it('a route to another page re-renders', () => {
    const { onChange } = started('#/people')
    fireHashChange('#/product')
    expect(onChange).toHaveBeenCalledWith()
  })

  it('a bare in-page anchor set without a click scrolls, keeps the page and is written onto it', () => {
    // A `navigate` action's `location.assign('#contact')`, or a typed fragment:
    // the address said `#contact`, which names no page, so a reload or a shared
    // link opened the entry page.
    const target = section('contact')
    const { onChange } = started('#/people?tab=all')
    fireHashChange('#contact')
    expect(onChange).not.toHaveBeenCalled()
    expect(location.hash).toBe('#/people?tab=all#contact')
    expect(scrolledInto).toContain(target)
  })

  it('an in-page anchor link keeps the page and its query in the address', () => {
    const target = section('rsvp')
    const { onChange } = started('#/product?id=12')
    click(link('#rsvp'))
    expect(lastClickPrevented).toBe(true)
    expect(location.hash).toBe('#/product?id=12#rsvp')
    expect(onChange).not.toHaveBeenCalled()
    expect(scrolledInto).toContain(target)
  })

  it('the address an in-page anchor leaves reloads onto the same page at the anchor', () => {
    started('#/product?id=12')
    click(link('#rsvp'))
    // A reload: a fresh router reads the address the click left behind.
    const target = section('rsvp')
    const reloaded = createRouter('hash', PAGES, 'home')
    expect(reloaded.current()).toBe('product')
    expect(reloaded.query()).toBe('id=12')
    reloaded.applyScroll()
    expect(scrolledInto).toContain(target)
  })

  it('an in-page anchor link is one history entry, so Back returns to the page as it was', () => {
    started('#/product?id=12')
    const before = history.length
    click(link('#rsvp'))
    expect(history.length).toBe(before + 1)
  })

  it('a bare "#" link keeps the page and goes to the top', () => {
    const { onChange } = started('#/people')
    click(link('#'))
    expect(lastClickPrevented).toBe(true)
    expect(location.hash).toBe('#/people')
    expect(onChange).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('an in-page anchor on the not-found page keeps that address', () => {
    const { router } = started('#/services')
    expect(router.current()).toBeNull()
    click(link('#help'))
    expect(location.hash).toBe('#/services#help')
  })

  it('an in-page anchor after a compound anchor replaces the anchor, not the page', () => {
    started('#/people#team')
    click(link('#contact'))
    expect(location.hash).toBe('#/people#contact')
  })

  it('an in-page jump scrolls smoothly, and instantly when the reader asks for reduced motion', () => {
    section('rsvp')
    started('#/people')
    const behaviours: unknown[] = []
    Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
      behaviours.push(typeof arg === 'object' ? arg.behavior : undefined)
    }
    let reduce = false
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' && reduce }))
    click(link('#rsvp'))
    reduce = true
    click(link('#rsvp'))
    expect(behaviours).toEqual(['smooth', 'auto'])
  })

  it('a new query on the same page is reported as query-only', () => {
    const { onChange } = started('#/product?id=12')
    fireHashChange('#/product?id=13')
    expect(onChange).toHaveBeenCalledWith({ queryOnly: true })
  })

  it('a compound anchor on the same page scrolls instead of re-rendering', () => {
    const target = section('reviews')
    const { onChange } = started('#/product?id=12')
    fireHashChange('#/product?id=12#reviews')
    expect(onChange).not.toHaveBeenCalled()
    expect(scrolledInto).toContain(target)
  })

  it('a trailing slash names the same page', () => {
    const { onChange } = started('#/people')
    fireHashChange('#/people/')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a root-relative link to one of our pages becomes a hash route, query and fragment kept', () => {
    started('#/home')
    click(link('/people/?tab=all#top'))
    expect(lastClickPrevented).toBe(true)
    expect(location.hash).toBe('#/people?tab=all#top')
  })

  it('a link with target="_self" is still ours', () => {
    started('#/home')
    click(link('/people', { target: '_self' }))
    expect(location.hash).toBe('#/people')
  })

  it.each<[string, () => HTMLAnchorElement, MouseEventInit]>([
    ['a page this app does not have', () => link('/services'), {}],
    ['an absolute external address', () => link('https://example.com/people'), {}],
    ['a protocol-relative address', () => link('//cdn.example.com/people'), {}],
    ['a new-tab link', () => link('/people', { target: '_blank' }), {}],
    ['a middle click', () => link('/people'), { button: 1 }],
    ['a ctrl-click', () => link('/people'), { ctrlKey: true }],
    ['a meta-click', () => link('/people'), { metaKey: true }],
    ['a shift-click', () => link('/people'), { shiftKey: true }],
    ['an alt-click', () => link('/people'), { altKey: true }],
  ])('leaves %s to the browser', (_label, make, init) => {
    started('#/home')
    click(make(), init)
    expect(lastClickPrevented).toBe(false)
    expect(location.hash).toBe('#/home')
  })

  it('a click outside any link is ignored', () => {
    started('#/home')
    const span = document.createElement('span')
    document.body.appendChild(span)
    click(span)
    expect(lastClickPrevented).toBe(false)
  })

  it('a click something else already handled is ignored', () => {
    started('#/home')
    const a = link('/people')
    a.addEventListener('click', (ev) => ev.preventDefault())
    click(a)
    expect(location.hash).toBe('#/home')
  })
})

// ============================================================
// PATH ROUTER — start()
// ============================================================

describe('path router start()', () => {
  const BASE = '/apps/x'

  function started(path: string) {
    goTo(path)
    const router = createRouter('path', PAGES, 'home', { basePath: `${BASE}/` })
    router.current()
    const onChange = vi.fn<(change?: RouteChange) => void>()
    router.start(onChange)
    return { router, onChange }
  }

  it('back/forward re-renders', () => {
    const { onChange } = started(`${BASE}/people`)
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onChange).toHaveBeenCalledWith()
  })

  it('a link to another page under the base is pushed, not loaded', () => {
    const { onChange } = started(`${BASE}/people`)
    click(link(`${BASE}/product?id=1`))
    expect(lastClickPrevented).toBe(true)
    expect(location.pathname + location.search).toBe(`${BASE}/product?id=1`)
    expect(onChange).toHaveBeenCalledWith()
  })

  it('an unknown page under the base is pushed too, so it renders not-found in place', () => {
    const { onChange } = started(`${BASE}/people`)
    click(link(`${BASE}/services`))
    expect(location.pathname).toBe(`${BASE}/services`)
    expect(onChange).toHaveBeenCalledWith()
  })

  it('the same page with a new query is reported as query-only', () => {
    const { onChange } = started(`${BASE}/product?id=12`)
    click(link(`${BASE}/product?id=13`))
    expect(onChange).toHaveBeenCalledWith({ queryOnly: true })
  })

  it('an anchor on the page already shown scrolls and does not re-render', () => {
    const target = section('reviews')
    const { onChange } = started(`${BASE}/product`)
    click(link(`${BASE}/product#reviews`))
    expect(onChange).not.toHaveBeenCalled()
    expect(scrolledInto).toContain(target)
    expect(location.hash).toBe('#reviews')
  })

  it('the same page, same query, no anchor goes to the top', () => {
    const { onChange } = started(`${BASE}/product`)
    click(link(`${BASE}/product`))
    expect(onChange).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('a not-found page is never "the same surface"', () => {
    const { onChange } = started(`${BASE}/services`)
    click(link(`${BASE}/services`))
    expect(onChange).toHaveBeenCalledWith()
  })

  it('a root-relative link naming one of our pages is routed under the base', () => {
    const { onChange } = started(`${BASE}/home`)
    click(link('/people?tab=all'))
    expect(lastClickPrevented).toBe(true)
    expect(location.pathname + location.search).toBe(`${BASE}/people?tab=all`)
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('a stray link to the page already shown, with an anchor, only scrolls', () => {
    const target = section('top')
    const { onChange } = started(`${BASE}/people`)
    click(link('/people#top'))
    expect(onChange).not.toHaveBeenCalled()
    expect(scrolledInto).toContain(target)
  })

  it('a stray link to the page already shown, with a bare "#", goes to the top', () => {
    const { onChange } = started(`${BASE}/people`)
    click(link('/people#'))
    expect(onChange).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith(0, 0)
  })

  it('a stray link to the page already shown, with a new query, is query-only', () => {
    const { onChange } = started(`${BASE}/people`)
    click(link('/people?tab=all'))
    expect(onChange).toHaveBeenCalledWith({ queryOnly: true })
  })

  it('a path outside the base that names no page is the browser’s', () => {
    const { onChange } = started(`${BASE}/people`)
    click(link('/elsewhere'))
    expect(lastClickPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it.each<[string, () => HTMLAnchorElement, MouseEventInit]>([
    ['another origin', () => link('https://example.com/apps/x/people'), {}],
    ['a new-tab link', () => link(`${BASE}/people`, { target: '_blank' }), {}],
    ['a middle click', () => link(`${BASE}/people`), { button: 1 }],
    ['a ctrl-click', () => link(`${BASE}/people`), { ctrlKey: true }],
    ['a meta-click', () => link(`${BASE}/people`), { metaKey: true }],
    ['a shift-click', () => link(`${BASE}/people`), { shiftKey: true }],
    ['an alt-click', () => link(`${BASE}/people`), { altKey: true }],
  ])('leaves %s to the browser', (_label, make, init) => {
    const { onChange } = started(`${BASE}/home`)
    click(make(), init)
    expect(lastClickPrevented).toBe(false)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a click outside any link is ignored', () => {
    const { onChange } = started(`${BASE}/home`)
    const span = document.createElement('span')
    document.body.appendChild(span)
    click(span)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('a click something else already handled is ignored', () => {
    const { onChange } = started(`${BASE}/home`)
    const a = link(`${BASE}/people`)
    a.addEventListener('click', (ev) => ev.preventDefault())
    click(a)
    expect(onChange).not.toHaveBeenCalled()
    expect(location.pathname).toBe(`${BASE}/home`)
  })

  it('a bare #anchor link stays on the page shown, even though <base href> points at the app root', () => {
    // `#rsvp` resolves against `<base href="/apps/x/">` to the ENTRY page's
    // address, so following it as written left the page the reader was on.
    const base = document.createElement('base')
    base.href = `${BASE}/`
    document.head.appendChild(base)
    const target = section('rsvp')
    const { onChange } = started(`${BASE}/product?id=12`)
    click(link('#rsvp'))
    expect(lastClickPrevented).toBe(true)
    expect(location.pathname + location.search + location.hash).toBe(`${BASE}/product?id=12#rsvp`)
    expect(onChange).not.toHaveBeenCalled()
    expect(scrolledInto).toContain(target)
  })

  it('a link at the base itself is the entry page', () => {
    const { onChange } = started(`${BASE}/people`)
    click(link(`${BASE}/`))
    expect(location.pathname).toBe(`${BASE}/`)
    expect(onChange).toHaveBeenCalledWith()
  })
})
