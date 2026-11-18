/**
 * The static first paint (pwapp-format §2.5): every page's first frame,
 * rendered at build time, so a visitor sees the page before any script runs
 * and the renderer hydrates it instead of drawing it again.
 *
 * HOW. `@pwfabric/embed/static.js` — the renderer of `embed.js` plus React's
 * string renderer, built from the same sources — is evaluated in an isolated
 * context, one per build (the block loader is a singleton: one app's blocks
 * must not reach another's render, nor a rebuild's stale ones). Each placed
 * block's compiled module is evaluated there as a CommonJS body whose host
 * imports resolve to the instances that bundle seeded, as the import map
 * resolves them in the browser. Each page is then rendered from the runner's
 * own first-frame functions (`@pwfabric/runner` first-frame.ts), from the
 * envelope files as the build serves them.
 *
 * WHAT A FIRST FRAME IS: the receipt's own content and its static sources;
 * every fetched source loading (nothing is fetched here — build-time data
 * never reaches a visitor's HTML); nobody signed in; nothing read from the
 * address; the phone layout. An app that requires sign-in has no first frame
 * the build can know (who is signed in decides what is drawn): it is not
 * painted.
 *
 * A block whose render throws here (it reads `window` while rendering) is
 * left to the browser and reported: the rule for blocks is "render is pure;
 * browser APIs only in effects".
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { BLOCK_HOST_IMPORTS } from '@pwfabric/core'
import { toCommonJs } from '@pwfabric/compiler'
import {
  FIRST_FRAME_USER,
  STATIC_PAGE_ATTR,
  STATIC_VIEWPORT,
  STATIC_VIEWPORT_MAX_WIDTH,
  addressStateKeys,
  doorOf,
  firstFrameAuthState,
  firstFrameLocale,
  firstFrameOptions,
  ownApiBaseOf,
  ownRecordsReceipt,
  pageSurfaceOf,
  projectAppearanceRef,
  runnerMessages,
} from '@pwfabric/runner'
import type { AssembleDiagnostic } from './diagnostics.js'
import { escapeHtml } from './shell.js'

const require = createRequire(import.meta.url)

let cachedStatic: Promise<string> | null = null

/** The static renderer bundle from the installed engine (once per process). */
export function loadStaticRenderer(): Promise<string> {
  cachedStatic ??= readFile(require.resolve('@pwfabric/embed/static.js'), 'utf8')
  cachedStatic.catch(() => {
    cachedStatic = null
  })
  return cachedStatic
}

/** The hash router's address of a page (runner router.ts): what every built shell routes with. */
const hashHref = (key: string): string => `#/${key}`

/** One page the static paint renders. */
export interface StaticPage {
  readonly key: string
  /** The receipt as the build serves it (media filled, record fields declared). */
  readonly receipt: Record<string, unknown>
}

export interface StaticPaintInput {
  /** `@pwfabric/embed/static.js`'s source. */
  readonly staticJs: string
  /** Every placed block's descriptor (`blocks/manifest.json`). */
  readonly blockManifest: readonly { readonly blockType: string; readonly moduleUrl: string }[]
  /** The served files: each block's module is read from here. */
  readonly files: ReadonlyMap<string, Uint8Array>
  /** The envelope files as served. */
  readonly project: Record<string, unknown>
  readonly navigation: unknown
  readonly appearance: unknown
  readonly auth: unknown
  /** Every route, then the app's not-found page when it has one. */
  readonly pages: readonly StaticPage[]
}

/** What a page's first frame came out as. */
export interface PaintedPage {
  readonly key: string
  readonly html: string
  /** The query keys that seed the page's state: an address carrying one is not painted from the build. */
  readonly addressKeys: readonly string[]
}

export interface StaticPaintResult {
  readonly pages: readonly PaintedPage[]
  readonly diagnostics: readonly AssembleDiagnostic[]
}

