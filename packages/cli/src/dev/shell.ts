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
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import {
  BLOCK_HOST_IMPORTS,
  blockImportMap,
  blockShimFiles,
  specifiersForShim,
} from '@pwfabric/core'
import { webfontStylesheetHref, themeWebfonts } from './theme.js'

const require = createRequire(import.meta.url)

/** The runner and renderer bundles a pwapp ships. */
export interface RuntimeAssets {
  /** `assets/runner.js` — the ES module exporting `runApp`. */
  readonly runnerJs: string
  /** Its source map, when the build has one. */
  readonly runnerMap?: string
  /** `assets/embed.js` — the classic script that defines `window.PWFabric`. */
  readonly embedJs: string
}

let cachedAssets: Promise<RuntimeAssets> | null = null

/** Reads the built runner and renderer from the installed engine packages (once per process). */
export function loadRuntimeAssets(): Promise<RuntimeAssets> {
  cachedAssets ??= (async () => {
    const runnerPath = require.resolve('@pwfabric/runner')
    const embedPath = require.resolve('@pwfabric/embed/embed.js')
    const [runnerJs, embedJs, runnerMap] = await Promise.all([
      readFile(runnerPath, 'utf8'),
      readFile(embedPath, 'utf8'),
      readFile(`${runnerPath}.map`, 'utf8').catch(() => undefined),
    ])
    return { runnerJs, embedJs, ...(runnerMap !== undefined ? { runnerMap } : {}) }
  })()
  cachedAssets.catch(() => {
    cachedAssets = null
  })
  return cachedAssets
}

/** The vendor table the renderer exposes besides the `__pwfabric_*` globals. */
const VENDOR_GLOBAL = '__PW_VENDOR__'

/**
 * Globals the renderer bundle does not seed itself, and the vendor-table key
 * the shell seeds each from (see {@link buildShellHtml}), so blocks that reach
 * for these get the renderer's own instance instead of `undefined`.
 *
 * The renderer bundle (`@pwfabric/embed`'s `embed.js`) carries `react-dom`,
 * `@pwfabric/core` and `@pwfabric/authoring` (the `sdk@v1` shim's package)
 * in its `__PW_VENDOR__` table but does not seed these globals itself, so a
 * block that uses a VALUE from core or the authoring kit (as opposed to a
 * type) reads the renderer's instance here instead of `undefined`.
 */
export const SHELL_SEEDED_GLOBALS: Readonly<Record<string, string>> = {
  __pwfabric_react_dom: 'react-dom',
  __pwfabric_core: '@pwfabric/core',
  __pwfabric_sdk: '@pwfabric/authoring',
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

const RESERVED = new Set(
  (
    'break case catch class const continue debugger default delete do else enum export extends false finally for ' +
    'function if import in instanceof new null return super switch this throw true try typeof var void while with ' +
    'yield let static implements interface package private protected public await arguments eval'
  ).split(' ')
)

/** Whether `name` can be an `export const { name }` binding. */
export function isExportableName(name: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(name) && !RESERVED.has(name)
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

/** Source of one shim module. */
export function shimSource(shim: string, global: string, names: readonly string[]): string {
  const exported = [...new Set(names)].filter(isExportableName).sort()
  const specifiers = specifiersForShim(shim)
  const lines = [
    `// Generated by pwf. Serves ${specifiers.map((s) => `'${s}'`).join(', ')} to compiled blocks:`,
    `// re-exports the instance the page seeded on globalThis.${global}.`,
    `const m = globalThis.${global} ?? {}`,
    'export default m',
  ]
  if (exported.length > 0) {
    lines.push(`export const {\n${exported.map((n) => `  ${n},`).join('\n')}\n} = m`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * Every shim file the import map can point at, with its source.
 *
 * Names come from, in order: the global the renderer seeds; the vendor table
 * entry the shell seeds the global from; the package itself (for globals no
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
    const vendorKey = SHELL_SEEDED_GLOBALS[global]
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

export interface ShellOptions {
  readonly title: string
  /** `<html lang>`; default `en`. */
  readonly lang?: string
  /** The app's appearance configuration (its webfonts are linked). */
  readonly appearance?: Record<string, unknown>
  /** Markup appended to `<body>` (the dev server's reload client). */
  readonly bodyExtra?: string
  /** The policy for the shell's `<meta http-equiv="Content-Security-Policy">`; none when absent. */
  readonly csp?: string
}

/** The exact text of the shell's inline import map (the CSP hashes this). */
export function importMapText(): string {
  return scriptJson(importMap())
}

/**
 * `assets/seed.js`: seeds the globals the renderer does not seed itself from
 * its vendor table (a file, not an inline script, so the policy needs no hash).
 */
export function seedScript(): string {
  const seeds = Object.entries(SHELL_SEEDED_GLOBALS)
    .map(([global, key]) => `  g.${global} = g.${global} || v[${JSON.stringify(key)}];`)
    .join('\n')
  return `// Generated by pwf: globals the renderer carries in ${VENDOR_GLOBAL} but does not seed.
(function (g) {
  var v = g.${VENDOR_GLOBAL} || {};
${seeds}
})(globalThis)
`
}

/** `assets/boot.js`: the module that starts the runner. */
export function bootScript(locale: 'en' | 'tr' = 'en'): string {
  return `// Generated by pwf: starts the app.
import { runApp } from './runner.js'

runApp({ source: './pwpack', blocks: './blocks/', engines: './engines', router: 'hash', locale: '${locale}' })
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
 * `index.html`, in the order the pwapp format requires: import map, the
 * renderer (a classic script that seeds the shared globals) and `seed.js`,
 * the mount element, then `boot.js`, which starts the runner. The import map
 * is the only inline script, so a Content Security Policy needs one hash.
 * Every address is relative, so the folder works at a host root, under a
 * sub-path, or from disk behind any static server.
 */
export function buildShellHtml(options: ShellOptions): string {
  const href = webfontStylesheetHref(themeWebfonts(options.appearance))
  const fonts = href
    ? `
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${escapeHtml(href)}" />`
    : ''
  const csp = options.csp
    ? `
    <meta http-equiv="Content-Security-Policy" content="${escapeHtml(options.csp)}" />`
    : ''
  return `<!doctype html>
<html lang="${escapeHtml(htmlLangOf(options.lang))}">
  <head>
    <meta charset="UTF-8" />${csp}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="./assets/theme.css" />${fonts}
    <script type="importmap">${importMapText()}</script>
    <script src="./assets/embed.js"></script>
    <script src="./assets/seed.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/boot.js"></script>${options.bodyExtra ?? ''}
  </body>
</html>
`
}
