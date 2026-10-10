/**
 * @pwfabric/embed
 *
 * Portable embed runtime — renders a PWFabric CanonicalSurface anywhere, using
 * the REAL `SurfaceRenderer` from `@pwfabric/runtime`.
 *
 * Consumed two ways:
 *   - as a built artifact — `assembleWebApp` takes the bundle as an `embedJs`
 *     string and ships it into every export's `assets/`;
 *   - as a dependency — a host API can resolve `dist/embed.js` out of
 *     `node_modules` rather than keeping a committed copy (a vendored copy
 *     goes stale silently; a package dependency is version-gated).
 *
 * Two modes:
 *   - **thin**  — fetch surface + render grants from the API (like a hosted surface page).
 *   - **fat**   — render an inline surface + block bundles + appearance fully
 *                 offline, no backend.
 *
 * Public entry: `PWFabric.render(target, source, options?)`. A `data-pw-surface`
 * DOM auto-loader is also wired on load.
 *
 * @module @pwfabric/embed
 */

import { mountSurface, type SurfaceMountHandle, type RenderCoreOptions } from './render-core.js'
import { renderFat, type RenderFatOptions } from './fat.js'
import { loadThin, type ThinAuth, type ThinSurfaceRef } from './thin.js'
import type {
  DynamicBlockDescriptor,
  BreakpointName,
} from '@pwfabric/contracts'
import type {
  CapabilityProvider,
  EntityFacade,
  ImageAdapter,
  SurfaceEvent,
  RenderableSurface,
  BlockComponentRegistry,
  SurfaceConnectionsValue,
  DataServiceConfig,
  SurfaceDataCache,
} from '@pwfabric/runtime'

// Re-export the building blocks for bundler consumers.
export { renderFat, fatCoreOptions } from './fat.js'
export { loadThin, grantsToDescriptors } from './thin.js'
export { buildFatHtml } from './build-fat-html.js'
export type { BuildFatHtmlOptions } from './build-fat-html.js'
export {
  mountSurface,
  createSurfaceElement,
  needsDataBoundRenderer,
  resolveTarget,
  missingBlockTypes,
  RebuildNeededBlock,
} from './render-core.js'
export type { RenderCoreOptions, SurfaceMountHandle } from './render-core.js'
export type { RenderFatOptions, FatMountHandle } from './fat.js'
export type { LoadThinOptions, LoadThinResult, ThinAuth, ThinSurfaceRef } from './thin.js'
export {
  createOfflineEntityFacade,
  createOfflineNavigationProvider,
  staticPersistenceCapability,
} from './capabilities-stub.js'

// ============================================================
// PUBLIC OPTION TYPES
// ============================================================

export type EmbedMode = 'thin' | 'fat'

/**
 * Source: either a reference to fetch (thin) or an inline surface (fat).
 */
export type EmbedSource =
  | { readonly surfaceId: string }
  | { readonly tenantSlug: string; readonly surfaceSlug: string }
  | { readonly surface: RenderableSurface }

export interface EmbedOptions {
  /** `thin` (fetch) or `fat` (inline/offline). Auto-detected from source when omitted. */
  readonly mode?: EmbedMode

  // ── thin ──────────────────────────────────────────────
  /** API origin for thin mode (e.g. https://api.example.com). */
  readonly apiBaseUrl?: string
  /** Auth for thin mode. */
  readonly auth?: ThinAuth
  /** Custom fetch implementation (test/non-browser). */
  readonly fetchImpl?: typeof fetch

  // ── fat ───────────────────────────────────────────────
  /** Inline block bundle descriptors (fat). */
  readonly blocks?: readonly DynamicBlockDescriptor[]
  /** Inline appearance ref (fat); falls back to surface.appearance. */
  readonly appearance?: RenderableSurface['appearance']
  /** Hydrate existing server-rendered markup instead of a fresh mount (fat). */
  readonly hydrate?: boolean
  /** Capability providers (fat). */
  readonly capabilities?: CapabilityProvider[]
  /** Entity facade override (fat). */
  readonly entityFacade?: EntityFacade
  /** Connector/provider engine registry + connections (fat embed). */
  readonly connections?: SurfaceConnectionsValue
  /**
   * Configuration for the renderer's DataService — the host's own API origin
   * (so the platform store can be called with its cookie and nobody else can)
   * and the token resolver for `authProviderRef`.
   */
  readonly dataServiceConfig?: DataServiceConfig
  readonly loadingStrategy?: 'gate' | 'immediate'
  readonly dataCache?: SurfaceDataCache


