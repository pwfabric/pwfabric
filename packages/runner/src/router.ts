/**
 * Router — hash mode (`#/<key>`, zero-config on every static host) and path
 * mode (`<base>/<key>` with pushState + popstate + link interception, for
 * hosts that serve an SPA fallback).
 *
 * ONE RULE, BOTH MODES: the location either names a page this app has, or it
 * names nothing. `current()` returns `null` for the second case and the caller
 * renders a not-found page. It does NOT fall back to the entry surface.
 *
 * That fallback is why a published four-page app rendered its home page at
 * every URL: `/services` did not match a page key, resolved to entry, and the
 * breakage was invisible — no error, no 404, just the wrong page. A router
 * that cannot say "no" turns every routing defect into silent wrong output.
 *
 * ANCHORS ARE THIS ROUTER'S BUSINESS, IN BOTH MODES. The browser scrolls to a
 * fragment only on a real navigation, and neither mode performs one: hash mode
 * puts the route in the fragment, so `#/api#auth` makes the browser look for an
 * element whose id is the whole string `/api#auth` and find nothing; path mode
 * intercepts the click and calls `pushState`, which never scrolls at all. So
 * without help an in-page link would do nothing in path mode and render the
 * NOT-FOUND page in hash mode. `applyScroll()` is that help.
 *
 * Base-independence rule: nothing about the deploy path is baked into the
 * package. In path mode the base is DECLARED by the shell's `<base href>`
 * (which is what serves the app at `/` on a subdomain or under a host's
 * sub-path). Deriving it from the current location instead would make an
 * unknown deep link unfalsifiable: `/nope` has no page key to strip, so the
 * whole path would become "the base" and the router would conclude the
 * location WAS the base — i.e. entry.
 *
 * @module @pwfabric/runner/router
 */

import type { RouterMode } from './types.js'
import type { ToHref } from './helpers.js'
import { strayPageKeyOf } from './helpers.js'

export interface RouterHandle {
  readonly mode: 'hash' | 'path'
  /**
   * The app's absolute base path, always ending in `/`. This is the ONE
   * stable path per deploy — page navigation never changes it — so it is
   * what the PKCE flow registers as the redirect URI (Entra needs exactly
   * one SPA redirect URI per app, not one per page).
   */
  readonly base: string
  /**
   * Page key addressed by the current location, or `null` when the location
   * names a page this app does not have. Never guesses.
   */
  current(): string | null
  /**
   * The query the current location carries, without the `?` — `location.search`
   * in path mode, the `?…` inside `#/<key>?…` in hash mode. The runner seeds
   * page state from it.
   */
  query(): string
  /** Build an href for a page key in this router's form. */
  toHref: ToHref
  /**
   * Put the reader where the address says: at the element its in-page anchor
   * names, or at the top when it names none. Called after a route renders.
   *
   * Never falls back to the top when the anchor names nothing FOUND — a reader
   * who asked for a section is better left where they are than thrown to the
   * top of the page. And because the surface paints before its data fills in,
   * the element may not exist on the frame the route resolves; this looks
   * again for a few frames before giving up.
   */
  applyScroll(): void
  /**
   * Register location-change listeners; `onChange` re-renders the route.
   * `queryOnly` says the page stayed the same and only its query changed —
   * the runner then re-renders only if the change reaches page state.
   */
  start(onChange: (change?: RouteChange) => void): void
}

/** What a location change changed, when the router can tell. */
export interface RouteChange {
  readonly queryOnly?: boolean
}

// ============================================================
// ANCHOR SCROLLING
// ============================================================

/** How long an anchor keeps being honoured while the surface fills in. */
const ANCHOR_WATCH_MS = 3000

function elementFor(anchor: string): HTMLElement | null {
  const byId = document.getElementById(anchor)
  if (byId) return byId
  // A non-ASCII anchor travels percent-encoded in the address but is authored
  // decoded in the receipt, so the id on the page is the decoded form.
  try {
    return document.getElementById(decodeURIComponent(anchor))
  } catch {
    return null
  }
}

