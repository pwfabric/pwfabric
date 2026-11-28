/**
 * `llms.txt` and `llms-full.txt` (pwapp-format §2.4): the app's pages for a
 * language model, from the same first frames the page documents show.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp, navigationOrder } from '../../dev/assemble.js'
import { bandsOf, chromeOf, llmsFullTxt, llmsTxt, markdownOf } from '../../dev/llms.js'
import { parseFrame } from '../../dev/static-layout.js'
import { makeApp, text } from './helpers.js'

vi.setConfig({ testTimeout: 60_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

const page = (title: string, words: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ title, blocks: [{ id: 'page', type: 'stack', props: {}, children: [{ id: 't', type: 'title', props: { text: words } }] }], ...extra })

/** k-app with pages home, about, pricing, a record page and a template-titled page; navigation lists pricing before about. */
async function site(plan: Record<string, unknown> = { origin: 'https://example.com' }): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  const root = a.root
  const surfaces = join(root, 'app', 'surfaces')
  await writeFile(join(surfaces, 'about.receipt.json'), page('About', 'Who we are'))
  await writeFile(join(surfaces, 'pricing.receipt.json'), page('Pricing', 'Plans and prices', { description: 'What it costs.' }))
  await writeFile(join(surfaces, 'greet.receipt.json'), page('Hello {{state.name}}', 'Hello {{state.name}}', { capabilities: [{ capability: 'platform/persistence', config: { initialState: { name: '' } } }] }))
  await writeFile(
    join(surfaces, 'item.receipt.json'),
    page('Item', 'One item', {
      capabilities: [
        { capability: 'platform/persistence', config: { initialState: { id: '' }, dataSources: [{ id: 'item', kind: 'rest', url: 'https://api.example.com/i/{{state.id}}', notFoundWhenEmpty: true }] } },
      ],
    })
  )
  const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: Record<string, unknown> }
  identity.app = { ...identity.app, surfaceOrder: ['home', 'about', 'greet', 'item', 'pricing'] }
  await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))
  await writeFile(
    join(root, 'app', 'definitions', 'navigation.json'),
    JSON.stringify({ navbar: { links: [{ label: 'Pricing', href: '/pricing' }, { label: 'About', surfaceKey: 'about' }] } })
  )
  const planPath = join(root, 'app', 'plan.json')
  const current = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
  await writeFile(planPath, JSON.stringify({ ...current, description: 'A demo app.', ...plan }))
  return root
}

