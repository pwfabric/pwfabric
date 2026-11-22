/**
 * The app's documents (pwapp-format §1, §2.4, §2.5): under path routing every
 * page is an HTML file of its own, holding its first frame as visible markup
 * and its own head — title, description, canonical address, Open Graph —
 * with a 404.html, a sitemap and a robots.txt that names it.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp } from '../../dev/assemble.js'
import { isRecordPage, pageDocuments, previewImageOf, sitemapXml } from '../../dev/documents.js'
import { makeApp, text } from './helpers.js'

vi.setConfig({ testTimeout: 60_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

const page = (title: string, words: string, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ title, blocks: [{ id: 'page', type: 'stack', props: {}, children: [{ id: 't', type: 'title', props: { text: words } }] }], ...extra })

/** k-app with three pages, a record page and a not-found page; `plan` is merged into its plan. */
async function site(plan: Record<string, unknown> = {}): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  const root = a.root
  const surfaces = join(root, 'app', 'surfaces')
  await writeFile(join(surfaces, 'pricing.receipt.json'), page('Pricing', 'Plans and prices', { description: 'What it costs.' }))
  await writeFile(join(surfaces, 'docs.intro.receipt.json'), page('{{state.x}}', 'Read me first'))
  await writeFile(
    join(surfaces, 'item.receipt.json'),
    page('Item', 'One item', {
      capabilities: [
        { capability: 'platform/persistence', config: { initialState: { id: '' }, dataSources: [{ id: 'item', kind: 'rest', url: 'https://api.example.com/i/{{state.id}}', notFoundWhenEmpty: true }] } },
      ],
    })
  )
  await writeFile(join(surfaces, 'missing.receipt.json'), page('Not here', 'Nothing at this address'))
  const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: Record<string, unknown> }
  identity.app = { ...identity.app, surfaceOrder: ['home', 'pricing', 'docs.intro', 'item'], notFound: 'missing' }
  await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))
  const planPath = join(root, 'app', 'plan.json')
  const current = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
  await writeFile(planPath, JSON.stringify({ ...current, description: 'A demo app.', ...plan }))
  return root
}

/** A served document, parsed: its head's tags and the words a reader without scripts sees. */
function read(html: string): { doc: Document; words: string; head: (selector: string, attr: string) => string | null } {
  const doc = new JSDOM(html).window.document
  // What a crawler or a reader without scripts gets: the body, minus scripts and templates.
  const body = doc.body.cloneNode(true) as HTMLElement
  for (const el of body.querySelectorAll('script, template, style')) el.remove()
  return {
    doc,
    words: (body.textContent ?? '').replace(/\s+/g, ' ').trim(),
    head: (selector, attr) => doc.head.querySelector(selector)?.getAttribute(attr) ?? null,
  }
}

