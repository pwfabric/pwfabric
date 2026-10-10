/**
 * The canonical pwpack folder through `classifyAtom`,
 * `classifyPackPath`, and the two optional manifest fields.
 *
 * WHAT THESE LOCK. The change is additive: every path `classifyAtom`
 * classified before still returns the identical `{ kind, id }`, and
 * `atoms/<same path>` returns that same classification — `atoms/` is a root,
 * not part of the id. The only paths whose result is new are under `atoms/`.
 *
 * @module @pwfabric/contracts/__tests__/atom-classify-canonical
 */

import { describe, it, expect } from 'vitest'
import { AtomFileManifestSchema, classifyAtom, classifyPackPath } from '../fabric/atom.js'
import type { AtomFileManifest, PackPathClassification, PwpackManifest } from '../fabric/atom.js'
import { IDENTITY_METHODS } from '../fabric/project-identity.js'

/**
 * Every rootless path the legacy rules classify, with the `{ kind, id }` they
 * returned BEFORE the `atoms/` root existed — written out, not computed, so a change to the
 * rootless rules fails here too.
 */
const ROOTLESS: ReadonlyArray<readonly [string, { kind: string; id: string }]> = [
  ['blocks/marketing/hero/component.tsx', { kind: 'block', id: 'marketing.hero' }],
  ['blocks/marketing/hero/bundle.mjs', { kind: 'block', id: 'marketing.hero' }],
  ['blocks/hero/component.tsx', { kind: 'block', id: 'hero' }],
  ['surfaces/landing.receipt.json', { kind: 'surface', id: 'landing' }],
  ['surfaces/marketing/landing.receipt.json', { kind: 'surface', id: 'marketing.landing' }],
  ['capabilities/persistence/handler.ts', { kind: 'capability', id: 'platform/persistence' }],
  ['appearance/default/manifest.json', { kind: 'ui-appearance', id: 'default' }],
  ['patterns/two-column.json', { kind: 'pattern', id: 'two-column' }],
  ['icons/icons.json', { kind: 'icon-set', id: 'icons' }],
  ['connectors/Sharepoint.knowledge.json', { kind: 'connector', id: 'Sharepoint' }],
  ['providers/microsoft/entities/mail.knowledge.json', { kind: 'provider', id: 'microsoft.mail' }],
  ['auth/AuthProvider.knowledge.json', { kind: 'auth-provider', id: 'auth' }],
  ['auth/AuthProvider.tsx', { kind: 'auth-provider', id: 'auth' }],
  ...IDENTITY_METHODS.map(
    (m) => [`auth/${m}.knowledge.json`, { kind: 'auth-provider', id: `auth.${m}` }] as const,
  ),
]

/** Rootless paths that were inert cargo before the `atoms/` root and must stay so, with and without it. */
const ROOTLESS_INERT = [
  'connectors/Sharepoint.ts',
  'providers/microsoft/index.ts',
  'README.md',
  'patterns/nested/two-column.json',
  'surfaces/landing.json',
  'blocks/component.tsx',
  'auth/bogus.knowledge.json',
  'auth/password.tsx',
  'auth/methods/password.knowledge.json',
] as const

describe('classifyAtom — legacy rootless paths are unchanged', () => {
  it.each(ROOTLESS)('%s', (path, expected) => {
    expect(classifyAtom(path)).toEqual(expected)
  })
})

describe('classifyAtom — atoms/<family>/… classifies exactly as <family>/…', () => {
  it.each(ROOTLESS)('atoms/%s', (path, expected) => {
    expect(classifyAtom(`atoms/${path}`)).toEqual(classifyAtom(path))
    expect(classifyAtom(`atoms/${path}`)).toEqual(expected)
  })

  it.each(ROOTLESS_INERT)('atoms/%s stays inert, as its rootless form does', (path) => {
    expect(classifyAtom(path)).toBeNull()
    expect(classifyAtom(`atoms/${path}`)).toBeNull()
  })

  it('strips the root once: atoms/atoms/… is not an atom', () => {
    expect(classifyAtom('atoms/atoms/blocks/marketing/hero/component.tsx')).toBeNull()
  })
})

describe('classifyAtom — the canonical folder non-atom paths are null', () => {
  it.each([
    ['atoms/lib/_shared-cards.ts', 'shared code, a compiler companion'],
    ['lib/_shared-cards.ts', 'rootless lib, inert cargo as before'],
    ['app/surfaces/home.json', 'the app declaration, read by ingest'],
    ['pwpack.json', 'pack identity'],
  ])('%s (%s)', (path) => {
    expect(classifyAtom(path)).toBeNull()
  })
})

