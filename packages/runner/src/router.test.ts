import { afterEach, describe, expect, it } from 'vitest'
import { createRouter } from './router.js'

/**
 * `createRouter` reads `location` once at construction (base derivation) and
 * on `current()`. Node env has no location — stub the minimal shape. `start()`
 * (window listeners) stays untested here per the package's law: browser
 * orchestration is proven by the pwapp export self-test.
 */
const realLocation = (globalThis as { location?: Location }).location

function stubLocation(pathname: string, hash = ''): void {
  ;(globalThis as { location?: unknown }).location = {
    pathname,
    hash,
    href: `https://app.example${pathname}${hash}`,
  }
}

afterEach(() => {
  ;(globalThis as { location?: unknown }).location = realLocation
})

const PAGES = ['home', 'team-chat', 'people']

describe('path router base — the ONE stable PKCE redirect path per app', () => {
  it('at the origin root, base is "/"', () => {
    stubLocation('/')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    expect(router.base).toBe('/')
    expect(router.current()).toBe('home')
  })

  it('on a deep link, the declared base is unaffected by the page segment', () => {
    stubLocation('/team-chat')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    expect(router.base).toBe('/')
    expect(router.current()).toBe('team-chat')
  })

  it('under a sub-path deploy, base keeps the deploy prefix with a trailing slash', () => {
    stubLocation('/api/installed/world-1/proj-1/')
    const router = createRouter('path', PAGES, 'home', {
      basePath: '/api/installed/world-1/proj-1/',
    })
    expect(router.base).toBe('/api/installed/world-1/proj-1/')
    expect(router.current()).toBe('home')
  })

  it('sub-path deep link: page resolves, prefix kept', () => {
    stubLocation('/api/installed/world-1/proj-1/people')
    const router = createRouter('path', PAGES, 'home', {
      basePath: '/api/installed/world-1/proj-1/',
    })
    expect(router.base).toBe('/api/installed/world-1/proj-1/')
    expect(router.current()).toBe('people')
  })

  it('base is identical no matter which page login starts from', () => {
    const bases = ['/team-chat', '/people', '/'].map((p) => {
      stubLocation(p)
      return createRouter('path', PAGES, 'home', { basePath: '/' }).base
    })
    expect(new Set(bases).size).toBe(1)
  })

  it('without a declared base it still derives one from the location', () => {
    stubLocation('/api/installed/world-1/proj-1/people')
    const router = createRouter('path', PAGES, 'home')
    expect(router.base).toBe('/api/installed/world-1/proj-1/')
    expect(router.current()).toBe('people')
  })
})

/**
 * The arc's defect, locked in both modes: an address naming no page must be
 * REFUSED. Answering with the entry surface is what made twenty-one broken
 * links in a published app look like a working home page.
 */
describe('an unknown address is refused, not redirected to entry', () => {
  it('path mode: an unknown page under the base resolves to null', () => {
    stubLocation('/services')
    const router = createRouter('path', PAGES, 'home', { basePath: '/' })
    expect(router.current()).toBeNull()
  })

  it('path mode: a DECLARED base is what makes an unknown deep link falsifiable', () => {
    // Derived-from-location, the unknown segment becomes "the base" and the
    // router concludes the location IS the base — i.e. entry. This is the
    // exact mechanism that hid the defect on the published app.
    stubLocation('/services')
    const derived = createRouter('path', PAGES, 'home')
    expect(derived.current()).toBe('home')

    const declared = createRouter('path', PAGES, 'home', { basePath: '/' })
    expect(declared.current()).toBeNull()
  })

  it('path mode: a path outside the base is not this app’s', () => {
    stubLocation('/somewhere/else')
    const router = createRouter('path', PAGES, 'home', { basePath: '/apps/intranet/' })
    expect(router.current()).toBeNull()
  })

  it('hash mode: an unknown route key resolves to null', () => {
    stubLocation('/index.html', '#/services')
    const router = createRouter('hash', PAGES, 'home')
    expect(router.current()).toBeNull()
  })
})

describe('hash router', () => {
  it('base is the shell pathname — unchanged by page navigation', () => {
    stubLocation('/index.html', '#/team-chat')
    const router = createRouter('hash', PAGES, 'home')
    expect(router.base).toBe('/index.html')
    expect(router.current()).toBe('team-chat')
  })

  it('no hash, or a bare "#", is the entry page', () => {
    stubLocation('/index.html', '')
    expect(createRouter('hash', PAGES, 'home').current()).toBe('home')
    stubLocation('/index.html', '#')
    expect(createRouter('hash', PAGES, 'home').current()).toBe('home')
    stubLocation('/index.html', '#/')
    expect(createRouter('hash', PAGES, 'home').current()).toBe('home')
  })

  /**
   * The slash is what separates a route from an in-page anchor. It used to be
   * optional (`/^#\/?/`), so `#iletisim` was read as the page key "iletisim":
   * clicking an anchor on a sub-page fired hashchange, failed to resolve, and
   * bounced the reader to the entry page. An app could not have both.
   */
  describe('#/route and #anchor are different things', () => {
    it('an anchor on first load leaves the reader on the entry page', () => {
      stubLocation('/index.html', '#iletisim')
      expect(createRouter('hash', PAGES, 'home').current()).toBe('home')
    })

    it('an anchor does NOT move the reader off the page they are on', () => {
      stubLocation('/index.html', '#/people')
      const router = createRouter('hash', PAGES, 'home')
      expect(router.current()).toBe('people')

      // The reader clicks an in-page anchor on that page.
      stubLocation('/index.html', '#iletisim')
      expect(router.current()).toBe('people')
    })

    it('an anchor is never mistaken for a page that happens to share its name', () => {
      stubLocation('/index.html', '#team-chat')
      expect(createRouter('hash', PAGES, 'home').current()).toBe('home')
    })
  })

  /**
   * A link may name a page AND a place in it. `/people#iletisim` is what
   * a receipt authors; rewritten for this mode it becomes the compound
   * `#/people#iletisim` — the same shape Vue Router, Angular's
   * HashLocationStrategy and React Router's HashRouter produce.
   *
   * Captured greedily, the page key would become the literal
   * `people#iletisim`, match nothing, and the reader would get the
   * NOT-FOUND page.
   */
  describe('#/route#anchor — a page AND a place in it', () => {
    it('the route ends at the second "#"', () => {
      stubLocation('/index.html', '#/people#iletisim')
      expect(createRouter('hash', PAGES, 'home').current()).toBe('people')
    })

    it('the anchor does not make a real page unknown', () => {
      stubLocation('/index.html', '#/team-chat#gunluk')
      expect(createRouter('hash', PAGES, 'home').current()).not.toBeNull()
    })

    it('an unknown page is still refused when an anchor rides along', () => {
      stubLocation('/index.html', '#/services#pricing')
      expect(createRouter('hash', PAGES, 'home').current()).toBeNull()
    })

    it('an anchor on the entry route still resolves to entry', () => {
      stubLocation('/index.html', '#/#tepe')
      expect(createRouter('hash', PAGES, 'home').current()).toBe('home')
    })
  })
})
