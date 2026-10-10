import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { packFromRecord, validatePack } from '@pwfabric/pack'
import {
  atomRootOf,
  compileSources,
  compileTreeOf,
  createCompileCache,
  mapLimit,
  type CompiledAtom,
} from '../../dev/compile.js'
import type { SourcePack } from '../../dev/sources.js'

const manifest = (id: string, name: string): string =>
  JSON.stringify({
    id,
    kind: 'block',
    version: '1.0.0',
    category: id.split('.')[0],
    name,
    state: 'stable',
    knowledge: { purpose: 'p', useCases: ['u'], composesWith: [], antiPatterns: ['a'] },
  })

function source(files: Record<string, string>, label = '.pwf/packs/@pwpack/t/t@1.0.0'): SourcePack {
  const folder = packFromRecord({ 'pwpack.json': JSON.stringify({ id: '@pwpack/t/t', version: '1.0.0' }), ...files })
  return { origin: 'pack', id: '@pwpack/t/t', version: '1.0.0', dir: '/x', label, folder, validation: validatePack(folder) }
}

const BLOCK = `import * as React from 'react'
import { clean } from '../../../lib/_shared-a.js'
export const def = { type: 'a', schema: {} }
export default function A() { return React.createElement('p', null, clean('x')) }
`

const byId = (atoms: CompiledAtom[], id: string): CompiledAtom => atoms.find((a) => a.id === id) as CompiledAtom

let dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })))
  dirs = []
})

describe('compileSources', () => {
  it('compiles blocks with their companions, caches by content, and recompiles what changed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pwf-cache-'))
    dirs.push(dir)
    const files = {
      'atoms/blocks/x/a/component.tsx': BLOCK,
      'atoms/blocks/x/a/manifest.json': manifest('x.a', 'a'),
      'atoms/blocks/x/b/component.tsx': `export default function B() { return null }\nexport const def = { type: 'b', schema: {} }\n`,
      'atoms/blocks/x/b/manifest.json': manifest('x.b', 'b'),
      'atoms/lib/_shared-a.ts': `export const clean = (s: string) => s.trim()\n`,
    }
    const cache = createCompileCache(dir)
    const first = await compileSources([source(files)], cache)
    expect(first.map((a) => [a.id, a.status, a.fromCache])).toEqual([
      ['x.a', 'compiled', false],
      ['x.b', 'compiled', false],
    ])
    const a = byId(first, 'x.a')
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(a.code).toContain('react')
    expect(a.manifest?.['name']).toBe('a')
    expect((await readdir(dir)).length).toBe(2)

    // Same content, new process: served from disk.
    const again = await compileSources([source(files)], createCompileCache(dir))
    expect(again.every((x) => x.fromCache)).toBe(true)
    expect(byId(again, 'x.a').code).toBe(a.code)

    // A changed companion recompiles only the block that imports it.
    const changed = await compileSources(
      [source({ ...files, 'atoms/lib/_shared-a.ts': `export const clean = (s: string) => s.toUpperCase()\n` })],
      cache
    )
    expect(byId(changed, 'x.a').fromCache).toBe(false)
    expect(byId(changed, 'x.b').fromCache).toBe(true)
  })

  it('reports compile errors with the pack path and a screen finding as a warning', async () => {
    const atoms = await compileSources(
      [
        source({
          'atoms/blocks/x/bad/component.tsx': `import x from 'left-pad'\nexport default function Bad() { return x }\n`,
          'atoms/blocks/x/bad/manifest.json': manifest('x.bad', 'bad'),
        }),
      ],
      createCompileCache(null)
    )
    const bad = byId(atoms, 'x.bad')
    expect(bad.status).toBe('failed')
    expect(bad.code).toBeUndefined()
    expect(bad.diagnostics.some((d) => d.code === 'NON_HOST_IMPORT' && d.severity === 'error')).toBe(true)
    expect(bad.diagnostics.some((d) => d.code === 'SCREEN' && d.severity === 'warning')).toBe(true)
    expect(bad.diagnostics.every((d) => d.path?.startsWith('.pwf/packs/@pwpack/t/t@1.0.0/atoms/blocks/x/bad/'))).toBe(true)
  })

  it('compiles connector engines, keeps declared engines as data and takes shipped bundles as they are', async () => {
    const atoms = await compileSources(
      [
        source(
          {
            'connectors/Echo.knowledge.json': JSON.stringify({ name: 'Echo', kind: 'connector', connection: 'echo' }),
            'connectors/Echo.ts': `export default class Echo { async query() { return [] } }\n`,
            'connectors/Still.knowledge.json': JSON.stringify({ name: 'Still', kind: 'connector', connection: 'still', engine: { v: 1 } }),
            'blocks/x/pre/bundle.mjs': `export const Component = () => null\n`,
            'blocks/x/pre/manifest.json': manifest('x.pre', 'pre'),
          },
          ''
        ),
      ],
      createCompileCache(null),
      1
    )
    expect(byId(atoms, 'Echo').status).toBe('compiled')
    expect(byId(atoms, 'Echo').manifest?.['connection']).toBe('echo')
    expect(byId(atoms, 'Still').status).toBe('declared')
    expect(byId(atoms, 'Still').manifest?.['engine']).toEqual({ v: 1 })
    const pre = byId(atoms, 'x.pre')
    expect(pre.status).toBe('precompiled')
    expect(pre.code).toBe(`export const Component = () => null\n`)
  })
})

describe('compile helpers', () => {
  it('finds the atom root and the compiler view of a source', () => {
    const canonical = source({ 'atoms/lib/x.ts': 'x', 'app/plan.json': '{}' })
    expect(atomRootOf(canonical)).toBe('atoms/')
    expect(Object.keys(compileTreeOf(canonical))).toEqual(['lib/x.ts'])
    const rootless = source({ 'lib/x.ts': 'x', 'app/plan.json': '{}' })
    expect(atomRootOf(rootless)).toBe('')
    expect(Object.keys(compileTreeOf(rootless))).toEqual(['lib/x.ts'])
  })
  it('keeps order under a concurrency limit', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, n))
      inFlight--
      return n * 10
    })
    expect(out).toEqual([50, 10, 30, 20])
    expect(peak).toBe(2)
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([])
  })
  it('ignores a disk cache it cannot read or write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pwf-cache-'))
    dirs.push(dir)
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(dir, 'bad.json'), '{not json')
    await writeFile(join(dir, 'odd.json'), '{"code": 1}')
    const cache = createCompileCache(dir)
    expect(await cache.get('bad')).toBeUndefined()
    expect(await cache.get('odd')).toBeUndefined()
    expect(await cache.get('missing')).toBeUndefined()
    // A path that is a file cannot be a cache folder: set still succeeds in memory.
    const blocked = createCompileCache(join(dir, 'bad.json'))
    await blocked.set('k', { ok: true, code: 'c', hash: 'h', diagnostics: [] })
    expect(await blocked.get('k')).toEqual({ ok: true, code: 'c', hash: 'h', diagnostics: [] })
  })
})
