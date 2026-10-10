/**
 * Surface Renderer Types
 *
 * Phase 2A.1: Type definitions for Surface-to-React rendering
 *
 * @module @pwfabric/runtime/render/types
 */

import type { Block, BreakpointName, SurfaceDocument, SurfaceTheme } from '@pwfabric/contracts'
import type { CSSProperties, ReactNode } from 'react'
import type { ImageAdapter as ImageAdapterType } from '../adapters/types.js'
import type { EntityFacade } from '../entity/facade.js'
import type { SurfaceConnectionsValue } from '../connectors/types.js'

// Re-export EntityFacade for consumers who import from @pwfabric/runtime/render
export type { EntityFacade } from '../entity/facade.js'

// Re-export ImageAdapter type for consumers
export type { ImageAdapter, ImageAdapterProps } from '../adapters/types.js'

// Local alias for use in this file
type ImageAdapter = ImageAdapterType

// ============================================================
// CAPABILITY TYPES (mirrored from starters to avoid circular dep)
// ============================================================

/**
 * Capability types that can be required by surfaces
 * (defined capabilities)
 */
export type CapabilityType =
  | 'auth'
  | 'data'
  | 'state'
  | 'navigation'
  | 'analytics'
  | 'seo'
  | 'i18n'
  | 'forms'

// ============================================================
// RENDERABLE SURFACE
// ============================================================

/**
 * Renderable surface interface
 *
 * A structural projection of SurfaceDocument containing only the fields
 * needed for rendering. Any object with the matching shape can be rendered,
 * including custom definitions.
 *
 * Derived from SurfaceDocument so it stays structurally aligned with the
 * canonical type.
 */
// theme + layout + styleVariables collapsed into `appearance` ref;
// dataSources + initialState moved into platform/persistence capability config.
export type RenderableSurface = Pick<SurfaceDocument, 'blocks' | 'appearance' | 'capabilities'> & {
  /** Optional surface identifier — used by `BehaviorSurfaceProvider` to scope the event bus */
  readonly id?: string
}

// ============================================================
// BLOCK COMPONENT TYPES
// ============================================================

/**
 * Props passed to block components
 */
export interface BlockComponentProps<T = Record<string, unknown>> {
  /** Block definition */
  readonly block: Block
  /** Resolved props (validated and defaulted) */
  readonly props: T
  /** Rendered children (for container blocks) */
  readonly children?: ReactNode
  /** Block context for capability access */
  readonly context: BlockContext
}

/**
 * Block component type
 */
export type BlockComponent<T = Record<string, unknown>> = ((
  props: BlockComponentProps<T>
) => ReactNode) & {
  /**
   * How the block wants to be sized when it sits in a flex ROW.
   *
   * The engine's default for a row child is an equal share (`flex: 1 1 0`) —
   * right for two content columns, wrong for an avatar, a badge, a button: an
   * intrinsic thing stretched to half a row is the single most measured layout
   * defect of the 2026-09 surface audit (127 hand-written `flex: 0 0 auto`
   * overrides across 14 receipts). A block whose natural width is its content
   * declares `sizing: 'intrinsic'` — as a static on the component, the same
   * way `displayName` travels — and the engine gives it `flex: 0 0 auto`.
   * An authored flex hint on the instance still wins. The engine memorises no
   * block names: the block declares, the engine obeys.
   */
  sizing?: BlockSizing
}

/** The only sizing word the engine knows besides its default (fluid share). */
export type BlockSizing = 'intrinsic'

/**
 * Block component registry
 */
export type BlockComponentRegistry = Record<string, BlockComponent>

// ============================================================
// CAPABILITY CONTEXT
// ============================================================

/**
 * Capability provider interface
 */
export interface CapabilityProvider {
  /** Capability type */
  readonly type: CapabilityType
  /** Provider-specific data */
  readonly data?: unknown
}

/**
 * Block rendering context
 */
