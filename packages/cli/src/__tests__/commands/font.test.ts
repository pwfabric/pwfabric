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