  // ── shared render passthrough ─────────────────────────
  readonly theme?: 'light' | 'dark'
  readonly viewport?: BreakpointName
  readonly basePath?: string
  readonly imageAdapter?: ImageAdapter
  readonly interactionMode?: 'live' | 'inert'
  readonly onEvent?: (event: SurfaceEvent) => void
  readonly gap?: number
  readonly padding?: number
  /** Custom block component overrides (test/preview seams). */
  readonly components?: Partial<BlockComponentRegistry>
  /** Visible placeholder for block types nothing can render (preview hosts). */
  readonly placeholderMissingBlocks?: boolean

  // ── lifecycle callbacks ───────────────────────────────
  readonly onReady?: (handle: SurfaceMountHandle) => void
  readonly onError?: (error: unknown) => void
}

// ============================================================
// CORE RENDER ENTRY
// ============================================================

function isInlineSurface(source: EmbedSource): source is { surface: RenderableSurface } {
  return 'surface' in source
}

function detectMode(source: EmbedSource, options?: EmbedOptions): EmbedMode {
  if (options?.mode) return options.mode
  return isInlineSurface(source) ? 'fat' : 'thin'
}

/**
 * Shared render-option assembly from EmbedOptions → RenderCore/RenderFat opts.
 */
function passthrough(options?: EmbedOptions): Partial<RenderCoreOptions> {
  const o = options ?? {}
  return {
    ...(o.theme !== undefined ? { theme: o.theme } : {}),
    ...(o.viewport !== undefined ? { viewport: o.viewport } : {}),
    ...(o.basePath !== undefined ? { basePath: o.basePath } : {}),
    ...(o.imageAdapter !== undefined ? { imageAdapter: o.imageAdapter } : {}),
    ...(o.interactionMode !== undefined ? { interactionMode: o.interactionMode } : {}),
    ...(o.onEvent !== undefined ? { onEvent: o.onEvent } : {}),
    ...(o.gap !== undefined ? { gap: o.gap } : {}),
    ...(o.padding !== undefined ? { padding: o.padding } : {}),
    ...(o.components !== undefined ? { components: o.components } : {}),
    ...(o.loadingStrategy !== undefined ? { loadingStrategy: o.loadingStrategy } : {}),
    ...(o.dataCache !== undefined ? { dataCache: o.dataCache } : {}),
    ...(o.placeholderMissingBlocks !== undefined ? { placeholderMissingBlocks: o.placeholderMissingBlocks } : {}),
  }
}

/**
 * Render a surface into `target`.
 *
 * @param target  An HTMLElement or CSS selector string.
 * @param source  `{ surfaceId }` / `{ tenantSlug, surfaceSlug }` (thin) or
 *                `{ surface }` (fat).
 * @param options Mode + transport + render options.
 * @returns       A promise resolving to the mount handle.
 */
export async function render(
  target: HTMLElement | string,
  source: EmbedSource,
  options?: EmbedOptions
): Promise<SurfaceMountHandle> {
  const o = options ?? {}
  try {
    const mode = detectMode(source, options)

    if (mode === 'fat') {
      if (!isInlineSurface(source)) {
        throw new Error('[pwfabric-embed] fat mode requires an inline { surface }')
      }
      const fatOpts: RenderFatOptions = {
        surface: source.surface,
        ...(o.blocks ? { blocks: o.blocks } : {}),
        ...(o.appearance ? { appearance: o.appearance } : {}),
        ...(o.hydrate ? { hydrate: true } : {}),
        ...(o.capabilities ? { capabilities: o.capabilities } : {}),
        ...(o.entityFacade ? { entityFacade: o.entityFacade } : {}),
        ...(o.connections ? { connections: o.connections } : {}),
        ...(o.dataServiceConfig ? { dataServiceConfig: o.dataServiceConfig } : {}),
        ...passthrough(options),
      }
      const handle = renderFat(target, fatOpts)
      o.onReady?.(handle)
      return handle
    }

    // thin mode
    if (isInlineSurface(source)) {
      throw new Error('[pwfabric-embed] thin mode requires a { surfaceId } or slug reference')
    }
    if (!o.apiBaseUrl) {
      throw new Error('[pwfabric-embed] thin mode requires `apiBaseUrl`')
    }

    const ref: ThinSurfaceRef =
      'surfaceId' in source
        ? { surfaceId: source.surfaceId }
        : { tenantSlug: (source as { tenantSlug: string }).tenantSlug, surfaceSlug: (source as { surfaceSlug: string }).surfaceSlug }
    const loaded = await loadThin(ref, {
      apiBaseUrl: o.apiBaseUrl,
      ...(o.auth ? { auth: o.auth } : {}),
      ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}),
    })

    const core: RenderCoreOptions = {
      surface: loaded.surface,
      ...(loaded.dynamicBlocks.length > 0 ? { dynamicBlocks: loaded.dynamicBlocks } : {}),
      ...(o.capabilities ? { capabilities: o.capabilities } : {}),
      ...(o.entityFacade ? { entityFacade: o.entityFacade } : {}),
      ...(loaded.layout?.gap !== undefined ? { gap: loaded.layout.gap } : {}),
      ...(loaded.layout?.padding !== undefined ? { padding: loaded.layout.padding } : {}),
      ...passthrough(options),
    }
    const handle = mountSurface(target, core)
    o.onReady?.(handle)
    return handle
  } catch (err) {
    if (o.onError) {
      o.onError(err)
      // Re-throw so callers awaiting the promise still observe the failure.
    }
    throw err
  }
}

