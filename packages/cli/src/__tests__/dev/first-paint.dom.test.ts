/**
 * The shell's first-paint script (pwapp-format §2.5) puts the build's first
 * frame into the empty root only where it is this visit's: the entry page
 * from its template, another page fetched, nothing for a wide window or an
 * address whose query changes the page's frame.
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
  maxWidth: 639,
  pages: {
    menu: { keys: ['category'] },
    visit: { keys: [], file: 'pwpack/surfaces/visit.html' },
    notfound: { keys: [], file: 'pwpack/surfaces/notfound.html' },
  },
}

async function run(hash: string, width = 390, served: Record<string, string> = {}): Promise<HTMLElement> {
  history.replaceState(null, '', `/${hash}`)
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true })
  document.body.innerHTML =
    `<div id="root"></div><template id="pw-entry-frame"><div id="pw-root" data-pw-static="menu"><p>menu</p></div></template>` +
    `<script type="application/json" id="pw-first-paint">${JSON.stringify(data)}</script>`
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

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  history.replaceState(null, '', '/')
})

describe('the first-paint script', () => {
  it('puts the entry page’s frame in place from its template', async () => {
    expect((await run('')).innerHTML).toContain('<p>menu</p>')
    expect((await run('#/menu')).innerHTML).toContain('<p>menu</p>')
    expect((await run('#/menu?utm_source=x')).innerHTML).toContain('<p>menu</p>')
  })

  it('puts another page’s first frame in place, fetched from the build', async () => {
    const root = await run('#/visit', 390, { './pwpack/surfaces/visit.html': '<p>visit</p>' })
    expect(root.querySelector('#pw-root')?.getAttribute('data-pw-static')).toBe('visit')
    expect(root.innerHTML).toContain('<p>visit</p>')
    expect(root.innerHTML).not.toContain('<p>menu</p>')
  })

  it('an address naming no page shows the app’s not-found frame', async () => {
    const root = await run('#/nope', 390, { './pwpack/surfaces/notfound.html': '<p>lost</p>' })
    expect(root.querySelector('#pw-root')?.getAttribute('data-pw-static')).toBe('notfound')
  })

  it('a page the build did not paint leaves the root empty', async () => {
    expect((await run('#/dish')).innerHTML).toBe('')
  })

  it('a query key that does not change the frame keeps it (a record page’s ?id=)', async () => {
    const root = await run('#/visit?id=3', 390, { './pwpack/surfaces/visit.html': '<p>visit</p>' })
    expect(root.innerHTML).toContain('<p>visit</p>')
  })

  it('an address that seeds the page’s state is not the build’s first frame', async () => {
    expect((await run('#/menu?category=drinks')).innerHTML).toBe('')
  })

  it('a window wider than the painted breakpoint is not painted from the build', async () => {
    expect((await run('', 1024)).innerHTML).toBe('')
  })

  it('a page the runner drew first is not overwritten when the fetch lands', async () => {
    let land: (v: unknown) => void = () => undefined
    history.replaceState(null, '', '/#/visit')
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true })
    document.body.innerHTML = `<div id="root"></div><script type="application/json" id="pw-first-paint">${JSON.stringify(data)}</script>`
    vi.stubGlobal('fetch', vi.fn(() => new Promise((r) => (land = r))))
    new Function(FIRST_PAINT_SCRIPT)()
    const root = document.getElementById('root') as HTMLElement
    root.innerHTML = '<div id="pw-root">drawn by the runner</div>'
    land({ ok: true, text: async () => '<p>visit</p>' })
    await new Promise((r) => setTimeout(r, 0))
    expect(root.textContent).toBe('drawn by the runner')
  })
})
