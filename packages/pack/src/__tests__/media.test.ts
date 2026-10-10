/**
 * Media declarations: `app/media/<key>.json`, bytes in `media/<file>`, each
 * recorded in `media/provenance.json`. `app/assets/` is not read.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mediaDeclarations, packFromRecord, readMediaProvenance, validatePack } from '../index.js'

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n'
const sha = (text: string): string => `sha256:${createHash('sha256').update(text).digest('hex')}`
const slot = { surfaceKey: 'home', blockId: 'hero', prop: 'imageSrc' }
const provenance = (...items: { path: string; text: string }[]): string =>
  json({
    formatVersion: '1.0',
    items: items.map(({ path, text }) => ({ path, hash: sha(text), source: 'uploaded', createdAt: '2026-10-07T00:00:00Z' })),
  })

const codesOf = (issues: readonly { severity: string; code: string }[]): string[] =>
  issues.map((i) => `${i.severity}:${i.code}`).sort()

/** A valid app's media. */
const MEDIA: Record<string, string> = {
  'pwpack.json': json({ id: '@pwpack/acme/media', version: '1.0.0', formatVersion: '1.0' }),
  'app/media/hero.json': json({ kind: 'image', purpose: 'A loaf', origin: 'uploaded', status: 'ready', slots: [slot], file: 'media/hero.png' }),
  'app/media/logo.json': json({ kind: 'image', origin: 'generated', status: 'pending', url: 'https://cdn.example.com/logo.svg' }),
  'media/hero.png': 'png-bytes',
  'media/provenance.json': provenance({ path: 'media/hero.png', text: 'png-bytes' }),
}

