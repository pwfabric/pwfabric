import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { packFromRecord } from '@pwfabric/pack'
import { assemblePwapp } from '../../dev/assemble.js'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import { collectMedia, fillMediaSlots } from '../../dev/media.js'
import { makeApp, parse, text } from './helpers.js'

vi.setConfig({ testTimeout: 60_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.map((c) => c()))
  cleanups = []
})

const enc = new TextEncoder()
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const SVG = enc.encode('<svg xmlns="http://www.w3.org/2000/svg"/>')

async function put(root: string, path: string, bytes: Uint8Array | string): Promise<void> {
  const abs = join(root, ...path.split('/'))
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, bytes)
}

describe('collectMedia', () => {
  it('resolves each app/media declaration to bytes in media/, then an absolute url', () => {
    const folder = packFromRecord({
      'pwpack.json': '{}',
      'media/provenance.json': '{"items":[]}',
      'media/hero.webp': 'hero-bytes',
      'media/logo.svg': '<svg/>',
      'media/brochure.pdf': 'pdf',
      'media/dup.png': 'a',
      'media/dup.jpg': 'b',
      'media/photo.jpg': 'jpeg',
      'app/media/hero.json': JSON.stringify({ kind: 'image', file: 'media/hero.webp', slots: [{ surfaceKey: 'home', blockId: 'h', prop: 'src' }] }),
      'app/media/logo.json': JSON.stringify({ kind: 'image' }),
      'app/media/doc.json': JSON.stringify({ kind: 'file', url: './media/brochure.pdf' }),
      'app/media/photo.json': JSON.stringify({ kind: 'image', file: 'media/photo.jpg', slots: [{ surfaceKey: 'about', blockId: 'p', prop: 'src' }] }),
      'app/media/remote.json': JSON.stringify({ kind: 'image', url: 'https://cdn.example.com/r.png', slots: [{ surfaceKey: 'home', blockId: 'r', prop: 'src' }] }),
      'app/media/dup.json': JSON.stringify({ kind: 'image' }),
      'app/media/gone.json': JSON.stringify({ kind: 'image', file: 'media/gone.png' }),
      'app/media/broken.json': '{',
      'app/media/list.json': '[]',
      'app/media/nested/skip.json': '{}',
      // Not read: the folder is refused by validation (LEGACY_ASSETS_FOLDER).
      'app/assets/old.json': JSON.stringify({ kind: 'image', file: 'media/old.png' }),
      'app/assets/old.png': 'old',
    })
    const diagnostics: AssembleDiagnostic[] = []
    const media = collectMedia(folder, diagnostics)
    expect([...media.files.keys()].sort()).toEqual([
      'media/brochure.pdf',
      'media/dup.jpg',
      'media/dup.png',
      'media/hero.webp',
      'media/logo.svg',
      'media/photo.jpg',
    ])
    expect(media.records).toEqual([
      { key: 'doc', url: 'pwpack/media/brochure.pdf' },
      { key: 'hero', url: 'pwpack/media/hero.webp' },
      { key: 'logo', url: 'pwpack/media/logo.svg' },
      { key: 'photo', url: 'pwpack/media/photo.jpg' },
      { key: 'remote', url: 'https://cdn.example.com/r.png' },
    ])
    expect(media.slots.get('home')).toEqual([
      { blockId: 'h', prop: 'src', url: './pwpack/media/hero.webp' },
      { blockId: 'r', prop: 'src', url: 'https://cdn.example.com/r.png' },
    ])
    expect(media.slots.get('about')).toEqual([{ blockId: 'p', prop: 'src', url: './pwpack/media/photo.jpg' }])
    // Invalid declarations are validation findings (validatePack), not repeated here.
    expect(diagnostics.map((d) => `${d.severity}:${d.code}:${d.path}`)).toEqual([
      // Two files are named after "dup"; which one is meant is not guessed.
      'info:MEDIA_UNRESOLVED:app/media/dup.json',
      'info:MEDIA_UNRESOLVED:app/media/gone.json',
    ])
  })
})