export interface BlockContext {
  /** Available capabilities */
  readonly capabilities: Map<CapabilityType, CapabilityProvider>
  /** Base path for routing */
  readonly basePath: string
  /** Event handler */
  readonly onEvent: ((event: SurfaceEvent) => void) | undefined
  /** Image adapter for framework-specific optimization */
  readonly imageAdapter: ImageAdapter | undefined
  /** Current viewport breakpoint for responsive rendering */
  readonly viewport?: BreakpointName
  /**
   * Interaction mode (ADR render-unification). `onEvent` is a pure notification
   * and always fires; `interactionMode` gates real SIDE-EFFECTS. Blocks that
   * perform real navigation or data writes (e.g. `window.location.href`) MUST
   * skip those when `interactionMode === 'inert'` so editor/preview renders
   * don't trigger navigation or external mutations. Defaults to `live`.
   */
  readonly interactionMode?: BlockInteractionMode
}

// ============================================================
// SURFACE EVENTS
// ============================================================

/**
 * Surface event types
 */
export type SurfaceEventType = 'click' | 'submit' | 'change' | 'navigate' | 'custom'

/**
 * Surface event
 */
export interface SurfaceEvent {
  /** Event type */
  readonly type: SurfaceEventType
  /** Block ID that triggered the event */
  readonly blockId: string
  /** Event payload */
  readonly payload?: unknown
  /** Original DOM event (if applicable) */
  readonly originalEvent?: Event
  /** Canonical bus event name (e.g. 'block:click', 'form:submit') — set by the renderer bridge */
  readonly canonicalType?: string
}

// ============================================================
// RENDERER PROPS
// ============================================================

/**
 * Surface renderer props
 */
/**
 * Interaction mode for the runtime render (ADR render-unification).
 * - `live` (default): full runtime behavior — data-source auto-refresh timers run
 *   and block-dispatched surface actions/events fire.
 * - `inert`: editor/preview render — no auto-refresh timers, block-dispatched
 *   surface actions are no-ops, so an editor can intercept clicks (e.g. for
 *   selection) without the surface mutating its own state.
 */
export type BlockInteractionMode = 'live' | 'inert'

/**
 * Props the runtime puts on each block's outermost wrapper element. The exact
 * shape `renderBlock` would spread onto its own `<div>`. An editor decorator
 * (see `renderBlockWrapper`) spreads these onto its own element so the runtime's
 * computed layout + the per-block selector survive — the decorator never
 * recomputes layout.
 */
export interface BlockWrapperProps {
  readonly style?: CSSProperties
  /**
   * The block id as a DOM id, so `#<blockId>` is a reachable anchor.
   *
   * Separate from `data-block-id`, which addresses blocks for styling and
   * editing: only a real `id` makes a fragment link scroll, so without it
   * same-page navigation would be silently impossible.
   *
   * A decorator that renders its own wrapper receives this and is expected to
   * apply it — two elements carrying one id is worse than none.
   */
  readonly id?: string
  /** Unified per-block selector — present on every render path. */
  readonly 'data-block-id': string
  /** Any other `data-*` attributes the runtime sets (e.g. data-dynamic-block). */
  readonly [dataAttr: `data-${string}`]: string | undefined
}

/**
 * Arguments passed to a `renderBlockWrapper` decorator. `children` is the
 * runtime-rendered block content (already wrapped in its error boundary);
 * `wrapperProps` carries the runtime-computed layout style + selectors.
 */
export interface BlockWrapperRenderArgs {
  readonly block: Block
  readonly children: ReactNode
  readonly wrapperProps: BlockWrapperProps
  readonly parentBlock?: Block
}

