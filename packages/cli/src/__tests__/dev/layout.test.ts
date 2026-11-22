/**
 * The app's layout (receipt §4): `app/layout.receipt.json` wraps every page,
 * its one page slot (`{ "type": "pw:page" }`) holding the page's blocks. The
 * build serves it beside the pages (`pwpack/layout.receipt.json`, named by
 * `project.json` `layoutReceiptFile`) and paints each page's first frame
 * assembled into it; a page with `layout: false` is drawn as it is.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp } from '../../dev/assemble.js'
import { makeApp, parse, text } from './helpers.js'

vi.setConfig({ testTimeout: 60_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

async function put(root: string, rel: string, doc: unknown): Promise<void> {
  const path = join(root, ...rel.split('/'))
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(doc))
}

const LAYOUT = {
  blocks: [
    { id: 'site-header', type: 'title', props: { text: 'Site header' } },
    { id: 'main', type: 'stack', props: { gap: '8px' }, children: [{ type: 'pw:page' }] },
  ],
}

/** The k-app with a second page, `about`, and the layout above. */
async function appWithLayout(layout: unknown = LAYOUT, about: Record<string, unknown> = {}): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  const identityPath = join(a.root, 'pwpack.json')
  const identity = JSON.parse(await readFile(identityPath, 'utf8')) as { app: { surfaceOrder: string[] } }
  identity.app.surfaceOrder = ['home', 'about']
  await writeFile(identityPath, JSON.stringify(identity))
  await put(a.root, 'app/surfaces/about.receipt.json', { title: 'About', blocks: [{ id: 'about-title', type: 'title', props: { text: 'About us' } }], ...about })
  await put(a.root, 'app/layout.receipt.json', layout)
  return a.root
}

const codes = (r: { diagnostics: readonly { code: string; severity: string }[] }, severity = 'error'): string[] =>
  r.diagnostics.filter((d) => d.severity === severity).map((d) => d.code)

describe('the app layout in a build', () => {
  it('serves the layout beside the pages and names it in project.json', async () => {
    const r = await assemblePwapp(await appWithLayout(), { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect((parse(r.files.get('pwpack/project.json')) as { layoutReceiptFile?: string }).layoutReceiptFile).toBe('layout.receipt.json')
    expect((parse(r.files.get('pwpack/layout.receipt.json')) as { blocks: { id?: string }[] }).blocks.map((b) => b.id)).toEqual(['site-header', 'main'])
    // The page's receipt is served as written: the runner assembles it.
    expect(text(r.files.get('pwpack/surfaces/home.receipt.json'))).not.toContain('Site header')
  })

  it('names no layout for an app without one', async () => {
    const a = await makeApp()
    cleanups.push(a.cleanup)
    const r = await assemblePwapp(a.root, { cacheDir: null })
    expect((parse(r.files.get('pwpack/project.json')) as { layoutReceiptFile?: string }).layoutReceiptFile).toBeUndefined()
    expect(r.files.has('pwpack/layout.receipt.json')).toBe(false)
  })

  it('paints every page inside the layout, the page in place of the slot', async () => {
    const r = await assemblePwapp(await appWithLayout(), { cacheDir: null, router: 'path' })
    expect(r.ok, codes(r).join()).toBe(true)
    const home = text(r.files.get('index.html'))
    const about = text(r.files.get('about/index.html'))
    for (const doc of [home, about]) expect(doc).toContain('Site header')
    expect(home).toContain('Hello from k-app')
    expect(about).toContain('About us')
    // The page's blocks sit inside the slot's parent, after the header.
    expect(about.indexOf('Site header')).toBeLessThan(about.indexOf('About us'))
  })

  it('draws a page that opts out (layout: false) without it', async () => {
    const r = await assemblePwapp(await appWithLayout(LAYOUT, { layout: false }), { cacheDir: null, router: 'path' })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('about/index.html'))).not.toContain('Site header')
    expect(text(r.files.get('index.html'))).toContain('Site header')
  })

  it("hints each page's layout modules too", async () => {
    const r = await assemblePwapp(await appWithLayout({ blocks: [{ id: 'main', type: 'stack', children: [{ type: 'pw:page' }] }] }), { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const hints = /<script type="application\/json" id="pw-page-hints">(.*?)<\/script>/s.exec(text(r.files.get('index.html')))?.[1] ?? '{}'
    const pages = (JSON.parse(hints) as { pages: Record<string, { modules: string[] }> }).pages
    // `about` places a title only; the layout's stack is drawn with it.
    expect(pages['about']?.modules.some((m) => m.includes('stack'))).toBe(true)
  })

  it('refuses a layout without exactly one bare page slot (APP_LAYOUT_SLOT) and draws no page in it', async () => {
    const r = await assemblePwapp(await appWithLayout({ blocks: [{ id: 'site-header', type: 'title', props: { text: 'Site header' } }] }), { cacheDir: null })
    expect(codes(r)).toContain('APP_LAYOUT_SLOT')
    expect((parse(r.files.get('pwpack/project.json')) as { layoutReceiptFile?: string }).layoutReceiptFile).toBeUndefined()
  })

  it('refuses a page that repeats a block id of the layout', async () => {
    const r = await assemblePwapp(await appWithLayout(LAYOUT, { blocks: [{ id: 'site-header', type: 'title', props: { text: 'x' } }] }), { cacheDir: null })
    expect(codes(r)).toContain('BLOCK_ID_DUPLICATE')
  })
})