describe('llms.txt and llms-full.txt', () => {
  it('lists the sitemap’s pages in navigation order, with absolute addresses under the base', async () => {
    const r = await assemblePwapp(await site(), { cacheDir: null, router: 'path', base: '/shop/' })
    expect(r.ok, r.diagnostics.map((d) => d.code).join()).toBe(true)
    expect(text(r.files.get('llms.txt'))).toBe(
      [
        '# K Demo',
        '',
        '> A demo app.',
        '',
        '## Pages',
        '',
        '- [Home](https://example.com/shop/)',
        '- [Pricing](https://example.com/shop/pricing/): What it costs.',
        '- [About](https://example.com/shop/about/)',
        // A title that is an expression is the browser's: the app's stands. No record page.
        '- [K Demo](https://example.com/shop/greet/)',
        '',
      ].join('\n')
    )
    const full = text(r.files.get('llms-full.txt'))
    expect(full).toContain('## Pricing\n\nSource: https://example.com/shop/pricing/\n\n')
    expect(full.indexOf('## Pricing')).toBeLessThan(full.indexOf('## About'))
    expect(full).not.toContain('{{')
    expect(full).not.toContain('One item')
  })

  it('each page’s words are the words its HTML shows', async () => {
    const r = await assemblePwapp(await site(), { cacheDir: null, router: 'path' })
    const full = text(r.files.get('llms-full.txt'))
    for (const [file, title] of [['index.html', 'Home'], ['pricing/index.html', 'Pricing'], ['about/index.html', 'About']] as const) {
      const doc = new JSDOM(text(r.files.get(file))).window.document
      const root = doc.getElementById('pw-root') as HTMLElement
      for (const el of root.querySelectorAll('style, script, template, [aria-hidden="true"]')) el.remove()
      const visible = (root.textContent ?? '').replace(/\s+/g, ' ').trim()
      const start = full.indexOf(`## ${title}\n`)
      const section = full.slice(start, full.indexOf('\n## ', start + 1) >>> 0 || undefined)
      // A heading's anchor ({#id}) is the address of its words, not words.
      const words = section.split('\n').slice(4).join(' ').replace(/ \{#[^}]+\}/g, '').replace(/[#|-]\s|\[|\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
      expect(words.length, file).toBeGreaterThan(0)
      expect(visible, file).toContain(words)
    }
  })

  it('an app that requires sign-in, a hash build and an app without an origin get neither file', async () => {
    const gated = await site()
    await writeFile(join(gated, 'app', 'definitions', 'auth.json'), JSON.stringify({ required: true, topology: 'external' }))
    const g = await assemblePwapp(gated, { cacheDir: null, router: 'path' })
    expect([g.files.has('llms.txt'), g.files.has('llms-full.txt')]).toEqual([false, false])
    const hash = await assemblePwapp(await site(), { cacheDir: null })
    expect(hash.files.has('llms.txt')).toBe(false)
    const plain = await assemblePwapp(await site({}), { cacheDir: null, router: 'path' })
    expect(plain.files.has('llms.txt')).toBe(false)
  })
})

describe('the Markdown of a frame', () => {
  const md = (html: string): string[] => markdownOf(parseFrame(html), (h) => new URL(h, 'https://example.com/').href)

  it('headings by level, paragraphs, list items, table rows and absolute links', () => {
    expect(
      md(
        '<section><h2>Plans</h2><p>From <a href="/pricing/">our prices</a> to <b>more</b>.</p>' +
          '<ul><li>One</li><li>Two</li></ul><table><tr><th>Plan</th><th>Price</th></tr><tr><td>Basic</td><td>9</td></tr></table></section>'
      )
    ).toEqual(['## Plans', 'From [our prices](https://example.com/pricing/) to more.', '- One', '- Two', '| Plan | Price |', '| Basic | 9 |'])
  })

  it('reads no script, style, hidden or aria-hidden text', () => {
    expect(
      md('<div><style>p{}</style><script>x</script><p hidden>a</p><p aria-hidden="true">b</p><p style="display:none">c</p><p>shown</p><svg><text>d</text></svg></div>')
    ).toEqual(['shown'])
  })

  it('a heading carries its anchor: its own id, else the id of the block it is in', () => {
    expect(md('<h2 id="plans">Plans</h2><div data-block-wrapper="intro"><div><h3>Intro</h3><p>Words</p></div></div><h4>Loose</h4>')).toEqual([
      '## Plans {#plans}',
      '### Intro {#intro}',
      'Words',
      '#### Loose',
    ])
  })

  it('leaves out the chrome it is told to, wherever it sits, and walks into the layout around the page', () => {
    const html =
      '<div data-block-wrapper="site-nav"><nav><a href="/">Home</a></nav></div>' +
      '<div data-block-wrapper="main"><div data-block-wrapper="side"><a href="/b/">B</a></div><div data-block-wrapper="a"><p>Alpha</p></div>' +
      '<div data-block-wrapper="list--0"><div data-block-wrapper="toc--0"><p>On this page</p></div><p>Row</p></div></div>' +
      '<div data-block-wrapper="footer"><p>Footer words</p></div>'
    const chrome = { skip: new Set(['site-nav', 'side', 'toc', 'footer']), through: new Set(['main']) }
    expect(bandsOf(html, (h) => h, chrome)).toEqual([
      { id: 'a', text: 'Alpha' },
      { id: 'list--0', text: 'Row' },
    ])
  })

  it('a band every page shares is written once, under Site navigation', () => {
    const nav = '<div data-block-wrapper="nav"><nav><a href="/">Home</a></nav></div>'
    const pages = [
      { title: 'A', url: 'https://example.com/', html: `${nav}<div data-block-wrapper="a"><p>Alpha</p></div>` },
      { title: 'B', url: 'https://example.com/b/', html: `${nav}<div data-block-wrapper="b"><p>Beta</p></div>` },
    ]
    expect(bandsOf(pages[0]?.html as string, (h) => h).map((b) => b.id)).toEqual(['nav', 'a'])
    expect(llmsFullTxt({ name: 'X' }, pages, () => (h) => new URL(h, 'https://example.com/').href)).toBe(
      '# X\n\n## A\n\nSource: https://example.com/\n\nAlpha\n\n## B\n\nSource: https://example.com/b/\n\nBeta\n\n## Site navigation\n\n[Home](https://example.com/)\n'
    )
    expect(llmsTxt({ name: 'X' }, pages)).toBe('# X\n\n## Pages\n\n- [A](https://example.com/)\n- [B](https://example.com/b/)\n')
  })

  it('navigation order: the entry, then the pages navigation links to, then the rest', () => {
    expect(navigationOrder({ navbar: { links: [{ href: '/c?x=1' }, { surfaceKey: 'b' }, { href: 'https://x.example/a' }] } }, 'home', ['home', 'a', 'b', 'c', 'd'])).toEqual([
      'home',
      'c',
      'b',
      'a',
      'd',
    ])
  })
})

describe('llms-full.txt leaves the chrome out', () => {
  /** A two-page app in a layout (a header, the page, a footer) whose pages place a sidebar that declares itself chrome. */
  async function chromed(): Promise<string> {
    const a = await makeApp()
    cleanups.push(a.cleanup)
    const root = a.root
    const block = join(root, 'atoms', 'blocks', 'nav', 'side-links')
    await mkdir(block, { recursive: true })
    await writeFile(
      join(block, 'manifest.json'),
      JSON.stringify({
        id: 'nav.side-links',
        kind: 'block',
        version: '1.0.0',
        category: 'nav',
        name: 'side-links',
        state: 'stable',
        knowledge: { purpose: 'Links to the other pages, beside the page', useCases: ['A docs sidebar'], composesWith: [], antiPatterns: ['A page body'] },
        definition: { props: [{ name: 'text', type: 'string', default: '', jsonSchema: { type: 'string' } }], defaultProps: { text: '' }, canHaveChildren: false, traits: ['chrome'] },
      })
    )
    await writeFile(
      join(block, 'component.tsx'),
      "import * as React from 'react'\nexport default function SideLinks(p: { props?: { text?: string } }): React.ReactElement {\n  return <aside><a href=\"/about/\">{p.props?.text ?? ''}</a></aside>\n}\n"
    )
    await writeFile(
      join(root, 'app', 'layout.receipt.json'),
      JSON.stringify({
        blocks: [
          { id: 'site-header', type: 'title', props: { text: 'Header words' } },
          { id: 'main', type: 'stack', props: {}, children: [{ type: 'pw:page' }] },
          { id: 'site-footer', type: 'stack', props: {}, children: [{ id: 'footer-text', type: 'title', props: { text: 'Footer words' } }] },
        ],
      })
    )
    const body = (key: string, words: string): string =>
      JSON.stringify({
        title: key === 'home' ? 'Home' : 'About',
        blocks: [
          { id: `${key}-side`, type: 'side-links', props: { text: 'Sidebar words' } },
          { id: `${key}-title`, type: 'title', props: { text: `${words} title` } },
          { id: `${key}-body`, type: 'stack', props: {}, children: [{ id: `${key}-more`, type: 'title', props: { text: `${words} body` } }] },
        ],
      })
    await writeFile(join(root, 'app', 'surfaces', 'home.receipt.json'), body('home', 'Welcome'))
    await writeFile(join(root, 'app', 'surfaces', 'about.receipt.json'), body('about', 'Story'))
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: Record<string, unknown> }
    identity.app = { ...identity.app, surfaceOrder: ['home', 'about'] }
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))
    const planPath = join(root, 'app', 'plan.json')
    const plan = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
    await writeFile(planPath, JSON.stringify({ ...plan, origin: 'https://example.com' }))
    return root
  }

  it('each page’s body once, no layout or chrome text, and anchors the page renders', async () => {
    const r = await assemblePwapp(await chromed(), { cacheDir: null, router: 'path' })
    expect(r.ok, r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`).join('\n')).toBe(true)
    const full = text(r.files.get('llms-full.txt'))
    for (const words of ['Welcome title', 'Welcome body', 'Story title', 'Story body']) expect(full.split(words).length - 1, words).toBe(1)
    for (const chrome of ['Header words', 'Footer words', 'Sidebar words', 'Site navigation']) expect(full, chrome).not.toContain(chrome)
    // Every anchor names an element of that page's document.
    const anchors = [...full.matchAll(/^#+ .* \{#([^}]+)\}$/gm)].map((m) => m[1] as string)
    expect(anchors).toEqual(['home-title', 'home-more', 'about-title', 'about-more'])
    for (const [file, ids] of [['index.html', ['home-title', 'home-more']], ['about/index.html', ['about-title', 'about-more']]] as const) {
      const doc = new JSDOM(text(r.files.get(file))).window.document
      for (const id of ids) expect(doc.querySelector(`#${id}, [data-block-id="${id}"]`), `${file} #${id}`).not.toBeNull()
    }
  })
})

