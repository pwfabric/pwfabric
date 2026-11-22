/**
 * `pwf font add` (appearance §3.3): a family's woff2 files into media/fonts/,
 * their licence beside them, provenance, and the theme's fonts — from a local
 * path, an https address or an npm package (a stubbed registry here), never at
 * build time, and idempotent.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { writeTar } from '@pwfabric/pack'
import { fontAdd } from '../../commands/font.js'
import { main } from '../../index.js'
import { capture, tempDir } from './helpers.js'

const FONT = fileURLToPath(new URL('../../__fixtures__/fonts/katex-caligraphic-regular.woff2', import.meta.url))
const LICENCE = fileURLToPath(new URL('../../__fixtures__/fonts/LICENSE.txt', import.meta.url))

async function appFolder(): Promise<string> {
  const root = await tempDir()
  await mkdir(join(root, 'app', 'definitions'), { recursive: true })
  await writeFile(join(root, 'app', 'definitions', 'appearance.json'), JSON.stringify({ theme: { colors: { primary: '#111111' } } }))
  return root
}
const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
const fontsOf = async (root: string) =>
  ((await json(join(root, 'app', 'definitions', 'appearance.json')))['theme'] as { fonts: { family: string; fallback?: string; files: Record<string, unknown>[] }[] }).fonts

describe('pwf font add --from <path>', () => {
  it('copies the files and the licence beside them, records provenance, declares the family — and changes nothing the second time', async () => {
    const root = await appFolder()
    const src = join(root, 'downloads')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'cal-400.woff2'), await readFile(FONT))
    await writeFile(join(src, 'cal-700-italic.woff2'), await readFile(FONT))
    await writeFile(join(src, 'LICENSE.txt'), await readFile(LICENCE))
    const first = await fontAdd({ root, family: 'Caligraphic', from: 'downloads', fallback: 'serif', now: () => new Date('2026-11-22T00:00:00Z') })
    expect(first.written.sort()).toEqual(['media/fonts/caligraphic-LICENSE.txt', 'media/fonts/caligraphic-cal-400.woff2', 'media/fonts/caligraphic-cal-700-italic.woff2'])
    expect(first.declared).toBe(true)
    expect(await fontsOf(root)).toEqual([
      {
        family: 'Caligraphic',
        fallback: 'serif',
        files: [
          { src: 'media/fonts/caligraphic-cal-400.woff2', weight: 400 },
          { src: 'media/fonts/caligraphic-cal-700-italic.woff2', weight: 700, style: 'italic' },
        ],
      },
    ])
    const provenance = (await json(join(root, 'media', 'provenance.json')))['items'] as { path: string; hash: string }[]
    expect(provenance.map((i) => i.path).sort()).toEqual(['media/fonts/caligraphic-cal-400.woff2', 'media/fonts/caligraphic-cal-700-italic.woff2'])
    expect(provenance[0]?.hash).toMatch(/^sha256:[0-9a-f]{64}$/)

    const again = await fontAdd({ root, family: 'Caligraphic', from: 'downloads', fallback: 'serif' })
    expect(again.written).toEqual([])
    expect(again.declared).toBe(false)
    expect(await fontsOf(root)).toHaveLength(1)
  })

  it('refuses a file that is not woff2', async () => {
    const root = await appFolder()
    await writeFile(join(root, 'x.woff2'), 'not a font, just text here')
    await expect(fontAdd({ root, family: 'X', from: 'x.woff2' })).rejects.toMatchObject({ code: 'FONT_FILE_INVALID' })
  })

  it('runs as a command: pwf font add', async () => {
    const root = await appFolder()
    await writeFile(join(root, 'cal.woff2'), await readFile(FONT))
    const c = capture(root)
    expect(await main(['font', 'add', 'Caligraphic', '--from', 'cal.woff2', '--weight', '100 900'], c.io)).toBe(0)
    expect(c.out.join('\n')).toContain('Declared Caligraphic')
    expect((await fontsOf(root))[0]?.files).toEqual([{ src: 'media/fonts/caligraphic-cal.woff2', weight: '100 900' }])
    expect(await main(['font', 'add', 'Caligraphic'], capture(root).io)).toBe(2)
  })
})

describe('pwf font add --from <https> and npm:<package>', () => {
  it('downloads one file from an https address', async () => {
    const root = await appFolder()
    const bytes = new Uint8Array(await readFile(FONT))
    const fetchStub = (async (url: string) => {
      expect(url).toBe('https://cdn.example.com/fonts/cal.woff2')
      return new Response(bytes)
    }) as unknown as typeof fetch
    const r = await fontAdd({ root, family: 'Caligraphic', from: 'https://cdn.example.com/fonts/cal.woff2', fetch: fetchStub })
    expect(r.written).toEqual(['media/fonts/caligraphic-cal.woff2'])
  })

  it('takes the asked weights and styles of a Fontsource package, latin and latin-ext only, with their unicode-range and the licence', async () => {
    const root = await appFolder()
    const font = new Uint8Array(await readFile(FONT))
    const enc = new TextEncoder()
    const css = `@font-face{font-family:'Inter';src:url(./files/inter-latin-400-normal.woff2) format('woff2');unicode-range:U+0000-00FF,U+0131;}
@font-face{font-family:'Inter';src:url(./files/inter-latin-ext-400-normal.woff2) format('woff2');unicode-range:U+0100-02BA;}`
    const tgz = gzipSync(
      writeTar(
        new Map<string, Uint8Array>([
          ['package/package.json', enc.encode('{"name":"@fontsource/inter"}')],
          ['package/LICENSE', enc.encode('SIL Open Font License 1.1')],
          ['package/index.css', enc.encode(css)],
          ['package/files/inter-latin-400-normal.woff2', font],
          ['package/files/inter-latin-ext-400-normal.woff2', font],
          ['package/files/inter-cyrillic-400-normal.woff2', font],
          ['package/files/inter-latin-700-normal.woff2', font],
          ['package/files/inter-latin-400-italic.woff2', font],
        ])
      )
    )
    const asked: string[] = []
    const fetchStub = (async (url: string) => {
      asked.push(url)
      if (url === 'https://registry.npmjs.org/@fontsource%2finter/5.1.0') {
        return Response.json({ version: '5.1.0', license: 'OFL-1.1', dist: { tarball: 'https://registry.npmjs.org/@fontsource/inter/-/inter-5.1.0.tgz' } })
      }
      if (url.endsWith('inter-5.1.0.tgz')) return new Response(tgz)
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const r = await fontAdd({ root, family: 'Inter', from: 'npm:@fontsource/inter@5.1.0', weights: ['400'], fetch: fetchStub })
    expect(r.written.sort()).toEqual(['media/fonts/inter-LICENSE.txt', 'media/fonts/inter-latin-400-normal.woff2', 'media/fonts/inter-latin-ext-400-normal.woff2'])
    expect((await fontsOf(root))[0]?.files).toEqual([
      { src: 'media/fonts/inter-latin-400-normal.woff2', weight: 400, unicodeRange: 'U+0000-00FF, U+0131' },
      { src: 'media/fonts/inter-latin-ext-400-normal.woff2', weight: 400, unicodeRange: 'U+0100-02BA' },
    ])
    const provenance = (await json(join(root, 'media', 'provenance.json')))['items'] as { license?: string; origin?: string }[]
    expect(provenance[0]).toMatchObject({ license: 'OFL-1.1', origin: 'npm:@fontsource/inter@5.1.0' })
    expect(asked).toHaveLength(2)
  })
})

describe('pwf font add: weights, the family’s category and where the theme is', () => {
  it('takes a weight or a range from 1 to 1000', async () => {
    const root = await appFolder()
    await writeFile(join(root, 'cal.woff2'), await readFile(FONT))
    expect(await main(['font', 'add', 'Caligraphic', '--from', 'cal.woff2', '--weight', '100 1000'], capture(root).io)).toBe(0)
    expect((await fontsOf(root))[0]?.files).toEqual([{ src: 'media/fonts/caligraphic-cal.woff2', weight: '100 1000' }])
    for (const bad of ['0', '1001', '900 100', '100 1001', 'bold']) {
      expect(await main(['font', 'add', 'Caligraphic', '--from', 'cal.woff2', '--weight', bad], capture(root).io), bad).toBe(2)
    }
    await expect(fontAdd({ root, family: 'Odd', from: 'cal.woff2', weights: ['950'] })).resolves.toMatchObject({ declared: true })
  })

  it('declares a Fontsource family’s category as its fallback, its variable range from the package, and hints the stack with it', async () => {
    const root = await appFolder()
    const font = new Uint8Array(await readFile(FONT))
    const enc = new TextEncoder()
    const tgz = gzipSync(
      writeTar(
        new Map<string, Uint8Array>([
          ['package/package.json', enc.encode('{"name":"@fontsource-variable/newsreader"}')],
          ['package/metadata.json', enc.encode(JSON.stringify({ family: 'Newsreader', category: 'serif', variable: { wght: { default: '400', min: '200', max: '800', step: '1' } } }))],
          ['package/files/newsreader-latin-wght-normal.woff2', font],
        ])
      )
    )
    const fetchStub = (async (url: string) => {
      if (url.startsWith('https://registry.npmjs.org/@fontsource-variable%2fnewsreader/')) {
        return Response.json({ version: '5.3.0', license: 'OFL-1.1', dist: { tarball: 'https://registry.npmjs.org/@fontsource-variable/newsreader/-/newsreader-5.3.0.tgz' } })
      }
      if (url.endsWith('newsreader-5.3.0.tgz')) return new Response(tgz)
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    const r = await fontAdd({ root, family: 'Newsreader', from: 'npm:@fontsource-variable/newsreader', weights: ['200 800'], fetch: fetchStub })
    expect(r.fallback).toBe('serif')
    expect(await fontsOf(root)).toEqual([{ family: 'Newsreader', fallback: 'serif', files: [{ src: 'media/fonts/newsreader-latin-wght-normal.woff2', weight: '200 800' }] }])

    await writeFile(join(root, 'mono.woff2'), font)
    const c = capture(root)
    expect(await main(['font', 'add', 'Mono Face', '--from', 'mono.woff2', '--fallback', 'monospace'], c.io)).toBe(0)
    expect(c.out.join('\n')).toContain('"Mono Face, monospace"')
  })

  it('writes the fonts into the app’s own theme atom when appearance.json uses it', async () => {
    const root = await appFolder()
    const atom = join(root, 'atoms', 'appearance', 'brand', 'manifest.json')
    await mkdir(join(atom, '..'), { recursive: true })
    await writeFile(atom, JSON.stringify({ id: 'theme-brand', kind: 'ui-appearance', theme: { colors: { primary: '#123456' } } }))
    const appearance = JSON.stringify({ use: 'brand', theme: { colors: { accent: '#654321' } } })
    await writeFile(join(root, 'app', 'definitions', 'appearance.json'), appearance)
    await writeFile(join(root, 'cal.woff2'), await readFile(FONT))
    const c = capture(root)
    expect(await main(['font', 'add', 'Caligraphic', '--from', 'cal.woff2'], c.io), c.text()).toBe(0)
    expect(c.out.join('\n')).toContain('Declared Caligraphic in atoms/appearance/brand/manifest.json theme.fonts')
    expect(await readFile(join(root, 'app', 'definitions', 'appearance.json'), 'utf8')).toBe(appearance)
    const manifest = await json(atom)
    expect(manifest['theme']).toEqual({ colors: { primary: '#123456' }, fonts: [{ family: 'Caligraphic', files: [{ src: 'media/fonts/caligraphic-cal.woff2', weight: 400 }] }] })
  })
})

describe('pwf font add --subset', () => {
  async function fontsource(root: string) {
    const font = new Uint8Array(await readFile(FONT))
    const enc = new TextEncoder()
    const css = ['latin', 'latin-ext', 'greek', 'cyrillic-ext']
      .map((s, i) => `@font-face{font-family:'Inter';src:url(./files/inter-${s}-400-normal.woff2) format('woff2');unicode-range:U+0${i}00-0${i}FF;}`)
      .join('\n')
    const tgz = gzipSync(
      writeTar(
        new Map<string, Uint8Array>([
          ['package/metadata.json', enc.encode(JSON.stringify({ id: 'inter', category: 'sans-serif', subsets: ['cyrillic-ext', 'greek', 'latin', 'latin-ext'] }))],
          ['package/400.css', enc.encode(css)],
          ...['latin', 'latin-ext', 'greek', 'cyrillic-ext'].map((s) => [`package/files/inter-${s}-400-normal.woff2`, font] as [string, Uint8Array]),
        ])
      )
    )
    const fetchStub = (async (url: string) => {
      if (url.startsWith('https://registry.npmjs.org/@fontsource%2finter/')) return Response.json({ version: '5.3.0', dist: { tarball: 'https://registry.npmjs.org/@fontsource/inter/-/inter-5.3.0.tgz' } })
      if (url.endsWith('inter-5.3.0.tgz')) return new Response(tgz)
      return new Response('', { status: 404 })
    }) as unknown as typeof fetch
    void root
    return fetchStub
  }
  const srcs = async (root: string) => ((await fontsOf(root))[0]?.files ?? []).map((f) => `${String(f['src'])} ${String(f['unicodeRange'])}`)

  it('takes latin and latin-ext by default, the subsets named, or all — each with its unicode-range', async () => {
    const plain = await appFolder()
    await fontAdd({ root: plain, family: 'Inter', from: 'npm:@fontsource/inter', fetch: await fontsource(plain) })
    expect(await srcs(plain)).toEqual(['media/fonts/inter-latin-400-normal.woff2 U+0000-00FF', 'media/fonts/inter-latin-ext-400-normal.woff2 U+0100-01FF'])

    const greek = await appFolder()
    await fontAdd({ root: greek, family: 'Inter', from: 'npm:@fontsource/inter', subsets: ['latin', 'greek'], fetch: await fontsource(greek) })
    expect(await srcs(greek)).toEqual(['media/fonts/inter-greek-400-normal.woff2 U+0200-02FF', 'media/fonts/inter-latin-400-normal.woff2 U+0000-00FF'])

    const all = await appFolder()
    await fontAdd({ root: all, family: 'Inter', from: 'npm:@fontsource/inter', subsets: ['all'], fetch: await fontsource(all) })
    expect(await srcs(all)).toHaveLength(4)

    const none = await appFolder()
    await expect(fontAdd({ root: none, family: 'Inter', from: 'npm:@fontsource/inter', subsets: ['klingon'], fetch: await fontsource(none) })).rejects.toThrow(/klingon.*cyrillic-ext, greek, latin, latin-ext/)
  })
})

describe('pwf font add list flags', () => {
  it('takes a comma list or the flag repeated, and says so when given a space-separated list', async () => {
    const root = await appFolder()
    await writeFile(join(root, 'cal.woff2'), await readFile(FONT))
    expect(await main(['font', 'add', 'A', '--from', 'cal.woff2', '--weight', '400,700', '--style', 'normal,italic'], capture(root).io)).toBe(0)
    expect(await main(['font', 'add', 'B', '--from', 'cal.woff2', '--weight', '400', '--weight', '700', '--style', 'normal', '--style', 'italic'], capture(root).io)).toBe(0)
    const c = capture(root)
    expect(await main(['font', 'add', 'C', '--from', 'cal.woff2', '--subset', 'latin', 'latin-ext', 'greek'], c.io)).toBe(2)
    expect(c.err.join('\n')).toContain('unexpected argument "latin-ext": give a list with commas (--subset latin,latin-ext) or the flag again (--subset latin --subset latin-ext)')
    const help = capture(root)
    await main(['font', '--help'], help.io)
    expect(help.text()).toContain('[--weight <w>[,<w>]]… [--style <s>[,<s>]]… [--subset <name>[,<name>]|all]…')
  })
})
