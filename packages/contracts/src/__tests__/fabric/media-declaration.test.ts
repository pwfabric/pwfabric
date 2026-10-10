/**
 * app/media/<key>.json — one media need and the page slots it fills.
 *
 * @module @pwfabric/contracts/__tests__/fabric/media-declaration
 */
import { describe, it, expect } from 'vitest'
import {
  MEDIA_DECLARATION_KINDS,
  MEDIA_DECLARATION_ORIGINS,
  MediaDeclarationSchema,
  parseMediaDeclaration,
  safeParseMediaDeclaration,
  type MediaDeclaration,
} from '../../fabric/media-declaration.js'
import * as contracts from '../../index.js'

const full: MediaDeclaration = {
  kind: 'image',
  purpose: 'A loaf on a table',
  origin: 'provided',
  slots: [{ surfaceKey: 'home', blockId: 'hero', prop: 'imageSrc' }],
  status: 'ready',
  url: 'https://media.example.com/hero.webp',
  decorative: false,
  file: 'media/hero.webp',
}

describe('MediaDeclarationSchema — valid', () => {
  it('accepts the smallest declaration: a kind', () => {
    expect(parseMediaDeclaration({ kind: 'file' })).toEqual({ kind: 'file' })
  })

  it('round-trips every member', () => {
    expect(parseMediaDeclaration(full)).toEqual(full)
  })

  it('accepts media/<name> and an origin outside the known list', () => {
    const r = safeParseMediaDeclaration({ kind: 'image', file: 'media/logo.svg', origin: 'stock' })
    expect(r.ok).toBe(true)
  })

  it('strips members it does not know', () => {
    expect(parseMediaDeclaration({ kind: 'image', key: 'hero', usedBySurfaces: ['home'] })).toEqual({ kind: 'image' })
  })
})

describe('MediaDeclarationSchema — invalid', () => {
  it('refuses a missing or unknown kind', () => {
    expect(safeParseMediaDeclaration({}).ok).toBe(false)
    const r = safeParseMediaDeclaration({ kind: 'video' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues[0]).toMatch(/^kind: /)
  })

  it('refuses a file that is not one name directly in media/', () => {
    for (const file of [
      '',
      'x.png',
      'hero.webp',
      'media/',
      'media/..',
      'media/.',
      'media/../x.png',
      'media/brand/logo.svg',
      'media/a\\x.png',
      'media/x\0.png',
      '/media/x.png',
      'app/media/x.png',
      'media/provenance.json',
    ]) {
      expect(safeParseMediaDeclaration({ kind: 'image', file }).ok, JSON.stringify(file)).toBe(false)
    }
  })

  it('refuses a slot without a prop and a non-boolean decorative', () => {
    expect(safeParseMediaDeclaration({ kind: 'image', slots: [{ surfaceKey: 'home', blockId: 'h' }] }).ok).toBe(false)
    expect(safeParseMediaDeclaration({ kind: 'image', decorative: 'yes' }).ok).toBe(false)
  })

  it('throws from parse', () => {
    expect(() => parseMediaDeclaration(null)).toThrow()
  })
})

describe('exports', () => {
  it('is reachable from the package root', () => {
    expect(contracts.MediaDeclarationSchema).toBe(MediaDeclarationSchema)
    expect(contracts.safeParseMediaDeclaration).toBe(safeParseMediaDeclaration)
    expect(MEDIA_DECLARATION_KINDS).toEqual(['image', 'file'])
    expect(MEDIA_DECLARATION_ORIGINS).toContain('library')
  })
})