describe('chromeOf', () => {
  it('the layout but what holds the page, and every chrome-typed block wherever it is', () => {
    const layout = {
      blocks: [
        { id: 'bar', type: 'navbar' },
        { id: 'shell', type: 'stack', children: [{ id: 'side', type: 'stack' }, { id: 'main', type: 'stack', children: [{ type: 'pw:page' }] }] },
        { id: 'foot', type: 'stack' },
      ],
    }
    const page = { blocks: [{ id: 'crumbs', type: 'breadcrumb' }, { id: 'body', type: 'stack', children: [{ id: 'toc', type: 'toc' }, { id: 'p', type: 'text' }] }] }
    const chrome = chromeOf(layout, page, (t) => t === 'breadcrumb' || t === 'toc')
    expect([...chrome.skip].sort()).toEqual(['bar', 'crumbs', 'foot', 'side', 'toc'])
    expect([...chrome.through].sort()).toEqual(['main', 'shell'])
    expect(chromeOf(undefined, { blocks: 'x' }, () => true)).toEqual({ skip: new Set(), through: new Set() })
  })

  it('a block placed with chrome: true is chrome, with its children; a layout block that holds the page never is', () => {
    const layout = { blocks: [{ id: 'shell', type: 'stack', chrome: true, children: [{ type: 'pw:page' }] }] }
    const page = {
      blocks: [
        { id: 'body', type: 'prose' },
        { id: 'updated', type: 'text', chrome: true },
        { id: 'box', type: 'stack', children: [{ id: 'copy', type: 'copy-button', chrome: true }, { id: 'note', type: 'text', chrome: false }] },
      ],
    }
    const chrome = chromeOf(layout, page, () => false)
    expect([...chrome.skip].sort()).toEqual(['copy', 'updated'])
    expect([...chrome.through]).toEqual(['shell'])
  })
})