describe('page documents under path routing', () => {
  it('writes one document per page, each holding its own first frame as visible markup', async () => {
    const r = await assemblePwapp(await site(), { cacheDir: null, router: 'path' })
    expect(r.ok, r.diagnostics.map((d) => d.code).join()).toBe(true)
    for (const [file, key, words] of [
      ['index.html', 'home', 'Hello from k-app'],
      ['pricing/index.html', 'pricing', 'Plans and prices'],
      ['docs.intro/index.html', 'docs.intro', 'Read me first'],
      ['item/index.html', 'item', 'One item'],
      ['404.html', 'missing', 'Nothing at this address'],
    ] as const) {
      const doc = read(text(r.files.get(file)))
      expect(doc.doc.querySelector('#root > #pw-root')?.getAttribute('data-pw-static'), file).toBe(key)
      expect(doc.words, file).toContain(words)
      // No other page's words in it.
      if (key !== 'home') expect(doc.words, file).not.toContain('Hello from k-app')
      expect(doc.doc.querySelector('template'), file).toBeNull()
    }
  })

  it('gives each document its page’s title and description, and links within the app by folder', async () => {
    const r = await assemblePwapp(await site(), { cacheDir: null, router: 'path' })
    const home = read(text(r.files.get('index.html')))
    expect(home.doc.title).toBe('K Demo — Home')
    expect(home.head('meta[name="description"]', 'content')).toBe('A demo app.')
    const pricing = read(text(r.files.get('pricing/index.html')))
    expect(pricing.doc.title).toBe('K Demo — Pricing')
    expect(pricing.head('meta[name="description"]', 'content')).toBe('What it costs.')
    expect(pricing.head('meta[property="og:title"]', 'content')).toBe('K Demo — Pricing')
    expect(pricing.head('meta[property="og:description"]', 'content')).toBe('What it costs.')
    // A title that is an expression is the browser's to resolve: the app's stands.
    expect(read(text(r.files.get('docs.intro/index.html'))).doc.title).toBe('K Demo')
    // No origin declared: no canonical, no og:url, no sitemap.
    expect(pricing.head('link[rel="canonical"]', 'href')).toBeNull()
    expect(r.files.has('sitemap.xml')).toBe(false)
    expect(text(r.files.get('robots.txt'))).toBe('User-agent: *\nAllow: /\n')
    // 404.html asks not to be indexed and has no canonical address.
    expect(read(text(r.files.get('404.html'))).head('meta[name="robots"]', 'content')).toBe('noindex')
    // Every page document is revalidated like the shell.
    const headers = text(r.files.get('_headers'))
    for (const p of ['/pricing/', '/pricing/index.html', '/404.html']) expect(headers).toContain(`${p}\n  Cache-Control: no-cache\n`)
  })

  it('with the app’s public origin: canonical and og:url per page, og:image, a sitemap of its pages and robots.txt naming it', async () => {
    const r = await assemblePwapp(await site({ origin: 'https://example.com', image: 'https://cdn.example.com/card.png' }), {
      cacheDir: null,
      router: 'path',
      base: '/shop/',
    })
    expect(r.ok, r.diagnostics.map((d) => d.code).join()).toBe(true)
    const home = read(text(r.files.get('index.html')))
    expect(home.head('link[rel="canonical"]', 'href')).toBe('https://example.com/shop/')
    const pricing = read(text(r.files.get('pricing/index.html')))
    expect(pricing.head('link[rel="canonical"]', 'href')).toBe('https://example.com/shop/pricing/')
    expect(pricing.head('meta[property="og:url"]', 'content')).toBe('https://example.com/shop/pricing/')
    expect(pricing.head('meta[property="og:image"]', 'content')).toBe('https://cdn.example.com/card.png')
    expect(read(text(r.files.get('404.html'))).head('link[rel="canonical"]', 'href')).toBeNull()
    // The record page names no page without its record: not listed.
    expect(text(r.files.get('sitemap.xml'))).toBe(
      sitemapXml(['https://example.com/shop/', 'https://example.com/shop/pricing/', 'https://example.com/shop/docs.intro/'])
    )
    expect(text(r.files.get('robots.txt'))).toBe('User-agent: *\nAllow: /\nSitemap: https://example.com/shop/sitemap.xml\n')
    // The runner keeps the canonical address per page: it reads the origin from project.json.
    expect(JSON.parse(text(r.files.get('pwpack/project.json')))).toMatchObject({ origin: 'https://example.com', image: 'https://cdn.example.com/card.png' })
    // The links the frame draws are the pages' own addresses.
    expect(text(r.files.get('index.html'))).not.toContain('href="#/')
  })

  it('a hash-routed app stays one document, its entry page visible in it', async () => {
    const r = await assemblePwapp(await site({ origin: 'https://example.com' }), { cacheDir: null })
    expect(r.files.has('pricing/index.html')).toBe(false)
    expect(r.files.has('404.html')).toBe(false)
    const home = read(text(r.files.get('index.html')))
    expect(home.words).toContain('Hello from k-app')
    expect(home.head('link[rel="canonical"]', 'href')).toBe('https://example.com/')
    expect(text(r.files.get('sitemap.xml'))).toBe(sitemapXml(['https://example.com/']))
  })

  it('refuses an origin with a path, and an image the app does not have', async () => {
    const r = await assemblePwapp(await site({ origin: 'https://example.com/shop', image: 'media/nope.png' }), { cacheDir: null, router: 'path' })
    expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code).sort()).toEqual(['IMAGE_INVALID', 'ORIGIN_INVALID'])
  })

  it('an app that requires sign-in tells a visitor nothing of a page’s own, and lists nothing', async () => {
    const root = await site({ origin: 'https://example.com' })
    await writeFile(join(root, 'app', 'definitions', 'auth.json'), JSON.stringify({ required: true, topology: 'external' }))
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    const pricing = read(text(r.files.get('pricing/index.html')))
    expect(pricing.doc.title).toBe('K Demo')
    expect(pricing.head('meta[name="description"]', 'content')).toBe('A demo app.')
    expect(pricing.words).toBe('')
    expect(r.files.has('sitemap.xml')).toBe(false)
  })

  it('a page named like a folder of the served app is refused under path routing', async () => {
    const root = await site()
    await writeFile(join(root, 'app', 'surfaces', 'assets.receipt.json'), page('Assets', 'x'))
    const identity = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8')) as { app: { surfaceOrder: string[] } }
    identity.app.surfaceOrder.push('assets')
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(identity))
    expect((await assemblePwapp(root, { cacheDir: null, router: 'path' })).diagnostics.map((d) => d.code)).toContain('PAGE_KEY_RESERVED')
    expect((await assemblePwapp(root, { cacheDir: null })).diagnostics.map((d) => d.code)).not.toContain('PAGE_KEY_RESERVED')
  })
})

