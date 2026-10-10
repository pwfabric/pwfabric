/**
 * pwpack.json — the folder identity file, including `formatVersion` and
 * `engines`.
 *
 * @module @pwfabric/contracts/__tests__/fabric/pwpack-json
 */
import { describe, it, expect } from 'vitest'
import {
  PwpackIdentitySchema,
  PwpackEnginesSchema,
  PwpackIdentityAppSchema,
  parsePwpackIdentity,
  safeParsePwpackIdentity,
  type PwpackIdentity,
} from '../../fabric/pwpack-json.js'
import * as contracts from '../../index.js'

const full: PwpackIdentity = {
  id: '@pwpack/acme/shop',
  version: '1.2.0',
  formatVersion: '1.0',
  engines: { pwfabric: '>=1.0.0 <2' },
  requires: ['records'],
  license: { fork: true, redistribute: false },
  app: { entry: 'home', surfaceOrder: ['home', 'about'] },
  packs: [{ id: '@pwpack/acme/base', version: '2.0.0', hash: 'sha256:abc' }],
}

describe('PwpackIdentitySchema — valid', () => {
  it('accepts the minimal identity (id + version)', () => {
    expect(parsePwpackIdentity({ id: '@pwpack/acme/shop', version: '1.0.0' })).toEqual({
      id: '@pwpack/acme/shop',
      version: '1.0.0',
    })
  })

  it('round-trips a full identity', () => {
    expect(parsePwpackIdentity(full)).toEqual(full)
  })

  it('treats formatVersion and engines as optional (pre-versioned layout)', () => {
    const r = safeParsePwpackIdentity({ id: 'a', version: '1.0.0' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.formatVersion).toBeUndefined()
      expect(r.value.engines).toBeUndefined()
    }
  })

  it('accepts an engines object without a pwfabric range', () => {
    expect(PwpackEnginesSchema.safeParse({}).success).toBe(true)
  })

  it('strips unknown keys instead of rejecting a newer format', () => {
    const r = PwpackIdentitySchema.parse({ id: 'a', version: '1.0.0', futureField: 1 })
    expect(r).toEqual({ id: 'a', version: '1.0.0' })
  })

  it('is exported from the package root', () => {
    expect(typeof contracts.PwpackIdentitySchema.parse).toBe('function')
    expect(typeof contracts.safeParsePwpackIdentity).toBe('function')
    expect(typeof contracts.parsePwpackIdentity).toBe('function')
  })
})

describe('PwpackIdentitySchema — invalid', () => {
  it('refuses a missing or empty id / version', () => {
    expect(safeParsePwpackIdentity({ version: '1.0.0' }).ok).toBe(false)
    expect(safeParsePwpackIdentity({ id: 'x' }).ok).toBe(false)
    expect(safeParsePwpackIdentity({ id: '', version: '1.0.0' }).ok).toBe(false)
  })

  it('refuses a formatVersion that is not MAJOR.MINOR', () => {
    for (const formatVersion of ['1', '1.0.0', 'v1.0', '']) {
      const r = safeParsePwpackIdentity({ id: 'a', version: '1.0.0', formatVersion })
      expect(r.ok, formatVersion).toBe(false)
      if (!r.ok) expect(r.issues[0]).toMatch(/^formatVersion: /)
    }
  })

  it('refuses an engines.pwfabric that is not a semver range', () => {
    const r = safeParsePwpackIdentity({ id: 'a', version: '1.0.0', engines: { pwfabric: 'latest please' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues).toEqual(['engines.pwfabric: engines.pwfabric "latest please" is not a semver range'])
  })

  it('refuses an app without entry, and a pin without hash', () => {
    expect(PwpackIdentityAppSchema.safeParse({ entry: '', surfaceOrder: [] }).success).toBe(false)
    expect(safeParsePwpackIdentity({ id: 'a', version: '1', packs: [{ id: 'b', version: '1' }] }).ok).toBe(false)
  })

  it('refuses half a licence', () => {
    expect(safeParsePwpackIdentity({ id: 'a', version: '1', license: { fork: true } }).ok).toBe(false)
  })

  it('refuses a non-object document', () => {
    const r = safeParsePwpackIdentity('pwpack.json')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0)
    expect(() => parsePwpackIdentity(null)).toThrow()
  })
})

describe('pwpack.json requires and app display fields', () => {
  it('accepts requires entries as { id, range }, the shape first-party packs write', () => {
    const r = safeParsePwpackIdentity({
      id: '@pwpack/commerce',
      version: '2.0.1',
      requires: [{ id: '@pwpack/records', range: '^2.0.0' }],
    })
    expect(r.ok).toBe(true)
  })
  it('still accepts the older bare-name form', () => {
    expect(safeParsePwpackIdentity({ id: '@pwpack/a', version: '1.0.0', requires: ['records'] }).ok).toBe(true)
  })
  it('rejects an object entry whose range is not a semver range', () => {
    const r = safeParsePwpackIdentity({
      id: '@pwpack/a',
      version: '1.0.0',
      requires: [{ id: '@pwpack/records', range: 'latest-ish' }],
    })
    expect(r.ok).toBe(false)
  })
  it('keeps app title, description and icon', () => {
    const r = safeParsePwpackIdentity({
      id: '@pwpack/app',
      version: '1.0.0',
      app: { entry: 'home', surfaceOrder: ['home'], title: 'Shop', description: 'A shop', icon: 'store' },
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.app?.title).toBe('Shop')
  })
})
