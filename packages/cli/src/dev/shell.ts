/**
 * The runtime half of a pwapp: the shell page, the runner and renderer
 * bundles, and the shim modules the import map points at.
 *
 * Every bare specifier a compiled block may import comes from one list in
 * the engine (`BLOCK_HOST_IMPORTS`). The import map and the shim files are
 * derived from it here, so a block compiled against that list always links.
 *
 * A shim re-exports a global the renderer seeded from its own bundled copy
 * (one React, one runtime, one zod for every block). Its named exports are
 * not typed out by hand: they are read off the very globals the renderer
 * bundle seeds, by evaluating that bundle once in an isolated context. An
 * ESM import of a name a shim does not export fails the whole module at link
 * time, so the list has to be complete — and reading it from the bundle that
 * serves it is the only way it stays complete.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import {
  BLOCK_HOST_IMPORTS,
  blockImportMap,
  blockShimFiles,
  shimSource,
} from '@pwfabric/core'
import { webfontStylesheetHref, themeWebfonts } from './theme.js'

const require = createRequire(import.meta.url)

/**
 * The runner and renderer bundles a pwapp ships. No source map: a published
 * app serves its visitors no `.map` files (pwapp-format §1).
 */
export interface RuntimeAssets {
  /** `assets/runner.<hash>.js` — the ES module exporting `runApp`. */
  readonly runnerJs: string
  /** `assets/embed.<hash>.js` — the classic script that defines `window.PWFabric`. */
  readonly embedJs: string
}

let cachedAssets: Promise<RuntimeAssets> | null = null

