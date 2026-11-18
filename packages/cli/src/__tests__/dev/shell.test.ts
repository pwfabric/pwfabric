import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { BLOCK_HOST_IMPORTS, blockShimFiles, isExportableName, shimSource } from '@pwfabric/core'
import {
  BOOT_FILES,
  bootScript,
  buildShellHtml,
  hashedName,
  importMapText,
  buildShims,
  escapeHtml,
  htmlLangOf,
  importMap,
  loadRuntimeAssets,
  scriptJson,
  seededGlobals,
  shimGlobal,
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
    // react-dom: the renderer seeds it itself.
    expect(exportsOf(shims.get('react-dom.mjs') as string)).toEqual(expect.arrayContaining(['createPortal', 'flushSync']))
    // Unseeded globals still export the package's names, so blocks link.
    expect(exportsOf(shims.get('core.mjs') as string)).toEqual(expect.arrayContaining(['defineCapability', 'BREAKPOINTS']))
    expect(exportsOf(shims.get('sdk@v1.mjs') as string)).toContain('defineBlock')
    expect(await shimsFor(embedJs)).toBe(await shimsFor(embedJs))
  })

  it('the runner imports no host specifier at load, and the shims carry what it imports later', async () => {
    const { runnerJs, embedJs } = await loadRuntimeAssets()
    const shims = await shimsFor(embedJs)
    const map = importMap().imports
    // It runs before the renderer that seeds them (pwapp-format §2).
    const statics = [...runnerJs.matchAll(/(?:^|[;}\s])import\s*\{?[^;()]*?\}?\s*from\s*["']([^"']+)["']/g)].map((m) => m[1])
    expect(statics.filter((spec) => spec !== undefined && spec in map)).toEqual([])
    // Once the renderer is in it imports these by name (run-app.ts, entity-facade.ts).
    const dynamic = [...runnerJs.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])
    expect(dynamic.sort()).toEqual(['@pwfabric/runtime', 'zod'])
    expect(exportsOf(shims.get('runtime.mjs') as string)).toContain('createConnectorEngineRegistry')
    expect(exportsOf(shims.get('zod.mjs') as string)).toContain('z')
    // The bundle's own map is not shipped, so it does not point at one.
    expect(runnerJs).not.toMatch(/sourceMappingURL/)
  })

  it('reads core names off the vendor table and sdk names off the global the renderer seeds', async () => {
    const shims = await buildShims(
      "globalThis.__PW_VENDOR__ = { '@pwfabric/core': { BREAKPOINTS: 1 } }; globalThis.__pwfabric_sdk = { defineBlock() {}, defineFactory() {} }"
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
    // zod exports `undefined`; a binding of it (or of NaN / Infinity) breaks lint and some parsers.
    expect(exportsOf(shimSource('zod.mjs', '__pwfabric_zod', ['z', 'undefined', 'NaN', 'Infinity']))).toEqual(['z'])
    expect(shimGlobal('unknown file.mjs')).toBe('__pwfabric_unknown_file_mjs')
  })
})

