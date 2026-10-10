/**
 * What the runner does with a preview-bridge message: re-render the page on
 * screen through the mount handle it already holds. No receipt is fetched.
 *
 * Kept apart from `run-app.ts` so the decision — which page an update may
 * touch, what it renders with, how it reaches the renderer — is testable
 * without a browser. `run-app.ts` supplies the page pipeline (href rewrite,
 * navigation assembly, account control, query seeding) and the theme resolver
 * (`projectAppearanceRef`, the same one a normal load uses).
 *
 * @module @pwfabric/runner/preview-session
 */

import {
  createPreviewBridge,
  type PreviewBridgeOptions,
  type PreviewBridgeWindow,
  type PreviewSurface,
  type PreviewSurfaceUpdate,
} from './preview-bridge.js'
import type { SurfaceBlockNode } from './types.js'

/** The surface a route rendered, in the form `PWFabric.render` takes. */
export interface RenderedSurface {
  readonly blocks: SurfaceBlockNode[]
  readonly appearance?: unknown
  readonly capabilities?: unknown
}

/** One route render, as the runner recorded it. */
export interface PreviewPage {
  /** The route sequence number the render belongs to. */
  readonly seq: number
  /** The page key on screen. */
  readonly key: string
  /** The receipt's own surface id, when it carries one. */
  readonly surfaceId?: string
  readonly surface: RenderedSurface
  /** The options handed to `PWFabric.render` (fat mode). */
  readonly options: Readonly<Record<string, unknown>>
  /** What `PWFabric.render` returned — the mount handle, or a promise of it. */
  readonly handle: unknown
}

/** The mount handle embed returns. `update` exists on fat handles of embed builds that have it. */
interface MountHandleLike {
  unmount?: () => void
  update?: (opts: Record<string, unknown>) => void
}

export interface PreviewSessionDeps {
  readonly win: PreviewBridgeWindow
  readonly crypto: Pick<Crypto, 'getRandomValues'>
  /** Is this render still the one on screen? (no newer route started, same page key) */
  isCurrent(page: PreviewPage): boolean
  /** The route pipeline applied to pushed blocks/capabilities, as for a fetched receipt. */
  prepare(surface: PreviewSurface): RenderedSurface
  /**
   * Resolve a pushed project theme through the normal appearance path and make
   * it the app's theme from now on. Returns the appearance ref to render with,
   * or undefined when the theme resolves to nothing.
   */
  applyTheme(theme: Record<string, unknown>): unknown
  /** Fresh mount on the same target, for an embed build whose handle has no `update`. */
  remount(surface: RenderedSurface, options: Record<string, unknown>): unknown
}

export interface PreviewSession {
  /** Record a route render and announce its page to the parent. */
  rendered(page: PreviewPage): void
  /** The route rendered no page (not-found, gated). */
  cleared(): void
  dispose(): void
}

/** Does this update address the page on screen? It must name it, and nothing it names may differ. */
export function updateTargets(update: Pick<PreviewSurfaceUpdate, 'pageKey' | 'surfaceId'>, page: PreviewPage): boolean {
  if (update.pageKey === undefined && update.surfaceId === undefined) return false
  if (update.pageKey !== undefined && update.pageKey !== page.key) return false
  if (update.surfaceId !== undefined && update.surfaceId !== page.surfaceId) return false
  return true
}

/** The receipt's own id, if it carries one (`surfaceId`, else `id`). */
export function receiptSurfaceId(receipt: Readonly<Record<string, unknown>>): string | undefined {
  const id = receipt['surfaceId'] ?? receipt['id']
  return typeof id === 'string' && id ? id : undefined
}

/**
 * Start the preview session. Returns null — no listener, no behaviour — unless
 * the host turned the bridge on and the page is framed.
 */
export function startPreviewSession(
  options: PreviewBridgeOptions | undefined,
  deps: PreviewSessionDeps
): PreviewSession | null {
  if (!options) return null
  let page: PreviewPage | null = null
  // Serialises re-renders: each waits for the handle the previous one produced.
  let queue: Promise<unknown> = Promise.resolve()

  const rerender = (target: PreviewPage, surface: RenderedSurface, renderOptions: Record<string, unknown>): void => {
    const next = queue.then(async () => {
      const handle = (await target.handle) as MountHandleLike | null | undefined
      // A route render that started since then owns the mount now.
      if (page !== target && page?.seq !== target.seq) return handle
      const { mode: _mode, ...fat } = renderOptions
      if (handle && typeof handle.update === 'function') {
        handle.update({ ...fat, surface })
        return handle
      }
      // An embed build without `update`: a fresh mount on the same target.
      // Still no fetch — the surface is the one in hand.
      handle?.unmount?.()
      return deps.remount(surface, renderOptions)
    })
    queue = next.catch(() => undefined)
    page = { ...target, surface, options: renderOptions, handle: next }
  }

  const bridge = createPreviewBridge(
    options,
    {
      onSurfaceUpdate(update) {
        if (!page || !deps.isCurrent(page) || !updateTargets(update, page)) return
        const surface = deps.prepare(update.surface)
        // A block type the shipped manifest lacks gets a visible placeholder,
        // and only on surfaces the bridge supplied.
        rerender(page, surface, { ...page.options, placeholderMissingBlocks: true })
      },
      onProjectTheme(theme) {
        const appearance = deps.applyTheme(theme)
        if (appearance === undefined) return
        if (!page || !deps.isCurrent(page)) return
        rerender(page, page.surface, { ...page.options, appearance })
      },
    },
    { win: deps.win, crypto: deps.crypto }
  )
  if (!bridge) return null

  return {
    rendered(next) {
      page = next
      bridge.announce(next.key)
    },
    cleared() {
      page = null
    },
    dispose() {
      page = null
      bridge.dispose()
    },
  }
}
