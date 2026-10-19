import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { packFromRecord, validatePack, type PackFolder, type PackValidation } from '../index.js'
import { CANONICAL_APP, CANONICAL_PACK, mediaPack } from '../__fixtures__/folders.js'

const codes = (v: PackValidation, severity?: string): string[] =>
  v.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code)

const withIdentity = (identity: unknown, extra: Record<string, string> = {}): PackValidation =>
  validatePack(packFromRecord({ 'pwpack.json': JSON.stringify(identity), ...extra }))

describe('validatePack — valid folders', () => {
  it('accepts the canonical app with no issues', () => {
    const v = validatePack(packFromRecord(CANONICAL_APP))
    expect(v.issues).toEqual([])
    expect(v.ok).toBe(true)
    expect(v.layout).toBe('canonical')
    expect(v.identity?.app?.entry).toBe('home')
    expect(v.atoms).toHaveLength(9)
  })

  it('accepts a plain canonical pack', () => {
    const v = validatePack(packFromRecord(CANONICAL_PACK))
    expect(v.ok).toBe(true)
    expect(v.issues).toEqual([])
  })

  it('reports an identity-only folder as empty layout', () => {
    expect(withIdentity({ id: 'x', version: '1' }).layout).toBe('empty')
  })
})

describe('validatePack — identity', () => {
  it('requires pwpack.json', () => {
    const v = validatePack(packFromRecord({ 'atoms/icons/icons.json': '{}' }))
    expect(v.ok).toBe(false)
    expect(codes(v, 'error')).toEqual(['IDENTITY_MISSING'])
    expect(v.identity).toBeNull()
  })

  it('reports pwpack.json that is not JSON', () => {
    const v = validatePack(packFromRecord({ 'pwpack.json': '{ nope' }))
    expect(codes(v, 'error')).toEqual(['IDENTITY_INVALID'])
  })

  it('reports each schema issue', () => {
    const v = withIdentity({ id: '', version: 1, requires: [{ id: '@pwpack/a', range: 'not a range' }] })
    expect(codes(v, 'error').every((c) => c === 'IDENTITY_INVALID')).toBe(true)
    expect(v.issues.length).toBeGreaterThanOrEqual(3)
    expect(v.issues.some((i) => i.message.includes('requires'))).toBe(true)
  })

  it('warns on a newer formatVersion and accepts the current one', () => {
    expect(codes(withIdentity({ id: 'x', version: '1', formatVersion: '2.0' }))).toEqual(['FORMAT_VERSION_NEWER'])
    expect(codes(withIdentity({ id: 'x', version: '1', formatVersion: '1.7' }))).toEqual([])
  })

  it('notes a legacy package.json', () => {
    const v = withIdentity({ id: 'x', version: '1' }, { 'package.json': '{}' })
    expect(v.ok).toBe(true)
    expect(codes(v, 'info')).toEqual(['LEGACY_PACKAGE_JSON'])
  })
})

