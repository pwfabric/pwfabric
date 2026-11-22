/**
 * An app in several languages (envelope §2.3, pwapp-format §1, §2.4): one
 * document per page per locale at its address, `<prefix>404.html`, each
 * document's `<html lang>` and first frame in its locale, its canonical
 * address its own locale's, `hreflang` alternates and `x-default`, one
 * sitemap with `xhtml:link`, one robots.txt, llms.txt sections per locale —
 * and the envelope's locales, address table, catalogues and per-locale
 * receipts. Under hash routing: one document, the locale in the route.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assemblePwapp } from '../../dev/assemble.js'
import { makeApp, parse, text } from './helpers.js'

vi.setConfig({ testTimeout: 90_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

async function put(root: string, rel: string, doc: unknown): Promise<void> {
  const path = join(root, ...rel.split('/'))
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, typeof doc === 'string' ? doc : JSON.stringify(doc))
}

const page = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  blocks: [{ id: 'page', type: 'stack', props: {}, children: [{ id: 't', type: 'title', props: { text: "{{t('intro')}}" } }] }],
  ...extra,
})

/** The k-app in English and German: a translated address, a German entry receipt, a not-found page. */
async function bakery(plan: Record<string, unknown> = {}): Promise<string> {
  const a = await makeApp()
  cleanups.push(a.cleanup)
  const root = a.root
  const identityPath = join(root, 'pwpack.json')
  const identity = JSON.parse(await readFile(identityPath, 'utf8')) as { app: Record<string, unknown> }
  identity.app = { ...identity.app, surfaceOrder: ['home', 'pricing'], notFound: 'missing' }
  await writeFile(identityPath, JSON.stringify(identity))
  await put(root, 'app/surfaces/home.receipt.json', page('Home'))
  await put(root, 'app/surfaces/home.de.receipt.json', page('Startseite'))
  await put(root, 'app/surfaces/pricing.receipt.json', page('Pricing', { path: { de: 'preise' } }))
  await put(root, 'app/surfaces/missing.receipt.json', page('Not here'))
  await put(root, 'app/messages/en.json', { intro: 'Fresh bread every morning', 'notFound.title': 'Not found' })
  await put(root, 'app/messages/de.json', { intro: 'Jeden Morgen frisches Brot', 'notFound.title': 'Nicht gefunden' })
  const planPath = join(root, 'app', 'plan.json')
  const current = JSON.parse(await readFile(planPath, 'utf8')) as Record<string, unknown>
  await writeFile(planPath, JSON.stringify({ ...current, locales: ['en', 'de'], defaultLocale: 'en', origin: 'https://bakery.example.com', ...plan }))
  return root
}