describe('the title template (plan.json titleTemplate, receipt §1.1)', () => {
  it("titles each document through the app's template and carries it into project.json", async () => {
    const root = await site({ titleTemplate: '%s · 100%% Demo' })
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(r.ok, r.diagnostics.map((d) => d.code).join()).toBe(true)
    expect(read(text(r.files.get('pricing/index.html'))).doc.title).toBe('Pricing · 100% Demo')
    // A page whose title is an expression: the app's title alone, never the template.
    expect(read(text(r.files.get('docs.intro/index.html'))).doc.title).toBe('K Demo')
    expect((JSON.parse(text(r.files.get('pwpack/project.json'))) as { titleTemplate?: string }).titleTemplate).toBe('%s · 100%% Demo')
  })

  it('takes a page title as the whole title when the page says titleTemplate: false', async () => {
    const root = await site({ titleTemplate: '%s · Demo' })
    await writeFile(join(root, 'app', 'surfaces', 'pricing.receipt.json'), page('Demo pricing, plainly', 'Plans', { titleTemplate: false }))
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(read(text(r.files.get('pricing/index.html'))).doc.title).toBe('Demo pricing, plainly')
  })

  it('refuses a template without exactly one %s, or with a stray %', async () => {
    for (const bad of ['Demo', '%s and %s', '%s at 5%']) {
      const r = await assemblePwapp(await site({ titleTemplate: bad }), { cacheDir: null })
      expect(r.diagnostics.filter((d) => d.severity === 'error').map((d) => d.code), bad).toContain('PLAN_TITLE_TEMPLATE_INVALID')
    }
  })
})

describe('documents helpers', () => {
  it('maps each page to the file a static host serves at its address', () => {
    const toHref = (k: string): string => (k === 'home' ? '/shop/' : `/shop/${k}/`)
    expect(pageDocuments({ byPath: true, entry: 'home', routes: ['home', 'a'], notFound: 'nf', base: '/shop/', toHref })).toEqual([
      { file: 'index.html', key: 'home', notFound: false, path: '/shop/' },
      { file: 'a/index.html', key: 'a', notFound: false, path: '/shop/a/' },
      { file: '404.html', key: 'nf', notFound: true },
    ])
    expect(pageDocuments({ byPath: false, entry: 'home', routes: ['home', 'a'], base: '/', toHref })).toEqual([
      { file: 'index.html', key: 'home', notFound: false, path: '/' },
    ])
  })

  it('a preview picture is absolute: an http(s) address, or the app’s file on its origin', () => {
    expect(previewImageOf('https://x.example/a.png', undefined, '/')).toBe('https://x.example/a.png')
    expect(previewImageOf('media/card.png', 'https://example.com', '/shop/')).toBe('https://example.com/shop/pwpack/media/card.png')
    expect(previewImageOf('media/card.png', undefined, '/')).toBeUndefined()
  })

  it('a record page is one whose source is its record', () => {
    expect(isRecordPage({ capabilities: [{ config: { dataSources: [{ notFoundWhenEmpty: true }] } }] })).toBe(true)
    expect(isRecordPage({ capabilities: [{ config: { dataSources: [{ id: 'x' }] } }] })).toBe(false)
  })
})
