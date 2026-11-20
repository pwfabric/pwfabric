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
 * never reaches a visitor's HTML), and every source settled without a
 * request settled (idle; `requiresSession` refused); nobody signed in; nothing read from the
 * address; the phone layout — and, beside it, what a wider window changes,
 * as CSS (static-layout.ts). An app that requires sign-in has no first frame
 * the build can know (who is signed in decides what is drawn): it is not
 * painted. A record page (`notFoundWhenEmpty`) is: its first frame is the
 * shell and its loading frame, whichever record the address names; a record
 * that is not there replaces it with the not-found page, in the browser.
 *
 * A block whose render throws here (it reads `window` while rendering) is
 * left to the browser and reported: the rule for blocks is "render is pure;
 * browser APIs only in effects".
 */
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { BLOCK_HOST_IMPORTS } from '@pwfabric/core/host-imports'
import { toCommonJs } from '@pwfabric/compiler'
import {
  FIRST_FRAME_USER,
  STATIC_PAGE_ATTR,
  STATIC_VIEWPORT,
  STATIC_LAYOUT_ID,
  addressStateKeys,
  firstFrameAuthState,
  firstFrameDoorOf,
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
import { WIDE_BREAKPOINTS, staticLayoutOf } from './static-layout.js'

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

/** A value no app's address carries: what a query key is seeded with to learn whether it changes a page's first frame. */
const ADDRESS_PROBE = 'pw-address-probe'

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
  /** How the built app writes a page's address: the runner's router's `toHref` for the build's router and base. */
  readonly toHref: (key: string) => string
}

/** What a page's first frame came out as. */
export interface PaintedPage {
  readonly key: string
  /** The frame at the phone breakpoint: the inner HTML of `#pw-root`. */
  readonly html: string
  /** The stylesheet that lays the frame out at every wider breakpoint (static-layout.ts); empty when nothing differs. */
  readonly layoutCss: string
  /** The query keys that change the page's first frame: an address carrying one is not painted from the build. */
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
  const auth = (input.auth ?? null) as Parameters<typeof ownApiBaseOf>[0]
  const runnerProject = project as unknown as Parameters<typeof firstFrameDoorOf>[0]
  const entry = String(project['entrySurfaceId'] ?? '')
  // The ways in the app DECLARES (project.json identity), not this build's
  // auth.json — which `pwf build` does not write and a host replaces.
  const firstDoor = firstFrameDoorOf(runnerProject)
  const door = firstDoor.door
  const ownApiBase = ownApiBaseOf(auth)
  const appearanceRef = projectAppearanceRef(input.appearance)
  const ctx = {
    entry,
    toHref: input.toHref,
    navigation: (input.navigation ?? null) as Parameters<typeof pageSurfaceOf>[3]['navigation'],
    door,
    user: FIRST_FRAME_USER,
    messages: runnerMessages(project['messages'] as Parameters<typeof runnerMessages>[0]),
  }
  // The address a page reads: none.
  const address = { query: () => '', writeQuery: () => undefined, notFound: () => undefined }
  const failedBlocks = new Map<string, { message: string; pages: string[] }>()
  const reshapedBlocks = new Map<string, string[]>()
  const painted: PaintedPage[] = []
  for (const page of input.pages) {
    const served = page.receipt as unknown as Parameters<typeof pageSurfaceOf>[0]
    // As the runner fetches it: the app's own records read from its API base.
    const receipt = ownApiBase ? ownRecordsReceipt(served, ownApiBase) : served
    const render = (params: URLSearchParams, viewport: string = STATIC_VIEWPORT): ReturnType<StaticRenderer['renderStatic']> =>
      renderer.renderStatic(pageSurfaceOf(receipt, page.key, params, ctx), {
        mode: 'fat',
        blocks: input.blockManifest,
        ...firstFrameOptions({ project: runnerProject, appearanceRef, receipt, entry, toHref: input.toHref }),
        identity: { state: firstFrameAuthState(firstDoor), onAction: () => undefined },
        viewport,
        locale: firstFrameLocale(runnerProject),
        address,
      })
    try {
      const result = render(new URLSearchParams())
      for (const f of result.failed) {
        const seen = failedBlocks.get(f.blockType) ?? { message: f.message, pages: [] }
        seen.pages.push(page.key)
        failedBlocks.set(f.blockType, seen)
      }
      // THE KEYS THAT CHANGE THIS FRAME. A query key the page reads makes a
      // visit's first frame not the build's only when its value changes what
      // the frame draws: a record page's `?id=` seeds the source that is still
      // loading, so its frame — the shell and the loading frame — stands
      // (E16); a `?tab=` its tabs read does not.
      const keys = addressStateKeys(receipt).filter((k) => render(new URLSearchParams({ [k]: ADDRESS_PROBE })).html !== result.html)
      // THE FRAME AT EVERY WIDTH: the same page drawn at each wider
      // breakpoint, and what differs from the phone's written as CSS.
      const wide: Record<string, string> = {}
      for (const bp of WIDE_BREAKPOINTS) wide[bp.name] = render(new URLSearchParams(), bp.name).html
      const layout = staticLayoutOf(result.html, wide)
      for (const type of layout.reshaped) reshapedBlocks.set(type, [...(reshapedBlocks.get(type) ?? []), page.key])
      painted.push({ key: page.key, html: result.html, layoutCss: layout.css, addressKeys: keys })
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
  for (const [blockType, pages] of reshapedBlocks) {
    diagnostics.push({
      severity: 'info',
      code: 'STATIC_PAINT_WIDTH',
      message: `block "${blockType}" draws different markup on a wider window, on ${pages.map((p) => `"${p}"`).join(', ')}: before the renderer runs it shows its phone form at every width. A block that lays itself out for the width in CSS is painted right at every width.`,
    })
  }
  return { pages: painted, diagnostics }
}

/** A page's first frame as a document's body holds it: `#pw-root` naming the page, the frame inside. */
export function staticRootHtml(page: PaintedPage): string {
  return `<div id="pw-root" ${STATIC_PAGE_ATTR}="${escapeHtml(page.key)}">${page.html}</div>`
}

/** The served file holding a page's first frame, for a document that holds another page's. */
export function staticPageFile(key: string): string {
  return `pwpack/surfaces/${key}.html`
}

/** That file's content: the frame's stylesheet (`#pw-static-layout`), then its `#pw-root`. */
export function staticPageFragment(page: PaintedPage): string {
  const layout = page.layoutCss ? `<style id="${STATIC_LAYOUT_ID}">${page.layoutCss.replace(/<\//g, '<\\/')}</style>` : ''
  return `${layout}${staticRootHtml(page)}`
}

/**
 * What the shell's first-paint script reads (`<script type="application/json"
 * id="pw-first-paint">`): which page each address names, which query keys
 * change a page's first frame, and the file each painted page's frame is
 * served in. The same on every document of the app.
 */
export function firstPaintData(input: {
  /** How the app routes, when not by hash: the script then reads the page off the path. */
  readonly router?: 'path' | 'auto'
  readonly entry: string
  readonly routes: readonly string[]
  readonly notFound?: string
  readonly pages: readonly PaintedPage[]
}): Record<string, unknown> {
  const pages: Record<string, { keys: readonly string[]; file: string }> = {}
  for (const p of input.pages) pages[p.key] = { keys: p.addressKeys, file: staticPageFile(p.key) }
  return {
    ...(input.router ? { router: input.router } : {}),
    entry: input.entry,
    routes: input.routes,
    ...(input.notFound ? { notFound: input.notFound } : {}),
    pages,
  }
}
