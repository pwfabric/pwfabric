/**
 * The shell's first-paint script (pwapp-format §2.5). The document holds the
 * first frame of its own page, visible; the script lets it stand only where
 * it is this visit's — at every width — and otherwise takes it (and its
 * stylesheet) away before the first paint, fetching the frame of the page
 * the address names when the build painted one.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FIRST_PAINT_SCRIPT } from '../../dev/shell.js'

/** What `firstPaintData` writes for this app (static-paint.test.ts checks the writer). */
const data = {
  entry: 'menu',
  routes: ['menu', 'visit', 'dish'],
  notFound: 'notfound',
  pages: {
    menu: { keys: ['category'], file: 'pwpack/surfaces/menu.html' },
    visit: { keys: [], file: 'pwpack/surfaces/visit.html' },
    notfound: { keys: [], file: 'pwpack/surfaces/notfound.html' },
  },
}

const frame = (key: string, text: string): string => `<div id="pw-root" data-pw-static="${key}"><p>${text}</p></div>`
const fragment = (key: string, text: string): string => `<style id="pw-static-layout">.${key}{}</style>${frame(key, text)}`

/** The document of page `held` (its frame in #root, its layout in <head>), opened at `address`. */
async function open(
  address: string,
  options: { held?: string; width?: number; served?: Record<string, string>; data?: Record<string, unknown>; head?: string } = {}
): Promise<HTMLElement> {
  history.replaceState(null, '', address)
  Object.defineProperty(window, 'innerWidth', { value: options.width ?? 390, configurable: true })
  const held = options.held ?? 'menu'
  document.head.innerHTML = `${options.head ?? ''}<style id="pw-static-layout">.${held}{}</style>`
  document.body.innerHTML =
    `<div id="root">${frame(held, held)}</div>` +
    `<script type="application/json" id="pw-first-paint">${JSON.stringify(options.data ?? data)}</script>`
  const served = options.served ?? {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body = served[url]
      return { ok: body !== undefined, text: async () => body ?? '' }
    })
  )
  new Function(FIRST_PAINT_SCRIPT)()
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  return document.getElementById('root') as HTMLElement
}

const layout = (): string | null => document.getElementById('pw-static-layout')?.textContent ?? null
const shown = (root: HTMLElement): string | null => root.querySelector('#pw-root')?.getAttribute('data-pw-static') ?? null

afterEach(() => {
  vi.unstubAllGlobals()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
})

describe('the first-paint script', () => {
  it('leaves the document’s own frame and its layout where the address names its page', async () => {
    expect(shown(await open('/'))).toBe('menu')
    expect(shown(await open('/#/menu'))).toBe('menu')
    expect(shown(await open('/#/menu?utm_source=x'))).toBe('menu')
    expect(layout()).toBe('.menu{}')
  })

  it('at every width: a wide window keeps the frame', async () => {
    expect(shown(await open('/', { width: 1440 }))).toBe('menu')
    expect(layout()).toBe('.menu{}')
  })

  it('another page: the held frame goes, and that page’s is fetched with its layout', async () => {
    const root = await open('/#/visit', { served: { './pwpack/surfaces/visit.html': fragment('visit', 'visit') } })
    expect(shown(root)).toBe('visit')
    expect(root.innerHTML).not.toContain('<p>menu</p>')
    expect(layout()).toBe('.visit{}')
  })

  it('an address naming no page shows the app’s not-found frame', async () => {
    const root = await open('/#/nope', { served: { './pwpack/surfaces/notfound.html': fragment('notfound', 'lost') } })
    expect(shown(root)).toBe('notfound')
  })

  it('a page the build did not paint: the root is emptied and its layout removed', async () => {
    expect((await open('/#/dish')).innerHTML).toBe('')
    expect(layout()).toBeNull()
  })

  it('a query key that does not change the frame keeps it (a record page’s ?id=)', async () => {
    const root = await open('/#/visit?id=3', { held: 'visit' })
    expect(shown(root)).toBe('visit')
  })

  it('an address that seeds the page’s state is not the build’s first frame', async () => {
    expect((await open('/#/menu?category=drinks')).innerHTML).toBe('')
    expect(layout()).toBeNull()
  })

  it('a page the runner drew first is not overwritten when the fetch lands', async () => {
    let land: (v: unknown) => void = () => undefined
    history.replaceState(null, '', '/#/visit')
    document.body.innerHTML = `<div id="root">${frame('menu', 'menu')}</div><script type="application/json" id="pw-first-paint">${JSON.stringify(data)}</script>`
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (land = r))))
    new Function(FIRST_PAINT_SCRIPT)()
    const root = document.getElementById('root') as HTMLElement
    expect(root.innerHTML).toBe('')
    root.innerHTML = '<div id="pw-root">drawn by the runner</div>'
    land({ ok: true, text: async () => fragment('visit', 'visit') })
    await new Promise((r) => setTimeout(r, 0))
    expect(root.textContent).toBe('drawn by the runner')
    expect(layout()).toBeNull()
  })
})

describe('the first-paint script under path routing (pwf build --router path|auto)', () => {
  const visit = {
    './pwpack/surfaces/visit.html': fragment('visit', 'visit'),
    './pwpack/surfaces/notfound.html': fragment('notfound', 'gone'),
    './pwpack/surfaces/menu.html': fragment('menu', 'menu'),
  }
  const path = (router: 'path' | 'auto'): Record<string, unknown> => ({ ...data, router })

  it('a page’s own document keeps its frame at its address, with or without the slash', async () => {
    expect(shown(await open('/', { data: path('path'), head: '<base href="/" />' }))).toBe('menu')
    expect(shown(await open('/visit/', { held: 'visit', data: path('path'), head: '<base href="/" />' }))).toBe('visit')
    expect(shown(await open('/visit', { held: 'visit', data: path('path'), head: '<base href="/" />' }))).toBe('visit')
  })

  it('404.html keeps the not-found frame at any address that names no page', async () => {
    expect(shown(await open('/a/b/c', { held: 'notfound', data: path('path'), head: '<base href="/" />' }))).toBe('notfound')
  })

  it('a host that answers every path with index.html: the entry frame gives way to the addressed page’s', async () => {
    expect(shown(await open('/visit', { data: path('path'), head: '<base href="/" />', served: visit }))).toBe('visit')
    expect(shown(await open('/nope', { data: path('path'), head: '<base href="/" />', served: visit }))).toBe('notfound')
    // A hash means nothing to the path router.
    expect(shown(await open('/#/visit', { data: path('path'), head: '<base href="/" />', served: visit }))).toBe('menu')
  })

  it('honours a sub-path base and the query keys that change a frame', async () => {
    expect(shown(await open('/shop/visit/', { held: 'visit', data: path('path'), head: '<base href="/shop/" />' }))).toBe('visit')
    expect(shown(await open('/shop', { data: path('path'), head: '<base href="/shop/" />' }))).toBe('menu')
    expect((await open('/shop/?category=tea', { data: path('path'), head: '<base href="/shop/" />' })).innerHTML).toBe('')
  })

  it('auto routes by path only where the shell declares the fallback, as the runner decides', async () => {
    const meta = '<base href="/" /><meta name="pw-router" content="path" />'
    expect(shown(await open('/visit', { data: path('auto'), head: meta, served: visit }))).toBe('visit')
    // No meta: auto is hash routing, so /visit is the entry page by its (empty) hash.
    expect(shown(await open('/visit', { data: path('auto'), head: '<base href="/" />', served: visit }))).toBe('menu')
  })
})
