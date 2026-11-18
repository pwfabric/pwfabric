import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { assemblePwapp } from '../../dev/assemble.js'
import { FIRST_PAINT_SCRIPT, PAGE_HINTS_SCRIPT } from '../../dev/shell.js'
import { firstPaintData } from '../../dev/static-paint.js'
import { PACK_REL, makeApp, text } from './helpers.js'

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})
async function app(): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  return a.root
}
const codes = (r: { diagnostics: readonly { code: string }[] }): string[] => r.diagnostics.map((d) => d.code)

describe('the static first paint (pwapp-format §2.5)', () => {
  it('writes the entry page into #root, before any script runs', async () => {
    const r = await assemblePwapp(await app(), { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const html = text(r.files.get('index.html'))
    // Held in a template the first-paint script puts into the (empty) root:
    // a visitor who opens another page never fetches this page's pictures.
    expect(html).toContain('<div id="root"></div>')
    const root = html.slice(html.indexOf('<template id="pw-entry-frame">'), html.indexOf('</template>'))
    expect(root).toContain('<div id="pw-root" data-pw-static="home">')
    // The page's own words, from the pack's compiled blocks.
    expect(root).toContain('Hello from k-app')
    // The phone layout, the renderer's own root.
    expect(root).toContain('data-viewport="xs"')
    expect(root).not.toMatch(/<script/i)
    expect(codes(r).filter((c) => c.startsWith('STATIC_PAINT'))).toEqual([])
  })

  it('the first-paint script is allowed by its hash, and the data it reads is beside it', async () => {
    const r = await assemblePwapp(await app(), { cacheDir: null })
    const html = text(r.files.get('index.html'))
    const hash = `'sha256-${createHash('sha256').update(FIRST_PAINT_SCRIPT).digest('base64')}'`
    expect(html).toContain(`<script>${FIRST_PAINT_SCRIPT}</script>`)
    expect(text(r.files.get('_headers'))).toContain(hash)
    const hintsHash = `'sha256-${createHash('sha256').update(PAGE_HINTS_SCRIPT).digest('base64')}'`
    expect(html).toContain(`<script>${PAGE_HINTS_SCRIPT}</script>`)
    expect(text(r.files.get('_headers'))).toContain(hintsHash)
    const data = JSON.parse(html.match(/<script type="application\/json" id="pw-first-paint">(.*?)<\/script>/)?.[1] ?? '{}')
    expect(data).toMatchObject({ entry: 'home', routes: ['home'], maxWidth: 639, pages: { home: { keys: [] } } })
  })

  it('is the same bytes on every build (no build-time clock, data or machine locale)', async () => {
    const root = await app()
    const a = await assemblePwapp(root, { cacheDir: null })
    const b = await assemblePwapp(root, { cacheDir: null })
    expect(text(a.files.get('index.html'))).toBe(text(b.files.get('index.html')))
  })

  it('an app that requires sign-in is not painted: who signs in decides its first frame', async () => {
    const root = await app()
    await writeFile(join(root, 'app', 'definitions', 'auth.json'), JSON.stringify({ required: true, topology: 'external' }))
    const r = await assemblePwapp(root, { cacheDir: null })
    const html = text(r.files.get('index.html'))
    expect(html).toContain('<div id="root"></div>')
    expect(html).not.toContain('pw-first-paint')
  })

  it('draws the account control the app DECLARES, though the build has no auth.json (conference-companion, React #418)', async () => {
    const root = await app()
    // A password door: `pwf build` writes no auth.json — the host brings its addresses.
    await writeFile(join(root, 'app', 'definitions', 'auth.json'), JSON.stringify({ required: false, topology: 'app', methods: ['password'] }))
    await writeFile(join(root, 'app', 'definitions', 'navigation.json'), JSON.stringify({ account: { placement: 'bottom-bar' } }))
    const block = join(root, 'atoms', 'blocks', 'layout', 'bottom-bar')
    await mkdir(block, { recursive: true })
    await writeFile(
      join(block, 'component.tsx'),
      `import * as React from 'react'
export default function Bar(p: { props?: { account?: { signedIn?: boolean } } }): React.ReactElement {
  const a = p.props?.account
  return <nav data-account={a ? (a.signedIn ? 'in' : 'signed-out') : 'none'}>bar</nav>
}
`
    )
    const manifest = JSON.parse(await readFile(join(root, ...PACK_REL, 'atoms', 'blocks', 'text', 'title', 'manifest.json'), 'utf8')) as Record<string, unknown>
    await writeFile(
      join(block, 'manifest.json'),
      JSON.stringify({ ...manifest, id: 'layout.bottom-bar', category: 'layout', name: 'bottom-bar', definition: { props: [], defaultProps: {}, canHaveChildren: false } })
    )
    const receipt = join(root, 'app', 'surfaces', 'home.receipt.json')
    const home = JSON.parse(await readFile(receipt, 'utf8')) as { blocks: unknown[] }
    home.blocks.push({ id: 'bar', type: 'bottom-bar', props: {} })
    await writeFile(receipt, JSON.stringify(home))

    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(r.files.has('pwpack/auth.json')).toBe(false)
    const html = text(r.files.get('index.html'))
    expect(html).toContain('data-account="signed-out"')
    // What the runner hydrates from: the declaration travels in project.json.
    const project = JSON.parse(text(r.files.get('pwpack/project.json'))) as { identity: Record<string, unknown> }
    expect(project.identity).toMatchObject({ methods: ['password'], registration: 'open', door: false })
  })

  it('the first-paint data names each painted page, its seeding keys and, past the entry, its file', () => {
    expect(
      firstPaintData({
        entry: 'menu',
        routes: ['menu', 'visit', 'dish'],
        notFound: 'notfound',
        pages: [
          { key: 'menu', html: '', addressKeys: ['category'] },
          { key: 'visit', html: '', addressKeys: [] },
          { key: 'notfound', html: '', addressKeys: [] },
        ],
      })
    ).toEqual({
      entry: 'menu',
      routes: ['menu', 'visit', 'dish'],
      notFound: 'notfound',
      maxWidth: 639,
      pages: {
        menu: { keys: ['category'] },
        visit: { keys: [], file: 'pwpack/surfaces/visit.html' },
        notfound: { keys: [], file: 'pwpack/surfaces/notfound.html' },
      },
    })
  })

  it('a record page is painted: the shell and its loading frame, whichever record the address names (E16)', async () => {
    const root = await app()
    const recordPage = (title: string): unknown => ({
      title: 'Dish',
      blocks: [{ id: 'page', type: 'stack', props: {}, children: [{ id: 't', type: 'title', props: { text: title } }] }],
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            initialState: { id: '' },
            dataSources: [{ id: 'dish', kind: 'rest', url: 'https://api.example.com/dishes/{{state.id}}', notFoundWhenEmpty: true }],
          },
        },
      ],
    })
    await writeFile(join(root, 'app', 'surfaces', 'dish.receipt.json'), JSON.stringify(recordPage('A dish')))
    // A page whose frame shows the address's value: that key keeps the build's frame out.
    await writeFile(join(root, 'app', 'surfaces', 'order.receipt.json'), JSON.stringify(recordPage('Order {{state.id}}')))
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: { surfaceOrder: string[] } }
    identity.app.surfaceOrder = ['home', 'dish', 'order']
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))

    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('pwpack/surfaces/dish.html'))).toContain('A dish')
    const html = text(r.files.get('index.html'))
    const data = JSON.parse(html.match(/<script type="application\/json" id="pw-first-paint">(.*?)<\/script>/)?.[1] ?? '{}')
    // `?id=` seeds a source that is still loading: the dish frame stands for every dish.
    expect(data.pages.dish).toEqual({ keys: [], file: 'pwpack/surfaces/dish.html' })
    expect(data.pages.order).toEqual({ keys: ['id'], file: 'pwpack/surfaces/order.html' })
    // A deep link asks for its frame with the document; the entry's is in the shell.
    const hints = JSON.parse(html.match(/<script type="application\/json" id="pw-page-hints">(.*?)<\/script>/)?.[1] ?? '{}')
    expect(hints.pages.dish.frame).toBe('pwpack/surfaces/dish.html')
    expect(hints.pages.home.frame).toBeUndefined()
  })
})
