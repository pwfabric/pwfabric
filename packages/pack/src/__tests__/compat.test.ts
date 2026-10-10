/**
 * Compatibility with the archives existing producers emit today, and with
 * the reader existing consumers run. Fixtures re-create each producer's
 * framing (see __fixtures__/producers.ts and COMPAT.md).
 */
import { describe, expect, it } from 'vitest'
import { gunzipSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { hashPack, packFromRecord, readPwpack, validatePack, writePwpack, type PackValidation } from '../index.js'
import { CANONICAL_APP, CANONICAL_PACK, CRLF_PACK } from '../__fixtures__/folders.js'
import {
  buildServiceTgz,
  entries,
  generatorTgz,
  foundationTgz,
  platformExportTgz,
  platformReadTar,
  pluginTgz,
  pluginWire,
} from '../__fixtures__/producers.js'

const codes = (v: PackValidation, severity?: string): string[] =>
  [...new Set(v.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code))].sort()

describe('authoring plugin packer (rootless wire, pre-ustar headers, wall-clock mtime)', () => {
  it('reads a plain pack: rootless layout, legacy package.json, valid', async () => {
    const pack = await readPwpack(pluginTgz(pluginWire(CANONICAL_PACK)))
    expect(pack.files.has('blocks/control/button/component.tsx')).toBe(true)
    expect(pack.files.has('lib/_shared-theme.ts')).toBe(true)
    const v = validatePack(pack)
    expect(v.ok).toBe(true)
    expect(v.layout).toBe('rootless')
    expect(codes(v)).toEqual(['LAYOUT_ROOTLESS', 'LEGACY_PACKAGE_JSON'])
    expect(v.atoms.map((a) => a.id)).toEqual(['control.button'])
  })

  it('cannot carry an app: app/surfaces move to surfaces/, so the app entry is missing', async () => {
    const v = validatePack(await readPwpack(pluginTgz(pluginWire(CANONICAL_APP))))
    expect(v.ok).toBe(false)
    expect(codes(v, 'error')).toEqual(['APP_SURFACE_MISSING'])
    // the app's pages have become shelf surface atoms instead
    expect(v.atoms.some((a) => a.kind === 'surface' && a.id === 'home')).toBe(true)
  })

  it('reads a path over 100 bytes only as its first 100 bytes (the producer cuts names)', async () => {
    const long = `blocks/${'x'.repeat(60)}/${'y'.repeat(60)}/component.tsx`
    const pack = await readPwpack(pluginTgz([{ path: long, content: Buffer.from('x') }]))
    expect([...pack.files.keys()]).toEqual([long.slice(0, 100)])
  })
})

describe('first-party pack exporter (rootless wire, identity appended unsorted)', () => {
  it('reads and validates a pack, whatever the entry order', async () => {
    const pack = await readPwpack(foundationTgz(CANONICAL_PACK))
    expect([...pack.files.keys()].slice(-2)).toEqual(['pwpack.json', 'package.json'])
    const v = validatePack(pack)
    expect(v.ok).toBe(true)
    expect(codes(v)).toEqual(['LAYOUT_ROOTLESS', 'LEGACY_PACKAGE_JSON'])
  })

  it('accepts the object form of requires the first-party packs write', async () => {
    const record = {
      ...CANONICAL_PACK,
      'pwpack.json': JSON.stringify({ id: '@pwpack/acme/identity', version: '1.1.2', requires: [{ id: '@pwpack/acme/base', range: '^1.0.0' }] }),
    }
    const v = validatePack(await readPwpack(foundationTgz(record)))
    expect(codes(v, 'error')).toEqual([])
  })
})

