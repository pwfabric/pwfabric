/**
 * Shared mount core for the embed runtime.
 *
 * Wraps the REAL runtime renderer (`SurfaceRenderer` / `DataBoundSurfaceRenderer`,
 * imported as-is from `@pwfabric/runtime`) inside a
 * `DynamicArtifactProvider` and mounts it into a target DOM node with
 * `ReactDOM.createRoot`.
 *
 * Nothing here talks to the network on its own — the caller supplies the
 * already-resolved surface + dynamic block descriptors. Thin mode fetches
 * them first (see `thin.ts`); fat mode passes inline descriptors (see
 * `fat.ts`).
 *
 * @module @pwfabric/embed/render-core
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import {
  // The aliased export name in the runtime's public `exports` — this IS the
  // canonical `SurfaceRenderer`, re-exported as `BlockSurfaceRenderer` to
  // disambiguate from the surface/* module's own renderer.
  BlockSurfaceRenderer as SurfaceRenderer,
  DataBoundSurfaceRenderer,
  DynamicArtifactProvider,
  surfaceNeedsDataBinding,
} from '@pwfabric/runtime'
import type {
  RenderableSurface,
  DataBoundSurface,
  EntityFacade,
  CapabilityProvider,
  SurfaceEvent,
  ImageAdapter,
  BlockComponentRegistry,
  SurfaceConnectionsValue,
  DataServiceConfig,
  SurfaceDataCache,
  BlockComponentProps,
} from '@pwfabric/runtime'
import type {
  DynamicBlockDescriptor,
  DynamicStarterDescriptor,
  BreakpointName,
} from '@pwfabric/contracts'

// ============================================================
// TYPES
// ============================================================

/**
 * Options accepted by the shared mount. A superset of what both thin and fat
 * mode produce after they have resolved the surface + descriptors.
 */
export interface RenderCoreOptions {
  /** Resolved surface to render (blocks + appearance + capabilities). */
  readonly surface: RenderableSurface

  /** Dynamic (installed/CDN/inline) block descriptors. */
  readonly dynamicBlocks?: readonly DynamicBlockDescriptor[]

  /** Optional dynamic starter descriptors (rarely used in embed). */
  readonly dynamicStarters?: readonly DynamicStarterDescriptor[]

  /** App-level light/dark hint passed straight to the renderer. */
  readonly theme?: 'light' | 'dark'

  /** Explicit viewport breakpoint override (otherwise auto-detected). */
  readonly viewport?: BreakpointName

  /** Capability providers (auth/data/navigation/...). */
  readonly capabilities?: CapabilityProvider[]

  /** Entity facade for the platform/entities capability (fat = in-memory). */
  readonly entityFacade?: EntityFacade

  /**
   * The surface CONNECTIONS CONTEXT — configured connections +
   * the loaded connector/provider engine registry. When present the render
   * routes `{kind:entity,connector}` data sources through the registry AND
   * exposes the value to blocks via `SurfaceConnectionsContext` (the
   * engine-bridge path, e.g. chat-panel). Absent = today's behavior.
   */
  readonly connections?: SurfaceConnectionsValue
  /**
   * Configuration for the renderer's DataService — the host's own API origin
   * (so the platform store can be called with its cookie and nobody else can)
   * and the token resolver for `authProviderRef`.
   */
  readonly dataServiceConfig?: DataServiceConfig
  /** See DataBoundSurfaceRendererProps — 'gate' withholds the tree until the first fetch, 'immediate' paints at once. */
  readonly loadingStrategy?: 'gate' | 'immediate'
  /** See DataBoundSurfaceRendererProps — yesterday's rows while today's load. */
  readonly dataCache?: SurfaceDataCache


  /** `live` (default) or `inert` (no auto-refresh, no dispatched actions). */
  readonly interactionMode?: 'live' | 'inert'

  /** Base path for links/routing. */
  readonly basePath?: string

  /** Image adapter; defaults to plain <img> when omitted. */
  readonly imageAdapter?: ImageAdapter

  /** Custom block component overrides (test/preview seams). */
  readonly components?: Partial<BlockComponentRegistry>

  /** Surface event callback. */
  readonly onEvent?: (event: SurfaceEvent) => void

  /** Grid gap (px) override. */
  readonly gap?: number

