import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { BLOCK_HOST_IMPORTS, blockShimFiles } from '@pwfabric/core'
import {
  bootScript,
  buildShellHtml,
  importMapText,
  seedScript,
  buildShims,
  escapeHtml,
  htmlLangOf,
  importMap,
  isExportableName,
  loadRuntimeAssets,
  runnerLocaleOf,
  scriptJson,
  seededGlobals,
  shimGlobal,
  shimSource,
  shimsFor,
} from '../../dev/shell.js'

/** `export const { a, b } = m` → ['a', 'b'] */
function exportsOf(source: string): string[] {
  const m = /export const \{([^}]*)\} = m/.exec(source)
  return m ? (m[1] as string).split(',').map((s) => s.trim()).filter(Boolean) : []
}

describe('import map', () => {
  it('maps every host import the engine lists to a shim under ./shims/', () => {
    const map = importMap().imports
    for (const entry of BLOCK_HOST_IMPORTS) expect(map[entry.specifier]).toBe(`./shims/${entry.shim}`)
    expect(Object.keys(map)).toHaveLength(BLOCK_HOST_IMPORTS.length)
  })
})

describe('shims', () => {
  it('writes one file per shim the import map names, reading the seeded globals', async () => {
    const { embedJs } = await loadRuntimeAssets()
    const shims = await buildShims(embedJs)
    expect([...shims.keys()].sort()).toEqual([...blockShimFiles()].sort())
    for (const [file, source] of shims) {
      expect(source).toContain(`globalThis.${shimGlobal(file)}`)
      expect(source).toContain('export default m')
    }
    // Names that blocks and the runner import by name.
    expect(exportsOf(shims.get('react.mjs') as string)).toEqual(expect.arrayContaining(['useState', 'useEffect', 'createElement', 'Fragment']))
    expect(exportsOf(shims.get('react-jsx-runtime.mjs') as string)).toEqual(expect.arrayContaining(['jsx', 'jsxs', 'Fragment']))
    expect(exportsOf(shims.get('zod.mjs') as string)).toContain('z')
    expect(exportsOf(shims.get('runtime.mjs') as string)).toEqual(
      expect.arrayContaining(['createConnectorEngineRegistry', 'useSurfaceEvents', 'applyEntityQuery'])
    )
    expect(exportsOf(shims.get('contracts.mjs') as string)).toContain('SURFACE_EVENTS')
    // react-dom comes from the renderer's vendor table, which the shell seeds.
    expect(exportsOf(shims.get('react-dom.mjs') as string)).toEqual(expect.arrayContaining(['createPortal', 'flushSync']))
    // Unseeded globals still export the package's names, so blocks link.
    expect(exportsOf(shims.get('core.mjs') as string)).toEqual(expect.arrayContaining(['defineCapability', 'BREAKPOINTS']))
    expect(exportsOf(shims.get('sdk@v1.mjs') as string)).toContain('defineBlock')
    expect(await shimsFor(embedJs)).toBe(await shimsFor(embedJs))
  })

  it('covers every name the runner imports from a host specifier', async () => {
    const { runnerJs, embedJs } = await loadRuntimeAssets()
    const shims = await shimsFor(embedJs)
    const map = importMap().imports
    const imports = [...runnerJs.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)]
    expect(imports.length).toBeGreaterThan(0)
    for (const [, names, spec] of imports) {
      const target = map[spec as string]
      expect(target, spec).toBeDefined()
      const exported = exportsOf(shims.get((target as string).replace('./shims/', '')) as string)
      for (const n of (names as string).split(',')) expect(exported).toContain(n.trim().split(/\s+as\s+/)[0])
    }
  })

  it('reads core and sdk names off the vendor table when the renderer carries them', async () => {
    const shims = await buildShims(
      "globalThis.__PW_VENDOR__ = { '@pwfabric/core': { BREAKPOINTS: 1 }, '@pwfabric/authoring': { defineBlock() {}, defineFactory() {} } }"
    )
    expect(exportsOf(shims.get('core.mjs') as string)).toEqual(['BREAKPOINTS'])
    expect(exportsOf(shims.get('sdk@v1.mjs') as string)).toEqual(['defineBlock', 'defineFactory'])
  })

  it('degrades when the renderer seeds nothing', async () => {
    const shims = await buildShims('/* empty bundle */ throw new Error("needs a document")')
    expect(exportsOf(shims.get('react.mjs') as string)).toEqual([])
    expect(exportsOf(shims.get('sdk@v1.mjs') as string)).toContain('defineBlock')
    expect(seededGlobals('globalThis.__pwfabric_x = { a: 1 }; globalThis.other = 1')).toEqual({ __pwfabric_x: { a: 1 } })
  })

  it('writes only names that can be bindings', () => {
    expect(isExportableName('useState')).toBe(true)
    expect(isExportableName('$x_1')).toBe(true)
    expect(isExportableName('default')).toBe(false)
    expect(isExportableName('delete')).toBe(false)
    expect(isExportableName('a-b')).toBe(false)
    expect(isExportableName('1a')).toBe(false)
    const src = shimSource('zod.mjs', '__pwfabric_zod', ['z', 'z', 'default', 'ZodString'])
    expect(exportsOf(src)).toEqual(['ZodString', 'z'])
    expect(shimSource('zod.mjs', '__pwfabric_zod', [])).not.toContain('export const')
    expect(shimGlobal('unknown file.mjs')).toBe('__pwfabric_unknown_file_mjs')
  })
})

