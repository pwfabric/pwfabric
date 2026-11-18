import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { assemblePwapp } from '../../dev/assemble.js'
import { FIRST_PAINT_SCRIPT } from '../../dev/shell.js'
import { firstPaintData, readsOneRecord } from '../../dev/static-paint.js'
import { makeApp, text } from './helpers.js'

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
    const root = html.slice(html.indexOf('<div id="root">'), html.indexOf('<script type="application/json"'))
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

  it('a record page is not painted (its record decides what it shows)', () => {
    const page = (notFoundWhenEmpty: boolean) => ({
      blocks: [],
      capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'dish', kind: 'entity', notFoundWhenEmpty }] } }],
    })
    expect(readsOneRecord(page(true))).toBe(true)
    expect(readsOneRecord(page(false))).toBe(false)
    expect(readsOneRecord({ blocks: [] })).toBe(false)
  })
})
