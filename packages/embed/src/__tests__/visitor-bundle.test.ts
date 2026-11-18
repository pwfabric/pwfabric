/**
 * @vitest-environment node
 *
 * What `embed.js` ships to every visitor of every app. It exposes whole module
 * namespaces to blocks, so it cannot be tree-shaken: a namespace that reaches
 * zod or `next/image` ships them to everyone. zod was 193 KB of the 734 KB
 * file until 3.0. Built here with the very plugins the package build uses.
 *
 * What is not on a visitor's page is not in those namespaces either: the
 * build-, install-, server- and tooling-only modules live on subpaths of their
 * packages, and the build's metafile proves none of them is bundled.
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
/** Every module bundled into embed.js, as `<package>/<path in the package>` (no extension). */
let bundled: string[]

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
    metafile: true,
    silent: true,
    dts: false,
    config: false,
  })
  code = await readFile(join(out, 'embed.js'), 'utf8')
  const meta = JSON.parse(await readFile(join(out, 'metafile-iife.json'), 'utf8')) as { inputs: Record<string, unknown> }
  bundled = Object.keys(meta.inputs).flatMap((p) => {
    const m = p.replace(/\\/g, '/').match(/(?:^|\/)(runtime|core|contracts|authoring|embed)\/(?:dist|src)\/(.+)\.[cm]?[jt]sx?$/)
    return m ? [`${m[1]}/${m[2]}`] : []
  })
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

  // Module → why a visitor's page has no use for it, and where it lives now.
  const NOT_ON_A_PAGE: Record<string, string> = {
    'runtime/entity/postgres-connector': "a server's database connector (@pwfabric/runtime/entity/postgres)",
    'runtime/seo/generator': 'SEO tags are written at build and by the runner (@pwfabric/runtime/seo)',
    'runtime/analytics/tracker': 'no page draws it (@pwfabric/runtime/analytics)',
    'runtime/graph/resolver': 'no page draws it (@pwfabric/runtime/graph)',
    'runtime/perf/reporter': 'no page reports through it (@pwfabric/runtime/perf)',
    'runtime/perf/web-vitals': 'no page reports through it (@pwfabric/runtime/perf)',
    'runtime/capability/platform-capabilities': "a host registry's declarations (@pwfabric/runtime/platform-capabilities)",
    'runtime/blocks/rule-engine': 'composition checks, reached only by defineFactory',
    'runtime/blocks/composition-rules': 'composition checks, reached only by defineFactory',
    'core/config-schema-builder': 'builds declarations for tooling (@pwfabric/core/config-schema)',
    'core/monitoring/web-vitals': 'no page reports through it (@pwfabric/core/monitoring)',
    'core/monitoring/metrics': 'no page reports through it (@pwfabric/core/monitoring)',
    'core/blocks/host-imports': "the compiler's and a host's list (@pwfabric/core/host-imports)",
    'contracts/fabric/pack-requires': 'install-time (@pwfabric/contracts/pack)',
    'contracts/fabric/atom': 'reads pack files: compiler, pack tools, install (@pwfabric/contracts/pack)',
    'contracts/fabric/record-write': "a session server's (@pwfabric/contracts/record-write)",
    'contracts/fabric/webfonts': 'the publish path and a font picker read it (@pwfabric/contracts/webfonts)',
    'authoring/index': 'the whole authoring kit; a page seeds @pwfabric/authoring/block',
    'authoring/define-factory': 'composes blocks in tooling',
    'authoring/registry': 'registers blocks in tooling',
    'authoring/validation': 'checks props in tooling',
  }

  it('carries no build-, install-, server- or tooling-only module', () => {
    // Positive control: the path parsing sees the modules that ARE there.
    expect(bundled).toContain('runtime/render/renderer')
    expect(bundled).toContain('authoring/define-block')
    expect(bundled).toContain('contracts/fabric/appearance-cascade')
    const present = Object.keys(NOT_ON_A_PAGE).filter((m) => bundled.includes(m))
    expect(present.map((m) => `${m}: ${NOT_ON_A_PAGE[m]}`)).toEqual([])
  })

  it('exposes none of them to blocks, and still everything a block calls', () => {
    const runtime = seeded['__pwfabric_runtime'] as Record<string, unknown>
    const core = seeded['__pwfabric_core'] as Record<string, unknown>
    const sdk = seeded['__pwfabric_sdk'] as Record<string, unknown>
    for (const name of ['createPostgresConnector', 'createSeoCapability', 'createAnalyticsCapability', 'createGraphResolver', 'createPerformanceReporter', 'platformCapabilities', 'satisfiesSemverRange', 'resolveSiblingEntry', 'prepareRecordWrite', 'findAllowedWebfont']) {
      expect(runtime[name], name).toBeUndefined()
    }
    for (const name of ['defineConfigSchema', 'observeLCP', 'BLOCK_HOST_IMPORTS']) {
      expect(core[name], name).toBeUndefined()
    }
    for (const name of ['defineFactory', 'createCustomBlockRegistry', 'validateProps']) {
      expect(sdk[name], name).toBeUndefined()
    }
    // What blocks import today: the authoring global is the runtime plus defineBlock.
    expect(typeof sdk['defineBlock']).toBe('function')
    expect(sdk['BehaviorSurfaceProvider']).toBe(runtime['BehaviorSurfaceProvider'])
    expect(typeof runtime['DataBoundSurfaceRenderer']).toBe('function')
    expect(typeof runtime['createDataService']).toBe('function')
    expect(typeof core['defineCapability']).toBe('function')
    expect(typeof core['passthroughContract']).toBe('object')
    expect(runtime['SURFACE_EVENTS']).toBeTruthy()
  })

  it('stays within its budget (gzip)', () => {
    // 2.1.0: 995,807 bytes, 256 KB gzipped; 2.2.0: 734 KB, 217 KB gzipped
    // (193 KB of it zod). 3.0 carries no zod (160 KB), nor the build-, install-
    // and tooling-only modules above (137 KB). Raise this only on purpose.
    expect(gzipSync(code, { level: 9 }).length).toBeLessThan(145_000)
  })
})
