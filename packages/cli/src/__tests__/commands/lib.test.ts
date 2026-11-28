import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { packFromRecord, validatePack } from '@pwfabric/pack'
import {
  caretRange,
  engineRange,
  engineVersion,
  findPackageJson,
  orderIdentity,
  stripBom,
  upsertPin,
} from '../../commands/lib/identity.js'
import { cacheRelDir } from '../../commands/lib/project.js'
import { catalogOf, starterAppearance, starterBlocks, starterTheme, titleOf } from '../../commands/lib/starter.js'
import { boolFlag } from '../../commands/lib/flags.js'
import { schemaErrors, SPEC_SCHEMAS_MISSING, tempDir } from './helpers.js'

describe('identity helpers', () => {
  it('orders members and keeps unknown ones after the known', () => {
    expect(Object.keys(orderIdentity({ z: 1, packs: [], id: 'a', version: '1', gone: undefined }))).toEqual(['id', 'version', 'packs', 'z'])
  })
  it('places the listing members and tokens where the format lists them', () => {
    const doc = { packs: [], app: {}, license: {}, tokens: [], requires: [], engines: {}, category: 'c', description: 'd', name: 'n', formatVersion: '1.1', version: '1', id: 'a' }
    expect(Object.keys(orderIdentity(doc))).toEqual(['id', 'version', 'formatVersion', 'name', 'description', 'category', 'engines', 'requires', 'tokens', 'license', 'app', 'packs'])
  })
  it('derives ranges and refuses non-semver', () => {
    expect(caretRange('12.4.0')).toBe('^12.0.0')
    expect(() => caretRange('latest')).toThrow('not a semver version')
    expect(engineRange('4.17.0')).toBe('>=4.17 <5')
    expect(() => engineRange('4')).toThrow('not semver')
  })
  it('replaces a pin with the same id where it was', () => {
    const doc: Record<string, unknown> = { packs: [{ id: 'a', version: '1', hash: 'x' }, { id: 'b', version: '1', hash: 'y' }] }
    upsertPin(doc, { id: 'a', version: '2', hash: 'z' })
    expect(doc.packs).toEqual([{ id: 'a', version: '2', hash: 'z' }, { id: 'b', version: '1', hash: 'y' }])
  })
  it('reads the engine version from the installed contracts package', async () => {
    expect(engineVersion()).toMatch(/^\d+\.\d+\.\d+/)
    const dir = await tempDir()
    expect(findPackageJson('@scope/never-installed', dir)).toBeNull()
    expect(() => engineVersion(dir)).toThrow('cannot find')
    const pkg = join(dir, 'node_modules', ...'@pwfabric/contracts'.split('/'))
    await mkdir(pkg, { recursive: true })
    await writeFile(join(pkg, 'package.json'), '{}')
    expect(() => engineVersion(dir)).toThrow('has no version')
  })
  it('strips a byte-order mark only at the start', () => {
    expect(stripBom(`${String.fromCharCode(0xfeff)}{}`)).toBe('{}')
    expect(stripBom('{}')).toBe('{}')
  })
})

describe('project helpers', () => {
  it('nests scoped ids and refuses ids that escape the cache', () => {
    expect(cacheRelDir('@pwpack/example/cards', '1.0.0')).toBe('.pwf/packs/@pwpack/example/cards@1.0.0')
    expect(() => cacheRelDir('../x', '1.0.0')).toThrow('not usable')
    expect(() => cacheRelDir('a:b', '1.0.0')).toThrow('not usable')
  })
  it('reads switches', () => {
    expect(boolFlag({ positionals: [], flags: { a: true, b: 'false' } }, 'a')).toBe(true)
    expect(boolFlag({ positionals: [], flags: { b: 'false' } }, 'b')).toBe(false)
  })
})

describe('starter', () => {
  it('reads block types from manifests and falls back to the id when a manifest is missing or broken', () => {
    const pack = packFromRecord({
      'pwpack.json': '{"id":"@pwpack/x/y","version":"1.0.0"}',
      'blocks/text/title/component.tsx': '',
      'blocks/text/text/component.tsx': '',
      'blocks/text/text/manifest.json': '{ not json',
      'blocks/control/button/component.tsx': '',
      'blocks/control/button/manifest.json': '{"name":"button","definition":{"props":[{"name":"text"},7,{"name":3}],"tokens":[{"name":"radius","type":"length","default":"6px","description":"Corner."},{"name":"bad-name","type":"length","default":"1px","description":"x"}]}}',
      'appearance/dark/manifest.json': '[]',
      'appearance/b-light/manifest.json': '{"id":"b-light"}',
    })
    const catalog = catalogOf(pack, validatePack(pack))
    expect(catalog.blocks.map((b) => b.type).sort()).toEqual(['button', 'text', 'title'])
    expect(catalog.blocks.find((b) => b.type === 'button')?.props).toEqual(['text'])
    // Its look tokens by name (describe-project lists them); a malformed one is left out.
    expect(catalog.blocks.find((b) => b.type === 'button')?.tokens).toEqual(['radius'])
    expect(catalog.blocks.find((b) => b.type === 'title')?.tokens).toBeUndefined()
    expect(starterTheme(catalog)).toBe('b-light')
    const blocks = starterBlocks(catalog, 'My App')
    expect(blocks).toEqual([
      { id: 'title', type: 'title', props: {} },
      { id: 'intro', type: 'text', props: {} },
      { id: 'cta', type: 'button', props: { text: 'Get started' } },
    ])
  })
  it('prefers theme-zinc and has an appearance without any theme', () => {
    expect(starterTheme({ blocks: [], themes: ['a', 'theme-zinc'] })).toBe('theme-zinc')
    expect(starterTheme({ blocks: [], themes: [] })).toBeUndefined()
    expect(starterAppearance(undefined)).toBeDefined()
  })
  it.skipIf(SPEC_SCHEMAS_MISSING !== undefined)(
    `writes an appearance without a theme that the spec schema accepts${SPEC_SCHEMAS_MISSING ? ` (skipped: ${SPEC_SCHEMAS_MISSING})` : ''}`,
    () => {
      expect(schemaErrors('definitions.appearance', starterAppearance(undefined))).toEqual([])
    }
  )
  it('titles names', () => {
    expect(titleOf('my-shop_v2')).toBe('My Shop V2')
  })
})