  /** Surface inner padding (px) override. */
  readonly padding?: number

  /**
   * Draw a visible "rebuild needed" placeholder for every block type in the
   * surface that has neither a dynamic descriptor nor a component.
   *
   * Off by default, and deliberately so: on a published page an unknown type
   * renders only its children (see the renderer), because a visible
   * placeholder reads as a broken page to a visitor. A live preview is the
   * opposite case — the author has just added a block whose bundle is not in
   * the shipped manifest yet, and an invisible block would look like the edit
   * did nothing. The placeholder is a plain element: nothing is fetched or
   * imported for the missing type.
   */
  readonly placeholderMissingBlocks?: boolean
}

/**
 * Handle returned by `mountSurface` so the host can later unmount or update.
 */
export interface SurfaceMountHandle {
  /** Tear down the React root and free the DOM. */
  unmount(): void
  /** The root DOM node the surface was mounted into. */
  readonly container: HTMLElement
  /**
   * Re-render new surface options into the SAME root — e.g. a client-side
   * page transition. Reuses the root created by `mountSurface` instead of
   * calling `createRoot`/`hydrateRoot` again (which would either throw or
   * discard the existing tree).
   */
  render(opts: RenderCoreOptions): void
}

export interface MountSurfaceOptions {
  /**
   * Hydrate existing server-rendered markup already present in `target`
   * (`ReactDOM.hydrateRoot`) instead of a fresh client-only mount
   * (`ReactDOM.createRoot`, which discards whatever DOM was already there).
   * The initial `opts` must produce a tree matching what was server-rendered
   * or React will warn/re-render on mismatch.
   */
  readonly hydrate?: boolean
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Does this surface need the data-bound renderer? The RUNTIME answers —
 * `surfaceNeedsDataBinding` is the same predicate the renderer's own
 * passthrough uses: data sources, `initialState`, declared behaviors,
 * formBindings, or a block `action`.
 *
 * This used to be a second, shorter list (sources + initialState). It had
 * drifted from the renderer's in both directions: a page with only buttons
 * carrying `action` props, or only formBindings, got the plain
 * SurfaceRenderer here — no dispatcher, so the click did nothing and the
 * submit went nowhere.
 */
export function needsDataBoundRenderer(surface: RenderableSurface): boolean {
  return surfaceNeedsDataBinding(surface as Parameters<typeof surfaceNeedsDataBinding>[0])
}

/**
 * Build the props object shared by both renderers, omitting `undefined`
 * keys so `exactOptionalPropertyTypes` stays happy.
 */
function buildRendererProps(opts: RenderCoreOptions): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  if (opts.theme !== undefined) props.theme = opts.theme
  if (opts.viewport !== undefined) props.viewport = opts.viewport
  if (opts.capabilities !== undefined) props.capabilities = opts.capabilities
  if (opts.entityFacade !== undefined) props.entityFacade = opts.entityFacade
  if (opts.connections !== undefined) props.connections = opts.connections
  if (opts.dataServiceConfig !== undefined) props.dataServiceConfig = opts.dataServiceConfig
  if (opts.loadingStrategy !== undefined) props.loadingStrategy = opts.loadingStrategy
  if (opts.dataCache !== undefined) props.dataCache = opts.dataCache
  if (opts.interactionMode !== undefined) props.interactionMode = opts.interactionMode
  if (opts.basePath !== undefined) props.basePath = opts.basePath
  if (opts.imageAdapter !== undefined) props.imageAdapter = opts.imageAdapter
  if (opts.components !== undefined) props.components = opts.components
  if (opts.onEvent !== undefined) props.onEvent = opts.onEvent
  if (opts.gap !== undefined) props.gap = opts.gap
  if (opts.padding !== undefined) props.padding = opts.padding
  return props
}

// ============================================================
// MISSING BLOCK TYPES
// ============================================================

/**
 * Every block type in `surface` that nothing can render: no dynamic
 * descriptor and no component. Walks `blocks` and `children` recursively.
 */
