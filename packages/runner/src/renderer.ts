/**
 * Loading the renderer — `embed.js` — when the first page is drawn.
 *
 * WHY THE RUNNER LOADS IT. The shell used to name `embed.js` as a classic
 * script in `<head>`: every visitor waited for the whole renderer (React and the
 * runtime) before the browser drew anything, and a visitor of an app
 * behind sign-in downloaded all of it to be shown one button. The runner
 * itself needs nothing the renderer seeds until it draws a page, so it asks
 * for the renderer then, once. A shell that wants it early names it as
 * `<script async>` — downloaded with the page, run when it arrives, holding
 * nothing — and the runner waits for that element instead of adding one.
 *
 * A page that has the renderer already (`window.PWFabric` — a host that loads
 * it its own way) keeps its own; nothing is added.
 *
 * @module @pwfabric/runner/renderer
 */

import type { PWFabricGlobal } from './types.js'

let loading: { url: string; promise: Promise<PWFabricGlobal> } | null = null

/**
 * Resolves with `window.PWFabric`, adding `<script src="{url}">` to the page
 * first when it is not defined yet. One request however often it is called;
 * a failed load is not cached, so the next page tries again.
 */
export function loadRenderer(url: string, doc: Document = document): Promise<PWFabricGlobal> {
  const win = doc.defaultView as (Window & { PWFabric?: PWFabricGlobal }) | null
  const present = win?.PWFabric
  if (present) return Promise.resolve(present)
  if (loading && loading.url === url) return loading.promise
  const promise = new Promise<PWFabricGlobal>((resolve, reject) => {
    // The shell may name it already (`<script async>`): wait for that one
    // rather than ask twice.
    const wanted = new URL(url, doc.baseURI).href
    const named = [...doc.querySelectorAll<HTMLScriptElement>('script[src]')].find((s) => s.src === wanted)
    const script = named ?? doc.createElement('script')
    if (!named) script.src = url
    script.addEventListener('load', () => {
      const fabric = win?.PWFabric
      if (fabric) resolve(fabric)
      else reject(new Error(`[pwapp] the renderer at ${url} loaded but defined no window.PWFabric`))
    })
    script.addEventListener('error', () => {
      // A failed element is not waited on again: the next call adds a fresh one.
      script.remove()
      reject(new Error(`[pwapp] the renderer could not be loaded from ${url}`))
    })
    if (!named) doc.head.appendChild(script)
  })
  loading = { url, promise }
  promise.catch(() => {
    if (loading?.promise === promise) loading = null
  })
  return promise
}

/** Forgets a load in flight (tests). */
export function resetRendererLoad(): void {
  loading = null
}

const warmed = new Set<string>()

/** Every block `type` in a block tree, once each. */
function blockTypesIn(nodes: unknown, out = new Set<string>()): Set<string> {
  if (!Array.isArray(nodes)) return out
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue
    const n = node as { type?: unknown; children?: unknown }
    if (typeof n.type === 'string' && n.type) out.add(n.type)
    blockTypesIn(n.children, out)
  }
  return out
}

/**
 * Starts downloading the page's block modules the moment its receipt is in —
 * while the renderer may still be on its way — as `<link rel="preload"
 * as="fetch" crossorigin>`: the very request the block loader makes
 * (runtime dynamic-block-loader: `fetch(url)`, CORS, same-origin
 * credentials), so the loader's fetch is ANSWERED BY the preload instead of
 * asking again. A module the page already asks for — the shell's hint for
 * the opened page (pwapp-format §2.1), or an earlier page's warm-up — gets no
 * second link: each module is requested once per load. Nothing is evaluated
 * here, and a failure is the renderer's to report.
 */
export function warmBlockModules(
  blocks: unknown,
  manifest: readonly { readonly blockType: string; readonly moduleUrl: string }[],
  doc: Document = document
): void {
  const byType = new Map(manifest.map((d) => [d.blockType, d.moduleUrl]))
  const asked = new Set<string>()
  for (const link of doc.querySelectorAll<HTMLLinkElement>('link[rel="preload"][as="fetch"]')) asked.add(link.href)
  for (const type of blockTypesIn(blocks)) {
    const url = byType.get(type)
    if (!url) continue
    const href = new URL(url, doc.baseURI).href
    if (asked.has(href) || warmed.has(href)) continue
    warmed.add(href)
    const link = doc.createElement('link')
    link.rel = 'preload'
    link.setAttribute('as', 'fetch')
    link.crossOrigin = 'anonymous'
    link.href = href
    doc.head.appendChild(link)
  }
}