describe('shell', () => {
  it('declares the import map, starts what the first page needs at once, and boots; nothing holds the first paint', () => {
    const html = buildShellHtml({ title: 'A <b>', description: 'A "café".', bodyExtra: '<!--dev-->', appearance: { theme: { typography: { fontFamily: 'Inter' } } } })
    const map = html.indexOf('type="importmap"')
    const runner = html.indexOf('<link rel="modulepreload" href="./assets/runner.js" />')
    const renderer = html.indexOf('<script async src="./assets/embed.js"></script>')
    const root = html.indexOf('<div id="root">')
    const boot = html.indexOf('<script type="module" src="./assets/boot.js">')
    expect(map).toBeGreaterThan(0)
    expect(map).toBeLessThan(runner)
    expect(runner).toBeLessThan(root)
    expect(renderer).toBeGreaterThan(map)
    expect(root).toBeLessThan(boot)
    // Nothing that holds the parser: the import map, the renderer (async), the boot module.
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script type="importmap">', '<script async src="./assets/embed.js">', '<script type="module" src="./assets/boot.js">'])
    expect(html).toContain(`<script type="importmap">${importMapText()}</script>`)
    for (const shim of new Set(Object.values(importMap().imports))) expect(html).toContain(`<link rel="modulepreload" href="${shim}" />`)
    for (const f of BOOT_FILES) expect(html).toContain(`<link rel="preload" as="fetch" href="./${f}" crossorigin />`)
    expect(html).toContain('<title>A &lt;b&gt;</title>')
    expect(html).toContain('<meta name="description" content="A &quot;café&quot;." />')
    // The webfont stylesheet is preloaded, not linked: it must not hold the first paint.
    expect(html).toMatch(/<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com[^"]*" \/>/)
    expect(html).not.toMatch(/<link rel="stylesheet" href="https:\/\/fonts/)
    expect(html).toContain('<!--dev-->')
    // No locale stated: no language guessed.
    expect(html).toContain('<html>')
    expect(html).not.toContain('Content-Security-Policy')
    const plain = buildShellHtml({ title: 'x', lang: 'tr-TR', csp: "default-src 'none'", preloadRenderer: false, bootFiles: ['pwpack/project.json'] })
    expect(plain).not.toContain('fonts.googleapis.com')
    expect(plain).not.toContain('name="description"')
    expect(plain).toContain('<html lang="tr-TR">')
    // A gated app's visitor may never need the renderer: not named.
    expect(plain).not.toContain('embed')
    expect(plain.match(/as="fetch"/g)).toHaveLength(1)
    // The policy comes before anything it governs.
    const meta = plain.indexOf(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'" />`)
    expect(meta).toBeGreaterThan(0)
    expect(meta).toBeLessThan(plain.indexOf('<link'))
    expect(meta).toBeLessThan(plain.indexOf('<script'))
  })
  it('names the hashed runtime files, and boots the runner with the renderer’s address (its words come from project.json)', () => {
    expect(hashedName('assets/embed.js', 'abc')).toMatch(/^assets\/embed\.[0-9a-f]{8}\.js$/)
    expect(hashedName('assets/embed.js', 'abc')).toBe(hashedName('assets/embed.js', 'abc'))
    expect(hashedName('assets/embed.js', 'abd')).not.toBe(hashedName('assets/embed.js', 'abc'))
    const assets = { embed: 'assets/embed.1.js', runner: 'assets/runner.2.js', boot: 'assets/boot.3.js', theme: 'assets/theme.4.css' }
    const boot = bootScript({ assets, webfontHref: 'https://fonts.googleapis.com/css2?family=Inter&display=swap' })
    expect(boot).toContain('import { runApp } from "./runner.2.js"')
    expect(boot).toContain('renderer: "./assets/embed.1.js"')
    expect(boot).not.toContain('locale')
    // The boot module links the webfonts, so they never block the first paint.
    expect(boot).toContain("fonts.rel = 'stylesheet'")
    expect(bootScript()).not.toContain('stylesheet')
  })
  it('escapes and normalises', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
    expect(scriptJson({ a: '</script>' })).toBe('{"a":"\\u003c/script>"}')
    expect(htmlLangOf('en-GB')).toBe('en-GB')
    expect(htmlLangOf('<x>')).toBe('')
    expect(htmlLangOf(undefined)).toBe('')
  })
})

describe('what a page needs first', () => {
  it('the first image: a priority block wins, else the first image block, only a literal address', async () => {
    const { firstImageOf } = await import('../../dev/shell.js')
    const img = (src: unknown, extra: Record<string, unknown> = {}) => ({ type: 'image', props: { src, ...extra } })
    expect(firstImageOf({ blocks: [{ type: 'section', children: [img('pwpack/media/a.jpg')] }, img('pwpack/media/b.jpg')] })).toEqual({ src: 'pwpack/media/a.jpg', priority: false })
    expect(
      firstImageOf({ blocks: [img('pwpack/media/a.jpg'), { type: 'hero', props: { image: 'pwpack/media/hero.webp', priority: true } }] })
    ).toEqual({ src: 'pwpack/media/hero.webp', priority: true })
    expect(firstImageOf({ blocks: [img('{{dish.photo}}'), img('data:image/png;base64,AA')] })).toBeUndefined()
  })

  it('the shell asks for the entry page, boot.js for a deep-linked one', async () => {
    const { buildShellHtml, bootScript } = await import('../../dev/shell.js')
    const hints = { receipt: 'pwpack/surfaces/menu.receipt.json', modules: ['blocks/text.1.mjs'], image: 'pwpack/media/hero.jpg', imagePriority: true }
    const html = buildShellHtml({ title: 'x', entryHints: hints, themeCss: ':root{--a:1}' })
    expect(html).toContain('<link rel="preload" as="fetch" href="./pwpack/surfaces/menu.receipt.json" crossorigin />')
    expect(html).toContain('<link rel="modulepreload" href="./blocks/text.1.mjs" />')
    expect(html).toContain('<link rel="preload" as="image" href="./pwpack/media/hero.jpg" fetchpriority="high" />')
    expect(html).toContain('<style>:root{--a:1}</style>')
    const boot = bootScript({ pageHints: { dish: hints } })
    expect(boot).toContain('"dish":')
    expect(boot).toContain("location.hash.slice(2).split(/[?#]/)[0]")
  })
})
