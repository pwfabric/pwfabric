/**
 * The router of an app in several languages (envelope §3): the first segment
 * selects the locale, the rest is read against that locale's row of the
 * address table, and a link written by page key is written as that page's
 * address in the locale drawn.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addressTable } from '@pwfabric/contracts/app-locales'
import { createRouter } from './router.js'

const PAGES = ['home', 'pricing']
const declaration = { locales: ['en', 'de'], defaultLocale: 'en' }
const { addresses } = addressTable(declaration, PAGES, 'home', (k) => (k === 'pricing' ? { de: 'preise' } : undefined))
const locales = { declaration, addresses }

const added: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []
function track(): void {
  for (const target of [window, document] as EventTarget[]) {
    const real = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
      if (listener) added.push([target, type, listener])
      real(type, listener, options)
    })
  }
}
afterEach(() => {
  for (const [t, type, l] of added.splice(0)) t.removeEventListener(type, l)
  vi.restoreAllMocks()
  history.replaceState(null, '', '/')
})

function click(href: string): void {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  document.body.appendChild(a)
  // After the router's own listener on the document: jsdom navigates nowhere.
  const stop = (e: Event): void => e.preventDefault()
  window.addEventListener('click', stop)
  a.click()
  window.removeEventListener('click', stop)
  a.remove()
}

describe('path routing with locales', () => {
  it('reads the locale and the page off the address', () => {
    history.replaceState(null, '', '/de/preise/')
    const router = createRouter('path', PAGES, 'home', { basePath: '/', locales })
    expect(router.current()).toBe('pricing')
    expect(router.locale()).toBe('de')
    history.replaceState(null, '', '/de/')
    expect(router.current()).toBe('home')
    history.replaceState(null, '', '/pricing')
    expect(router.current()).toBe('pricing')
    expect(router.locale()).toBe('en')
    history.replaceState(null, '', '/de/pricing/')
    expect(router.current()).toBeNull()
    expect(router.locale()).toBe('de')
  })

  it('writes a page key as its address in the locale drawn, and keeps an address of the table', () => {
    history.replaceState(null, '', '/shop/de/')
    const router = createRouter('path', PAGES, 'home', { basePath: '/shop/', locales })
    router.current()
    expect(router.toHref('pricing')).toBe('/shop/de/preise/')
    expect(router.toHref('home')).toBe('/shop/de/')
    expect(router.toHref('pricing/')).toBe('/shop/pricing/')
    expect(router.hrefIn('en', 'pricing')).toBe('/shop/pricing/')
    expect(router.hrefIn('de', 'home')).toBe('/shop/de/')
  })

  it('routes a link to the same page in another locale as a new page, and a stray key in the locale drawn', () => {
    track()
    history.replaceState(null, '', '/de/preise/')
    const router = createRouter('path', PAGES, 'home', { basePath: '/', locales })
    router.current()
    const onChange = vi.fn()
    router.start(onChange)
    click('/pricing/')
    expect(location.pathname).toBe('/pricing/')
    expect(onChange).toHaveBeenCalled()
    router.current()
    history.replaceState(null, '', '/de/')
    router.current()
    click('/pricing')
    expect(location.pathname).toBe('/pricing')
  })
})

describe('hash routing with locales', () => {
  it('reads the locale from the route and writes addresses as routes', () => {
    history.replaceState(null, '', '/#/de/preise')
    const router = createRouter('hash', PAGES, 'home', { locales })
    expect(router.current()).toBe('pricing')
    expect(router.locale()).toBe('de')
    expect(router.toHref('home')).toBe('#/de')
    expect(router.hrefIn('en', 'home')).toBe('#/')
    expect(router.hrefIn('en', 'pricing')).toBe('#/pricing')
    history.replaceState(null, '', '/#/')
    expect(router.current()).toBe('home')
    expect(router.locale()).toBe('en')
  })

  it('opens the entry at its key in every locale, as a single-language app does', () => {
    history.replaceState(null, '', '/#/home')
    const router = createRouter('hash', PAGES, 'home', { locales })
    expect(router.current()).toBe('home')
    expect(router.locale()).toBe('en')
    history.replaceState(null, '', '/#/de/home')
    expect(router.current()).toBe('home')
    expect(router.locale()).toBe('de')
    // Only the entry: another page is at its address.
    history.replaceState(null, '', '/#/de/pricing')
    expect(router.current()).toBeNull()
  })

  it('writes the query onto the localized route', () => {
    history.replaceState(null, '', '/#/de/preise')
    const router = createRouter('hash', PAGES, 'home', { locales })
    router.current()
    router.writeQuery('x=1', 'replace')
    expect(location.hash).toBe('#/de/preise?x=1')
  })
})

describe('a single-language router', () => {
  it('has no locale and writes keys as before', () => {
    history.replaceState(null, '', '/#/pricing')
    const router = createRouter('hash', PAGES, 'home')
    expect(router.current()).toBe('pricing')
    expect(router.locale()).toBeUndefined()
    expect(router.toHref('home')).toBe('#/home')
  })
})