function scrollToAnchor(anchor: string | null): void {
  if (anchor === null || anchor === '') {
    window.scrollTo(0, 0)
    return
  }
  /**
   * WHY AN OBSERVER AND NOT A FRAME LOOP. The surface renders asynchronously
   * and in main-thread bursts, so a frame loop with a time budget spends the
   * whole budget before the anchored element exists — measured on a cross-page
   * anchor: zero scroll attempts, the element appearing about a second after
   * the route resolved. A DOM observer wakes when the page actually changes, so
   * a busy main thread cannot outrun it.
   *
   * It keeps re-honouring the anchor while the page keeps changing, because
   * data filling in ABOVE the anchor ("PAINT FIRST, FILL IN AFTER") pushes it
   * back down after the first scroll.
   */
  const honour = (): void => elementFor(anchor)?.scrollIntoView()
  honour()
  if (typeof MutationObserver !== 'function') return

  const observer = new MutationObserver(honour)
  const stop = (): void => {
    observer.disconnect()
    for (const ev of USER_SCROLL_EVENTS) window.removeEventListener(ev, stop)
  }
  observer.observe(document.body, { childList: true, subtree: true })
  // A reader who takes over wins immediately — re-honouring the anchor under
  // someone who is already scrolling away would fight them for three seconds.
  for (const ev of USER_SCROLL_EVENTS) window.addEventListener(ev, stop, { once: true, passive: true })
  window.setTimeout(stop, ANCHOR_WATCH_MS)
}

/** Reader input that means "I am driving now" — it ends the anchor watch. */
const USER_SCROLL_EVENTS = ['wheel', 'touchstart', 'keydown'] as const

/** Options a caller may declare; everything here is read from the DOCUMENT, not guessed. */
export interface RouterOptions {
  /**
   * The app's base path, from the shell's `<base href>`. Path mode only.
   * When absent the base is derived from the current location, which cannot
   * distinguish a deep link to an unknown page from a sub-path deploy — so
   * the shell is expected to declare it and `runApp` reads it for us.
   */
  readonly basePath?: string | undefined
}

// ============================================================
// MODE RESOLUTION
// ============================================================

/**
 * `'auto'` promotes to `'path'` only when `history.pushState` is usable AND
 * the server declared SPA fallback via `<meta name="pw-router" content="path">`
 * — otherwise hash (safe on any static host).
 */
export function resolveRouterMode(requested: RouterMode): 'hash' | 'path' {
  if (requested === 'hash' || requested === 'path') return requested
  const canPush = typeof history !== 'undefined' && typeof history.pushState === 'function'
  const meta = document.querySelector('meta[name="pw-router"]')
  return canPush && meta?.getAttribute('content') === 'path' ? 'path' : 'hash'
}

// ============================================================
// HASH ROUTER
// ============================================================

/**
 * A route reference is `#/<key>` — the slash is REQUIRED. `#contact-form` is
 * an in-page anchor and belongs to the document, not to this router.
 *
 * The slash used to be optional (`/^#\/?/`), which made the two forms
 * indistinguishable: clicking an in-page anchor on a sub-page fired
 * `hashchange`, resolved "contact-form" as a page key, failed, and bounced
 * the reader back to the entry page. An app could not have both routes and
 * anchors.
 *
 * THE ROUTE ENDS AT THE SECOND '#'. A link may name a page AND a place in it
 * — `#/api-reference#authentication` — which is what an authored path href
 * (`/api-reference#authentication`) becomes once rewritten for this mode, and
 * is the same compound form Vue Router, Angular's HashLocationStrategy and
 * React Router's HashRouter all produce. It used to be captured greedily, so
 * the page key became the literal `api-reference#authentication`, matched no
 * page, and every in-page link rendered the not-found page.
 */
/*
 * THE ROUTE ALSO ENDS AT '?'. `#/product?id=12` is page `product` with the
 * query `id=12`. `[^#]*` swallowed the `?`, the key
 * became `product?id=12`, and every detail link rendered the not-found page.
 * Order is route, query, anchor: `#/product?id=12#reviews`.
 */
const ROUTE_HASH = /^#\/([^#?]*)(?:\?([^#]*))?(?:#(.*))?$/

/** The anchor part of a compound `#/route#anchor`, or null for a plain route. */
function hashAnchorOf(hash: string): string | null {
  return ROUTE_HASH.exec(hash)?.[3] ?? null
}