/** The sandbox a build renders in: what React's string renderer and the runtime read, nothing that keeps the process alive. */
function sandbox(): Record<string, unknown> {
  const unref = <T>(timer: T): T => {
    ;(timer as { unref?: () => void }).unref?.()
    return timer
  }
  const box: Record<string, unknown> = {
    console,
    setTimeout: (fn: () => void, ms?: number) => unref(setTimeout(fn, ms)),
    clearTimeout,
    setInterval: (fn: () => void, ms?: number) => unref(setInterval(fn, ms)),
    clearInterval,
    queueMicrotask,
    structuredClone,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    AbortController,
    Intl,
    crypto: globalThis.crypto,
  }
  box['globalThis'] = box
  box['self'] = box
  return box
}

interface StaticRenderer {
  registerBlocks(blocks: readonly { blockType: string; module: Record<string, unknown> }[]): void
  renderStatic(
    surface: unknown,
    options: Record<string, unknown>
  ): { html: string; failed: readonly { blockType: string; message: string }[] }
}

/**
 * Renders every page's first frame. Never throws for a page: a page that
 * cannot be rendered is reported and left unpainted (the browser draws it as
 * before).
 */
export async function paintPages(input: StaticPaintInput): Promise<StaticPaintResult> {
  const diagnostics: AssembleDiagnostic[] = []
  const box = sandbox()
  const context = vm.createContext(box)
  try {
    vm.runInContext(input.staticJs, context, { filename: 'static.js', timeout: 10_000 })
  } catch (err) {
    diagnostics.push({
      severity: 'warning',
      code: 'STATIC_PAINT_UNAVAILABLE',
      message: `the static first paint could not start (${err instanceof Error ? err.message : String(err)}); pages are drawn in the browser only`,
    })
    return { pages: [], diagnostics }
  }
  const renderer = box['PWFabricStatic'] as StaticRenderer | undefined
  if (!renderer) return { pages: [], diagnostics }

  // A block's host imports, answered with what static.js seeded — the shim's
  // own shape: the namespace, and itself as the default export.
  const globals = new Map(BLOCK_HOST_IMPORTS.map((i) => [i.specifier, i.global]))
  const requireIn = (specifier: string): unknown => {
    const name = globals.get(specifier)
    const value = name ? (box[name] as Record<string, unknown> | undefined) : undefined
    if (!value) throw new Error(`a block imports "${specifier}", which the page does not provide`)
    return { __esModule: true, ...value, default: value }
  }
  const blocks: { blockType: string; module: Record<string, unknown> }[] = []
  const decoder = new TextDecoder()
  for (const entry of input.blockManifest) {
    const bytes = input.files.get(entry.moduleUrl)
    if (!bytes) continue
    try {
      const body = await toCommonJs(decoder.decode(bytes))
      const fn = vm.runInContext(`(function (require, module, exports) {\n${body}\n})`, context, {
        filename: entry.moduleUrl,
      }) as (r: typeof requireIn, m: { exports: Record<string, unknown> }, e: Record<string, unknown>) => void
      const module = { exports: {} as Record<string, unknown> }
      fn(requireIn, module, module.exports)
      blocks.push({ blockType: entry.blockType, module: module.exports })
    } catch (err) {
      diagnostics.push({
        severity: 'warning',
        code: 'STATIC_PAINT_BLOCK',
        message: `block "${entry.blockType}" could not be loaded outside a browser (${err instanceof Error ? err.message : String(err)}); the browser draws it. A block's module must not touch window or document when it loads.`,
        path: entry.moduleUrl,
      })
    }
  }
  renderer.registerBlocks(blocks)

  const project = input.project
  const auth = (input.auth ?? null) as Parameters<typeof doorOf>[1]
  const runnerProject = project as unknown as Parameters<typeof doorOf>[0]
  const entry = String(project['entrySurfaceId'] ?? '')
  const { door, methods } = doorOf(runnerProject, auth)
  const ownApiBase = ownApiBaseOf(auth)
  const appearanceRef = projectAppearanceRef(input.appearance)
  const ctx = {
    entry,
    toHref: hashHref,
    navigation: (input.navigation ?? null) as Parameters<typeof pageSurfaceOf>[3]['navigation'],
    door,
    user: FIRST_FRAME_USER,
    messages: runnerMessages(project['messages'] as Parameters<typeof runnerMessages>[0]),
  }
  // The address a page reads: none.
  const address = { query: () => '', writeQuery: () => undefined, notFound: () => undefined }
  const failedBlocks = new Map<string, { message: string; pages: string[] }>()
  const painted: PaintedPage[] = []
  for (const page of input.pages) {
    // A RECORD PAGE is not painted: what it shows is decided by its record
    // (`notFoundWhenEmpty`) — the record the address names, or the not-found
    // page when it names none — and the build knows neither.
    if (readsOneRecord(page.receipt)) continue
    const served = page.receipt as unknown as Parameters<typeof pageSurfaceOf>[0]
    // As the runner fetches it: the app's own records read from its API base.
    const receipt = ownApiBase ? ownRecordsReceipt(served, ownApiBase) : served
    try {
      const surface = pageSurfaceOf(receipt, page.key, new URLSearchParams(), ctx)
      const result = renderer.renderStatic(surface, {
        mode: 'fat',
        blocks: input.blockManifest,
        ...firstFrameOptions({ project: runnerProject, appearanceRef, receipt, entry, toHref: hashHref }),
        identity: { state: firstFrameAuthState(methods, auth), onAction: () => undefined },
        viewport: STATIC_VIEWPORT,
        locale: firstFrameLocale(runnerProject),
        address,
      })
      for (const f of result.failed) {
        const seen = failedBlocks.get(f.blockType) ?? { message: f.message, pages: [] }
        seen.pages.push(page.key)
        failedBlocks.set(f.blockType, seen)
      }
      painted.push({ key: page.key, html: result.html, addressKeys: addressStateKeys(receipt) })
    } catch (err) {
      diagnostics.push({
        severity: 'warning',
        code: 'STATIC_PAINT_PAGE',
        message: `page "${page.key}" could not be painted at build (${err instanceof Error ? err.message : String(err)}); the browser draws it`,
        path: `app/surfaces/${page.key}.receipt.json`,
      })
    }
  }
  for (const [blockType, { message, pages }] of failedBlocks) {
    diagnostics.push({
      severity: 'warning',
      code: 'STATIC_PAINT_BLOCK',
      message: `block "${blockType}" threw while rendering outside a browser (${message}), on ${pages.map((p) => `"${p}"`).join(', ')}: the static first paint leaves it empty and the browser draws it, so the page moves when it appears. A block's render must be pure; browser APIs belong in effects.`,
    })
  }
  return { pages: painted, diagnostics }
}