describe('app generator delivery (canonical folder, LF-normalised, OS byte pinned)', () => {
  const delivery = {
    ...CANONICAL_APP,
    'pwpack.json': JSON.stringify({
      id: '@pwpack/acme/clinic',
      version: '1.0.0',
      app: { title: 'Clinic', description: 'Bookings', entry: 'home', surfaceOrder: ['home', 'book'], icon: '/assets/brief/icon.svg' },
      packs: [{ id: '@pwpack/acme/base', version: '2.0.0', hash: 'abc123' }],
    }),
  }

  it('reads into exactly the folder it was made from, with the same content hash', async () => {
    const pack = await readPwpack(generatorTgz(delivery))
    expect(hashPack(pack)).toBe(hashPack(packFromRecord(delivery)))
    const v = validatePack(pack)
    expect(v.ok).toBe(true)
    expect(v.layout).toBe('canonical')
    expect(v.issues).toEqual([])
  })

  it('reads long paths it splits at the shortest prefix', async () => {
    const long = `atoms/surfaces/${'g'.repeat(90)}/${'n'.repeat(80)}.receipt.json`
    const pack = await readPwpack(generatorTgz({ ...delivery, [long]: '{}' }))
    expect(pack.files.has(long)).toBe(true)
  })

  it('normalises CRLF before packing, so its hash differs from the folder on disk', async () => {
    const pack = await readPwpack(generatorTgz(CRLF_PACK))
    expect(hashPack(pack)).not.toBe(hashPack(packFromRecord(CRLF_PACK)))
  })

  it('rejects a pin without a hash and an app without an entry (both written today)', async () => {
    const v = validatePack(
      await readPwpack(
        generatorTgz({
          ...delivery,
          'pwpack.json': JSON.stringify({ id: 'x', version: '1', app: { entry: null, surfaceOrder: [] }, packs: [{ id: 'a', version: '1', hash: null }] }),
        })
      )
    )
    expect(codes(v, 'error')).toEqual(['IDENTITY_INVALID'])
    expect(v.issues.map((i) => i.message).join('\n')).toMatch(/app\.entry[\s\S]*packs\.0\.hash/)
  })
})

describe("hosting platform's build service (package/ wrapper, directory entries first)", () => {
  it('unwraps package/ and reads the folder it was built from', async () => {
    const pack = await readPwpack(buildServiceTgz(CANONICAL_APP))
    expect(hashPack(pack)).toBe(hashPack(packFromRecord(CANONICAL_APP)))
    expect(validatePack(pack).ok).toBe(true)
  })

  it('reads its rootless legacy input the same way', async () => {
    const legacy = { 'package.json': '{"name":"x","version":"1.0.0"}', 'blocks/a/b/component.tsx': 'x', 'README.md': '# x' }
    const v = validatePack(await readPwpack(buildServiceTgz(legacy)))
    expect(codes(v, 'error')).toEqual(['IDENTITY_MISSING'])
    // README.md at the root is pack content; package.json is only info.
    expect(codes(v, 'warning')).toEqual(['LAYOUT_ROOTLESS'])
  })
})

describe("hosting platform's project export (manifest first, app envelope at the root, PAX names)", () => {
  it('reads it, including a 140-byte file name carried in a PAX record, and says what it is not', async () => {
    const longReceipt = `surfaces/${'p'.repeat(140)}.receipt.json`
    const files = entries({
      'pwfabric.manifest.json': '{"id":"@pwpack/acme/site","version":"1.0.0","atoms":[]}',
      'blocks/custom/hero/component.tsx': 'x',
      'blocks/custom/hero/manifest.json': '{}',
      [longReceipt]: '{}',
      'project.json': '{}',
      'navigation.json': '{}',
    })
    const pack = await readPwpack(platformExportTgz(files))
    expect(pack.files.has(longReceipt)).toBe(true)
    const v = validatePack(pack)
    expect(codes(v, 'error')).toEqual(['IDENTITY_MISSING'])
    expect(v.issues.filter((i) => i.code === 'UNKNOWN_TOP_LEVEL').map((i) => i.path)).toEqual([
      'navigation.json',
      'project.json',
      'pwfabric.manifest.json',
    ])
  })
})

describe('writer output in the reader consumers run today', () => {
  it('yields the same files, long paths included, with directory entries skipped', async () => {
    const long = `app/surfaces/${'q'.repeat(140)}.receipt.json`
    const record = { ...CANONICAL_APP, [long]: '{}' }
    const tar = gunzipSync(await writePwpack(packFromRecord(record)))
    const read = platformReadTar(tar)
    expect(read.map((e) => e.name).sort()).toEqual(Object.keys(record).sort())
    for (const e of read) expect(Buffer.from(e.data).toString('utf8')).toBe(record[e.name])
  })
})