/** The query part of `#/route?query`, `''` when there is none. */
function hashQueryOf(hash: string): string {
  return ROUTE_HASH.exec(hash)?.[2] ?? ''
}

function createHashRouter(pages: readonly string[], entry: string): RouterHandle {
  /**
   * The last hash that actually named a page. An anchor-only hash change must
   * leave the reader where they are, so "no route in the location" answers
   * with the page we are already on rather than with entry.
   */
  let resolved: string | null = null
  /** The query of the location `resolved` was read from. */
  let resolvedQuery = ''

  const routeOf = (hash: string): string | null => {
    const match = ROUTE_HASH.exec(hash)
    if (!match) return null
    const key = (match[1] ?? '').replace(/\/+$/, '')
    return key === '' ? entry : key
  }

  return {
    mode: 'hash',
    // Hash mode: the pathname IS the shell and never changes per page.
    base: location.pathname,
    current() {
      const match = ROUTE_HASH.exec(location.hash)
      if (!match) return resolved ?? entry
      resolvedQuery = match[2] ?? ''
      const key = (match[1] ?? '').replace(/\/+$/, '')
      if (key === '') {
        resolved = entry
        return entry
      }
      if (pages.includes(key)) {
        resolved = key
        return key
      }
      return null
    },
    query: () => (ROUTE_HASH.test(location.hash) ? hashQueryOf(location.hash) : resolvedQuery),
    toHref: (key) => `#/${key}`,
    applyScroll() {
      scrollToAnchor(hashAnchorOf(location.hash))
    },
    start(onChange) {
      window.addEventListener('hashchange', () => {
        // A BARE in-page anchor (`#contact-form`) is a true document fragment
        // in this mode: the browser finds that id itself and scrolls to it.
        // Re-rendering would discard the scroll it is about to set.
        if (!ROUTE_HASH.test(location.hash)) return
        // A COMPOUND `#/route#anchor` on the page already shown changed the
        // address, not the surface. Re-rendering would replace the DOM under
        // the reader — and the browser cannot scroll here, because the
        // fragment it sees is the whole `/route#anchor`.
        if (routeOf(location.hash) === resolved) {
          // Same page, NEW QUERY (`#/product?id=12` → `?id=13`): the page
          // state may have changed, so the runner decides whether to re-render.
          if (hashQueryOf(location.hash) !== resolvedQuery) {
            onChange({ queryOnly: true })
            return
          }
          scrollToAnchor(hashAnchorOf(location.hash))
          return
        }
        onChange()
      })
      // A root-relative link naming one of our pages (`/people/`) is ours even
      // though the rewriter never saw it — data rows render such hrefs. Left to
      // the browser it walks off the app to `<origin>/people/`.
      document.addEventListener('click', (ev) => {
        const stray = strayLinkFromClick(ev, pages)
        if (stray === null) return
        ev.preventDefault()
        // The query and fragment ride along: `/records/5#top` names a place in
        // that page, and dropping it is how a row link lands at the top of a
        // record the reader asked one section of.
        location.hash = `#/${stray.key}${stray.suffix}`
      })
    },
  }
}

// ============================================================
// PATH ROUTER
// ============================================================

/** `'/a/b/'` → `'/a/b'` ; `'/'` and `''` → `''`. */
function trimBase(path: string): string {
  return path.replace(/\/+$/, '')
}