const errors = (r: { diagnostics: readonly { code: string; severity: string; message: string }[] }): string[] =>
  r.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code} ${d.message}`)
const doc = (html: string): Document => new JSDOM(html).window.document
const words = (d: Document): string => (d.getElementById('root')?.textContent ?? '').replace(/\s+/g, ' ').trim()

describe('an app in several languages, path routing', () => {
  it('writes one document per page per locale, each in its language, and a 404 per locale', async () => {
    const r = await assemblePwapp(await bakery(), { cacheDir: null, router: 'path' })
    expect(r.ok, errors(r).join('\n')).toBe(true)
    for (const f of ['index.html', 'pricing/index.html', 'de/index.html', 'de/preise/index.html', '404.html', 'de/404.html']) expect(r.files.has(f), f).toBe(true)
    expect(r.files.has('de/pricing/index.html')).toBe(false)
    const dePrice = doc(text(r.files.get('de/preise/index.html')))
    expect(dePrice.documentElement.lang).toBe('de')
    expect(words(dePrice)).toContain('Jeden Morgen frisches Brot')
    const enPrice = doc(text(r.files.get('pricing/index.html')))
    expect(enPrice.documentElement.lang).toBe('en')
    expect(words(enPrice)).toContain('Fresh bread every morning')
    // The German entry page is its own receipt.
    expect(doc(text(r.files.get('de/index.html'))).title).toContain('Startseite')
    expect(doc(text(r.files.get('de/404.html'))).documentElement.lang).toBe('de')
  })

  it('names its own canonical address and every alternate, x-default the default locale’s', async () => {
    const r = await assemblePwapp(await bakery(), { cacheDir: null, router: 'path' })
    const d = doc(text(r.files.get('de/preise/index.html')))
    expect(d.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://bakery.example.com/de/preise/')
    const alternates = [...d.querySelectorAll('link[rel="alternate"]')].map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')])
    expect(alternates).toEqual([
      ['en', 'https://bakery.example.com/pricing/'],
      ['de', 'https://bakery.example.com/de/preise/'],
      ['x-default', 'https://bakery.example.com/pricing/'],
    ])
    expect(doc(text(r.files.get('de/404.html'))).querySelector('link[rel="alternate"]')).toBeNull()
  })

  it('writes one sitemap with every page per locale and its alternates, one robots.txt, llms sections per locale', async () => {
    const r = await assemblePwapp(await bakery(), { cacheDir: null, router: 'path' })
    const sitemap = text(r.files.get('sitemap.xml'))
    expect(sitemap).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"')
    expect(sitemap.match(/<url>/g)).toHaveLength(4)
    expect(sitemap).toContain('<loc>https://bakery.example.com/de/preise/</loc><xhtml:link rel="alternate" hreflang="en" href="https://bakery.example.com/pricing/"/>')
    expect(text(r.files.get('robots.txt'))).toBe('User-agent: *\nAllow: /\nSitemap: https://bakery.example.com/sitemap.xml\n')
    const llms = text(r.files.get('llms.txt'))
    expect(llms.indexOf('## Pages (en)')).toBeLessThan(llms.indexOf('## Pages (de)'))
    expect(llms).toContain('(https://bakery.example.com/de/preise/)')
    const full = text(r.files.get('llms-full.txt'))
    expect(full).toMatch(/\n# en\n/)
    expect(full).toMatch(/\n# de\n/)
    expect(full).toContain('Jeden Morgen frisches Brot')
  })

  it('carries the locales, the address table, the catalogues and the per-locale receipts in the envelope', async () => {
    const r = await assemblePwapp(await bakery(), { cacheDir: null, router: 'path' })
    const project = parse(r.files.get('pwpack/project.json')) as Record<string, unknown>
    expect(project['locales']).toEqual(['en', 'de'])
    expect(project['defaultLocale']).toBe('en')
    expect(project['messages']).toBeUndefined()
    expect(project['addresses']).toEqual({ en: { home: '', pricing: 'pricing/' }, de: { home: 'de/', pricing: 'de/preise/' } })
    expect(project['localeReceiptFiles']).toEqual({ de: { home: 'surfaces/home.de.receipt.json' } })
    expect((parse(r.files.get('pwpack/messages/de.json')) as Record<string, string>)['intro']).toBe('Jeden Morgen frisches Brot')
    expect(r.files.has('pwpack/surfaces/home.de.receipt.json')).toBe(true)
    // The documents read pages off the address table.
    expect(text(r.files.get('de/preise/index.html'))).toContain('d.addresses')
    const hints = JSON.parse(doc(text(r.files.get('de/index.html'))).getElementById('pw-page-hints')?.textContent ?? '{}') as {
      addresses: Record<string, string>
      pages: Record<string, { receipt: string; frame?: string }>
    }
    expect(hints.addresses).toMatchObject({ de: 'home', 'de/preise': 'pricing', '': '', pricing: '' })
    expect(hints.pages['home']?.receipt).toBe('pwpack/surfaces/home.de.receipt.json')
    expect(hints.pages['pricing']?.frame).toBe('pwpack/surfaces/pricing.de.html')
    expect(text(r.files.get('pwpack/surfaces/pricing.de.html'))).toContain('Jeden Morgen frisches Brot')
  })

  it('refuses an address conflict and incoherent locales', async () => {
    const conflict = await bakery()
    await put(conflict, 'app/surfaces/pricing.receipt.json', page('Pricing', { path: { de: 'home' } }))
    expect(errors(await assemblePwapp(conflict, { cacheDir: null })).join()).toContain('APP_ADDRESS_CONFLICT')
    const bad = await bakery({ defaultLocale: 'fr' })
    expect(errors(await assemblePwapp(bad, { cacheDir: null })).join()).toContain('APP_LOCALES_INVALID')
  })
})

describe('the static head of each locale', () => {
  it("writes a title and description given with t() in the document's locale", async () => {
    const root = await bakery()
    await put(root, 'app/surfaces/pricing.receipt.json', page("{{t('pricing.title')}}", { path: { de: 'preise' }, description: "{{t('pricing.about')}}" }))
    await put(root, 'app/messages/en.json', { intro: 'Fresh bread every morning', 'notFound.title': 'Not found', 'pricing.title': 'Prices', 'pricing.about': 'What bread costs.' })
    await put(root, 'app/messages/de.json', { intro: 'Jeden Morgen frisches Brot', 'notFound.title': 'Nicht gefunden', 'pricing.title': 'Preise' })
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(r.ok, errors(r).join(' | ')).toBe(true)
    const de = doc(text(r.files.get('de/preise/index.html')))
    expect(de.title).toBe('K Demo — Preise')
    expect(de.querySelector('meta[property="og:title"]')?.getAttribute('content')).toBe('K Demo — Preise')
    // An id the locale does not set reads the default's word.
    expect(de.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('What bread costs.')
    expect(doc(text(r.files.get('pricing/index.html'))).title).toBe('K Demo — Prices')
  })
})

describe('public files and locale prefixes', () => {
  it("refuses a public file under a non-default locale's prefix (APP_PUBLIC_RESERVED) and does not copy it", async () => {
    const root = await bakery()
    await put(root, 'public/de/guide.txt', 'x')
    const r = await assemblePwapp(root, { cacheDir: null, router: 'path' })
    expect(errors(r).join()).toContain('APP_PUBLIC_RESERVED')
  })
})

describe('an app in several languages, hash routing', () => {
  it('is one document in the default locale, the locales in the route', async () => {
    const r = await assemblePwapp(await bakery(), { cacheDir: null })
    expect(r.ok, errors(r).join('\n')).toBe(true)
    expect(r.files.has('de/index.html')).toBe(false)
    const d = doc(text(r.files.get('index.html')))
    expect(d.documentElement.lang).toBe('en')
    expect(text(r.files.get('index.html'))).toContain('d.addresses')
    expect(words(d)).toContain('Fresh bread every morning')
  })
})