/** Reads the built runner and renderer from the installed engine packages (once per process). */
export function loadRuntimeAssets(): Promise<RuntimeAssets> {
  cachedAssets ??= (async () => {
    const runnerPath = require.resolve('@pwfabric/runner')
    const embedPath = require.resolve('@pwfabric/embed/embed.js')
    const [runnerJs, embedJs] = await Promise.all([readFile(runnerPath, 'utf8'), readFile(embedPath, 'utf8')])
    // The bundle names its map in a trailing comment; the map does not ship.
    return { runnerJs: runnerJs.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'), embedJs }
  })()
  cachedAssets.catch(() => {
    cachedAssets = null
  })
  return cachedAssets
}

/** The vendor table the renderer exposes besides the `__pwfabric_*` globals. */
const VENDOR_GLOBAL = '__PW_VENDOR__'

/**
 * The vendor-table entry (`__PW_VENDOR__`) a global's names can be read from
 * when a renderer carries the package there without seeding the global.
 */
const VENDOR_KEYS: Readonly<Record<string, string>> = {
  __pwfabric_react_dom: 'react-dom',
  __pwfabric_core: '@pwfabric/core',
}

/** Packages to read export names from when no bundle seeds their global. */
const NAME_SOURCES: Readonly<Record<string, string>> = {
  __pwfabric_core: '@pwfabric/core',
  __pwfabric_sdk: '@pwfabric/authoring',
}

/** Export names a shim falls back to when neither a bundle nor a package says more. */
const FALLBACK_NAMES: Readonly<Record<string, readonly string[]>> = {
  __pwfabric_sdk: ['defineBlock'],
}

/** Evaluates the renderer bundle in an isolated context and returns what it put on `globalThis`. */
export function seededGlobals(embedJs: string): Record<string, unknown> {
  const sandbox: Record<string, unknown> = { console, setTimeout, clearTimeout, queueMicrotask }
  sandbox['globalThis'] = sandbox
  sandbox['self'] = sandbox
  const context = vm.createContext(sandbox)
  try {
    vm.runInContext(embedJs, context, { filename: 'embed.js', timeout: 10_000 })
  } catch {
    // A bundle that needs a document past its globals still seeded them first.
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(sandbox)) {
    if (k.startsWith('__pwfabric_') || k === VENDOR_GLOBAL) out[k] = v
  }
  return out
}

async function namesFromPackage(pkg: string): Promise<string[] | null> {
  try {
    const mod = (await import(pkg)) as Record<string, unknown>
    return Object.keys(mod)
  } catch {
    return null
  }
}

/** The global each shim file reads (every specifier sharing a shim names the same global). */
export function shimGlobal(shim: string): string {
  const entry = BLOCK_HOST_IMPORTS.find((i) => i.shim === shim && i.global)
  return entry?.global ?? `__pwfabric_${shim.replace(/[^A-Za-z0-9]+/g, '_')}`
}

/**
 * Every shim file the import map can point at, with its source.
 *
 * Names come from, in order: the global the renderer seeds; the renderer's
 * vendor table entry for that package; the package itself (for globals no
 * standalone page seeds — their exports resolve to `undefined`, which keeps a
 * block linking instead of failing at load).
 */
export async function buildShims(embedJs: string): Promise<Map<string, string>> {
  const seeded = seededGlobals(embedJs)
  const vendor = (seeded[VENDOR_GLOBAL] ?? {}) as Record<string, unknown>
  const out = new Map<string, string>()
  for (const shim of blockShimFiles()) {
    const global = shimGlobal(shim)
    let names: string[] | null = null
    const value = seeded[global]
    if (value && typeof value === 'object') names = Object.keys(value)
    const vendorKey = VENDOR_KEYS[global]
    if (!names && vendorKey && vendor[vendorKey] && typeof vendor[vendorKey] === 'object') {
      names = Object.keys(vendor[vendorKey] as object)
    }
    if (!names && NAME_SOURCES[global]) names = await namesFromPackage(NAME_SOURCES[global] as string)
    out.set(shim, shimSource(shim, global, names ?? [...(FALLBACK_NAMES[global] ?? [])]))
  }
  return out
}

let cachedShims: { embedJs: string; shims: Promise<Map<string, string>> } | null = null

/** {@link buildShims}, once per renderer bundle. */
export function shimsFor(embedJs: string): Promise<Map<string, string>> {
  if (cachedShims?.embedJs !== embedJs) cachedShims = { embedJs, shims: buildShims(embedJs) }
  return cachedShims.shims
}

/** The import map: every host import → `./shims/<file>`. */
export function importMap(): { readonly imports: Record<string, string> } {
  return blockImportMap('./shims')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** JSON safe to place inside a `<script>` element. */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/**
 * A served file's content-hashed name: `assets/embed.js` → `assets/embed.<8 hex>.js`.
 * The name changes exactly when the bytes do, so a host can serve it as
 * immutable (`_headers`, see csp.ts) and a new build never meets a stale copy.
 */
export function hashedName(path: string, bytes: Uint8Array | string): string {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
  const dot = path.lastIndexOf('.')
  return dot > path.lastIndexOf('/') ? `${path.slice(0, dot)}.${hash}${path.slice(dot)}` : `${path}.${hash}`
}

/** Where the shell finds its four runtime files, relative to the folder root. */
export interface ShellAssets {
  /** The renderer, `assets/embed.<hash>.js`. */
  readonly embed: string
  /** The runner, `assets/runner.<hash>.js`. */
  readonly runner: string
  /** The boot module, `assets/boot.<hash>.js`. */
  readonly boot: string
  /** The token stylesheet, `assets/theme.<hash>.css`. */
  readonly theme: string
}

/** The names a build without hashes would use (tests, and a shell built before its files). */
export const PLAIN_ASSETS: ShellAssets = {
  embed: 'assets/embed.js',
  runner: 'assets/runner.js',
  boot: 'assets/boot.js',
  theme: 'assets/theme.css',
}

/**
 * Envelope files every runner reads on boot (envelope §1), asked for by the
 * shell itself (`<link rel="preload" as="fetch">`) so they are in flight while
 * the runner is still downloading.
 */
export const BOOT_FILES = [
  'pwpack/project.json',
  'pwpack/navigation.json',
  'pwpack/appearance.json',
  'pwpack/connections.json',
  'blocks/manifest.json',
  'engines/manifest.json',
] as const

export interface ShellOptions {
  readonly title: string
  /** `<meta name="description">`: the app's description, or its entry page's. */
  readonly description?: string
  /** `<html lang>`; default `en`. */
  readonly lang?: string
  /** The app's appearance configuration (its webfonts are linked). */
  readonly appearance?: Record<string, unknown>
  /** Markup appended to `<body>` (the dev server's reload client). */
  readonly bodyExtra?: string
  /** The policy for the shell's `<meta http-equiv="Content-Security-Policy">`; none when absent. */
  readonly csp?: string
  /** The runtime files' served names; default {@link PLAIN_ASSETS}. */
  readonly assets?: ShellAssets
  /**
   * Start the renderer with the page (`<script async>`). True for an app a
   * visitor sees at once; false for one behind a sign-in wall, whose visitor
   * may never need it (the runner adds it when it draws a page).
   */
  readonly preloadRenderer?: boolean
  /** Envelope files to preload; default {@link BOOT_FILES}. Only files the folder has. */
  readonly bootFiles?: readonly string[]
}

/** The exact text of the shell's inline import map (the CSP hashes this). */
export function importMapText(): string {
  return scriptJson(importMap())
}

export interface BootOptions {
  /** The runner's content locale. */
  readonly locale?: 'en' | 'tr'
  /** The runtime files' served names; default {@link PLAIN_ASSETS}. */
  readonly assets?: ShellAssets
  /** The webfont stylesheet the theme names, linked by the boot module so it never holds the first paint. */
  readonly webfontHref?: string | null
}

/** `assets/boot.<hash>.js`: the module that starts the runner. */
export function bootScript(options: BootOptions = {}): string {
  const assets = options.assets ?? PLAIN_ASSETS
  const locale = options.locale ?? 'en'
  // boot sits in assets/ beside the runner; the renderer's address is the
  // document's (the runner adds it as a <script src>).
  const runner = `./${assets.runner.slice(assets.runner.lastIndexOf('/') + 1)}`
  const fonts = options.webfontHref
    ? `
// The theme's webfonts: linked from here, not from <head>, so the stylesheet
// does not hold the first paint (font-display: swap and the metric-matched
// fallbacks in the theme stylesheet keep the text from moving when they land).
const fonts = document.createElement('link')
fonts.rel = 'stylesheet'
fonts.href = ${JSON.stringify(options.webfontHref)}
document.head.appendChild(fonts)
`
    : ''
  return `// Generated by pwf: starts the app.
import { runApp } from ${JSON.stringify(runner)}
${fonts}
runApp({ source: './pwpack', blocks: './blocks/', engines: './engines', renderer: ${JSON.stringify(`./${assets.embed}`)}, router: 'hash', locale: '${locale}' })
`
}

/** A BCP-47-looking tag, or `en`. */
export function htmlLangOf(locale: string | undefined): string {
  const tag = (locale ?? '').trim()
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : 'en'
}

/** `tr-TR` → `tr`; the runner's copy knows `en` and `tr`. */
export function runnerLocaleOf(locale: string | undefined): 'en' | 'tr' {
  return /^tr(?:[-_]|$)/i.test(locale ?? '') ? 'tr' : 'en'
}

/**
 * `index.html`. Nothing in it holds the first paint but the token
 * stylesheet: the import map (the only inline script, so a Content Security
 * Policy needs one hash); the renderer as an `async` script and preloads that
 * start the runner, the shims and the envelope files the runner reads on
 * boot, all at once; the mount element; then `boot.js`, which starts the
 * runner. An app that requires sign-in does not name the renderer: the runner
 * adds it when it draws a page (pwapp-format §2), so a visitor held at the
 * gate never downloads it.
 *
 * Every address is relative, so the folder works at a host root, under a
 * sub-path, or from disk behind any static server.
 */
export function buildShellHtml(options: ShellOptions): string {
  const assets = options.assets ?? PLAIN_ASSETS
  const href = webfontStylesheetHref(themeWebfonts(options.appearance))
  const fonts = href
    ? `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="preload" as="style" href="${escapeHtml(href)}" />`
    : ''
  const csp = options.csp
    ? `
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(options.csp)}" />`
    : ''
  const description = options.description?.trim()
    ? `
    <meta name="description" content="${escapeHtml(options.description.trim())}" />`
    : ''
  // `async`: downloaded with the page and run the moment it arrives, holding
  // neither the parser nor the first paint, and not waiting for the runner
  // (which waits for this element when it needs the renderer).
  const renderer =
    options.preloadRenderer === false
      ? ''
      : `
    <script async src="./${escapeHtml(assets.embed)}"></script>`
  // The shims every block imports: fetched and compiled with the page (a
  // module preload does not evaluate them), not one round trip after the
  // first block module is imported.
  const shims = [...new Set(Object.values(importMap().imports))]
    .map((f) => `
    <link rel="modulepreload" href="${escapeHtml(f)}" />`)
    .join('')
  const boot = (options.bootFiles ?? BOOT_FILES)
    .map((f) => `
    <link rel="preload" as="fetch" href="./${escapeHtml(f)}" crossorigin />`)
    .join('')
  return `<!doctype html>
<html lang="${escapeHtml(htmlLangOf(options.lang))}">
  <head>
    <meta charset="UTF-8" />${csp}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>${description}
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="./${escapeHtml(assets.theme)}" />${fonts}
    <script type="importmap">${importMapText()}</script>
    <link rel="modulepreload" href="./${escapeHtml(assets.runner)}" />${renderer}${shims}${boot}
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./${escapeHtml(assets.boot)}"></script>${options.bodyExtra ?? ''}
  </body>
</html>
`
}

/**
 * The shell with `<base href="/">` as the first element of its head, unless it
 * already declares a base.
 *
 * The shell addresses its scripts and the import map relatively (`./assets/…`,
 * `./shims/…`) so the folder works under any sub-path. When a server answers a
 * nested page path (`/team/members`) with that shell, the browser would resolve
 * those addresses against `/team/` and miss every file. The pwapp format puts
 * the fix on the host: under path routing it declares the app's base with
 * `<base href>`. This server serves the app at its root, so the base is `/`.
 */
export function withBaseHref(body: Uint8Array, href = '/'): Uint8Array {
  const html = new TextDecoder().decode(body)
  if (/<bases/i.test(html)) return body
  const at = html.search(/<head[^>]*>/i)
  if (at < 0) return body
  const end = html.indexOf('>', at) + 1
  const tag = `
    <base href="${href.replace(/"/g, '&quot;')}" />`
  return new TextEncoder().encode(html.slice(0, end) + tag + html.slice(end))
}
