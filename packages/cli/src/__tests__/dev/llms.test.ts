/**
 * `llms.txt` and `llms-full.txt` (pwapp-format §2.4): the app's pages for a
 * language model, from the same first frames the page documents show.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp, navigationOrder } from '../../dev/assemble.js'
import { bandsOf, llmsFullTxt, llmsTxt, markdownOf } from '../../dev/llms.js'
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
      const words = section.split('\n').slice(4).join(' ').replace(/[#|-]\s|\[|\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
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
