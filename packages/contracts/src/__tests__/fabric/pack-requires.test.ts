/**
 * requires.packs — the pack-level dependency declaration and its closure.
 *
 * WHAT THESE LOCK. Consumers (a marketplace, a delivery path, an app builder)
 * install packs by this resolver, so its refusals are the contract: a missing
 * pack, an unsatisfiable range and a cycle must each come back as their own
 * typed error, never as a shorter install list.
 *
 * POSITIVE CONTROL. The "rejects" cases below are the positive control for the
 * validation: remove the range refine, the duplicate check or the self check
 * and at least one of them goes red. The last describe block proves the
 * fixtures are real by showing the same manifests pass once the defect is
 * removed — so a red here means the rule, not a broken fixture.
 *
 * @module @pwfabric/contracts/__tests__/fabric/pack-requires
 */
import { describe, it, expect } from 'vitest'
import {
  PwpackRequirementsSchema,
  validatePwpackRequirements,
  resolvePackClosure,
  satisfiesSemverRange,
  isValidSemverRange,
  isValidSemverVersion,
  packRefKey,
  type PackClosureCandidate,
} from '../../fabric/pack-requires.js'
import * as contracts from '../../index.js'
import type { PwpackManifest } from '../../fabric/atom.js'

const pack = (id: string, version: string, packs?: { id: string; range: string }[]): PackClosureCandidate => ({
  id,
  version,
  ...(packs ? { requires: { tokens: ['--pw-color-primary-ink'], packs } } : {}),
})

describe('semver ranges', () => {
  it.each([
    ['2.3.1', '^2.0.0', true],
    ['3.0.0', '^2.0.0', false],
    ['1.9.9', '^2.0.0', false],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.4.9', '~1.4.2', true],
    ['1.5.0', '~1.4.2', false],
    ['1.4.0', '~1.4', true],
    ['1.9.0', '~1', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '1.2.3', false],
    ['1.2.4', '=1.2.3', false],
    ['1.7.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.9', '1.2.*', true],
    ['9.9.9', '*', true],
    ['2.5.0', '>=1.2.0 <3', true],
    ['3.0.0', '>=1.2.0 <3', false],
    ['2.5.0', '>= 1.2.0 < 3.0.0', true],
    ['1.3.0', '>1.2', true],
    ['1.2.9', '>1.2', false],
    ['2.0.0', '>1', true],
    ['1.9.0', '<=1', true],
    ['2.0.0', '<=1', false],
    ['1.1.9', '<1.2', true],
    ['1.2.0', '<1.2', false],
    ['1.2.0', '>1.1.9', true],
    ['1.2.0', '<=1.2.0', true],
    ['2.0.0', '1.x || 2.x', true],
    ['3.0.0', '1.x || 2.x', false],
    ['1.5.0', '1.2.0 - 2.0.0', true],
    ['2.0.1', '1.2.0 - 2.0.0', false],
    ['2.3.9', '1.2 - 2.3', true],
    ['2.4.0', '1.2 - 2.3', false],
    ['1.2.0', '^1.x', true],
    ['0.5.0', '^0.x', true],
    ['0.2.0', '^0.1', false],
    ['1.2.0', '~>1.2.0', true],
    ['2.0.0', 'v2.0.0', true],
    ['4.0.0', '', true],
  ])('%s satisfies %s → %s', (version, range, expected) => {
    expect(satisfiesSemverRange(version, range)).toBe(expected)
  })

  it('treats prereleases the npm way', () => {
    expect(satisfiesSemverRange('2.0.0-rc.1', '^2.0.0')).toBe(false)
    expect(satisfiesSemverRange('2.0.0-rc.2', '^2.0.0-rc.1')).toBe(true)
    expect(satisfiesSemverRange('2.0.1-rc.1', '^2.0.0-rc.1')).toBe(false)
    expect(satisfiesSemverRange('3.0.0-0', '^2.0.0')).toBe(false)
    expect(satisfiesSemverRange('2.0.0-alpha', '2.0.0-alpha')).toBe(true)
    expect(satisfiesSemverRange('2.0.0-beta.2', '>=2.0.0-beta.10')).toBe(false)
    expect(satisfiesSemverRange('2.0.0-beta', '>=2.0.0-2')).toBe(true)
    expect(satisfiesSemverRange('2.0.0-beta.1', '>=2.0.0-beta')).toBe(true)
    expect(satisfiesSemverRange('2.0.0', '>2.0.0-rc.1')).toBe(true)
  })

  it.each(['^2', 'latest', '1.2.3.4', '>=', '^x.y', '<*', '>*', '1.2.3 - ', 'a - b', '01.2.3', '^1.2.3 || foo'])(
    'rejects "%s" as a range unless it is one',
    (range) => {
      const valid = ['^2'].includes(range)
      expect(isValidSemverRange(range)).toBe(valid)
    }
  )

  it('never satisfies with an unparseable version or range', () => {
    expect(satisfiesSemverRange('two', '^2.0.0')).toBe(false)
    expect(satisfiesSemverRange('2.0.0', 'latest')).toBe(false)
    expect(isValidSemverRange('x'.repeat(300))).toBe(false)
    expect(isValidSemverVersion('2.0')).toBe(false)
    expect(isValidSemverVersion('2.0.0+build.7')).toBe(true)
  })
})