// ============================================================
// DOM AUTO-LOADER (data-pw-surface)
// ============================================================

/**
 * Scan the DOM for `[data-pw-surface]` containers and render each.
 *
 * Attribute contract:
 *   - `data-pw-surface`         — surfaceId (thin) OR `"inline"` for fat.
 *   - `data-pw-mode`            — `"thin"` | `"fat"` (optional; auto-detected).
 *   - `data-pw-api`             — apiBaseUrl (thin).
 *   - `data-pw-tenant` + `data-pw-slug` — slug pair (thin, overrides surfaceId).
 *   - `data-pw-theme`           — `"light"` | `"dark"`.
 *   - `data-pw-token`           — bearer token (thin).
 *
 * For fat/inline rendering the element should contain sibling scripts:
 *   `<script type="application/pw-surface+json">…</script>`
 *   `<script type="application/pw-blocks+json">…</script>` (optional)
 *   `<script type="application/pw-appearance+json">…</script>` (optional)
 */
function readInlineJson<T>(root: ParentNode, type: string): T | undefined {
  const el = root.querySelector(`script[type="application/${type}+json"]`)
  if (!el?.textContent) return undefined
  try {
    return JSON.parse(el.textContent) as T
  } catch {
    return undefined
  }
}

function hydrateElement(el: HTMLElement): void {
  const ds = el.dataset
  const surfaceAttr = ds.pwSurface
  const declaredMode = ds.pwMode as EmbedMode | undefined

  // Inline surface scripts may live inside the container or as siblings.
  const scope: ParentNode = el.querySelector('script[type^="application/pw-"]')
    ? el
    : el.parentNode ?? el
  const inlineSurface = readInlineJson<RenderableSurface>(scope, 'pw-surface')

  const isFat = declaredMode === 'fat' || (!declaredMode && (surfaceAttr === 'inline' || !!inlineSurface))

  const common: EmbedOptions = {
    ...(ds.pwTheme ? { theme: ds.pwTheme as 'light' | 'dark' } : {}),
  }

  if (isFat) {
    if (!inlineSurface) {
      // Nothing to render — leave a console hint and bail.
      console.warn('[pwfabric-embed] data-pw-surface="inline" but no inline surface JSON found')
      return
    }
    const blocks = readInlineJson<DynamicBlockDescriptor[]>(scope, 'pw-blocks')
    const appearance = readInlineJson<RenderableSurface['appearance']>(scope, 'pw-appearance')
    void render(el, { surface: inlineSurface }, {
      ...common,
      mode: 'fat',
      ...(blocks ? { blocks } : {}),
      ...(appearance ? { appearance } : {}),
    })
    return
  }

  // thin
  const apiBaseUrl = ds.pwApi
  if (!apiBaseUrl) {
    console.warn('[pwfabric-embed] data-pw-surface thin mode requires data-pw-api')
    return
  }
  const auth = ds.pwToken ? { accessToken: ds.pwToken } : undefined
  const source: EmbedSource =
    ds.pwTenant && ds.pwSlug
      ? { tenantSlug: ds.pwTenant, surfaceSlug: ds.pwSlug }
      : { surfaceId: surfaceAttr ?? '' }

  void render(el, source, {
    ...common,
    mode: 'thin',
    apiBaseUrl,
    ...(auth ? { auth } : {}),
  })
}

/**
 * Scan + hydrate all `[data-pw-surface]` elements currently in the document.
 * Idempotent: elements already hydrated (marked with `data-pw-hydrated`) skip.
 */
export function autoload(root: ParentNode = document): void {
  const els = root.querySelectorAll<HTMLElement>('[data-pw-surface]')
  els.forEach((el) => {
    if (el.dataset.pwHydrated === 'true') return
    el.dataset.pwHydrated = 'true'
    hydrateElement(el)
  })
}

// Wire the auto-loader once the DOM is ready (browser only).
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => autoload())
  } else {
    // Defer to a microtask so a synchronous `PWFabric.render` call right after
    // the script tag still wins ordering if the host prefers manual control.
    queueMicrotask(() => autoload())
  }
}

// ============================================================
// NAMESPACE (mirrors the IIFE global `PWFabric`)
// ============================================================

export const PWFabric = {
  render,
  renderFat,
  loadThin,
  autoload,
}

export default PWFabric