describe('fillMediaSlots', () => {
  const receipt = (props: Record<string, unknown>): Uint8Array =>
    enc.encode(JSON.stringify({ blocks: [{ id: 'wrap', type: 'stack', children: [{ id: 'h', type: 'image', props }] }] }))
  const slots = [{ blockId: 'h', prop: 'src', url: './pwpack/media/hero.webp' }]

  it('fills an empty slot and never replaces a value someone put there', () => {
    expect(parse(fillMediaSlots(receipt({ src: '' }), slots))).toEqual({
      blocks: [{ id: 'wrap', type: 'stack', children: [{ id: 'h', type: 'image', props: { src: './pwpack/media/hero.webp' } }] }],
    })
    expect(fillMediaSlots(receipt({ src: 'https://mine.example/x.png' }), slots)).toBeUndefined()
    const noProps = enc.encode(JSON.stringify({ blocks: [{ id: 'h', type: 'image' }] }))
    expect(parse(fillMediaSlots(noProps, slots))).toEqual({ blocks: [{ id: 'h', type: 'image', props: { src: './pwpack/media/hero.webp' } }] })
  })

  it('leaves receipts it cannot read, and pages without slots, as they are', () => {
    expect(fillMediaSlots(receipt({ src: 'x' }), [])).toBeUndefined()
    expect(fillMediaSlots(receipt({}), undefined)).toBeUndefined()
    expect(fillMediaSlots(enc.encode('not json'), slots)).toBeUndefined()
    expect(fillMediaSlots(enc.encode('[]'), slots)).toBeUndefined()
  })
})

describe('assemblePwapp media and optional envelope files', () => {
  it('serves media under pwpack/media, fills the slot, records it in publish.json and always writes connections.json', async () => {
    const a = await makeApp()
    cleanups.push(a.cleanup)
    const root = a.root
    await rm(join(root, 'app', 'definitions', 'connections.json'), { force: true })
    await put(root, 'app/media/hero.json', JSON.stringify({ kind: 'image', file: 'media/hero.png', slots: [{ surfaceKey: 'home', blockId: 'hello', prop: 'image' }] }))
    await put(root, 'media/hero.png', PNG)
    await put(root, 'media/logo.svg', SVG)
    const sha = (b: Uint8Array): string => `sha256:${createHash('sha256').update(b).digest('hex')}`
    await put(
      root,
      'media/provenance.json',
      JSON.stringify({
        items: [
          { path: 'media/hero.png', hash: sha(PNG), source: 'uploaded', createdAt: '2026-10-07T00:00:00Z' },
          { path: 'media/logo.svg', hash: sha(SVG), source: 'uploaded', createdAt: '2026-10-07T00:00:00Z' },
        ],
      })
    )
    const r = await assemblePwapp(root, { publishedAt: '2026-10-06T00:00:00.000Z' })
    expect(r.ok, r.diagnostics.map((d) => d.code).join()).toBe(true)
    expect(parse(r.files.get('pwpack/connections.json'))).toEqual({ connections: [] })
    expect(r.files.get('pwpack/auth.json')).toBeUndefined()
    expect(r.files.get('pwpack/media/hero.png')).toEqual(PNG)
    expect(text(r.files.get('pwpack/media/logo.svg'))).toBe(text(SVG))
    const home = parse(r.files.get('pwpack/surfaces/home.receipt.json')) as { blocks: { children: { props: Record<string, unknown> }[] }[] }
    expect(home.blocks[0]?.children[0]?.props).toEqual({ text: 'Hello from k-app', image: './pwpack/media/hero.png' })
    expect((parse(r.files.get('publish.json')) as { media: unknown }).media).toEqual([{ key: 'hero', url: 'pwpack/media/hero.png' }])
  })

  it('leaves publish.json without media when the app declares none', async () => {
    const a = await makeApp()
    cleanups.push(a.cleanup)
    const r = await assemblePwapp(a.root, { publishedAt: '2026-10-06T00:00:00.000Z' })
    expect(parse(r.files.get('publish.json'))).not.toHaveProperty('media')
  })
})