describe('packRefKey', () => {
  it('names a pack the same by bare name and by full id', () => {
    expect(packRefKey('@pwpack/records')).toBe('records')
    expect(packRefKey('records')).toBe('records')
    expect(packRefKey(' @pwpack/acme/tools ')).toBe('acme/tools')
  })
})

describe('PwpackRequirementsSchema', () => {
  it('accepts a manifest without packs — the field is additive', () => {
    expect(PwpackRequirementsSchema.safeParse({ tokens: ['--pw-color-primary-ink'] }).success).toBe(true)
    expect(PwpackRequirementsSchema.safeParse({}).success).toBe(true)
    expect(validatePwpackRequirements('@pwpack/records', undefined)).toEqual({
      ok: true,
      value: {},
    })
  })

  it('accepts a pack under its own npm scope, and refuses what is not a pack id', () => {
    // `pwf create --foundation` writes the foundation's own id here.
    const ok = (id: string) => PwpackRequirementsSchema.safeParse({ packs: [{ id, range: '^1.0.0' }] }).success
    expect(ok('@pwfabric/foundation')).toBe(true)
    expect(ok('@pwpack/acme/cards')).toBe(true)
    expect(ok('records')).toBe(true)
    expect(ok('@/foundation')).toBe(false)
    expect(ok('@pwfabric/')).toBe(false)
    expect(ok('../foundation')).toBe(false)
    expect(ok('foundation pack')).toBe(false)
  })

  it('accepts the shape first-party packs already write (commerce → pitch)', () => {
    const commerce = {
      tokens: ['--pw-color-primary-ink'],
      packs: [{ id: 'pitch', range: '^2.0.0' }],
    }
    expect(PwpackRequirementsSchema.safeParse(commerce).success).toBe(true)
    expect(validatePwpackRequirements('@pwpack/commerce', commerce).ok).toBe(true)
  })

  it('accepts full ids and several dependencies', () => {
    const r = validatePwpackRequirements('@pwpack/microsoft', {
      packs: [
        { id: '@pwpack/identity', range: '^1.1.0' },
        { id: 'records', range: '>=2.0.0 <3' },
      ],
    })
    expect(r.ok).toBe(true)
  })

  it('types a manifest carrying requires.packs', () => {
    const m: PwpackManifest = {
      id: '@pwpack/commerce',
      version: '2.0.0',
      atoms: [],
      contentHash: 'sha256:00',
      storageRef: 'pwpacks/pwpack-commerce/2.0.0/00.tgz',
      requires: { packs: [{ id: 'records', range: '^2.0.0' }] },
    }
    expect(validatePwpackRequirements(m.id, m.requires).ok).toBe(true)
  })

  it('rejects a range that is not semver', () => {
    const r = validatePwpackRequirements('@pwpack/commerce', {
      packs: [{ id: 'records', range: 'latest' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join('\n')).toMatch(/packs\.0\.range: .*"latest" is not a semver range/)
  })

  it('rejects the same pack twice, even spelled two ways', () => {
    const r = validatePwpackRequirements('@pwpack/commerce', {
      packs: [
        { id: 'records', range: '^2.0.0' },
        { id: '@pwpack/records', range: '^2.1.0' },
      ],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues.join('\n')).toMatch(/packs\.1\.id: requires\.packs names "records" more than once/)
  })

  it('rejects a pack that requires itself', () => {
    const r = validatePwpackRequirements('@pwpack/records', {
      packs: [{ id: 'records', range: '^2.0.0' }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.issues).toEqual(['packs.0.id: pack "records" requires itself'])
  })

  it('rejects missing fields, unknown keys and malformed ids', () => {
    for (const bad of [
      { packs: [{ id: 'records' }] },
      { packs: [{ range: '^1.0.0' }] },
      { packs: [{ id: '', range: '^1.0.0' }] },
      { packs: [{ id: '../records', range: '^1.0.0' }] },
      { packs: [{ id: 'records', range: '^1.0.0', optional: true }] },
      { packs: 'records' },
      { tokens: [''] },
    ]) {
      expect(PwpackRequirementsSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
    expect(validatePwpackRequirements('@pwpack/x', 'nope').ok).toBe(false)
  })
})

describe('resolvePackClosure — ordering', () => {
  const foundation = pack('@pwpack/foundation', '4.0.0')
  const records = pack('@pwpack/records', '2.0.0', [{ id: 'foundation', range: '^4.0.0' }])
  const interactive = pack('@pwpack/interactive', '1.0.0', [{ id: 'records', range: '^2.0.0' }])
  const identity = pack('@pwpack/identity', '1.1.0', [{ id: 'interactive', range: '^1.0.0' }])
  const workspace = pack('@pwpack/workspace', '1.0.0', [{ id: 'foundation', range: '^4.0.0' }])
  const microsoft = pack('@pwpack/microsoft', '1.2.0', [
    { id: 'identity', range: '^1.1.0' },
    { id: 'records', range: '^2.0.0' },
  ])
  const all = [microsoft, workspace, identity, interactive, records, foundation]

  const ids = (r: ReturnType<typeof resolvePackClosure>) => (r.ok ? r.order.map((p) => p.id) : r.error)

  it('installs dependencies before dependents, each once', () => {
    expect(ids(resolvePackClosure(['microsoft'], all))).toEqual([
      '@pwpack/foundation',
      '@pwpack/records',
      '@pwpack/interactive',
      '@pwpack/identity',
      '@pwpack/microsoft',
    ])
  })

  it('is deterministic across several roots and shares the common base', () => {
    expect(ids(resolvePackClosure(['@pwpack/workspace', 'identity'], all))).toEqual([
      '@pwpack/foundation',
      '@pwpack/workspace',
      '@pwpack/records',
      '@pwpack/interactive',
      '@pwpack/identity',
    ])
  })

  it('returns a root with no requirements alone, and nothing for no roots', () => {
    expect(ids(resolvePackClosure(['foundation'], all))).toEqual(['@pwpack/foundation'])
    expect(ids(resolvePackClosure([], all))).toEqual([])
  })

  it('returns the candidate objects it was given', () => {
    const r = resolvePackClosure(['records'], all)
    expect(r.ok && r.order[1]).toBe(records)
  })

  it('handles a diamond once (a → b, a → c, b → d, c → d)', () => {
    const d = pack('d', '1.0.0')
    const b = pack('b', '1.0.0', [{ id: 'd', range: '1.x' }])
    const c = pack('c', '1.0.0', [{ id: 'd', range: '^1.0.0' }])
    const a = pack('a', '1.0.0', [
      { id: 'b', range: '*' },
      { id: 'c', range: '*' },
    ])
    expect(ids(resolvePackClosure(['a'], [a, b, c, d]))).toEqual(['d', 'b', 'c', 'a'])
  })
})

describe('resolvePackClosure — refusals', () => {
  it('refuses a missing root', () => {
    const r = resolvePackClosure(['records'], [pack('@pwpack/foundation', '4.0.0')])
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'MISSING_PACK',
        pack: 'records',
        requiredBy: null,
        range: null,
      },
    })
  })

  it('refuses a missing dependency and names who needed it', () => {
    const r = resolvePackClosure(
      ['commerce'],
      [pack('@pwpack/commerce', '2.0.0', [{ id: 'records', range: '^2.0.0' }])]
    )
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'MISSING_PACK',
        pack: 'records',
        requiredBy: 'commerce',
        range: '^2.0.0',
      },
    })
  })

  it('refuses a dependency whose available version is out of range', () => {
    const r = resolvePackClosure(
      ['commerce'],
      [pack('@pwpack/commerce', '2.0.0', [{ id: 'records', range: '^2.0.0' }]), pack('@pwpack/records', '1.0.0')]
    )
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'UNSATISFIED_RANGE',
        pack: 'records',
        version: '1.0.0',
        range: '^2.0.0',
        requiredBy: 'commerce',
      },
    })
  })

  it('checks the range on every edge, not only the first visit', () => {
    const r = resolvePackClosure(
      ['a', 'b'],
      [
        pack('a', '1.0.0', [{ id: 'c', range: '^1.0.0' }]),
        pack('b', '1.0.0', [{ id: 'c', range: '^2.0.0' }]),
        pack('c', '1.4.0'),
      ]
    )
    expect(r.ok === false && r.error).toEqual({
      code: 'UNSATISFIED_RANGE',
      pack: 'c',
      version: '1.4.0',
      range: '^2.0.0',
      requiredBy: 'b',
    })
  })

  it('refuses a cycle and returns its path', () => {
    const r = resolvePackClosure(
      ['a'],
      [
        pack('a', '1.0.0', [{ id: 'b', range: '*' }]),
        pack('b', '1.0.0', [{ id: 'c', range: '*' }]),
        pack('c', '1.0.0', [{ id: 'a', range: '*' }]),
      ]
    )
    expect(r).toEqual({
      ok: false,
      error: { code: 'CYCLE', path: ['a', 'b', 'c', 'a'] },
    })
  })

  it('refuses a candidate whose requires is malformed — a self-requirement included', () => {
    const r = resolvePackClosure(['a'], [pack('a', '1.0.0', [{ id: 'a', range: '^1.0.0' }])])
    expect(r).toEqual({
      ok: false,
      error: {
        code: 'INVALID_REQUIRES',
        pack: 'a',
        issues: ['packs.0.id: pack "a" requires itself'],
      },
    })
    const bad = resolvePackClosure(['a'], [pack('a', '1.0.0', [{ id: 'b', range: 'latest' }]), pack('b', '1.0.0')])
    expect(bad.ok === false && bad.error.code).toBe('INVALID_REQUIRES')
  })

  it('refuses a candidate with a non-semver version', () => {
    const r = resolvePackClosure(['a'], [pack('a', 'one')])
    expect(r.ok === false && r.error.code).toBe('INVALID_REQUIRES')
  })

  it('refuses two candidates for one pack', () => {
    const r = resolvePackClosure(['records'], [pack('records', '2.0.0'), pack('@pwpack/records', '2.1.0')])
    expect(r).toEqual({
      ok: false,
      error: { code: 'DUPLICATE_PACK', pack: 'records' },
    })
  })
})