export interface SurfaceRendererProps {
  /** Surface definition (starter or custom) */
  readonly surface: RenderableSurface
  /** Capability providers */
  readonly capabilities?: CapabilityProvider[]
  /**
   * App-level color scheme hint (kept for external API compat, not injected into BlockContext).
   * Surface visual theming is done via surface.theme.
   */
  readonly theme?: 'light' | 'dark'
  /**
   * the Project's shared theme tokens,
   * merged as a layer BETWEEN the platform defaults and this surface's own
   * `appearance.config.theme` — a surface that hasn't set a given token
   * inherits the project's; one that has, keeps winning. Only wired for the
   * in-process fallback resolution path (no tenant-installed ui-appearance
   * atom bundle active); published/public rendering does not consume this
   * yet — editor-only for now.
   */
  readonly projectTheme?: SurfaceTheme
  /**
   * The Project's dark OVERRIDES (`appearanceConfig.darkTheme`), as the authoring studio writes
   * them: only the tokens the author changed. They sit on top of the dark
   * variant DERIVED from the effective light theme, under this surface's own
   * `appearance.config.darkTheme`. Omit it and the dark mode is the derivation
   * plus the surface's overrides, as before.
   */
  readonly projectDarkTheme?: SurfaceTheme
  /** Base path for links/routing */
  readonly basePath?: string
  /** Event handler */
  readonly onEvent?: (event: SurfaceEvent) => void
  /** Custom block component overrides */
  readonly components?: Partial<BlockComponentRegistry>
  /** Wrapper className */
  readonly className?: string
  /** Explicit viewport override (if not set, uses auto-detection) */
  readonly viewport?: BreakpointName
  /** Grid gap between blocks in pixels (default: 16) */
  readonly gap?: number | undefined
  /** Surface inner padding in pixels (default: 24) */
  readonly padding?: number | undefined
  /**
   * Image adapter for framework-specific image optimization
   *
   * Allows using Next.js Image, Astro Image, etc. while keeping
   * surface definitions framework-agnostic.
   *
   * @example
   * ```tsx
   * import { NextImageAdapter } from '@pwfabric/runtime/adapters'
   *
   * <SurfaceRenderer
   *   surface={mySurface}
   *   imageAdapter={NextImageAdapter}
   * />
   * ```
   */
  readonly imageAdapter?: ImageAdapter
  /**
   * EntityFacade instance for data model access.
   * When provided, entity data sources and form bindings are activated.
   * platform/entities is Tier 1 always-on — this prop is optional only
   * because caller controls instantiation (ConnectorRegistry binding is app-specific).
   */
  readonly entityFacade?: EntityFacade
  /**
   * The surface's connections context — the world's
   * configured connections (single dialect with the runner's
   * `connections.json` entries) plus the loaded connector-engine registry.
   * When provided, `{kind:'entity', connector}` data sources route through
   * the registry and the value is exposed to blocks via
   * `SurfaceConnectionsContext`. Absent = today's behavior (additive).
   */
  readonly connections?: SurfaceConnectionsValue
  /**
   * Editor-only seam (ADR render-unification): wrap each block's layout wrapper
   * with custom chrome (selection/drag/hover). Receives the runtime-computed
   * `wrapperProps` so the decorator never recomputes layout. When omitted
   * (runtime/published path), each block renders in the default `<div>` —
   * byte-identical to before this seam existed.
   */
  readonly renderBlockWrapper?: (args: BlockWrapperRenderArgs) => ReactNode
  /**
   * Interaction mode. Defaults to `live`. `inert` suppresses data auto-refresh
   * and block-dispatched surface actions (for editor/preview embedding).
   */
  readonly interactionMode?: BlockInteractionMode
}

/**
 * Block renderer props (internal)
 */
export interface BlockRendererProps {
  /** Block to render */
  readonly block: Block
  /** Rendering context */
  readonly context: BlockContext
  /** Component registry */
  readonly components: BlockComponentRegistry
}

// ============================================================
// RENDER RESULT
// ============================================================

/**
 * Render result with metadata
 */
export interface RenderResult {
  /** Rendered element */
  readonly element: ReactNode
  /** Block IDs in render tree */
  readonly blockIds: string[]
  /** Required capabilities */
  readonly requiredCapabilities: CapabilityType[]
}