/** Whether a receipt has a source that stands for one record (`notFoundWhenEmpty`). */
export function readsOneRecord(receipt: Record<string, unknown>): boolean {
  const caps = Array.isArray(receipt['capabilities']) ? (receipt['capabilities'] as unknown[]) : []
  return caps.some((cap) => {
    const config = cap && typeof cap === 'object' ? (cap as Record<string, unknown>)['config'] : undefined
    const sources = config && typeof config === 'object' ? (config as Record<string, unknown>)['dataSources'] : undefined
    return Array.isArray(sources) && sources.some((s) => Boolean(s && typeof s === 'object' && (s as Record<string, unknown>)['notFoundWhenEmpty'] === true))
  })
}

/** The element the entry page's first frame is written into `#root` as. */
export function staticRootHtml(page: PaintedPage): string {
  return `<div id="pw-root" ${STATIC_PAGE_ATTR}="${escapeHtml(page.key)}">${page.html}</div>`
}

/** The served file holding a page's first frame, for a visitor who arrives at it. */
export function staticPageFile(key: string): string {
  return `pwpack/surfaces/${key}.html`
}

/**
 * What the shell's first-paint script reads (`<script type="application/json"
 * id="pw-first-paint">`): which page each address names, whether the window
 * is at the painted breakpoint, which query keys would seed the page.
 */
export function firstPaintData(input: {
  readonly entry: string
  readonly routes: readonly string[]
  readonly notFound?: string
  readonly pages: readonly PaintedPage[]
}): Record<string, unknown> {
  const pages: Record<string, { keys: readonly string[]; file?: string }> = {}
  for (const p of input.pages) {
    pages[p.key] = { keys: p.addressKeys, ...(p.key === input.entry ? {} : { file: staticPageFile(p.key) }) }
  }
  return {
    entry: input.entry,
    routes: input.routes,
    ...(input.notFound ? { notFound: input.notFound } : {}),
    maxWidth: STATIC_VIEWPORT_MAX_WIDTH,
    pages,
  }
}