describe('positive control — the fixtures are sound, the rule is what refuses', () => {
  it('the refused declarations pass once their one defect is removed', () => {
    expect(
      validatePwpackRequirements('@pwpack/commerce', {
        packs: [{ id: 'records', range: '^2.0.0' }],
      }).ok
    ).toBe(true)
    expect(
      validatePwpackRequirements('@pwpack/commerce', {
        packs: [
          { id: 'records', range: '^2.0.0' },
          { id: '@pwpack/identity', range: '^2.1.0' },
        ],
      }).ok
    ).toBe(true)
    expect(
      validatePwpackRequirements('@pwpack/commerce', {
        packs: [{ id: 'records', range: '^2.0.0' }],
      }).ok
    ).toBe(true)
  })

  it('the refused closures resolve once their one defect is removed', () => {
    expect(
      resolvePackClosure(
        ['commerce'],
        [pack('commerce', '2.0.0', [{ id: 'records', range: '^2.0.0' }]), pack('records', '2.0.0')]
      ).ok
    ).toBe(true)
    expect(resolvePackClosure(['a'], [pack('a', '1.0.0', [{ id: 'b', range: '*' }]), pack('b', '1.0.0')]).ok).toBe(true)
  })

  it('is reachable from the package root', () => {
    expect(typeof contracts.resolvePackClosure).toBe('function')
    expect(typeof contracts.validatePwpackRequirements).toBe('function')
    expect(contracts.PwpackRequirementsSchema).toBeDefined()
  })
})