export function missingBlockTypes(
  surface: RenderableSurface,
  dynamicBlocks: readonly DynamicBlockDescriptor[] | undefined,
  components: Partial<BlockComponentRegistry> | undefined
): string[] {
  const known = new Set<string>()
  for (const d of dynamicBlocks ?? []) known.add(d.blockType)
  for (const k of Object.keys(components ?? {})) known.add(k)
  const missing = new Set<string>()
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const n = node as { type?: unknown; children?: unknown }
      if (typeof n.type === 'string' && n.type && !known.has(n.type)) missing.add(n.type)
      walk(n.children)
    }
  }
  walk((surface as { blocks?: unknown }).blocks)
  return [...missing]
}

/**
 * The placeholder for a block type whose bundle this page does not have.
 * Static markup only — it never asks for the type's code. Children still
 * render inside it, so a missing container does not hide its subtree.
 */
export function RebuildNeededBlock({ block, children }: BlockComponentProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-pw-rebuild-needed': block.type,
      role: 'note',
      style: {
        border: '1px dashed currentColor',
        borderRadius: 6,
        padding: 12,
        opacity: 0.7,
        fontSize: 13,
      },
    },
    React.createElement('span', null, `Rebuild needed: "${block.type}" is not in this preview yet.`),
    children ?? null
  )
}

function withPlaceholders(opts: RenderCoreOptions): Partial<BlockComponentRegistry> | undefined {
  if (!opts.placeholderMissingBlocks) return opts.components
  const missing = missingBlockTypes(opts.surface, opts.dynamicBlocks, opts.components)
  if (missing.length === 0) return opts.components
  const added = Object.fromEntries(missing.map((t) => [t, RebuildNeededBlock])) as Partial<BlockComponentRegistry>
  return { ...added, ...(opts.components ?? {}) }
}

// ============================================================
// ELEMENT FACTORY
// ============================================================

/**
 * Build the React element tree for a surface — `DynamicArtifactProvider`
 * wrapping the appropriate renderer. Exposed separately from `mountSurface`
 * so it can be used in SSR / test contexts without a DOM root.
 */
export function createSurfaceElement(opts: RenderCoreOptions): React.ReactElement {
  // A connections context also requires the data-bound renderer
  // — it is what provides `SurfaceConnectionsContext` (engine-bridge blocks) and
  // routes connector data sources through the registry. A surface with only
  // engine-bridge panels declares no dataSources, so force it on when present.
  const useDataBound = needsDataBoundRenderer(opts.surface) || opts.connections != null
  const components = withPlaceholders(opts)
  const shared = buildRendererProps(components && components !== opts.components ? { ...opts, components } : opts)

  const rendererElement = useDataBound
    ? React.createElement(DataBoundSurfaceRenderer, {
        surface: opts.surface as DataBoundSurface,
        ...shared,
      })
    : React.createElement(SurfaceRenderer, {
        surface: opts.surface,
        ...shared,
      })

  return React.createElement(
    DynamicArtifactProvider,
    {
      ...(opts.dynamicBlocks && opts.dynamicBlocks.length > 0
        ? { dynamicBlocks: opts.dynamicBlocks }
        : {}),
      ...(opts.dynamicStarters && opts.dynamicStarters.length > 0
        ? { dynamicStarters: opts.dynamicStarters }
        : {}),
      children: rendererElement,
    }
  )
}

// ============================================================
// MOUNT
// ============================================================

/**
 * Resolve a target — an HTMLElement or a CSS selector string — to a node.
 */
export function resolveTarget(target: HTMLElement | string): HTMLElement {
  if (typeof target === 'string') {
    const el = document.querySelector(target)
    if (!el) {
      throw new Error(`[pwfabric-embed] target not found: ${target}`)
    }
    return el as HTMLElement
  }
  return target
}

/**
 * Mount a surface into `target` and return a handle for later teardown or
 * update. Pass `{ hydrate: true }` to attach to existing server-rendered
 * markup instead of discarding it.
 */
export function mountSurface(
  target: HTMLElement | string,
  opts: RenderCoreOptions,
  mountOptions?: MountSurfaceOptions
): SurfaceMountHandle {
  const container = resolveTarget(target)
  const root = mountOptions?.hydrate
    ? ReactDOM.hydrateRoot(container, createSurfaceElement(opts))
    : ReactDOM.createRoot(container)
  if (!mountOptions?.hydrate) root.render(createSurfaceElement(opts))
  return {
    container,
    unmount() {
      root.unmount()
    },
    render(newOpts: RenderCoreOptions) {
      root.render(createSurfaceElement(newOpts))
    },
  }
}