describe('validatePack — app', () => {
  const app = (entry: string, surfaceOrder: string[], surfaces: string[]): PackValidation =>
    withIdentity(
      { id: 'x', version: '1', app: { entry, surfaceOrder } },
      Object.fromEntries(surfaces.map((s) => [`app/surfaces/${s}.receipt.json`, '{}']))
    )

  it('requires a receipt for the entry and for every ordered surface', () => {
    const v = app('home', ['home', 'about'], ['about'])
    expect(codes(v, 'error')).toEqual(['APP_SURFACE_MISSING'])
    expect(v.issues[0]?.path).toBe('app/surfaces/home.receipt.json')
    expect(codes(app('home', ['home', 'about', 'gone'], ['home', 'about']), 'error')).toEqual(['APP_SURFACE_MISSING'])
  })

  it('warns when the entry is not in the order, or a key repeats', () => {
    expect(codes(app('home', ['about'], ['home', 'about']))).toEqual(['APP_ENTRY_NOT_IN_ORDER'])
    expect(codes(app('home', ['home', 'home'], ['home']))).toEqual(['APP_SURFACE_DUPLICATE'])
  })

  it('warns on a receipt the app does not serve (its key is not in the order)', () => {
    const v = app('home', ['home'], ['home', 'menu'])
    expect(v.ok).toBe(true)
    expect(codes(v)).toEqual(['APP_SURFACE_NOT_SERVED'])
    expect(v.issues[0]?.path).toBe('app/surfaces/menu.receipt.json')
    // The entry is served even when the order forgot it (that has its own warning).
    expect(codes(app('home', ['about'], ['home', 'about']))).toEqual(['APP_ENTRY_NOT_IN_ORDER'])
  })

  it('accepts app/content for a shared entity with UUID ids', () => {
    const v = withIdentity({ id: 'x', version: '1' }, {
      'app/definitions/entities.json': JSON.stringify({ entities: [{ typeId: 'Product', fields: [] }] }),
      'app/content/Product.json': JSON.stringify({ data: [{ id: '0b7d1c56-3f7e-4a52-9a0c-1f2e3d4c5b6a', name: 'Tea' }] }),
    })
    expect(v.issues).toEqual([])
  })

  it('refuses app/content that is undeclared, misshaped, or without stable ids', () => {
    const entities = JSON.stringify({ entities: [{ typeId: 'Product', fields: [] }, { typeId: 'Order', fields: [] }] })
    const id = '0b7d1c56-3f7e-4a52-9a0c-1f2e3d4c5b6a'
    const v = withIdentity({ id: 'x', version: '1' }, {
      'app/definitions/entities.json': entities,
      'app/content/Ghost.json': JSON.stringify({ data: [] }),
      'app/content/Product.json': JSON.stringify({ data: [{ id: 'p1' }, { name: 'no id' }, { id }, { id: id.toUpperCase() }] }),
      'app/content/notes.md': 'x',
    })
    expect(v.issues.map((i) => `${i.severity}:${i.code}:${i.path}`)).toEqual([
      'error:APP_CONTENT_UNDECLARED:app/content/Ghost.json',
      'error:APP_CONTENT_ID:app/content/Product.json',
      'error:APP_CONTENT_ID:app/content/Product.json',
      'error:APP_CONTENT_ID:app/content/Product.json',
      'warning:APP_UNEXPECTED_FILE:app/content/notes.md',
    ])
    expect(withIdentity({ id: 'x', version: '1' }, {
      'app/definitions/entities.json': entities,
      'app/content/Product.json': JSON.stringify([{ id }]),
    }).issues.map((i) => i.code)).toEqual(['APP_CONTENT_INVALID'])
  })

  it('checks access rules: entity, subject and verbs (definitions, `access`)', () => {
    const entities = JSON.stringify({ entities: [{ typeId: 'Booking', displayName: 'Booking request', fields: [] }, { typeId: 'Product', fields: [] }] })
    const auth = (rules: unknown[]): string => JSON.stringify({ topology: 'app', methods: ['password'], access: { roles: ['staff'], rules } })
    const codes = (rules: unknown[]): string[] =>
      withIdentity({ id: 'x', version: '1' }, { 'app/definitions/entities.json': entities, 'app/definitions/auth.json': auth(rules) })
        .issues.map((i) => i.message)
    expect(codes([
      { subject: 'public', model: 'Booking', rule: 'create, count' },
      { subject: 'member', model: 'booking request', rule: 'read own' },
      { subject: 'staff', model: 'Booking', rule: 'read update' },
    ])).toEqual([])
    const bad = codes([
      { subject: 'customer', model: 'Order', rule: 'sees their own orders' },
      { subject: 'anyone', model: 'Product', rule: 'read' },
    ])
    expect(bad).toEqual([
      expect.stringContaining('names "Order"'),
      expect.stringContaining('is for "customer"'),
      expect.stringContaining('not verbs (sees, their, orders)'),
      expect.stringContaining('has no verb'),
      expect.stringContaining('is for "anyone"'),
    ])
  })

  it('warns when content fills a collection only `own` readers reach', () => {
    const id = '0b7d1c56-3f7e-4a52-9a0c-1f2e3d4c5b6a'
    const files = (rules: unknown[]): Record<string, string> => ({
      'app/definitions/entities.json': JSON.stringify({ entities: [{ typeId: 'Note', fields: [] }] }),
      'app/definitions/auth.json': JSON.stringify({ topology: 'app', methods: ['password'], access: { rules } }),
      'app/content/Note.json': JSON.stringify({ data: [{ id }] }),
    })
    const issues = (rules: unknown[]): string[] => withIdentity({ id: 'x', version: '1' }, files(rules)).issues.map((i) => `${i.severity}:${i.code}`)
    expect(issues([{ subject: 'member', model: 'Note', rule: 'read own' }])).toEqual(['warning:APP_CONTENT_UNREADABLE'])
    expect(issues([{ subject: 'member', model: 'Note', rule: 'read own' }, { subject: 'public', model: 'Note', rule: 'list' }])).toEqual([])
    expect(issues([])).toEqual([])
  })

  it('warns on files under app/surfaces that are not receipts', () => {
    const v = withIdentity({ id: 'x', version: '1' }, { 'app/surfaces/notes.md': 'x', 'app/surfaces/a/b.receipt.json': '{}' })
    expect(codes(v)).toEqual(['APP_UNEXPECTED_FILE', 'APP_UNEXPECTED_FILE'])
  })

  it('errors on app JSON that does not parse, warns elsewhere', () => {
    const v = withIdentity({ id: 'x', version: '1' }, { 'app/plan.json': '{', 'atoms/patterns/p.json': '{' })
    expect(v.issues.map((i) => `${i.severity}:${i.code}:${i.path}`)).toEqual([
      'error:JSON_INVALID:app/plan.json',
      'warning:JSON_INVALID:atoms/patterns/p.json',
    ])
  })
})

