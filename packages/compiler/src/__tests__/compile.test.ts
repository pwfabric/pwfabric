import { describe, it, expect } from 'vitest'
import { mkdtemp, realpath, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BLOCK_HOST_IMPORTS, blockBundleExternals } from '@pwfabric/core'
import { compileAtom, MAX_ATOM_BUNDLE_BYTES, type CompileResult } from '../compile.js'
import { COMPILER_VERSION, ESBUILD_VERSION } from '../version.js'
import { HOST_BLOCK, LIB_BLOCK, PLAIN_BLOCK } from './fixtures.js'

/** Load a compiled module the way a host would — as an ES module, by URL. */
async function load(code: string): Promise<Record<string, unknown>> {
  // realpath: a short (8.3) temp path does not survive the test loader's URL round-trip.
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'pwfabric-compiler-test-')))
  try {
    const file = join(dir, 'bundle.mjs')
    await writeFile(file, code)
    return (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Record<string, unknown>
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function codes(r: CompileResult): string[] {
  return r.diagnostics.map((d) => d.code)
}

// ============================================================
// GOLDEN OUTPUT
// ============================================================

describe('compileAtom — golden output', () => {
  it('plain block: compiles, hashes, and reruns to identical bytes', async () => {
    const a = await compileAtom(PLAIN_BLOCK)
    const b = await compileAtom(PLAIN_BLOCK)
    expect(a.ok, JSON.stringify(a.diagnostics)).toBe(true)
    expect(a.diagnostics).toEqual([])
    expect(a.externals).toEqual([])
    expect(a.code).toBe(b.code)
    expect(a.hash).toBe(b.hash)
    expect(a.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(a.size).toBe(Buffer.byteLength(a.code))
    expect(a.hash).toMatchInlineSnapshot(`"sha256:d12f666fe2f6ba3f9d1f71b7406ff81c7e9f073f29b324d26aa2ac33be5ad717"`)
  })

  it('plain block: the wrapper re-exports Component + definition under stable names', async () => {
    const r = await compileAtom(PLAIN_BLOCK)
    expect(r.code).toMatch(/\bas Component\b/)
    expect(r.code).toMatch(/\bas definition\b/)
    const mod = await load(r.code)
    expect((mod.definition as { type: string }).type).toBe('content.plain')
    expect((mod.Component as (p: { text: string }) => string)({ text: 'x' })).toBe('plain:x')
  })

  it('block with lib + _shared companions: bundles them in, tree-shakes the rest', async () => {
    const a = await compileAtom(LIB_BLOCK)
    const b = await compileAtom(LIB_BLOCK)
    expect(a.ok, JSON.stringify(a.diagnostics)).toBe(true)
    expect(a.code).toBe(b.code)
    expect(a.code).not.toContain('notPartOfThisAtom')
    expect(a.code).not.toContain('42')
    expect(a.hash).toMatchInlineSnapshot(`"sha256:96cfda00575a1248ec0992ff50b1596f7a6972ce084ebd2fbd29b786998c1abc"`)
    const mod = await load(a.code)
    expect((mod.Component as (p: { name: string }) => string)({ name: 'you' })).toBe('HELLO, YOU!')
  })

  it('block importing host modules: they stay bare imports, and are reported', async () => {
    const a = await compileAtom(HOST_BLOCK)
    const b = await compileAtom(HOST_BLOCK)
    expect(a.ok, JSON.stringify(a.diagnostics)).toBe(true)
    expect(a.code).toBe(b.code)
    expect(a.externals).toEqual(['@pwfabric/runtime', 'react', 'react/jsx-runtime', 'zod'])
    for (const ext of a.externals) {
      expect(a.code).toMatch(new RegExp(`from\\s*["']${ext.replace(/\//g, '\\/')}["']`))
    }
    // The type-only relative import is erased; core (type-only) never appears.
    expect(a.code).not.toContain('component-types')
    expect(a.code).not.toContain('@pwfabric/core')
    expect(a.hash).toMatchInlineSnapshot(`"sha256:ebd100e680af1e173bb4afb6af0e2e9be10801981b4a7d719a08379620cfb558"`)
  })

  it('records the compiler and esbuild versions', async () => {
    const r = await compileAtom(PLAIN_BLOCK)
    expect(r.compilerVersion).toBe(COMPILER_VERSION)
    expect(r.esbuildVersion).toBe(ESBUILD_VERSION)
    expect(r.esbuildVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('does not depend on the order of the files map', async () => {
    const reversed = Object.fromEntries(Object.entries(LIB_BLOCK.files).reverse())
    const a = await compileAtom(LIB_BLOCK)
    const b = await compileAtom({ ...LIB_BLOCK, files: reversed })
    expect(b.hash).toBe(a.hash)
  })

  it('accepts Uint8Array contents and Windows-style keys with identical output', async () => {
    const a = await compileAtom(PLAIN_BLOCK)
    const src = PLAIN_BLOCK.files['blocks/content/plain/component.tsx']
    const b = await compileAtom({
      entry: 'blocks\\content\\plain\\component.tsx',
      files: { 'blocks\\content\\plain\\component.tsx': new TextEncoder().encode(src) },
    })
    expect(b.hash).toBe(a.hash)
  })
})

// ============================================================
// OPTIONS
// ============================================================

describe('compileAtom — options', () => {
  it('sourcemap: returns a map whose sources are the virtual paths', async () => {
    const r = await compileAtom({ ...LIB_BLOCK, sourcemap: true })
    expect(r.ok).toBe(true)
    expect(r.map).toBeDefined()
    const map = JSON.parse(r.map as string) as { sources: string[] }
    expect(map.sources.some((s) => s.includes('atoms/lib/format.ts'))).toBe(true)
    expect(r.code).not.toContain('sourceMappingURL')
    // The map is a side output: the code (and so the hash) is unchanged.
    const plain = await compileAtom(LIB_BLOCK)
    expect(r.hash).toBe(plain.hash)
  })

  it('no map unless asked', async () => {
    expect((await compileAtom(PLAIN_BLOCK)).map).toBeUndefined()
  })

  it('minify: false keeps readable output', async () => {
    const r = await compileAtom({ ...PLAIN_BLOCK, minify: false })
    expect(r.ok).toBe(true)
    expect(r.code).toContain('function Plain(')
  })

  it('target lowers syntax', async () => {
    const files = { 'capabilities/t/handler.ts': 'export const f = (o?: { a?: number }) => o?.a ?? 1\n' }
    const modern = await compileAtom({ files, entry: 'capabilities/t/handler.ts', kind: 'capability' })
    const old = await compileAtom({ files, entry: 'capabilities/t/handler.ts', kind: 'capability', target: 'es2019' })
    expect(modern.code).toContain('?.')
    expect(old.code).not.toContain('?.')
  })

  it('maxBytes: an oversize bundle is BUNDLE_TOO_LARGE', async () => {
    const r = await compileAtom({ ...PLAIN_BLOCK, maxBytes: 10 })
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(['BUNDLE_TOO_LARGE'])
    expect(r.code).toBe('')
    expect(r.hash).toBe('')
    expect(MAX_ATOM_BUNDLE_BYTES).toBe(500 * 1024)
  })
})

// ============================================================
// EXTERNALS
// ============================================================

describe('compileAtom — externals come from the core host-import list', () => {
  it('every host import in BLOCK_HOST_IMPORTS stays external', async () => {
    const specs = blockBundleExternals()
    expect(specs).toEqual(BLOCK_HOST_IMPORTS.map((i) => i.specifier))
    const source = specs.map((s, i) => `import * as m${i} from '${s}'`).join('\n') +
      `\nexport const all = [${specs.map((_, i) => `m${i}`).join(', ')}]\n`
    const r = await compileAtom({ files: { 'capabilities/all/handler.ts': source }, entry: 'capabilities/all/handler.ts', kind: 'capability' })
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true)
    expect(r.externals).toEqual([...specs].sort())
    for (const s of specs) expect(r.code).toContain(`"${s}"`)
  })

  it('a non-host bare import is a NON_HOST_IMPORT error with a location', async () => {
    const r = await compileAtom({
      files: { 'blocks/x/y/component.tsx': `import _ from 'left-pad'\nexport default function C() { return _ }\n` },
      entry: 'blocks/x/y/component.tsx',
    })
    expect(r.ok).toBe(false)
    const d = r.diagnostics.find((x) => x.code === 'NON_HOST_IMPORT')
    expect(d).toBeDefined()
    expect(d?.severity).toBe('error')
    expect(d?.message).toContain("'left-pad'")
    expect(d?.file).toBe('blocks/x/y/component.tsx')
    expect(d?.line).toBe(1)
  })

  it('a node builtin is not a host import either', async () => {
    const r = await compileAtom({
      files: { 'blocks/x/y/component.tsx': `import { readFileSync } from 'node:fs'\nexport default function C() { return readFileSync }\n` },
      entry: 'blocks/x/y/component.tsx',
    })
    expect(codes(r)).toContain('NON_HOST_IMPORT')
  })

  it('reports every bad import in one pass', async () => {
    const r = await compileAtom({
      files: {
        'blocks/x/y/component.tsx': `import a from 'one'\nimport b from 'two'\nimport c from './missing'\nexport default function C() { return [a, b, c] }\n`,
      },
      entry: 'blocks/x/y/component.tsx',
    })
    expect(codes(r).sort()).toEqual(['NON_HOST_IMPORT', 'NON_HOST_IMPORT', 'UNRESOLVED_IMPORT'])
  })

  it('an unmapped subpath of a host import stays external with a HOST_SUBPATH_IMPORT warning', async () => {
    const r = await compileAtom({
      files: { 'capabilities/p/handler.ts': `import { x } from '@pwfabric/runtime/auth'\nexport const h = x\n` },
      entry: 'capabilities/p/handler.ts',
      kind: 'capability',
    })
    expect(r.ok).toBe(true)
    expect(r.externals).toEqual(['@pwfabric/runtime/auth'])
    expect(r.diagnostics).toHaveLength(1)
    expect(r.diagnostics[0]).toMatchObject({ severity: 'warning', code: 'HOST_SUBPATH_IMPORT' })
  })

  it('lets a malformed (non-path) input error propagate instead of reporting it as PATH_ESCAPE', async () => {
    await expect(
      compileAtom({
        files: { 'capabilities/p/handler.ts': 'export const h = 1\n' },
        entry: 'capabilities/p/handler.ts',
        kind: 'capability',
        companions: [42 as unknown as string],
      })
    ).rejects.toThrow(TypeError)
  })

  it('a runtime subpath the host maps exactly compiles external with no warning', async () => {
    // The foundation pack persistence capability imports `createDataService`
    // from `/data`; the host import list maps it to the runtime shim.
    for (const sub of ['data', 'capability', 'adapters']) {
      const spec = `@pwfabric/runtime/${sub}`
      const r = await compileAtom({
        files: { 'capabilities/p/handler.ts': `import { x } from '${spec}'\nexport const h = x\n` },
        entry: 'capabilities/p/handler.ts',
        kind: 'capability',
      })
      expect(r.ok, spec).toBe(true)
      expect(r.externals).toEqual([spec])
      expect(r.diagnostics, spec).toEqual([])
    }
  })
})

// ============================================================
// THE TREE — containment, resolution, companions
// ============================================================

describe('compileAtom — the virtual tree', () => {
  const entry = 'capabilities/thing/handler.ts'

  it('refuses a file key that climbs out of the tree (PATH_ESCAPE)', async () => {
    const r = await compileAtom({ files: { [entry]: 'export const x = 1', '../../evil.ts': 'x' }, entry, kind: 'capability' })
    expect(codes(r)).toEqual(['PATH_ESCAPE'])
  })

  it('refuses an absolute file key', async () => {
    for (const key of ['/tmp/evil.ts', 'C:/evil.ts', 'C:\\evil.ts']) {
      const r = await compileAtom({ files: { [entry]: 'export const x = 1', [key]: 'x' }, entry, kind: 'capability' })
      expect(codes(r)).toEqual(['PATH_ESCAPE'])
    }
  })

  it('refuses an entry that climbs out of the tree', async () => {
    const r = await compileAtom({ files: { [entry]: 'export const x = 1' }, entry: '../../../evil.ts', kind: 'capability' })
    expect(codes(r)).toEqual(['PATH_ESCAPE'])
  })

  it('refuses a relative import that climbs past the root — no host file is read', async () => {
    const r = await compileAtom({
      files: { [entry]: `import creds from '../../../../secrets/creds.json'\nexport const x = creds\n` },
      entry,
      kind: 'capability',
    })
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(['PATH_ESCAPE'])
  })

  it('refuses an absolute import specifier', async () => {
    const r = await compileAtom({ files: { [entry]: `import x from '/etc/passwd'\nexport const y = x\n` }, entry, kind: 'capability' })
    expect(codes(r)).toEqual(['PATH_ESCAPE'])
  })

  it('accepts a relative import that climbs WITHIN the tree', async () => {
    const r = await compileAtom({
      files: {
        [entry]: "import { v } from '../../shared/_utils.js'\nexport const x = v",
        'shared/_utils.ts': 'export const v = 1',
      },
      entry,
      kind: 'capability',
    })
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true)
  })

  it('resolves JSON, index files and extensionless specifiers', async () => {
    const r = await compileAtom({
      files: {
        [entry]: "import data from './data.json'\nimport { n } from './dir'\nimport { m } from './plain'\nexport const x = [data.k, n, m]",
        'capabilities/thing/data.json': '{"k": "v"}',
        'capabilities/thing/dir/index.ts': 'export const n = 2',
        'capabilities/thing/plain.js': 'export const m = 3',
      },
      entry,
      kind: 'capability',
    })
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true)
    const mod = await load(r.code)
    expect(mod.x).toEqual(['v', 2, 3])
  })

  it('declared companions: importing an undeclared file is NOT_A_COMPANION', async () => {
    const r = await compileAtom({
      ...LIB_BLOCK,
      companions: ['atoms/lib/format.ts'], // the _shared-copy sibling is left out
    })
    expect(r.ok).toBe(false)
    expect(codes(r)).toEqual(['NOT_A_COMPANION'])
  })

  it('an unsupported file type is UNSUPPORTED_FILE', async () => {
    const r = await compileAtom({
      files: { [entry]: "import css from './x.css'\nexport const y = css", 'capabilities/thing/x.css': 'a{}' },
      entry,
      kind: 'capability',
    })
    expect(codes(r)).toEqual(['UNSUPPORTED_FILE'])
  })
})

// ============================================================
// INPUT ERRORS AND KINDS
// ============================================================

describe('compileAtom — input errors', () => {
  it('rejects empty source with INVALID_INPUT', async () => {
    const r = await compileAtom({ files: { 'blocks/control/empty/component.tsx': '' }, entry: 'blocks/control/empty/component.tsx' })
    expect(codes(r)).toEqual(['INVALID_INPUT'])
  })

  it('rejects an entry that is not in the tree', async () => {
    const r = await compileAtom({ files: {}, entry: 'blocks/a/b/component.tsx' })
    expect(codes(r)).toEqual(['INVALID_INPUT'])
  })

  it('rejects a kind that is not bundled', async () => {
    const r = await compileAtom({ files: { 'patterns/p.json': '{}' }, entry: 'patterns/p.json', kind: 'pattern' })
    expect(codes(r)).toEqual(['INVALID_INPUT'])
  })

  it('refuses a tree that already holds the wrapper file', async () => {
    const r = await compileAtom({
      files: { ...PLAIN_BLOCK.files, 'blocks/content/plain/_bundle-entry.tsx': 'export {}' },
      entry: PLAIN_BLOCK.entry,
    })
    expect(codes(r)).toEqual(['INVALID_INPUT'])
  })

  it('reports ESBUILD_FAILED for invalid syntax, with a location', async () => {
    const r = await compileAtom({
      files: { 'capabilities/broken/handler.ts': 'this is not valid typescript >>> ::: }}' },
      entry: 'capabilities/broken/handler.ts',
      kind: 'capability',
    })
    expect(r.ok).toBe(false)
    expect(codes(r)).toContain('ESBUILD_FAILED')
    expect(r.diagnostics[0]?.file).toBe('capabilities/broken/handler.ts')
  })
})

describe('compileAtom — kinds', () => {
  it('capability: opaque export *', async () => {
    const r = await compileAtom({
      files: {
        'capabilities/navigation/handler.ts': `export const navigationCapability = {
  id: 'platform/navigation',
  execute: async () => ({ resolvedPath: '/' }),
}
export default navigationCapability`,
      },
      entry: 'capabilities/navigation/handler.ts',
      kind: 'capability',
    })
    expect(r.ok).toBe(true)
    const mod = await load(r.code)
    expect((mod.navigationCapability as { id: string }).id).toBe('platform/navigation')
  })

  it('block whose component is the first function export (no default)', async () => {
    const r = await compileAtom({
      files: { 'blocks/a/b/component.tsx': "export const definition = { type: 'a.b', schema: {} }\nexport function B() { return 'b' }\n" },
      entry: 'blocks/a/b/component.tsx',
    })
    const mod = await load(r.code)
    expect((mod.Component as () => string)()).toBe('b')
  })

  it('block with neither definition nor component exports nulls', async () => {
    const r = await compileAtom({ files: { 'blocks/a/b/component.tsx': 'export const n = 1\n' }, entry: 'blocks/a/b/component.tsx' })
    const mod = await load(r.code)
    expect(mod.Component).toBeNull()
    expect(mod.definition).toBeNull()
  })

  it('connector: needs engineName', async () => {
    const r = await compileAtom({ files: {}, entry: 'connectors/Acme.__engine__.ts', kind: 'connector' })
    expect(codes(r)).toEqual(['INVALID_INPUT'])
  })

  it('connector: refuses a tree that already holds the generated wrapper', async () => {
    const r = await compileAtom({
      files: { 'connectors/Acme.__engine__.ts': 'export {}', 'connectors/Acme.ts': 'export {}' },
      entry: 'connectors/Acme.__engine__.ts',
      kind: 'connector',
      engineName: 'Acme',
    })
    expect(codes(r)).toEqual(['INVALID_INPUT'])
  })

  it('connector: the generated adapter constructs an engine class', async () => {
    const r = await compileAtom({
      files: {
        'connectors/Acme.ts': `export class AcmeEngine {
  constructor(private t: unknown, private c: Record<string, unknown>) {}
  query() { return 'acme:' + String(this.c.region) }
}`,
      },
      entry: 'connectors/Acme.__engine__.ts',
      kind: 'connector',
      engineName: 'Acme',
    })
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true)
    const mod = await load(r.code)
    const engine = (mod.createConnector as (t: unknown, c: unknown) => { query(): string })(async () => null, { region: 'eu' })
    expect(engine.query()).toBe('acme:eu')
    expect(mod.default).toBe(mod.createConnector)
  })

  it('connector: an explicit createConnector export wins', async () => {
    const r = await compileAtom({
      files: { 'connectors/Plain.ts': `export function createConnector(_t: unknown, c: unknown) { return { c } }` },
      entry: 'connectors/Plain.__engine__.ts',
      kind: 'connector',
      engineName: 'Plain',
    })
    const mod = await load(r.code)
    expect((mod.createConnector as (t: unknown, c: unknown) => { c: unknown })(null, 7)).toEqual({ c: 7 })
  })

  it('connector: a default function export is called; no engine throws', async () => {
    const withDefault = await compileAtom({
      files: { 'connectors/D.ts': `export default function make(_t: unknown, c: unknown) { return { made: c } }` },
      entry: 'connectors/D.__engine__.ts',
      kind: 'connector',
      engineName: 'D',
    })
    const modD = await load(withDefault.code)
    expect((modD.createConnector as (t: unknown, c: unknown) => unknown)(null, 1)).toEqual({ made: 1 })

    const none = await compileAtom({
      files: { 'connectors/N.ts': `export const nothing = 1` },
      entry: 'connectors/N.__engine__.ts',
      kind: 'connector',
      engineName: 'N',
    })
    const modN = await load(none.code)
    expect(() => (modN.createConnector as (t: unknown, c: unknown) => unknown)(null, 1)).toThrow(/exports no engine/)
  })

  it('provider: binds the domain entity map into the shared vendor engine', async () => {
    const r = await compileAtom({
      files: {
        'providers/acme/index.ts': `export class AcmeVendor {
  constructor(private t: unknown, private map: Record<string, unknown>) {}
  query() { return Object.keys(this.map).join(',') }
}`,
        'providers/acme/entities/orders.ts': `export const orders = { order: { table: 'orders' }, line: { table: 'lines' } }`,
      },
      entry: 'providers/acme/entities/orders.__engine__.ts',
      kind: 'provider',
      engineName: 'orders',
    })
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true)
    const mod = await load(r.code)
    const engine = (mod.createConnector as (t: unknown, c: unknown) => { query(): string })(async () => null, {})
    expect(engine.query()).toBe('order,line')
  })

  it('provider: falls back to a vendor create* factory', async () => {
    const r = await compileAtom({
      files: {
        'providers/v/index.ts': `export function createVendor(_t: unknown, c: unknown) { return { factory: c } }`,
        'providers/v/entities/things.ts': `export const nothing = 1`,
      },
      entry: 'providers/v/entities/things.__engine__.ts',
      kind: 'provider',
      engineName: 'things',
    })
    const mod = await load(r.code)
    expect((mod.createConnector as (t: unknown, c: unknown) => unknown)(null, 'cfg')).toEqual({ factory: 'cfg' })
  })
})
