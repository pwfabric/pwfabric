import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sha256Hex } from '@pwfabric/pack'
import { main } from '../../index.js'
import { runMedia } from '../../commands/media.js'
import { parseArgs } from '../../args.js'
import { sniffImage, svgProblem } from '../../commands/lib/image-type.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])

async function app(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { cwd, root: join(cwd, 'demo') }
}

const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, 'utf8'))

describe('image types', () => {
  it('tells the formats by their bytes', () => {
    expect(sniffImage(PNG)).toBe('png')
    expect(sniffImage(JPEG)).toBe('jpeg')
    expect(sniffImage(new TextEncoder().encode('GIF89a....'))).toBe('gif')
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('webp')
    expect(sniffImage(new Uint8Array([0, 0, 0, 0x1c, ...new TextEncoder().encode('ftypavif')]))).toBe('avif')
    expect(sniffImage(new TextEncoder().encode('<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe('svg')
    expect(sniffImage(new TextEncoder().encode('<html><svg/></html>'))).toBeUndefined()
    expect(sniffImage(new TextEncoder().encode('%PDF-1.7'))).toBeUndefined()
  })

  it('finds script in an SVG', () => {
    const svg = (s: string): Uint8Array => new TextEncoder().encode(s)
    expect(svgProblem(svg('<svg><circle r="1"/></svg>'))).toBeUndefined()
    expect(svgProblem(svg('<svg><SCRIPT>x</SCRIPT></svg>'))).toMatch(/script/)
    expect(svgProblem(svg('<svg onload="x()"/>'))).toMatch(/on…/)
    expect(svgProblem(svg('<svg><a href="javascript:x()"/></svg>'))).toMatch(/javascript/)
    expect(svgProblem(svg('<svg><foreignObject/></svg>'))).toMatch(/foreignObject/)
  })
})

describe('pwf media add', () => {
  it('copies a file, records its provenance and declares it in the app; again, it changes nothing', async () => {
    const { cwd, root } = await app()
    await writeFile(join(cwd, 'Hero Shot.png'), PNG)
    const c = capture(root)
    const at = new Date('2026-11-01T10:00:00.000Z')
    expect(await runMedia(parseArgs(['media', 'add', '../Hero Shot.png', '--name', 'hero.png', '--alt', 'A loaf on a table', '--licence', 'CC0-1.0']).args, c.io, { now: () => at })).toBe(0)
    expect(c.out[0]).toBe('Added media/hero.png (image/png, 16 bytes)')
    expect(new Uint8Array(await readFile(join(root, 'media', 'hero.png')))).toEqual(PNG)
    expect(await json(join(root, 'media', 'provenance.json'))).toEqual({
      items: [{ path: 'media/hero.png', hash: `sha256:${sha256Hex(PNG)}`, source: 'uploaded', createdAt: at.toISOString(), license: 'CC0-1.0' }],
    })
    expect(await json(join(root, 'app', 'media', 'hero.json'))).toEqual({ kind: 'image', origin: 'uploaded', file: 'media/hero.png', purpose: 'A loaf on a table' })
    expect(await main(['validate'], capture(root).io)).toBe(0)

    const again = capture(root)
    expect(await runMedia(parseArgs(['media', 'add', '../Hero Shot.png', '--name', 'hero.png']).args, again.io, { now: () => new Date() })).toBe(0)
    expect(again.out[0]).toBe('Unchanged media/hero.png (image/png, 16 bytes)')
    expect((await json(join(root, 'media', 'provenance.json')))['items']).toHaveLength(1)
  })

  it('downloads an https address and records it as the origin; a refused download fails', async () => {
    const { root } = await app()
    const seen: string[] = []
    const fetchStub = (async (url: string) => {
      seen.push(url)
      return url.endsWith('missing.jpg') ? new Response('no', { status: 404 }) : new Response(JPEG, { status: 200 })
    }) as unknown as typeof fetch
    const c = capture(root)
    expect(await runMedia(parseArgs(['media', 'add', 'https://images.example.com/a/bread.jpg']).args, c.io, { fetch: fetchStub })).toBe(0)
    const items = (await json(join(root, 'media', 'provenance.json')))['items'] as Record<string, unknown>[]
    expect(items[0]).toMatchObject({ path: 'media/bread.jpg', origin: 'https://images.example.com/a/bread.jpg', source: 'uploaded' })
    expect(seen).toEqual(['https://images.example.com/a/bread.jpg'])

    const bad = capture(root)
    await expect(runMedia(parseArgs(['media', 'add', 'https://images.example.com/missing.jpg']).args, bad.io, { fetch: fetchStub })).rejects.toThrow(/HTTP 404/)
    const plain = capture(root)
    expect(await main(['media', 'add', 'http://images.example.com/x.jpg'], plain.io)).toBe(2)
  })

  it('refuses a wrong extension, an unknown type, a taken name, an unsafe SVG and a text --source', async () => {
    const { cwd, root } = await app()
    await writeFile(join(cwd, 'photo.png'), JPEG)
    await writeFile(join(cwd, 'doc.pdf'), '%PDF-1.7')
    await writeFile(join(cwd, 'bad.svg'), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')
    await writeFile(join(cwd, 'other.png'), new Uint8Array([...PNG, 1]))
    await writeFile(join(cwd, 'hero.png'), PNG)
    const run = async (...argv: string[]): Promise<[number, string]> => {
      const c = capture(root)
      const code = await main(['media', 'add', ...argv], c.io)
      return [code, c.text()]
    }
    const [mismatch, mismatchText] = await run('../photo.png')
    expect(mismatch).toBe(1)
    expect(mismatchText).toMatch(/named as PNG, and its bytes are JPEG; name it photo\.jpg/)
    const [pdf, pdfText] = await run('../doc.pdf')
    expect(pdf).toBe(1)
    expect(pdfText).toMatch(/not a PNG, JPEG, GIF, WebP, AVIF or SVG/)
    const [svg, svgText] = await run('../bad.svg')
    expect(svg).toBe(1)
    expect(svgText).toMatch(/on… event attribute/)
    expect(existsSync(join(root, 'media', 'bad.svg'))).toBe(false)
    expect((await run('../hero.png'))[0]).toBe(0)
    const [taken, takenText] = await run('../other.png', '--name', 'hero.png')
    expect(taken).toBe(1)
    expect(takenText).toMatch(/media\/hero\.png holds another file/)
    const [text, textText] = await run('../hero.png', '--source', 'Photo by a friend')
    expect(text).toBe(2)
    expect(textText).toMatch(/--source takes the address/)
  })

  it('in a pack writes no declaration, and records --source provided', async () => {
    const cwd = await tempDir()
    const root = join(cwd, 'kit')
    await mkdir(root)
    await writeFile(join(root, 'pwpack.json'), JSON.stringify({ id: '@pwpack/example/kit', version: '1.0.0' }))
    await writeFile(join(cwd, 'logo.png'), PNG)
    expect(await main(['media', 'add', '../logo.png', '--source', 'provided'], capture(root).io)).toBe(0)
    expect(existsSync(join(root, 'app'))).toBe(false)
    expect(((await json(join(root, 'media', 'provenance.json')))['items'] as unknown[])[0]).toMatchObject({ source: 'provided' })
  })
})
