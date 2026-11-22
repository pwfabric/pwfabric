/**
 * `pwf font add`: what it refuses, and the document shapes it keeps when it
 * declares a family.
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

async function appFolder(): Promise<string> {
  const root = await tempDir()
  await mkdir(join(root, 'app', 'definitions'), { recursive: true })
  await writeFile(join(root, 'app', 'definitions', 'appearance.json'), JSON.stringify({ theme: {} }))
  return root
}
const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

const TARBALL = { version: '1.0.0', dist: { tarball: 'https://registry.npmjs.org/x/-/x-1.0.0.tgz' } }
function npmStub(files: Map<string, Uint8Array> | null, meta: Record<string, unknown> | number = TARBALL, tgzStatus = 200): typeof fetch {
  return (async (url: string) => {
    if (!url.endsWith('.tgz')) return typeof meta === 'number' ? new Response('', { status: meta }) : Response.json(meta)
    return tgzStatus === 200 && files ? new Response(gzipSync(writeTar(files))) : new Response('', { status: tgzStatus })
  }) as unknown as typeof fetch
}

describe('pwf font add refuses', () => {
  it('a missing path, an empty folder, an http address, a name that is no family and a file too large', async () => {
    const root = await appFolder()
    await expect(fontAdd({ root, family: 'X', from: 'nowhere' })).rejects.toMatchObject({ code: 'FONT_SOURCE_MISSING' })
    await mkdir(join(root, 'empty'), { recursive: true })
    await expect(fontAdd({ root, family: 'X', from: 'empty' })).rejects.toMatchObject({ code: 'FONT_SOURCE_EMPTY' })
    await expect(fontAdd({ root, family: 'X', from: 'http://example.com/x.woff2' })).rejects.toThrow(/--from takes a local path, an https:\/\/ address or npm:<package>/)
    await expect(fontAdd({ root, family: 'A, B', from: 'x' })).rejects.toThrow(/is not a font family name/)
    await expect(fontAdd({ root, family: '  ', from: 'x' })).rejects.toThrow(/is not a font family name/)
    expect(await main(['font', 'add', 'X', '--from', 'x', '--style', 'oblique'], capture(root).io)).toBe(2)
    const big = new Uint8Array(600_000)
    big.set(new Uint8Array(await readFile(FONT)).subarray(0, 48))
    await writeFile(join(root, 'big.woff2'), big)
    await expect(fontAdd({ root, family: 'X', from: 'big.woff2' })).rejects.toMatchObject({ code: 'FONT_FILE_INVALID' })
  })

  it('a download that fails, and an npm source that names no package, is not there, or has no file asked for', async () => {
    const root = await appFolder()
    const failing = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    await expect(fontAdd({ root, family: 'X', from: 'https://cdn.example.com/x.woff2', fetch: failing })).rejects.toMatchObject({ code: 'FONT_DOWNLOAD_FAILED' })
    await expect(fontAdd({ root, family: 'X', from: 'npm:Not A Package', fetch: npmStub(null) })).rejects.toThrow(/does not name an npm package/)
    await expect(fontAdd({ root, family: 'X', from: 'npm:x', fetch: npmStub(null, 404) })).rejects.toMatchObject({ code: 'FONT_PACKAGE_NOT_FOUND' })
    await expect(fontAdd({ root, family: 'X', from: 'npm:x', fetch: npmStub(null, { version: '1.0.0', dist: { tarball: 'http://plain/x.tgz' } }) })).rejects.toMatchObject({
      code: 'FONT_PACKAGE_NOT_FOUND',
    })
    await expect(fontAdd({ root, family: 'X', from: 'npm:x@1.0.0', fetch: npmStub(new Map(), TARBALL, 500) })).rejects.toMatchObject({ code: 'FONT_DOWNLOAD_FAILED' })
    const enc = new TextEncoder()
    const noFaces = new Map<string, Uint8Array>([
      ['package/metadata.json', enc.encode('not json')],
      ['package/files/x-latin-700-normal.woff2', new Uint8Array(await readFile(FONT))],
    ])
    await expect(fontAdd({ root, family: 'X', from: 'npm:x', fetch: npmStub(noFaces) })).rejects.toMatchObject({ code: 'FONT_SOURCE_EMPTY' })
    await expect(fontAdd({ root, family: 'X', from: 'npm:x', subsets: ['greek'], fetch: npmStub(new Map()) })).rejects.toThrow(/has the subsets \(none\)/)
  })

  it('a list given with spaces after --weight or --style, a family name with spaces unquoted, and other subcommands', async () => {
    const root = await appFolder()
    const weight = capture(root)
    expect(await main(['font', 'add', 'X', '--from', 'x.woff2', '--weight', '400', '700'], weight.io)).toBe(2)
    expect(weight.err.join('\n')).toContain('(--weight 400,700)')
    const style = capture(root)
    expect(await main(['font', 'add', 'X', '--from', 'x.woff2', '--style', 'normal', 'italic'], style.io)).toBe(2)
    expect(style.err.join('\n')).toContain('(--style normal --style italic)')
    const family = capture(root)
    expect(await main(['font', 'add', 'Open', 'Sans', '--from', 'x.woff2'], family.io)).toBe(2)
    expect(family.err.join('\n')).toContain('quote a family name with spaces')
    expect(await main(['font', 'remove', 'X'], capture(root).io)).toBe(2)
    expect(await main(['font'], capture(root).io)).toBe(2)
    expect(await main(['font', 'add'], capture(root).io)).toBe(2)
    expect(await main(['font', 'add', 'X'], capture(root).io)).toBe(2)
  })
})

describe('pwf font add keeps', () => {
  it('the reference shape of appearance.json, the file’s own name, and one provenance entry per file', async () => {
    const root = await appFolder()
    await writeFile(join(root, 'app', 'definitions', 'appearance.json'), JSON.stringify({ config: { theme: { fonts: [{ family: 'Cal', files: 'not a list' }] } } }))
    await writeFile(join(root, 'cal.woff2'), await readFile(FONT))
    const first = await fontAdd({ root, family: 'Cal', from: 'cal.woff2', fallback: 'serif' })
    expect(first.written).toEqual(['media/fonts/cal.woff2'])
    const doc = await json(join(root, 'app', 'definitions', 'appearance.json'))
    expect((doc['config'] as { theme: { fonts: unknown[] } }).theme.fonts).toEqual([{ family: 'Cal', fallback: 'serif', files: [{ src: 'media/fonts/cal.woff2', weight: 400 }] }])
    // The same name with other bytes: written again, its provenance replaced, not added.
    const other = new Uint8Array(await readFile(FONT))
    other[other.length - 1] = (other[other.length - 1] as number) ^ 1
    await writeFile(join(root, 'cal.woff2'), other)
    expect((await fontAdd({ root, family: 'Cal', from: 'cal.woff2' })).written).toEqual(['media/fonts/cal.woff2'])
    expect(((await json(join(root, 'media', 'provenance.json')))['items'] as unknown[]).length).toBe(1)
  })

  it('appearance.json as the home of the fonts when the theme it uses is no atom of the app’s own', async () => {
    const root = await appFolder()
    await mkdir(join(root, 'atoms', 'appearance', 'plain'), { recursive: true })
    await writeFile(join(root, 'atoms', 'appearance', 'plain', 'manifest.json'), JSON.stringify({ id: 'theme-plain' }))
    await writeFile(join(root, 'app', 'definitions', 'appearance.json'), JSON.stringify({ use: 'from-a-pack' }))
    await writeFile(join(root, 'cal.woff2'), await readFile(FONT))
    expect((await fontAdd({ root, family: 'Cal', from: 'cal.woff2' })).declaredIn).toBe('app/definitions/appearance.json')
    // No appearance.json at all: one is written.
    const bare = await tempDir()
    await writeFile(join(bare, 'cal.woff2'), await readFile(FONT))
    expect((await fontAdd({ root: bare, family: 'Cal', from: 'cal.woff2' })).declared).toBe(true)
  })
})
