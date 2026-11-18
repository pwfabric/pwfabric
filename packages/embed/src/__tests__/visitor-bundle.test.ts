/**
 * @vitest-environment node
 *
 * What `embed.js` ships to every visitor of every app. It exposes whole module
 * namespaces to blocks, so it cannot be tree-shaken: a namespace that reaches
 * zod or `next/image` ships them to everyone. zod was 193 KB of the 734 KB
 * file until 3.0. Built here with the very plugins the package build uses.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import vm from 'node:vm'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'tsup'
import { visitorBundlePlugins } from '../../visitor-bundle'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
let out: string
let code: string
let seeded: Record<string, unknown>

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), 'pw-embed-'))
  await build({
    entry: { embed: join(ROOT, 'src/embed-global.ts') },
    format: ['iife'],
    globalName: 'PWFabric',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    noExternal: [/.*/],
    esbuildPlugins: visitorBundlePlugins,
    define: { 'process.env.NODE_ENV': '"production"' },
    esbuildOptions(options) {
      options.jsx = 'automatic'
    },
    outDir: out,
    outExtension: () => ({ js: '.js' }),
    silent: true,
    dts: false,
    config: false,
  })
  code = await readFile(join(out, 'embed.js'), 'utf8')
  const sandbox: Record<string, unknown> = { console, setTimeout, clearTimeout, queueMicrotask }
  sandbox['globalThis'] = sandbox
  sandbox['self'] = sandbox
  try {
    vm.runInContext(code, vm.createContext(sandbox), { timeout: 10_000 })
  } catch {
    // Past its globals the bundle may want a document; they are seeded first.
  }
  seeded = sandbox
}, 120_000)

afterAll(async () => {
  if (out) await rm(out, { recursive: true, force: true })
})

describe('embed.js, the visitor bundle', () => {
  it('carries no zod (3.0): no zod module in the bundle, and no zod global for blocks', async () => {
    expect(seeded['__pwfabric_zod']).toBeUndefined()
    // zod 4 names its core error class and its JIT probe; neither may appear.
    expect(code.includes('$ZodError')).toBe(false)
    expect(code.includes('ZodObject')).toBe(false)
    // Positive control: the plugin refuses a zod import outright.
    const { noZod } = await import('../../visitor-bundle')
    let resolve: ((args: { path: string; importer: string }) => { errors?: { text: string }[] }) | undefined
    let filter: RegExp | undefined
    void noZod.setup({ onResolve: (o: { filter: RegExp }, cb: typeof resolve) => ((filter = o.filter), (resolve = cb)) } as never)
    expect(filter?.test('zod')).toBe(true)
    expect(filter?.test('zod/mini')).toBe(true)
    expect(filter?.test('zodiac')).toBe(false)
    const refused = resolve?.({ path: 'zod', importer: 'x.ts' }).errors?.[0]?.text
    expect(refused).toContain('zod is not in embed.js')
  })

  it('does not carry next/image', () => {
    // The stand-in that says why, not Next's image component.
    expect(code.includes('next/image is not in embed.js')).toBe(true)
    expect(code.includes('data-nimg')).toBe(false)
  })

  it('seeds every global a block imports, so the shell needs no seed script', () => {
    for (const g of ['__pwfabric_react', '__pwfabric_jsx_runtime', '__pwfabric_react_dom', '__pwfabric_core', '__pwfabric_sdk', '__pwfabric_runtime', '__pwfabric_contracts']) {
      expect(seeded[g], g).toBeTruthy()
    }
  })

  it('stays within its budget (gzip)', () => {
    // 2.1.0: 995,807 bytes, 256 KB gzipped; 2.2.0: 734 KB, 217 KB gzipped
    // (193 KB of it zod). 3.0 carries no zod. Raise this only on purpose.
    expect(gzipSync(code, { level: 9 }).length).toBeLessThan(170_000)
  })
})