describe('validatePack — layout and paths', () => {
  it('flags unknown top-level entries once per name', () => {
    const v = withIdentity({ id: 'x', version: '1' }, { 'README.md': 'x', 'docs/a.md': 'x', 'docs/b.md': 'x', 'pwfabric.manifest.json': '{}' })
    expect(v.issues.filter((i) => i.code === 'UNKNOWN_TOP_LEVEL').map((i) => i.path)).toEqual([
      'docs/',
      'pwfabric.manifest.json',
    ])
  })

  it('flags unknown families and stray files under atoms/', () => {
    const v = withIdentity({ id: 'x', version: '1' }, { 'atoms/widgets/a.ts': 'x', 'atoms/stray.txt': 'x', 'atoms/test/a.ts': 'x' })
    expect(v.issues.filter((i) => i.code === 'UNKNOWN_ATOM_FAMILY').map((i) => i.path)).toEqual(['atoms/stray.txt', 'atoms/widgets'])
  })

  it('detects the rootless and mixed layouts', () => {
    const rootless = withIdentity({ id: 'x', version: '1' }, { 'blocks/a/b/component.tsx': 'x', 'lib/u.ts': 'x', 'surfaces/home.receipt.json': '{}' })
    expect(rootless.layout).toBe('rootless')
    expect(codes(rootless)).toEqual(['LAYOUT_ROOTLESS'])
    expect(rootless.ok).toBe(true)
    const mixed = withIdentity({ id: 'x', version: '1' }, { 'blocks/a/b/manifest.json': '{}', 'atoms/icons/icons.json': '{}' })
    expect(mixed.layout).toBe('mixed')
    expect(codes(mixed)).toEqual(['LAYOUT_MIXED'])
  })

  it('treats root lib/ and test/ as neutral in either layout', () => {
    const v = validatePack(packFromRecord({ ...CANONICAL_PACK, 'test/pack.test.ts': 'x', 'lib/old.ts': 'x' }))
    expect(v.layout).toBe('canonical')
    expect(v.issues).toEqual([])
  })

  it('reports unsafe paths in a hand-built folder', () => {
    const pack: PackFolder = { files: new Map([['../x', new Uint8Array(0)], ['pwpack.json', new TextEncoder().encode('{"id":"x","version":"1"}')]]) }
    expect(codes(validatePack(pack), 'error')).toEqual(['UNSAFE_PATH'])
  })
})

describe('validatePack — atoms', () => {
  it('errors when two atom directories yield the same kind:id', () => {
    const v = withIdentity(
      { id: 'x', version: '1' },
      { 'atoms/blocks/a/b/component.tsx': 'x', 'blocks/a/b/component.tsx': 'y', 'atoms/surfaces/m/l.receipt.json': '{}', 'atoms/surfaces/m.l.receipt.json': '{}' }
    )
    expect(codes(v, 'error')).toEqual(['DUPLICATE_ATOM', 'DUPLICATE_ATOM'])
  })

  it('does not count two files of one atom directory as duplicates', () => {
    const v = withIdentity({ id: 'x', version: '1' }, { 'atoms/blocks/a/b/component.tsx': 'x', 'atoms/blocks/a/b/bundle.mjs': 'y' })
    expect(v.ok).toBe(true)
    expect(v.atoms).toHaveLength(1)
  })
})

describe('validatePack — media', () => {
  const hero = 'RIFF....WEBP'
  const heroHash = `sha256:${createHash('sha256').update(hero).digest('hex')}`

  it('accepts media whose provenance lists and hashes it', () => {
    const v = validatePack(packFromRecord(mediaPack(hero, heroHash)))
    expect(v.issues).toEqual([])
  })

  it('warns on a hash mismatch and on undeclared media', () => {
    const record = { ...mediaPack(hero, 'sha256:00'), 'media/extra.png': 'x' }
    expect(codes(validatePack(packFromRecord(record)))).toEqual(['MEDIA_HASH_MISMATCH', 'MEDIA_UNDECLARED'])
  })

  it('ignores a hash in another notation', () => {
    expect(codes(validatePack(packFromRecord(mediaPack(hero, 'blake3:zz'))))).toEqual([])
  })

  it('errors when provenance names a missing file', () => {
    const record = mediaPack(hero, heroHash)
    delete record['media/hero.webp']
    expect(codes(validatePack(packFromRecord(record)), 'error')).toEqual(['MEDIA_PROVENANCE_PATH_MISSING'])
  })

  it('errors on provenance that is not JSON or not valid', () => {
    const bad = (text: string): string[] =>
      codes(validatePack(packFromRecord({ 'pwpack.json': '{"id":"x","version":"1"}', 'media/provenance.json': text })), 'error')
    expect(bad('{')).toEqual(['MEDIA_PROVENANCE_INVALID'])
    expect(bad('{"items":[{"path":"media/a"}]}')).toContain('MEDIA_PROVENANCE_INVALID')
  })
})
