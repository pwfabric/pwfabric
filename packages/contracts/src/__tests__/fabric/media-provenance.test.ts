/**
 * media/provenance.json — one entry per exported media file.
 *
 * @module @pwfabric/contracts/__tests__/fabric/media-provenance
 */
import { describe, it, expect } from 'vitest'
import {
  MediaProvenanceEntrySchema,
  MEDIA_PROVENANCE_SOURCES,
  parseMediaProvenance,
  safeParseMediaProvenance,
  type MediaProvenance,
} from '../../fabric/media-provenance.js'
import * as contracts from '../../index.js'

const generated = {
  path: 'media/hero.webp',
  hash: 'sha256:abc',
  source: 'generated',
  model: 'image-model-1',
  createdAt: '2026-10-06T10:00:00Z',
  license: 'CC0-1.0',
} as const

const uploaded = {
  path: 'media/logo.png',
  hash: 'sha256:def',
  source: 'uploaded',
  createdAt: '2026-10-06T10:00:00+03:00',
  origin: 'https://example.com/logo.png',
} as const

describe('MediaProvenanceSchema — valid', () => {
  it('accepts an empty document', () => {
    expect(parseMediaProvenance({ items: [] })).toEqual({ items: [] })
  })

  it('round-trips generated, uploaded and provided entries', () => {
    const doc: MediaProvenance = {
      formatVersion: '1.0',
      items: [
        generated,
        uploaded,
        { path: 'media/bg.jpg', hash: 'h', source: 'provided', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    }
    expect(parseMediaProvenance(doc)).toEqual(doc)
  })

  it('lists exactly three sources', () => {
    expect(MEDIA_PROVENANCE_SOURCES).toEqual(['generated', 'uploaded', 'provided'])
  })

  it('is exported from the package root', () => {
    expect(typeof contracts.MediaProvenanceSchema.parse).toBe('function')
    expect(typeof contracts.safeParseMediaProvenance).toBe('function')
  })
})

describe('MediaProvenanceSchema — invalid', () => {
  it('refuses an unknown source', () => {
    expect(MediaProvenanceEntrySchema.safeParse({ ...generated, source: 'scraped' }).success).toBe(false)
  })

  it('refuses a createdAt that is not an ISO date-time', () => {
    const r = safeParseMediaProvenance({ items: [{ ...generated, createdAt: '6 Oct 2026' }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]).toMatch(/^items\.0\.createdAt: /)
  })

  it('refuses an origin that is not a URL', () => {
    expect(MediaProvenanceEntrySchema.safeParse({ ...uploaded, origin: 'not a url' }).success).toBe(false)
  })

  it('refuses missing path / hash', () => {
    const noPath = { hash: generated.hash, source: generated.source, createdAt: generated.createdAt }
    const noHash = { path: generated.path, source: generated.source, createdAt: generated.createdAt }
    expect(MediaProvenanceEntrySchema.safeParse(noPath).success).toBe(false)
    expect(MediaProvenanceEntrySchema.safeParse(noHash).success).toBe(false)
  })

  it('refuses the same path listed twice', () => {
    const r = safeParseMediaProvenance({ items: [generated, { ...uploaded, path: generated.path }] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues).toEqual(['items.1.path: media provenance lists "media/hero.webp" more than once'])
  })

  it('refuses a bad formatVersion, a missing items array and a non-object', () => {
    expect(safeParseMediaProvenance({ formatVersion: '1', items: [] }).ok).toBe(false)
    expect(safeParseMediaProvenance({}).ok).toBe(false)
    expect(() => parseMediaProvenance('x')).toThrow()
  })
})
