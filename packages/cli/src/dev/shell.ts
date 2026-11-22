/**
 * The runtime half of a pwapp: the shell page, the runner and renderer
 * bundles, and the shim modules the import map points at.
 *
 * Every bare specifier a compiled block may import comes from one list in
 * the engine (`BLOCK_HOST_IMPORTS`). The import map and the shim files are
 * derived from it here, so a block compiled against that list always links.
 *
 * A shim re-exports a global the renderer seeded from its own bundled copy
 * (one React and one runtime for every block). Its named exports are
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
} from '@pwfabric/core/host-imports'
import { FRAME_CSS_ATTR, STATIC_LAYOUT_ID } from '@pwfabric/runner'

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
  /**
   * `@pwfabric/embed/static.js`, the same renderer with React's string
   * renderer, which writes each page's first frame at build (static-paint.ts).
   * It never ships. Without it no page is painted at build.
   */
  readonly staticJs?: string
}

let cachedAssets: Promise<RuntimeAssets> | null = null

/** Reads the built runner and renderer from the installed engine packages (once per process). */
export function loadRuntimeAssets(): Promise<RuntimeAssets> {
  cachedAssets ??= (async () => {
    const runnerPath = require.resolve('@pwfabric/runner')
    const embedPath = require.resolve('@pwfabric/embed/embed.js')
    const staticPath = require.resolve('@pwfabric/embed/static.js')
    const [runnerJs, embedJs, staticJs] = await Promise.all([
      readFile(runnerPath, 'utf8'),
      readFile(embedPath, 'utf8'),
      readFile(staticPath, 'utf8'),
    ])
    // The bundle names its map in a trailing comment; the map does not ship.
    return { runnerJs: runnerJs.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n'), embedJs, staticJs }
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
  /** The rules the app's first frames share, `assets/frame.<hash>.css`; absent when none are. */
  readonly frame?: string
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
  /** The document's `<title>`: the page's title composed with the app's (receipt §1), or the app's; empty when it states none. */
  readonly title: string
  /** `<meta name="description">`: the page's description, else the app's. */
  readonly description?: string
  /** `<link rel="canonical">` and `og:url`: the page's address on the app's public origin, when the app declares one. */
  readonly canonical?: string
  /** `og:image`: the app's preview picture, as an absolute address. */
  readonly image?: string
  /** The document answers an address that names no page (`404.html`): it asks search engines not to index it. */
  readonly noindex?: boolean
  /** `<html lang>`: the app's locale. Absent or not a tag: no `lang`. */
  readonly lang?: string
  /** The webfont stylesheet of the app's theme and its pages' own (theme.ts `webfontStylesheetHref`): preconnected and preloaded. */
  readonly webfontHref?: string | null
  /** Markup appended to `<body>` (the dev server's reload client). */
  readonly bodyExtra?: string
  /** The policy for the shell's `<meta http-equiv="Content-Security-Policy">`; none when absent. */
  readonly csp?: string
  /**
   * How the app routes (`runApp`'s `router`). `path` and `auto` put the app's
   * base in `<head>` (`<base href>`, see {@link ShellOptions.base}); `auto`
   * also declares the host's fallback with `<meta name="pw-router"
   * content="path">`, which is what lets it choose path routing. Default `hash`.
   */
  readonly router?: RouterMode
  /** The app's base path under path routing (`<base href>`); default `/`. */
  readonly base?: string
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
  /**
   * The theme stylesheet's text, written into `<head>` as a `<style>` instead
   * of a `<link>`: the one render-blocking request of the shell is gone, and
   * the first paint waits for nothing but the document.
   */
  readonly themeCss?: string
  /**
   * What each page needs first, by page key (see {@link PageHints}): the
   * shell asks for the OPENED page's only ({@link PAGE_HINTS_SCRIPT}).
   * `page` is the page whose first frame this document holds: its frame is
   * not asked for again.
   */
  readonly pageHints?: {
    readonly entry: string
    readonly page?: string
    readonly routes: readonly string[]
    readonly notFound?: string
    readonly pages: Readonly<Record<string, PageHints>>
  }
  /**
   * The static first paint (pwapp-format §2.5): the first frame of the page
   * this document is for — `#pw-root` and its content, written into `#root`
   * as the document's own visible content (empty when the page is not
   * painted) — the stylesheet that lays it out at every wider breakpoint
   * (`<style id="pw-static-layout">` in `<head>`), and what
   * {@link FIRST_PAINT_SCRIPT} reads to take it away, or put another page's
   * in, when the address names another page. Absent: `#root` is empty and
   * the script is not written.
   */
  readonly firstPaint?: { readonly rootHtml: string; readonly layoutCss: string; readonly data: Record<string, unknown> }
}

/**
 * The page an address names, as both inline scripts read it: the hash
 * router's key (`#/<key>?<query>`), the entry for none, the app's not-found
 * page for a key that is not a route. Under path routing (the data's
 * `router` is `path`, or `auto` with the shell's `<meta name="pw-router">`,
 * as the runner resolves it) the key is the path below the shell's
 * `<base href>` and the query is the address's own. A page is then looked up as an OWN key
 * of its table only (`#/constructor` names none).
 */
const ADDRESS_KEY = String.raw`var own = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k) }
    var meta = document.querySelector('meta[name="pw-router"]')
    var byPath = d.router === 'path' || (d.router === 'auto' && typeof history.pushState === 'function' && !!meta && meta.getAttribute('content') === 'path')
    var m, key
    if (byPath) {
      var el = document.querySelector('base')
      var b = new URL((el && el.getAttribute('href')) || '/', location.href).pathname.replace(/\/+$/, '')
      var p = location.pathname.replace(/\/+$/, '')
      key = p === b ? '' : p.indexOf(b + '/') === 0 ? p.slice(b.length + 1) : '/'
      m = [p, key, location.search.replace(/^\?/, '')]
    } else {
      m = /^#\/([^#?]*)(?:\?([^#]*))?/.exec(location.hash)
      key = m ? m[1].replace(/\/+$/, '') : ''
    }
    if (key === '') key = d.entry
    if (d.routes.indexOf(key) < 0 && d.notFound) key = d.notFound`

/**
 * The shell's inline script in `<head>`: asks for what the OPENED page needs
 * — its receipt, its block modules, its first image, its first frame — and nothing of any
 * other page's (pwapp-format §2.1). It reads `<script type="application/json"
 * id="pw-page-hints">` (`{ entry, routes, notFound?, pages: { <key>: PageHints } }`).
 * It also names the page on `<html data-pw-page="<key>">` before the first
 * paint, so a page that wears its own theme has its ground from the start
 * (theme.ts `buildThemeCss`).
 * A hint is only a head start: nothing here can stop the app from starting.
 * Constant text, so the Content Security Policy allows it by one hash.
 */
export const PAGE_HINTS_SCRIPT = String.raw`(function () {
  try {
    var d = JSON.parse(document.getElementById('pw-page-hints').textContent || '{}')
    ${ADDRESS_KEY}
    var page = own(d.pages, key) ? d.pages[key] : null
    if (!page) return
    document.documentElement.setAttribute('data-pw-page', key)
    var add = function (href, as, high) {
      var link = document.createElement('link')
      link.rel = 'preload'
      link.setAttribute('as', as)
      link.href = /^(https?:|\.\/)/.test(href) ? href : './' + href
      if (as === 'fetch') link.crossOrigin = 'anonymous'
      if (high) link.setAttribute('fetchpriority', 'high')
      document.head.appendChild(link)
    }
    if (typeof page.receipt === 'string') add(page.receipt, 'fetch')
    for (var j = 0; j < (page.modules || []).length; j++) if (typeof page.modules[j] === 'string') add(page.modules[j], 'fetch')
    if (typeof page.image === 'string') add(page.image, 'image', page.imagePriority === true)
    // The frame only where the first-paint script puts it in: a page this
    // document does not hold, with no query key that changes it. Anywhere
    // else it was "preloaded but not used".
    var painted = typeof page.frame === 'string' && key !== d.page
    if (painted && m && m[2]) {
      var query = new URLSearchParams(m[2])
      for (var i = 0; i < (page.frameKeys || []).length; i++) if (query.has(page.frameKeys[i])) painted = false
    }
    if (painted) add(page.frame, 'fetch')
  } catch (e) {}
})()`

/**
 * The shell's inline script after `#root`, run where it stands — before the
 * first paint. The document holds the first frame of the page it is for
 * (`#pw-root[data-pw-static="<key>"]`); the script lets it stand only where
 * it is this visit's first frame — the address names that page, and its
 * query carries no key that changes the frame. Otherwise it takes the frame
 * and its stylesheet (`#pw-static-layout`) away before the browser paints
 * them, and when the address names another painted page (or one the app does
 * not have, while its not-found page is painted) and no such key, fetches
 * that page's frame (`pwpack/surfaces/<key>.html`: its stylesheet and its
 * `#pw-root`) and puts it in place when it arrives — unless the runner has
 * drawn into the root by then.
 * Constant text, so the Content Security Policy allows it by one hash.
 */
export const FIRST_PAINT_SCRIPT = String.raw`(function () {
  var root = document.getElementById('root')
  var data = document.getElementById('pw-first-paint')
  if (!root || !data) return
  try {
    var d = JSON.parse(data.textContent || '{}')
    ${ADDRESS_KEY}
    var page = own(d.pages, key) ? d.pages[key] : null
    if (page && m && m[2]) {
      var query = new URLSearchParams(m[2])
      for (var i = 0; i < page.keys.length; i++) if (query.has(page.keys[i])) { page = null; break }
    }
    var held = root.firstElementChild
    if (page && held && held.getAttribute('data-pw-static') === key) return
    var layout = document.getElementById('pw-static-layout')
    if (layout) layout.parentNode.removeChild(layout)
    while (root.firstChild) root.removeChild(root.firstChild)
    if (!page || !page.file) return
    fetch('./' + page.file).then(function (r) { return r.ok ? r.text() : '' }).then(function (html) {
      if (!html || root.firstChild) return
      var t = document.createElement('template')
      t.innerHTML = html
      var style = t.content.getElementById('pw-static-layout')
      var frame = t.content.getElementById('pw-root')
      if (!frame) return
      if (style) document.head.appendChild(style)
      root.appendChild(frame)
    }).catch(function () {})
  } catch (e) {}
})()`

/**
 * What a page needs before it can draw, so the shell (or boot.js) can ask for
 * all of it at once instead of in a chain — runner, then receipt, then one
 * module per block type.
 */
export interface PageHints {
  /** The page's receipt, as the runner fetches it (`pwpack/surfaces/<key>.receipt.json`). */
  readonly receipt: string
  /** Every block module the page places. */
  readonly modules: readonly string[]
  /** The image the page shows first (its likely largest paint), when one is known at build. */
  readonly image?: string
  /** The image is one a block marked `priority: true`: fetched at high priority. */
  readonly imagePriority?: boolean
  /**
   * The page's first frame (`pwpack/surfaces/<key>.html`, pwapp-format §2.5),
   * for a page painted at build: asked for with the document, so the
   * first-paint script's fetch of it is not one more round trip behind the
   * runner. Only where that script will put it in: on a document that holds
   * another page's frame, and with none of `frameKeys` in the address's query.
   */
  readonly frame?: string
  /** The query keys that change the page's first frame (the first-paint data's `keys`). */
  readonly frameKeys?: readonly string[]
}

/** An app file as the shell addresses it (`./…`); an absolute address as written. */
export function servedHref(href: string): string {
  return /^https?:\/\//i.test(href) ? href : `./${href.replace(/^\.?\//, '')}`
}

/** The props a block names its picture by. */
const IMAGE_PROPS = ['src', 'image', 'imageSrc', 'backgroundImage'] as const

/**
 * The image a page shows first, as the build can know it: the first block
 * that says it is the page's priority image (`priority: true`), else the
 * first `image` block that is loaded eagerly (`loading: "eager"`), depth
 * first — with a literal address (an expression or a `data:` URI cannot be
 * preloaded). A lazy image (`loading` is `"lazy"` or unset, the image
 * block's default) is fetched by the browser only when it nears the
 * viewport, so it is never preloaded: on a page that does not show it — a
 * below-the-fold picture, a record page that finds no record — the preload
 * is a download the visitor never uses.
 */
export function firstImageOf(receipt: unknown): { readonly src: string; readonly priority: boolean } | undefined {
  // A literal address of the app's own (relative) or an http(s) one; never an
  // expression, a `data:` URI or another scheme.
  const literal = (v: unknown): string | undefined => {
    if (typeof v !== 'string' || v.trim() === '' || v.includes('{{')) return undefined
    const src = v.trim()
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) && !/^https?:\/\//i.test(src)) return undefined
    return src.startsWith('//') ? undefined : src
  }
  const srcOf = (props: Record<string, unknown>): string | undefined => {
    for (const k of IMAGE_PROPS) {
      const v = literal(props[k])
      if (v) return v
    }
    return undefined
  }
  let first: string | undefined
  let priority: string | undefined
  const walk = (node: unknown): void => {
    if (priority !== undefined) return
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const block = node as Record<string, unknown>
    const props = (block['props'] && typeof block['props'] === 'object' ? block['props'] : {}) as Record<string, unknown>
    if (props['priority'] === true) {
      const src = srcOf(props)
      if (src) priority = src
    }
    if (first === undefined && block['type'] === 'image' && props['loading'] === 'eager') first = literal(props['src'])
    walk(block['children'])
  }
  if (receipt && typeof receipt === 'object') walk((receipt as Record<string, unknown>)['blocks'])
  if (priority !== undefined) return { src: priority, priority: true }
  return first !== undefined ? { src: first, priority: false } : undefined
}

/** The exact text of the shell's inline import map (the CSP hashes this). */
export function importMapText(): string {
  return scriptJson(importMap())
}

export interface BootOptions {
  /** The runtime files' served names; default {@link PLAIN_ASSETS}. */
  readonly assets?: ShellAssets
  /** The webfont stylesheet the theme names, linked by the boot module so it never holds the first paint. */
  readonly webfontHref?: string | null
  /** `runApp`'s `router`; default `hash`. */
  readonly router?: RouterMode
}

/** How a built app routes: `runApp({ router })`. */
export type RouterMode = 'hash' | 'path' | 'auto'
export const ROUTER_MODES: readonly RouterMode[] = ['hash', 'path', 'auto']

/** `assets/boot.<hash>.js`: the module that starts the runner. */
export function bootScript(options: BootOptions = {}): string {
  const assets = options.assets ?? PLAIN_ASSETS
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
runApp({ source: './pwpack', blocks: './blocks/', engines: './engines', renderer: ${JSON.stringify(`./${assets.embed}`)}, router: ${JSON.stringify(options.router ?? 'hash')} })
`
}

/**
 * The app's locale as the page's `lang`: a BCP-47-looking tag, or `''` —
 * no `lang` at all. The engine guesses no language for an app that states
 * none (`pwf validate` says so: MESSAGES_MISSING reads the same locale).
 */
export function htmlLangOf(locale: string | undefined): string {
  const tag = (locale ?? '').trim()
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(tag) ? tag : ''
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
  const href = options.webfontHref ?? null
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
  // What a search engine and a link preview read: the page's own (§2.4).
  const meta = [
    options.noindex ? '<meta name="robots" content="noindex" />' : '',
    options.canonical ? `<link rel="canonical" href="${escapeHtml(options.canonical)}" />` : '',
    '<meta property="og:type" content="website" />',
    options.title ? `<meta property="og:title" content="${escapeHtml(options.title)}" />` : '',
    options.description?.trim() ? `<meta property="og:description" content="${escapeHtml(options.description.trim())}" />` : '',
    options.canonical ? `<meta property="og:url" content="${escapeHtml(options.canonical)}" />` : '',
    options.image ? `<meta property="og:image" content="${escapeHtml(options.image)}" />` : '',
  ]
    .filter((l) => l !== '')
    .map((l) => `
    ${l}`)
    .join('')
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
  const lang = htmlLangOf(options.lang)
  // Path routing: the app's base, so the relative addresses below resolve on
  // a nested path too; `auto` also needs the host's fallback declared.
  const router = options.router ?? 'hash'
  const base =
    router === 'hash'
      ? ''
      : `
    <base href="${escapeHtml(options.base ?? '/')}" />${router === 'auto' ? `
    <meta name="pw-router" content="path" />` : ''}`
  const firstPaint = options.firstPaint
    ? `
    <script type="application/json" id="pw-first-paint">${scriptJson(options.firstPaint.data)}</script>
    <script>${FIRST_PAINT_SCRIPT}</script>`
    : ''
  // The rules every page's frame shares (static-paint.ts `shareFrameStyles`),
  // before the frame's own layout, whose rules outweigh them.
  const frameCss = assets.frame
    ? `
    <link rel="stylesheet" href="./${escapeHtml(assets.frame)}" ${FRAME_CSS_ATTR} />`
    : ''
  const layout = options.firstPaint?.layoutCss
    ? `
    <style id="${STATIC_LAYOUT_ID}">${options.firstPaint.layoutCss.replace(/<\//g, '<\\/')}</style>`
    : ''
  const hints = options.pageHints && Object.keys(options.pageHints.pages).length > 0
    ? `
    <script type="application/json" id="pw-page-hints">${scriptJson(options.pageHints)}</script>
    <script>${PAGE_HINTS_SCRIPT}</script>`
    : ''
  return `<!doctype html>
<html${lang ? ` lang="${escapeHtml(lang)}"` : ''}>
  <head>
    <meta charset="UTF-8" />${base}${csp}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)}</title>${description}${meta}
    <link rel="icon" href="data:," />
    ${options.themeCss !== undefined ? `<style>${options.themeCss.replace(/<\//g, '<\\/')}</style>` : `<link rel="stylesheet" href="./${escapeHtml(assets.theme)}" />`}${frameCss}${layout}${fonts}
    <script type="importmap">${importMapText()}</script>
    <link rel="modulepreload" href="./${escapeHtml(assets.runner)}" />${renderer}${shims}${boot}${hints}
  </head>
  <body>
    <div id="root">${options.firstPaint?.rootHtml ?? ''}</div>${firstPaint}
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
  if (/<base[\s>]/i.test(html)) return body
  const at = html.search(/<head[^>]*>/i)
  if (at < 0) return body
  const end = html.indexOf('>', at) + 1
  const tag = `
    <base href="${href.replace(/"/g, '&quot;')}" />`
  return new TextEncoder().encode(html.slice(0, end) + tag + html.slice(end))
}