describe('classifyPackPath', () => {
  it.each(ROOTLESS)('rootless atom %s', (path, expected) => {
    expect(classifyPackPath(path)).toEqual({ kind: 'atom', atom: expected })
  })

  it.each(ROOTLESS)('canonical atom atoms/%s', (path, expected) => {
    expect(classifyPackPath(`atoms/${path}`)).toEqual({ kind: 'atom', atom: expected })
  })

  it.each<[string, PackPathClassification | null]>([
    ['pwpack.json', { kind: 'identity' }],
    ['atoms/lib/_shared-cards.ts', { kind: 'lib', rel: '_shared-cards.ts' }],
    ['atoms/lib/hooks/use-thing.ts', { kind: 'lib', rel: 'hooks/use-thing.ts' }],
    ['app/surfaces/home.json', { kind: 'app', rel: 'surfaces/home.json' }],
    ['app/plan.json', { kind: 'app', rel: 'plan.json' }],
    // only a ROOT pwpack.json is identity; package.json never is
    ['package.json', null],
    ['app/pwpack.json', { kind: 'app', rel: 'pwpack.json' }],
    ['atoms/pwpack.json', null],
    // legacy rootless lib: the same companions, same rel (pack transfer emits it)
    ['lib/_shared-cards.ts', { kind: 'lib', rel: '_shared-cards.ts' }],
    ['lib/hooks/use-thing.ts', { kind: 'lib', rel: 'hooks/use-thing.ts' }],
    ['lib/', null],
    // bare roots are not files
    ['app/', null],
    ['atoms/lib/', null],
    // inert cargo, both layouts
    ['README.md', null],
    ['atoms/README.md', null],
    ['connectors/Sharepoint.ts', null],
    ['atoms/connectors/Sharepoint.ts', null],
  ])('%s', (path, expected) => {
    expect(classifyPackPath(path)).toEqual(expected)
  })

  it('an atom result carries exactly classifyAtom(relPath)', () => {
    for (const [path] of ROOTLESS) {
      for (const p of [path, `atoms/${path}`]) {
        const r = classifyPackPath(p)
        expect(r?.kind).toBe('atom')
        if (r?.kind === 'atom') expect(r.atom).toEqual(classifyAtom(p))
      }
    }
  })
})

describe('PwpackManifest.license and AtomFileManifest.forkedFrom (optional)', () => {
  const base: AtomFileManifest = {
    id: 'ui.button',
    kind: 'block',
    version: '1.0.0',
    name: 'Button',
    state: 'stable',
    knowledge: {
      purpose: 'Render a button',
      useCases: ['submit a form'],
      composesWith: [],
      antiPatterns: ['avoid as a heading'],
    },
  }
  const forkedFrom = {
    pack: '@pwpack/acme/base',
    version: '2.0.0',
    atomId: 'ui.button',
    hash: 'sha256-abc',
  }

  it('type-checks with and without the new fields', () => {
    const original: AtomFileManifest = base
    const forked: AtomFileManifest = { ...base, forkedFrom }
    const pack: PwpackManifest = {
      id: '@pwpack/acme/kit',
      version: '1.0.0',
      atoms: [],
      contentHash: 'x',
      storageRef: 'y',
    }
    const licensed: PwpackManifest = { ...pack, license: { fork: true, redistribute: false } }
    expect(original.forkedFrom).toBeUndefined()
    expect(forked.forkedFrom?.atomId).toBe('ui.button')
    expect(pack.license).toBeUndefined()
    expect(licensed.license).toEqual({ fork: true, redistribute: false })
  })

  it('the schema accepts a manifest with and without forkedFrom', () => {
    expect(AtomFileManifestSchema.safeParse(base).success).toBe(true)
    expect(AtomFileManifestSchema.safeParse({ ...base, forkedFrom }).success).toBe(true)
  })

  it('the schema rejects an incomplete, over-full or empty forkedFrom', () => {
    const { hash: _hash, ...noHash } = forkedFrom
    void _hash
    expect(AtomFileManifestSchema.safeParse({ ...base, forkedFrom: noHash }).success).toBe(false)
    expect(
      AtomFileManifestSchema.safeParse({ ...base, forkedFrom: { ...forkedFrom, extra: 1 } }).success,
    ).toBe(false)
    expect(
      AtomFileManifestSchema.safeParse({ ...base, forkedFrom: { ...forkedFrom, hash: '' } }).success,
    ).toBe(false)
  })
})