describe('mediaDeclarations', () => {
  it('reads app/media/<key>.json with bytes and provenance from media/', () => {
    const m = mediaDeclarations(packFromRecord(MEDIA))
    expect(m.issues).toEqual([])
    expect(m.declarations.map((d) => d.key)).toEqual(['hero', 'logo'])
    const [hero, logo] = m.declarations
    expect(hero?.path).toBe('app/media/hero.json')
    expect(hero?.filePath).toBe('media/hero.png')
    expect(new TextDecoder().decode(hero?.bytes)).toBe('png-bytes')
    expect(hero?.provenance?.source).toBe('uploaded')
    expect(hero?.declaration.slots).toEqual([slot])
    expect(logo?.filePath).toBeUndefined()
    expect(logo?.declaration.url).toBe('https://cdn.example.com/logo.svg')
    expect(m.provenance?.items).toHaveLength(1)
    expect(validatePack(packFromRecord(MEDIA)).issues).toEqual([])
  })

  it('reads a pack without formatVersion the same way', () => {
    const m = mediaDeclarations(packFromRecord({ ...MEDIA, 'pwpack.json': json({ id: 'x', version: '1' }) }))
    expect(m.issues).toEqual([])
    expect(m.declarations).toHaveLength(2)
  })

  it('refuses a file outside media/ or in a sub-directory as an invalid declaration', () => {
    for (const file of ['hero.png', 'media/brand/logo.svg', 'app/media/hero.json']) {
      const m = mediaDeclarations(packFromRecord({ ...MEDIA, 'app/media/hero.json': json({ kind: 'image', file }) }))
      expect(codesOf(m.issues), file).toEqual(['error:MEDIA_DECLARATION_INVALID'])
    }
  })

  it('reports a file missing from media/ as an error and keeps the declaration without bytes', () => {
    const record = { ...MEDIA, 'app/media/hero.json': json({ kind: 'image', file: 'media/gone.png' }) }
    const m = mediaDeclarations(packFromRecord(record))
    expect(codesOf(m.issues)).toEqual(['error:MEDIA_FILE_MISSING'])
    expect(m.declarations.find((d) => d.key === 'hero')?.filePath).toBeUndefined()
    expect(validatePack(packFromRecord(record)).ok).toBe(false)
  })

  it('never takes media/provenance.json as a declared file', () => {
    const record = { ...MEDIA, 'app/media/hero.json': json({ kind: 'file', file: 'media/provenance.json' }) }
    expect(codesOf(mediaDeclarations(packFromRecord(record)).issues)).toEqual(['error:MEDIA_DECLARATION_INVALID'])
  })

  it('reports a file without provenance as an error (and the media file as undeclared)', () => {
    const record = { ...MEDIA, 'media/provenance.json': provenance() }
    expect(codesOf(mediaDeclarations(packFromRecord(record)).issues)).toEqual(['error:MEDIA_FILE_UNRECORDED'])
    expect(codesOf(validatePack(packFromRecord(record)).issues)).toEqual(['error:MEDIA_FILE_UNRECORDED', 'warning:MEDIA_UNDECLARED'])
    const noRecord = { ...MEDIA }
    delete noRecord['media/provenance.json']
    expect(codesOf(mediaDeclarations(packFromRecord(noRecord)).issues)).toEqual(['error:MEDIA_FILE_UNRECORDED'])
  })

  it('leaves the unrecorded check to MEDIA_PROVENANCE_INVALID when the record is broken', () => {
    for (const text of ['{"items":[{"path":1}]}', '{']) {
      const record = { ...MEDIA, 'media/provenance.json': text }
      expect(mediaDeclarations(packFromRecord(record)).issues).toEqual([])
      expect(readMediaProvenance(packFromRecord(record)).state).toBe('invalid')
      const v = codesOf(validatePack(packFromRecord(record)).issues)
      expect(v).toContain('error:MEDIA_PROVENANCE_INVALID')
      expect(v).not.toContain('error:MEDIA_FILE_UNRECORDED')
    }
    expect(readMediaProvenance(packFromRecord({})).state).toBe('absent')
  })

  it('keeps the bytes but warns when the provenance hash disagrees', () => {
    const record = { ...MEDIA, 'media/hero.png': 'other-bytes' }
    const m = mediaDeclarations(packFromRecord(record))
    expect(m.issues).toEqual([])
    expect(m.declarations[0]?.provenance).toBeDefined()
    expect(codesOf(validatePack(packFromRecord(record)).issues)).toEqual(['warning:MEDIA_HASH_MISMATCH'])
  })

  it('reports a declaration that breaks its schema as an error and leaves it out', () => {
    const record = { ...MEDIA, 'app/media/clip.json': json({ kind: 'video' }), 'app/media/up.json': json({ kind: 'image', file: 'media/../x.png' }) }
    const m = mediaDeclarations(packFromRecord(record))
    expect(codesOf(m.issues)).toEqual(['error:MEDIA_DECLARATION_INVALID', 'error:MEDIA_DECLARATION_INVALID'])
    expect(m.declarations.map((d) => d.key)).toEqual(['hero', 'logo'])
  })

  it('leaves a declaration that is not JSON to JSON_INVALID', () => {
    const record = { ...MEDIA, 'app/media/broken.json': '{' }
    expect(mediaDeclarations(packFromRecord(record)).issues).toEqual([])
    expect(codesOf(validatePack(packFromRecord(record)).issues)).toEqual(['error:JSON_INVALID'])
  })

  it('warns on bytes or folders under app/media/', () => {
    const record = { ...MEDIA, 'app/media/hero.png': 'png', 'app/media/nested/x.json': '{}' }
    expect(codesOf(mediaDeclarations(packFromRecord(record)).issues)).toEqual(['warning:APP_UNEXPECTED_FILE', 'warning:APP_UNEXPECTED_FILE'])
  })

  it('refuses app/assets/: every file there is LEGACY_ASSETS_FOLDER, and none of it is read', () => {
    const record = {
      ...MEDIA,
      'app/assets/old.json': json({ kind: 'image', file: 'media/old.png' }),
      'app/assets/old.png': 'old-bytes',
    }
    const m = mediaDeclarations(packFromRecord(record))
    expect(codesOf(m.issues)).toEqual(['error:LEGACY_ASSETS_FOLDER', 'error:LEGACY_ASSETS_FOLDER'])
    expect(m.declarations.map((d) => d.key)).toEqual(['hero', 'logo'])
    expect(validatePack(packFromRecord(record)).ok).toBe(false)
  })

  it('reports nothing for a pack without media', () => {
    expect(mediaDeclarations(packFromRecord({ 'pwpack.json': '{}' }))).toEqual({ declarations: [], provenance: null, issues: [] })
  })
})