function createPathRouter(
  pages: readonly string[],
  entry: string,
  options: RouterOptions
): RouterHandle {
  // The shell declares its own base. Only when it does not do we fall back to
  // reading it off the current location — and that fallback cannot tell a deep
  // link to an unknown page from a deeper deploy path, so it is last resort.
  let base: string
  if (typeof options.basePath === 'string' && options.basePath !== '') {
    base = trimBase(new URL(options.basePath, location.href).pathname)
  } else {
    base = trimBase(location.pathname)
    const lastSegment = base.split('/').pop() ?? ''
    if (pages.includes(lastSegment)) base = base.slice(0, base.length - lastSegment.length - 1)
  }

  const keyOfPath = (pathname: string): string | null => {
    const path = trimBase(pathname)
    if (path === base) return entry
    if (!path.startsWith(`${base}/`)) return null
    const candidate = path.slice(base.length + 1)
    return pages.includes(candidate) ? candidate : null
  }

  /** The page this router last resolved — what the DOM currently shows. */
  let resolved: string | null = null

  return {
    mode: 'path',
    base: base === '' ? '/' : `${base}/`,
    current() {
      resolved = keyOfPath(location.pathname)
      return resolved
    },
    query: () => location.search.replace(/^\?/, ''),
    toHref: (key) => `${base}/${key}`,
    applyScroll() {
      scrollToAnchor(location.hash.startsWith('#') ? location.hash.slice(1) : null)
    },
    start(onChange) {
      window.addEventListener('popstate', () => onChange())
      // Link interception: same-origin anchors UNDER this app's base navigate
      // via pushState instead of a full document load — including ones naming
      // a page the app does not have, which then render the not-found page
      // in place. Anything outside the base is the browser's, not ours.
      document.addEventListener('click', (ev) => {
        if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return
        const target = ev.target as Element | null
        const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
        if (!anchor || (anchor.target && anchor.target !== '_self')) return
        const url = new URL(anchor.href, location.href)
        if (url.origin !== location.origin) return
        const path = trimBase(url.pathname)
        if (path !== base && !path.startsWith(`${base}/`)) {
          // Not under our base — but a root-relative `/people/` that names one
          // of our pages is still ours (see strayPageKeyOf). Route it under
          // the base instead of letting the document walk to `<origin>/people/`.
          const stray = strayLinkOf(anchor.getAttribute('href') ?? '', pages)
          if (stray === null) return
          ev.preventDefault()
          history.pushState(null, '', `${base}/${stray.key}${stray.suffix}`)
          // AN ANCHOR ON THE SAME PAGE DOES NOT RE-RENDER HERE EITHER. The
          // sibling branch below guards this with `sameSurface`; without the
          // guard here, a `/people#top` link on `/people` would fetch the
          // receipt again, replace the DOM, and throw the reader to the top.
          if (stray.key === resolved && stray.suffix.startsWith('#')) {
            scrollToAnchor(stray.suffix.slice(1) || null)
            return
          }
          onChange(stray.key === resolved ? { queryOnly: true } : undefined)
          return
        }
        ev.preventDefault()
        const sameSurface = keyOfPath(url.pathname) === resolved && resolved !== null
        const sameQuery = url.search === location.search
        history.pushState(null, '', url.pathname + url.search + url.hash)
        // SAME PAGE, NEW QUERY (`/product?id=12` → `?id=13`). Comparing only
        // the page key would make this a mere scroll: the address would say
        // 13 and the page keep showing 12.
        if (sameSurface && !sameQuery) {
          onChange({ queryOnly: true })
          return
        }
        // An in-page anchor on the page already shown: the address changed,
        // the surface did not. `pushState` NEVER scrolls to a fragment — that
        // is the browser's behaviour for a real navigation only — so honouring
        // the anchor is ours, and re-rendering would replace the DOM the
        // reader is looking at and send them back to the top.
        if (sameSurface) {
          scrollToAnchor(url.hash.startsWith('#') ? url.hash.slice(1) : null)
          return
        }
        onChange()
      })
    },
  }
}

/** The stray root-relative page link a plain left-click names, else null. */
function strayLinkFromClick(ev: MouseEvent, pages: readonly string[]): StrayLink | null {
  if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return null
  const target = ev.target as Element | null
  const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
  if (!anchor || (anchor.target && anchor.target !== '_self')) return null
  return strayLinkOf(anchor.getAttribute('href') ?? '', pages)
}

/** A stray link split into the page it names and the query/fragment riding along. */
interface StrayLink {
  readonly key: string
  /** `''`, or the `?…`/`#…` tail exactly as authored. */
  readonly suffix: string
}

function strayLinkOf(href: string, pages: readonly string[]): StrayLink | null {
  const key = strayPageKeyOf(href, pages)
  if (key === null) return null
  const tail = /[?#]/.exec(href)
  return { key, suffix: tail ? href.slice(tail.index) : '' }
}

// ============================================================
// FACTORY
// ============================================================

export function createRouter(
  mode: 'hash' | 'path',
  pages: readonly string[],
  entry: string,
  options: RouterOptions = {}
): RouterHandle {
  return mode === 'path' ? createPathRouter(pages, entry, options) : createHashRouter(pages, entry)
}
