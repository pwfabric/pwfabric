/**
 * The block host-import contract, checked against itself.
 *
 * The bundler's externals, a host's import map and its shim files must agree;
 * a host that misses one specifier breaks every block that imports it. One
 * list only helps if the one cannot rot. These are the properties every consumer assumes when it derives
 * from the list; each was chosen because breaking it produces a failure the
 * consumer reports somewhere else, late, and usually silently.
 */
import { describe, it, expect } from 'vitest'
import {
  BLOCK_HOST_IMPORTS,
  blockBundleExternals,
  blockImportMap,
  blockShimFiles,
  blockHostGlobals,
  unseededHostGlobals,
  specifiersForShim,
  isExportableName,
  shimSource,
} from '../blocks/host-imports.js'

describe('BLOCK_HOST_IMPORTS', () => {
  it('declares every specifier exactly once', () => {
    const seen = BLOCK_HOST_IMPORTS.map((i) => i.specifier)
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('gives every global-kind entry a globalThis key', () => {
    // A `global` entry without a key produces a shim that re-exports from
    // `globalThis[undefined]` — every named import from it is `undefined`, and
    // the block fails at render, not at load.
    for (const entry of BLOCK_HOST_IMPORTS.filter((i) => i.kind === 'global')) {
      expect(entry.global, entry.specifier).toBeTruthy()
    }
  })

  it('shares one zod instance rather than a copy per block', () => {
    // Not a preference: introspection walks a prop schema with `instanceof`,
    // which a second zod would break.
    const zod = BLOCK_HOST_IMPORTS.find((i) => i.specifier === 'zod')
    expect(zod?.kind).toBe('global')
    expect(zod?.global).toBe('__pwfabric_zod')
    expect(blockHostGlobals('standalone')).toContain('__pwfabric_zod')
  })

  it('keeps one global per shim file', () => {
    // Several specifiers may share a shim — that is the aliasing this contract
    // is built for. What they may NOT do is disagree about which global that
    // file reads: one file cannot re-export from two places.
    const globalByShim = new Map<string, string>()
    for (const entry of BLOCK_HOST_IMPORTS) {
      if (!entry.global) continue
      const already = globalByShim.get(entry.shim)
      if (already === undefined) globalByShim.set(entry.shim, entry.global)
      else expect(entry.global, `${entry.shim} via ${entry.specifier}`).toBe(already)
    }
  })

  it('names shim files that can be served from a static directory', () => {
    for (const entry of BLOCK_HOST_IMPORTS) {
      expect(entry.shim, entry.specifier).toMatch(/^[A-Za-z0-9@._-]+\.mjs$/)
    }
  })

  it('explains every entry', () => {
    // The reason is the only defence against a specifier nobody can justify
    // later. An entry that cannot say why it is here is a candidate for removal,
    // and removing one silently breaks every block already built against it.
    for (const entry of BLOCK_HOST_IMPORTS) {
      expect(entry.reason.length, entry.specifier).toBeGreaterThan(20)
    }
  })

  it('carries the specifiers blocks depend on', () => {
    // Regression lock. These four are not a sample: blocks depend on each, and
    // a host import map that misses one breaks them.
    const specifiers = blockBundleExternals()
    expect(specifiers).toContain('zod')
    expect(specifiers).toContain('@pwfabric/contracts')
    expect(specifiers).toContain('@pwfabric/runtime')
    expect(specifiers).toContain('@pwfabric/authoring')
  })
})

describe('derivations', () => {
  it('externals covers the whole list', () => {
    expect(blockBundleExternals()).toHaveLength(BLOCK_HOST_IMPORTS.length)
  })

  it('maps every specifier to a served shim path', () => {
    const { imports } = blockImportMap('/_pwfabric/shims')
    expect(Object.keys(imports)).toHaveLength(BLOCK_HOST_IMPORTS.length)
    for (const entry of BLOCK_HOST_IMPORTS) {
      expect(imports[entry.specifier]).toBe(`/_pwfabric/shims/${entry.shim}`)
    }
  })

  it('takes the shim base as given, without inventing a separator', () => {
    // One host may serve these from `assets/shims`, another from
    // `/_pwfabric/shims`. A helper that hard-coded either would be wrong for the
    // other, and a trailing slash would produce a double slash in the map.
    const { imports } = blockImportMap('assets/shims')
    expect(imports['zod']).toBe('assets/shims/zod.mjs')
  })

  it('lists each shim file once, sorted', () => {
    const files = blockShimFiles()
    expect(new Set(files).size).toBe(files.length)
    expect([...files]).toEqual([...files].sort())
    // A shim file appears once however many specifiers it serves.
    expect(files.filter((f) => f === 'sdk@v1.mjs')).toHaveLength(1)
  })

  it('lists each host global once, sorted', () => {
    const globals = blockHostGlobals()
    expect(new Set(globals).size).toBe(globals.length)
    expect([...globals]).toEqual([...globals].sort())
    expect(globals).toContain('__pwfabric_runtime')
  })

  it('asks the standalone export for no less than the app host', () => {
    // The sdk global used to be app-host only; a shipped app then rendered no
    // block written with defineBlock(). Every host seeds it now, so the two
    // lists agree — the app host's may only ever be the larger.
    const appHost = blockHostGlobals('app-host')
    const standalone = blockHostGlobals('standalone')
    expect(standalone).toContain('__pwfabric_sdk')
    for (const g of standalone) expect(appHost).toContain(g)
  })

  it('leaves unseeded globals out of both lists and names them instead', () => {
    // An entry nothing seeds is a gap, not a requirement. Putting it in a host's
    // list would produce a gate that cannot be satisfied; leaving it out
    // silently would hide it. It goes in its own list.
    const unseeded = unseededHostGlobals().map((i) => i.global)
    expect(unseeded.length).toBeGreaterThan(0)
    for (const g of unseeded) {
      expect(blockHostGlobals('app-host')).not.toContain(g)
      expect(blockHostGlobals('standalone')).not.toContain(g)
    }
  })

  it('reads the jsx-runtime global the seeders actually write', () => {
    // Regression lock. The shim and both seeders write `__pwfabric_jsx_runtime`.
    // A contract that disagrees with the only two files that fill the global is
    // worse than no contract — it invites someone to "fix" the seeder.
    const jsx = BLOCK_HOST_IMPORTS.find((i) => i.specifier === 'react/jsx-runtime')
    expect(jsx?.global).toBe('__pwfabric_jsx_runtime')
  })

  it('gives every entry a global and a seeding status', () => {
    // Every specifier here is resolved through a shim that reads a global, so
    // an entry without one describes a shim that cannot be written.
    for (const entry of BLOCK_HOST_IMPORTS) {
      expect(entry.global, entry.specifier).toBeTruthy()
      expect(entry.seeding, entry.specifier).toBeTruthy()
    }
  })

  it('reverses the shim alias', () => {
    const viaSdk = specifiersForShim('sdk@v1.mjs')
    expect(viaSdk).toEqual(['@pwfabric/authoring'])
    expect(specifiersForShim('does-not-exist.mjs')).toEqual([])
  })

  it('reaches every entry through exactly one shim', () => {
    const covered = blockShimFiles().flatMap((f) => specifiersForShim(f))
    expect(covered.sort()).toEqual([...blockBundleExternals()].sort())
  })
})

describe('runtime subpaths', () => {
  it('maps each listed runtime subpath to the runtime shim and its global, exactly', () => {
    // An import map resolves exact specifiers only. A subpath joins this list
    // only when the runtime root re-exports all of it (the runtime package
    // checks that), so the root shim serves it unchanged.
    const root = BLOCK_HOST_IMPORTS.find((i) => i.specifier === '@pwfabric/runtime')
    const subs = BLOCK_HOST_IMPORTS.filter((i) => i.specifier.startsWith('@pwfabric/runtime/'))
    expect(subs.map((i) => i.specifier).sort()).toEqual([
      '@pwfabric/runtime/adapters',
      '@pwfabric/runtime/capability',
      '@pwfabric/runtime/data',
    ])
    const { imports } = blockImportMap('/_pwfabric/shims')
    for (const sub of subs) {
      expect(sub.shim, sub.specifier).toBe(root?.shim)
      expect(sub.global, sub.specifier).toBe(root?.global)
      expect(sub.seeding, sub.specifier).toBe(root?.seeding)
      expect(imports[sub.specifier]).toBe('/_pwfabric/shims/runtime.mjs')
    }
  })
})

describe('shim sources', () => {
  /** Evaluates a shim's source against `seed` as globalThis and returns its exports. */
  async function load(source: string, seed: Record<string, unknown>): Promise<Record<string, unknown>> {
    const key = '__pwfabric_shim_test'
    const g = globalThis as Record<string, unknown>
    const previous = Object.fromEntries(Object.keys(seed).map((k) => [k, g[k]]))
    Object.assign(g, seed)
    try {
      const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${key}${Math.random()}`
      return (await import(/* @vite-ignore */ url)) as Record<string, unknown>
    } finally {
      for (const [k, v] of Object.entries(previous)) {
        if (v === undefined) delete g[k]
        else g[k] = v
      }
    }
  }

  it('binds only names that can be bindings: no reserved words, no undefined / NaN / Infinity', () => {
    expect(isExportableName('useState')).toBe(true)
    expect(isExportableName('$x_1')).toBe(true)
    for (const name of ['default', 'delete', 'a-b', '1a', 'undefined', 'NaN', 'Infinity']) {
      expect(isExportableName(name), name).toBe(false)
    }
    const src = shimSource('zod.mjs', '__pwfabric_zod', ['z', 'undefined', 'NaN', 'Infinity', 'z', 'ZodString'])
    expect(src).toContain('export const {\n  ZodString,\n  z,\n} = m')
    expect(src).not.toMatch(/\bundefined,|\bNaN,|\bInfinity,/)
  })

  it('names every specifier the shim serves', () => {
    const src = shimSource('runtime.mjs', '__pwfabric_runtime', ['a'])
    for (const s of specifiersForShim('runtime.mjs')) expect(src).toContain(`'${s}'`)
  })

  it('re-exports the seeded instance', async () => {
    const defineBlock = (): void => undefined
    const mod = await load(shimSource('sdk@v1.mjs', '__pwfabric_sdk', ['defineBlock']), {
      __pwfabric_sdk: { defineBlock },
    })
    expect(mod['defineBlock']).toBe(defineBlock)
    expect((mod['default'] as { defineBlock: unknown }).defineBlock).toBe(defineBlock)
  })

  it('throws a readable error when a global every host must seed is missing', async () => {
    await expect(load(shimSource('sdk@v1.mjs', '__pwfabric_sdk', ['defineBlock']), {})).rejects.toThrow(
      /globalThis\.__pwfabric_sdk is not seeded, so @pwfabric\/authoring cannot be imported by a block/
    )
  })

  it('degrades to undefined exports for a global nothing seeds yet', async () => {
    const mod = await load(shimSource('core.mjs', '__pwfabric_core', ['BREAKPOINTS']), {})
    expect(mod['BREAKPOINTS']).toBeUndefined()
  })

  it('seeds the authoring kit on every host: a documented block calls defineBlock() when it loads', () => {
    const sdk = BLOCK_HOST_IMPORTS.find((i) => i.specifier === '@pwfabric/authoring')
    expect(sdk?.seeding).toBe('every-host')
    expect(blockHostGlobals('standalone')).toContain('__pwfabric_sdk')
  })
})
