import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { assemblePwapp } from '../../dev/assemble.js'
import { FIRST_PAINT_SCRIPT, PAGE_HINTS_SCRIPT } from '../../dev/shell.js'
import { firstPaintData } from '../../dev/static-paint.js'
import { visibleText } from '../../dev/static-layout.js'
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
  it('writes the entry page into #root as visible markup, before any script runs', async () => {
    const r = await assemblePwapp(await app(), { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const html = text(r.files.get('index.html'))
    // The document's own content: no template, no script needed to show it.
    expect(html).not.toContain('<template')
    const start = html.indexOf('<div id="root">')
    const root = html.slice(start, html.indexOf('<script type="application/json" id="pw-first-paint">'))
    expect(root).toContain('<div id="root"><div id="pw-root" data-pw-static="home">')
    // The page's own words, from the pack's compiled blocks — read as a crawler does.
    expect(visibleText(root)).toContain('Hello from k-app')
    // Drawn at the phone breakpoint, the renderer's own root…
    expect(root).toContain('data-viewport="xs"')
    expect(root).not.toMatch(/<script/i)
    // …and laid out at every wider one by its stylesheet in <head>.
    const layout = html.match(/<style id="pw-static-layout">([\s\S]*?)<\/style>/)?.[1] ?? ''
    expect(layout).toContain('@media (min-width:640px)')
    expect(layout).toContain('@media (min-width:1024px)')
    expect(html.indexOf('<style id="pw-static-layout">')).toBeLessThan(html.indexOf('</head>'))
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
    expect(data).toEqual({ entry: 'home', routes: ['home'], pages: { home: { keys: [], file: 'pwpack/surfaces/home.html' } } })
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
    expect(html).not.toContain('pw-static-layout')
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

  it('the first-paint data names each painted page, the query keys that change its frame and its file', () => {
    expect(
      firstPaintData({
        entry: 'menu',
        routes: ['menu', 'visit', 'dish'],
        notFound: 'notfound',
        pages: [
          { key: 'menu', html: '', layoutCss: '', addressKeys: ['category'] },
          { key: 'visit', html: '', layoutCss: '', addressKeys: [] },
          { key: 'notfound', html: '', layoutCss: '', addressKeys: [] },
        ],
      })
    ).toEqual({
      entry: 'menu',
      routes: ['menu', 'visit', 'dish'],
      notFound: 'notfound',
      pages: {
        menu: { keys: ['category'], file: 'pwpack/surfaces/menu.html' },
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
    // The frame's own file: its stylesheet, then its root.
    expect(text(r.files.get('pwpack/surfaces/dish.html'))).toMatch(/^<style id="pw-static-layout">[\s\S]*<\/style><div id="pw-root" data-pw-static="dish">/)
    expect(text(r.files.get('pwpack/surfaces/dish.html'))).toContain('A dish')
    const html = text(r.files.get('index.html'))
    const data = JSON.parse(html.match(/<script type="application\/json" id="pw-first-paint">(.*?)<\/script>/)?.[1] ?? '{}')
    // `?id=` seeds a source that is still loading: the dish frame stands for every dish.
    expect(data.pages.dish).toEqual({ keys: [], file: 'pwpack/surfaces/dish.html' })
    expect(data.pages.order).toEqual({ keys: ['id'], file: 'pwpack/surfaces/order.html' })
    // A deep link asks for its frame with the document; the document's own page is in it.
    const hints = JSON.parse(html.match(/<script type="application\/json" id="pw-page-hints">(.*?)<\/script>/)?.[1] ?? '{}')
    expect(hints.pages.dish.frame).toBe('pwpack/surfaces/dish.html')
    expect(hints.page).toBe('home')
  })
  it('a source settled without a request is settled in the frame (idle with no ?id=); one only a session can read waits, loading (E-6)', async () => {
    const root = await app()
    // headphone-shop #/confirmation: an empty record key asks for no record, so
    // the page shows "no order" — painted so, not as a spinner hydration redraws.
    await writeFile(
      join(root, 'app', 'surfaces', 'confirmation.receipt.json'),
      JSON.stringify({
        title: 'Confirmation',
        blocks: [
          {
            id: 'page',
            type: 'stack',
            props: {},
            children: [
              { id: 'o', type: 'title', props: { text: "{{__idle.order ? 'No order to confirm' : 'Loading order'}}" } },
              { id: 'r', type: 'title', props: { text: "rsvps={{__errors.mine || (__loading.mine ? 'waiting' : 'asked')}}" } },
            ],
          },
        ],
        capabilities: [
          {
            capability: 'platform/persistence',
            config: {
              initialState: { id: '' },
              dataSources: [
                { id: 'order', kind: 'entity', entityType: 'Order', query: { filter: { field: 'id', operator: 'eq', value: '{{state.id}}' } } },
                { id: 'mine', kind: 'entity', entityType: 'Rsvp' },
              ],
            },
          },
        ],
      })
    )
    await mkdir(join(root, 'app', 'definitions'), { recursive: true })
    await writeFile(
      join(root, 'app', 'definitions', 'entities.json'),
      JSON.stringify({ entities: ['Order', 'Rsvp'].map((typeId) => ({ typeId, fields: [{ name: 'note', type: 'text' }] })) })
    )
    await writeFile(
      join(root, 'app', 'definitions', 'auth.json'),
      JSON.stringify({
        methods: ['password'],
        access: { rules: [{ subject: 'member', model: 'Order', rule: 'create, read own' }, { subject: 'member', model: 'Rsvp', rule: 'read own' }] },
      })
    )
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: { surfaceOrder: string[] } }
    identity.app.surfaceOrder = ['home', 'confirmation']
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))

    const r = await assemblePwapp(root, { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    const frame = text(r.files.get('pwpack/surfaces/confirmation.html'))
    expect(frame).toContain('No order to confirm')
    // The build cannot know who the visitor is: not "sign in" for a visitor
    // who is signed in — loading, until the runner knows (E-6).
    expect(frame).toContain('rsvps=waiting')
    // The served receipt says which source only a session can be answered for.
    const served = JSON.parse(text(r.files.get('pwpack/surfaces/confirmation.receipt.json'))) as {
      capabilities: { config: { dataSources: { id: string; requiresSession?: boolean }[] } }[]
    }
    expect(served.capabilities[0]!.config.dataSources.map((d) => [d.id, d.requiresSession === true])).toEqual([
      ['order', true],
      ['mine', true],
    ])
    // `?id=` changes this frame (an order loading, not "no order"): a visit carrying one is not painted from the build.
    const html = text(r.files.get('index.html'))
    const data = JSON.parse(html.match(/<script type="application\/json" id="pw-first-paint">(.*?)<\/script>/)?.[1] ?? '{}')
    expect(data.pages.confirmation.keys).toEqual(['id'])
  })
  /** An app block drawing one link per `links` entry, and the pages that draw `#a` and a link to `/guide`. */
  async function linkedApp(): Promise<string> {
    const root = await app()
    const block = join(root, 'atoms', 'blocks', 'nav', 'jump')
    await mkdir(block, { recursive: true })
    await writeFile(
      join(block, 'component.tsx'),
      `import * as React from 'react'
export default function Jump(p: { props?: { href?: string; homeHref?: string } }): React.ReactElement {
  return <nav><a href={p.props?.href}>up</a><a href={p.props?.homeHref}>guide</a></nav>
}
`
    )
    const manifest = JSON.parse(await readFile(join(root, ...PACK_REL, 'atoms', 'blocks', 'text', 'title', 'manifest.json'), 'utf8')) as Record<string, unknown>
    const prop = (name: string): unknown => ({ name, type: 'string', required: false, default: '', jsonSchema: { type: 'string' } })
    await writeFile(
      join(block, 'manifest.json'),
      JSON.stringify({ ...manifest, id: 'nav.jump', category: 'nav', name: 'jump', definition: { props: [prop('href'), prop('homeHref')], defaultProps: {}, canHaveChildren: false } })
    )
    const page = (title: string): string =>
      JSON.stringify({
        title,
        blocks: [{ id: 'page', type: 'stack', props: {}, children: [{ id: 't', type: 'title', props: { text: title } }, { id: 'j', type: 'jump', props: { href: '#a', homeHref: '/guide' } }] }],
      })
    await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), page('Home'))
    await writeFile(join(root, 'app', 'surfaces', 'guide.receipt.json'), page('Guide'))
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: { surfaceOrder: string[] } }
    identity.app.surfaceOrder = ['home', 'guide']
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))
    return root
  }

  it('a fragment-only link in a page painted under path routing names that page, not the app root its <base href> points at', async () => {
    const r = await assemblePwapp(await linkedApp(), { cacheDir: null, router: 'path', base: '/docs/' })
    expect(r.ok, codes(r).join()).toBe(true)
    // Before any script runs, `#a` resolves against `<base href="/docs/">`: the entry page.
    const guide = text(r.files.get('guide/index.html'))
    expect(guide).toContain('<base href="/docs/" />')
    expect(guide).toContain('href="/docs/guide/#a"')
    expect(guide).not.toContain('href="#a"')
    // The frame's own file (a document holding another page's) says the same.
    expect(text(r.files.get('pwpack/surfaces/guide.html'))).toContain('href="/docs/guide/#a"')
    expect(text(r.files.get('index.html'))).toContain('href="/docs/#a"')
    // A page link is the router's, untouched.
    expect(guide).toContain('href="/docs/guide/"')
  })

  it('under hash routing a fragment-only link stays as written: the one document is every page', async () => {
    const r = await assemblePwapp(await linkedApp(), { cacheDir: null })
    expect(r.ok, codes(r).join()).toBe(true)
    expect(text(r.files.get('index.html'))).toContain('href="#a"')
    expect(text(r.files.get('pwpack/surfaces/guide.html'))).toContain('href="#a"')
  })
})
