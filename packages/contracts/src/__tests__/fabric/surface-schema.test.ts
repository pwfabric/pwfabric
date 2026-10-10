/**
 * Surface Document Schema Tests
 *
 * Covers blockSnapshotSchema, surfaceThemeSchema, and surfaceDocumentSchema.
 *
 * @module @pwfabric/contracts/fabric/__tests__/surface-schema
 */

import { describe, it, expect } from 'vitest'
import {
  blockSnapshotSchema,
  surfaceThemeSchema,
  surfaceDocumentSchema,
  surfaceDocumentStrictSchema,
  dataSourceSchema,
  findDuplicateBlockIds,
  assertUniqueBlockIds,
} from '../../fabric/surface-schema.js'

describe('blockSnapshotSchema', () => {
  it('should accept a minimal block (type only)', () => {
    const result = blockSnapshotSchema.safeParse({ type: 'text-block' })
    expect(result.success).toBe(true)
  })

  it('should accept a full block with all optional fields', () => {
    const result = blockSnapshotSchema.safeParse({
      id: 'block-1',
      type: 'hero-block',
      props: { title: 'Hello' },
      style: { backgroundColor: '#fff' },
      layout: { span: 12 },
      children: [{ type: 'text-block', props: {} }],
    })
    expect(result.success).toBe(true)
  })

  it('should accept nested children recursively', () => {
    const result = blockSnapshotSchema.safeParse({
      type: 'section-block',
      children: [
        {
          type: 'grid-block',
          children: [{ type: 'card-block' }],
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('should reject a block missing required type field', () => {
    const result = blockSnapshotSchema.safeParse({ id: 'block-1' })
    expect(result.success).toBe(false)
  })

  it('should reject a block with empty type string', () => {
    const result = blockSnapshotSchema.safeParse({ type: '' })
    expect(result.success).toBe(false)
  })

  it('keeps visibleWhen / if on parse (conditional visibility survives persist)', () => {
    const result = blockSnapshotSchema.safeParse({
      type: 'container',
      visibleWhen: '{{state.formOpen}}',
      if: '{{state.other}}',
    })
    expect(result.success).toBe(true)
    expect(result.data.visibleWhen).toBe('{{state.formOpen}}')
    expect(result.data.if).toBe('{{state.other}}')
  })

  it('keeps a block-level repeat on parse, at any depth', () => {
    const result = blockSnapshotSchema.safeParse({
      type: 'section',
      children: [
        {
          id: 'list',
          type: 'container',
          repeat: '{{products}}',
          children: [{ id: 'card', type: 'text', props: { content: '{{item.title}}' } }],
        },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.data.children[0].repeat).toBe('{{products}}')
    expect(result.data.children[0].children[0].props.content).toBe('{{item.title}}')
  })

  it('a block without repeat parses as before (the field is optional)', () => {
    const result = blockSnapshotSchema.safeParse({ type: 'container', children: [] })
    expect(result.success).toBe(true)
    expect('repeat' in result.data).toBe(false)
  })

  it('rejects a non-string repeat, the way visibleWhen is modelled', () => {
    expect(blockSnapshotSchema.safeParse({ type: 'container', repeat: 3 }).success).toBe(false)
    expect(
      blockSnapshotSchema.safeParse({ type: 'container', visibleWhen: true }).success
    ).toBe(false)
  })

  it('carries repeat through a whole surface document', () => {
    const result = surfaceDocumentSchema.safeParse({
      blocks: [{ type: 'container', repeat: '{{rows}}', children: [{ type: 'text' }] }],
    })
    expect(result.success).toBe(true)
    expect(result.data?.blocks[0].repeat).toBe('{{rows}}')
  })
})

describe('surfaceThemeSchema', () => {
  it('should accept undefined (theme is optional)', () => {
    const result = surfaceThemeSchema.safeParse(undefined)
    expect(result.success).toBe(true)
  })

  it('should accept an empty theme object', () => {
    const result = surfaceThemeSchema.safeParse({})
    expect(result.success).toBe(true)
  })

  it('refuses colors.surface: the container colour is colors.card', () => {
    const bad = surfaceThemeSchema.safeParse({ colors: { primary: '#6366f1', surface: '#f8fafc' } })
    expect(bad.success).toBe(false)
    expect(bad.success ? '' : bad.error.issues[0]?.message).toContain('colors.card')
    expect(surfaceThemeSchema.safeParse({ colors: { primary: '#6366f1', card: '#f8fafc' } }).success).toBe(true)
  })

  it('should accept a theme with colors', () => {
    const result = surfaceThemeSchema.safeParse({
      colors: { primary: '#6366f1', background: '#0f172a' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a theme with border tokens', () => {
    const result = surfaceThemeSchema.safeParse({
      border: { radius: '8px', width: '1px', style: 'solid', radiusLarge: '1rem' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a theme with typography tokens', () => {
    const result = surfaceThemeSchema.safeParse({
      typography: {
        fontFamily: 'Inter, sans-serif',
        headingFontFamily: 'Playfair Display, serif',
        baseFontSize: '1rem',
        headingWeight: '700',
        headingLineHeight: '1.2',
        letterSpacing: '-0.02em',
        bodyLineHeight: '1.6',
        fontSizeSm: '0.875rem',
        fontSizeXs: '0.75rem',
      },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a theme with spacing tokens', () => {
    const result = surfaceThemeSchema.safeParse({
      spacing: { base: '1rem' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a theme with layout tokens', () => {
    const result = surfaceThemeSchema.safeParse({
      layout: { gap: '1rem', padding: '1.5rem', containerMaxWidth: '1280px', gridGap: '1rem' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a theme with shadow tokens', () => {
    const result = surfaceThemeSchema.safeParse({
      shadows: { card: '0 1px 3px rgba(0,0,0,0.1)', button: '0 2px 4px rgba(0,0,0,0.2)' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a theme with motion tokens', () => {
    const result = surfaceThemeSchema.safeParse({
      motion: {
        durationFast: '150ms',
        durationNormal: '300ms',
        durationSlow: '500ms',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        easingBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    })
    expect(result.success).toBe(true)
  })
})

describe('surfaceDocumentSchema', () => {
  it('should accept an empty document (all optional, blocks defaults to [])', () => {
    const result = surfaceDocumentSchema.safeParse({})
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.blocks).toEqual([])
    }
  })

  it('should default blocks to empty array when not provided', () => {
    const result = surfaceDocumentSchema.parse({})
    expect(result.blocks).toEqual([])
  })

  it('should accept a document with blocks', () => {
    const result = surfaceDocumentSchema.safeParse({
      blocks: [{ type: 'hero-block', props: { title: 'Hello' } }],
    })
    expect(result.success).toBe(true)
  })

  it('should accept a document with a full theme', () => {
    const result = surfaceDocumentSchema.safeParse({
      theme: { colors: { primary: '#6366f1' } },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a document with styleVariables', () => {
    const result = surfaceDocumentSchema.safeParse({
      styleVariables: { 'color-primary': '#6366f1' },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a document with dataSources', () => {
    const result = surfaceDocumentSchema.safeParse({
      dataSources: [
        { id: 'ds-1', kind: 'rest', endpoint: 'https://api.example.com/data', method: 'GET' },
        { id: 'ds-2', kind: 'static', staticData: { items: [] } },
        { id: 'ds-3', kind: 'state' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('should accept a document with capabilities', () => {
    const result = surfaceDocumentSchema.safeParse({
      capabilities: [
        { capability: 'platform/persistence', required: true, config: { defaultCacheTtl: 300 } },
        { capability: 'platform/entities', required: false },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('should accept a document with initialState', () => {
    const result = surfaceDocumentSchema.safeParse({
      initialState: { count: 0, user: null },
    })
    expect(result.success).toBe(true)
  })

  it('should accept a document with metadata fields', () => {
    const result = surfaceDocumentSchema.safeParse({
      description: 'A landing page surface',
      tags: ['marketing', 'landing'],
      thumbnailUrl: 'https://cdn.example.com/thumb.png',
    })
    expect(result.success).toBe(true)
  })

  // dataSources are not a SurfaceDocument field; they live in
  // capabilities[capability='platform/persistence'].config.dataSources and
  // are validated at the capability config level.
})

describe('dataSourceSchema — dialect unification', () => {
  it('should accept connector + authProviderRef and preserve them in parse output', () => {
    const result = dataSourceSchema.safeParse({
      id: 'tasks',
      kind: 'entity',
      entityType: 'Task',
      connector: 'graph-lists',
      authProviderRef: 'contoso-entra',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.connector).toBe('graph-lists')
      expect(result.data.authProviderRef).toBe('contoso-entra')
    }
  })

  it('should still accept a data source without connector/authProviderRef', () => {
    const result = dataSourceSchema.safeParse({
      id: 'ds-1',
      kind: 'rest',
      endpoint: 'https://api.example.com/data',
      method: 'GET',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.connector).toBeUndefined()
      expect(result.data.authProviderRef).toBeUndefined()
    }
  })

  it('should reject non-string connector / authProviderRef', () => {
    expect(
      dataSourceSchema.safeParse({ id: 'ds-1', kind: 'rest', connector: 42 }).success
    ).toBe(false)
    expect(
      dataSourceSchema.safeParse({ id: 'ds-1', kind: 'rest', authProviderRef: {} }).success
    ).toBe(false)
  })
})

describe('duplicate block ids — a separate validator, the document schema stays as it was', () => {
  // A page carrying the same gallery band twice: the runtime draws both
  // (React keys on `id`) and nothing in the schema refuses it. The
  // document schema is a published contract, so it keeps parsing what it
  // parsed; the refusal is a validator a caller opts into.
  const band = (id: string, children: unknown[] = []) => ({ id, type: 'section', props: {}, children })
  const twice = {
    blocks: [
      band('hero'),
      band('galeri-detay-bandi', [{ id: 'galeri-grid', type: 'gallery' }]),
      band('galeri-detay-bandi', [{ id: 'galeri-grid', type: 'gallery' }]),
    ],
  }
  const nestedDup = {
    blocks: [band('hero', [{ id: 'cta', type: 'button' }, { id: 'cta', type: 'button' }])],
  }

  it('findDuplicateBlockIds walks children and names every repeated id once, with its paths', () => {
    const dups = findDuplicateBlockIds(twice.blocks)
    expect(dups.map((d) => d.id)).toEqual(['galeri-detay-bandi', 'galeri-grid'])
    expect(dups[0]?.paths).toEqual([
      ['blocks', 1, 'id'],
      ['blocks', 2, 'id'],
    ])
    expect(dups[1]?.paths).toEqual([
      ['blocks', 1, 'children', 0, 'id'],
      ['blocks', 2, 'children', 0, 'id'],
    ])
    expect(findDuplicateBlockIds(nestedDup.blocks).map((d) => d.id)).toEqual(['cta'])
  })

  it('finds nothing on a clean tree and ignores blocks without an id', () => {
    expect(findDuplicateBlockIds([band('a', [band('b')]), band('c'), { type: 'text' }, { type: 'text' }])).toEqual([])
    expect(findDuplicateBlockIds(undefined)).toEqual([])
  })

  it('assertUniqueBlockIds throws naming the repeated id', () => {
    expect(() => assertUniqueBlockIds(twice.blocks)).toThrow(/galeri-detay-bandi/)
    expect(() => assertUniqueBlockIds([band('a'), band('b')])).not.toThrow()
  })

  it('surfaceDocumentStrictSchema rejects the duplicate with a custom issue at the second block', () => {
    const result = surfaceDocumentStrictSchema.safeParse(twice)
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.code === 'custom')
      expect(issue?.path).toEqual(['blocks', 2, 'id'])
      expect(issue?.message).toContain('galeri-detay-bandi')
    }
    expect(surfaceDocumentStrictSchema.safeParse({ blocks: [band('a'), band('b')] }).success).toBe(true)
  })

  it('surfaceDocumentSchema still parses a document with duplicate ids (published contract unchanged)', () => {
    expect(surfaceDocumentSchema.safeParse(twice).success).toBe(true)
  })
})

describe('dataSourceSchema — aggregate', () => {
  // A counter page ("12 people are coming") used to download the whole list
  // and count it client-side — on an intake collection that is a 403, and on
  // a public one it is every RSVP name handed to a stranger. The backend has
  // `/count` and `/aggregate`; this is the key the source declares to use them.
  // Additive and optional — a source without it parses exactly as before.
  it('accepts a count with no field and preserves it', () => {
    const result = dataSourceSchema.safeParse({
      id: 'records',
      kind: 'entity',
      entityType: 'Rsvp',
      aggregate: { fn: 'count' },
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.aggregate).toEqual({ fn: 'count' })
  })

  it('accepts sum/avg with a field and a filter in the query.filter shape', () => {
    const filter = { field: 'status', operator: 'eq', value: 'yes' }
    for (const fn of ['sum', 'avg'] as const) {
      const result = dataSourceSchema.safeParse({
        id: 'records',
        kind: 'entity',
        entityType: 'Rsvp',
        aggregate: { fn, field: 'guests', filter },
      })
      expect(result.success).toBe(true)
      if (result.success) expect(result.data.aggregate).toEqual({ fn, field: 'guests', filter })
    }
  })

  it('rejects an unknown fn, a non-string field and a non-object filter', () => {
    const base = { id: 'records', kind: 'entity', entityType: 'Rsvp' }
    expect(dataSourceSchema.safeParse({ ...base, aggregate: { fn: 'median' } }).success).toBe(false)
    // The enum is what the platform answers today (count|sum|avg).
    // A published contract enum cannot be narrowed later; min/max can be added
    // once the backend serves them.
    expect(dataSourceSchema.safeParse({ ...base, aggregate: { fn: 'min', field: 'guests' } }).success).toBe(false)
    expect(dataSourceSchema.safeParse({ ...base, aggregate: { fn: 'max', field: 'guests' } }).success).toBe(false)
    expect(dataSourceSchema.safeParse({ ...base, aggregate: { fn: 'sum', field: 3 } }).success).toBe(false)
    expect(dataSourceSchema.safeParse({ ...base, aggregate: { fn: 'count', filter: 'yes' } }).success).toBe(false)
  })

  it('a source without aggregate parses as before, aggregate undefined', () => {
    const result = dataSourceSchema.safeParse({ id: 'records', kind: 'entity', entityType: 'Rsvp' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.aggregate).toBeUndefined()
  })
})
