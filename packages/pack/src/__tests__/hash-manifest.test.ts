import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  compareBytes,
  deriveAtoms,
  deriveManifest,
  hashPack,
  isSafePackPath,
  legacyContentHash,
  packFromRecord,
  PackError,
  writePwpack,
} from '../index.js'
import { CANONICAL_APP, CANONICAL_PACK } from '../__fixtures__/folders.js'

const sha = (s: string | Uint8Array): string => createHash('sha256').update(s).digest('hex')

describe('hashPack', () => {
  it('is sha256 over byte-sorted "path\\0sha256(content)\\n" lines', () => {
    const record = { 'atoms/b.txt': 'B', 'atoms/a/z.txt': 'Z', 'atoms/a-b.txt': 'AB' }
    const lines = ['atoms/a-b.txt', 'atoms/a/z.txt', 'atoms/b.txt'].map((p) => `${p}\0${sha(record[p as keyof typeof record])}\n`).join('')
    expect(hashPack(packFromRecord(record))).toBe(`sha256:${sha(lines)}`)
  })

  it('uses byte order, not locale order', () => {
    expect(compareBytes('B', 'a')).toBeLessThan(0)
    expect(compareBytes('a', 'a')).toBe(0)
    expect(compareBytes('ab', 'a')).toBeGreaterThan(0)
    expect(compareBytes('z', 'é')).toBeLessThan(0)
  })

  it('changes when a byte changes (framing independence: see compat.test.ts)', () => {
    const a = packFromRecord(CANONICAL_PACK)
    const b = packFromRecord({ ...CANONICAL_PACK, 'atoms/lib/_shared-theme.ts': 'export const t = 2\n' })
    expect(hashPack(a)).not.toBe(hashPack(b))
  })
})

describe('legacyContentHash', () => {
  it('is sha256 of the archive bytes', async () => {
    const tgz = await writePwpack(packFromRecord(CANONICAL_PACK))
    expect(legacyContentHash(tgz)).toBe(`sha256:${sha(tgz)}`)
  })
})

describe('isSafePackPath', () => {
  it.each(['', 'a/./b', 'a/', '\0', 'C:x'])('rejects %j', (p) => expect(isSafePackPath(p)).toBe(false))
  it('accepts a normal path', () => expect(isSafePackPath('atoms/blocks/a/b/component.tsx')).toBe(true))
})

describe('deriveAtoms', () => {
  it('classifies every kind in the canonical layout, sorted by kind then id', () => {
    const atoms = deriveAtoms(packFromRecord(CANONICAL_APP))
    expect(atoms.map((a) => `${a.kind}:${a.id}`)).toEqual([
      'auth-provider:auth',
      'block:panel.card',
      'capability:platform/booking',
      'connector:rest',
      'icon-set:icons',
      'pattern:hero-split',
      'provider:crm.contact',
      'surface:marketing.landing',
      'ui-appearance:calm',
    ])
    const card = atoms.find((a) => a.id === 'panel.card')!
    expect(card.relPath).toBe('atoms/blocks/panel/card/component.tsx')
    expect(card.contentHash).toBe(sha(CANONICAL_APP['atoms/blocks/panel/card/component.tsx']!))
  })

  it('lets the knowledge file win the auth atom (first in byte order)', () => {
    const auth = deriveAtoms(packFromRecord(CANONICAL_APP)).find((a) => a.kind === 'auth-provider')!
    expect(auth.relPath).toBe('atoms/auth/AuthProvider.knowledge.json')
  })

  it('classifies the rootless layout the same way', () => {
    const atoms = deriveAtoms(packFromRecord({ 'blocks/panel/card/component.tsx': 'x', 'lib/a.ts': 'y' }))
    expect(atoms).toEqual([{ kind: 'block', id: 'panel.card', relPath: 'blocks/panel/card/component.tsx', contentHash: sha('x') }])
  })
})

describe('deriveManifest', () => {
  it('builds a full manifest from pwpack.json and the archive', async () => {
    const pack = packFromRecord(CANONICAL_APP)
    const archive = await writePwpack(pack)
    const m = deriveManifest(pack, { archive })
    const hex = sha(archive)
    expect(m).toMatchObject({
      id: '@pwpack/acme/clinic',
      version: '1.2.0',
      contentHash: `sha256:${hex}`,
      storageRef: `pwpacks/pwpack-acme-clinic/1.2.0/${hex.slice(0, 12)}.tgz`,
      license: { fork: true, redistribute: false },
    })
    expect(m.atoms).toHaveLength(9)
  })

  it('takes id and version overrides and omits license when pwpack.json is invalid', async () => {
    const pack = packFromRecord({ 'pwpack.json': '{"id":"@pwpack/x/y","version":"1.0.0","requires":[{"id":"a"}]}' })
    const m = deriveManifest(pack, { archive: new Uint8Array(0), version: '9.9.9' })
    expect(m.version).toBe('9.9.9')
    expect(m.id).toBe('@pwpack/x/y')
    expect('license' in m).toBe(false)
  })

  it('throws IDENTITY_REQUIRED without an id or version', () => {
    const run = (record: Record<string, string>): string => {
      try {
        deriveManifest(packFromRecord(record), { archive: new Uint8Array(0) })
      } catch (e) {
        return (e as PackError).code
      }
      return 'none'
    }
    expect(run({})).toBe('IDENTITY_REQUIRED')
    expect(run({ 'pwpack.json': 'not json' })).toBe('IDENTITY_REQUIRED')
    expect(run({ 'pwpack.json': '[1]' })).toBe('IDENTITY_REQUIRED')
    expect(run({ 'pwpack.json': '{"id":"@pwpack/x/y"}' })).toBe('IDENTITY_REQUIRED')
  })

  it('reads a pwpack.json that starts with a byte-order mark', () => {
    const m = deriveManifest(packFromRecord({ 'pwpack.json': '﻿{"id":"@pwpack/x/y","version":"1.0.0"}' }), {
      archive: new Uint8Array(0),
    })
    expect(m.version).toBe('1.0.0')
  })
})