describe('shell', () => {
  it('declares the import map, then the renderer and the seeding file, then the boot module', () => {
    const html = buildShellHtml({ title: 'A <b>', bodyExtra: '<!--dev-->', appearance: { theme: { typography: { fontFamily: 'Inter' } } } })
    const map = html.indexOf('type="importmap"')
    const embed = html.indexOf('./assets/embed.js')
    const seed = html.indexOf('./assets/seed.js')
    const root = html.indexOf('<div id="root">')
    const boot = html.indexOf('<script type="module" src="./assets/boot.js">')
    expect(map).toBeGreaterThan(0)
    expect(map).toBeLessThan(embed)
    expect(embed).toBeLessThan(seed)
    expect(seed).toBeLessThan(root)
    expect(root).toBeLessThan(boot)
    // The import map is the only inline script.
    expect(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g)).toEqual(['<script type="importmap">'])
    expect(html).toContain(`<script type="importmap">${importMapText()}</script>`)
    expect(html).toContain('<title>A &lt;b&gt;</title>')
    expect(html).toContain('fonts.googleapis.com')
    expect(html).toContain('<!--dev-->')
    expect(html).toContain('<html lang="en">')
    expect(html).not.toContain('Content-Security-Policy')
    const plain = buildShellHtml({ title: 'x', lang: 'tr-TR', csp: "default-src 'none'" })
    expect(plain).not.toContain('fonts.googleapis.com')
    expect(plain).toContain('<html lang="tr-TR">')
    // The policy comes before anything it governs.
    const meta = plain.indexOf(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'" />`)
    expect(meta).toBeGreaterThan(0)
    expect(meta).toBeLessThan(plain.indexOf('<link'))
    expect(meta).toBeLessThan(plain.indexOf('<script'))
  })
  it('seeds core, sdk and react-dom from the vendor table in seed.js, and boots with the locale', () => {
    const seed = seedScript()
    expect(seed).toContain('g.__pwfabric_react_dom = g.__pwfabric_react_dom || v["react-dom"];')
    expect(seed).toContain('g.__pwfabric_core = g.__pwfabric_core || v["@pwfabric/core"];')
    expect(seed).toContain('g.__pwfabric_sdk = g.__pwfabric_sdk || v["@pwfabric/authoring"];')
    expect(bootScript('tr')).toContain("import { runApp } from './runner.js'")
    expect(bootScript('tr')).toContain("locale: 'tr'")
    expect(bootScript()).toContain("locale: 'en'")
  })
  it('escapes and normalises', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
    expect(scriptJson({ a: '</script>' })).toBe('{"a":"\\u003c/script>"}')
    expect(htmlLangOf('en-GB')).toBe('en-GB')
    expect(htmlLangOf('<x>')).toBe('en')
    expect(htmlLangOf(undefined)).toBe('en')
    expect(runnerLocaleOf('tr_TR')).toBe('tr')
    expect(runnerLocaleOf('de')).toBe('en')
    expect(runnerLocaleOf(undefined)).toBe('en')
  })
})
