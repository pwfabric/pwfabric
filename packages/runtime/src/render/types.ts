/**
 * Surface Renderer Types
 *
 * Phase 2A.1: Type definitions for Surface-to-React rendering
 *
 * @module @pwfabric/runtime/render/types
 */

import type { Block, BreakpointName, SurfaceDocument, SurfaceTheme } from '@pwfabric/contracts'
import type { SurfaceAddress } from './address.js'
import type { CSSProperties, ReactNode } from 'react'
import type { ImageAdapter as ImageAdapterType } from '../adapters/types.js'
import type { EntityFacade } from '../entity/facade.js'
import type { SurfaceConnectionsValue } from '../connectors/types.js'
import type { LinkHref } from './links.js'

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

/**
 * The sizing words the engine knows besides its default (a fluid share).
 *
 * - `intrinsic` — the block's width is its content (avatar, badge, button):
 *   in a row it keeps that width instead of taking an equal share.
 * - `fill` — the block takes the whole width of where it is placed and has no
 *   content width of its own (a progress bar, a rule). Its wrapper fills the
 *   parent's line in a column or centred parent, so the block does not
 *   collapse to the zero width of a wrapper shrunk around nothing. In a row the
 *   flex share decides, as for any fluid block.
 */
export type BlockSizing = 'intrinsic' | 'fill'

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

/** The visitor's consent answers: category → consented. A category not answered is absent. */
export type ConsentAnswers = Readonly<Record<string, boolean>>

/**
 * The visitor's consent as a host keeps it (envelope §2.2): the categories
 * the app's scripts wait for, the answers so far, and a way to record new
 * ones. The runner's is backed by browser storage and loads the scripts.
 */
export interface ConsentStore {
  /** The categories the app's scripts name, each once, in declaration order. */
  readonly categories: readonly string[]
  /** The answers so far; the same object until they change. */
  answers(): ConsentAnswers
  /** Records answers, merged over the previous ones; a category not in `categories` is ignored. */
  set(answers: ConsentAnswers): void
  /** Called after every change of the answers; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
}

/** The visitor's colour scheme (appearance §4.1): `"system"` while none is chosen, the device then decides. */
export type ColorScheme = 'light' | 'dark' | 'system'

/**
 * The visitor's colour-scheme choice, as a host keeps it (appearance §4.1).
 * The runner's is backed by browser storage and sets `data-pw-theme` on the
 * document element.
 */
export interface ColorSchemeStore {
  /** The choice so far; `"system"` when none is made. */
  scheme(): ColorScheme
  /** Records a choice; any value but `"light"`, `"dark"` or `"system"` is ignored. */
  set(scheme: ColorScheme): void
  /** Called after every change of the choice; returns the unsubscribe. */
  subscribe(listener: () => void): () => void
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
  /**
   * The app's locale (BCP 47, `en-GB`): what a block writes numbers, prices
   * and dates in. Read it here, never off the document (`<html lang>`) — a
   * block's render must be the same wherever it runs, and the build renders
   * each page's first frame outside a browser (pwapp-format §2.5). Absent:
   * the host names none, and the visitor's formats apply.
   */
  readonly locale?: string
  /**
   * The app's languages, in order (envelope §2.3): `locales` of an app in
   * several languages, `[locale]` of a single-language one. Absent without a
   * locale.
   */
  readonly locales?: readonly string[]
  /**
   * The current page's address in every locale, from the app's base, as a
   * link to it is written (`{ en: '/pricing/', de: '/de/preise/' }`): what a
   * language switch draws. Only in an app with `locales`; on the not-found
   * page, each locale's entry page.
   */
  readonly alternates?: Readonly<Record<string, string>>
  /**
   * An app page's address, written the way this host routes (envelope §3):
   * `appHref('/webhooks?x=1')` is `#/webhooks?x=1` under a hash router,
   * `<base>/webhooks?x=1` under a path router. A block that draws a link of
   * its own making — a markdown link in prose, a table cell built from a
   * template — writes it through this, so the link also works opened in a new
   * tab or copied, which a bare `/webhooks` does not on a hash-routed static
   * host. A `href`/`*Href` prop needs nothing: the host has rewritten it.
   *
   * Root-relative page paths are rewritten (the query and fragment ride
   * along); an absolute URL, a fragment (`#x`), a link to the app's media and
   * `''` come back as given. Always present; without a router (a gallery, a
   * test) it returns the path as given. It does not make data safe: a link
   * built from a row is still checked by the block (`safeDataLink`).
   */
  readonly appHref: LinkHref
  /**
   * The consent categories the app's scripts wait for, each once, in
   * declaration order (envelope §2.2): what a consent block asks about.
   * Empty when the app declares no script.
   */
  readonly consentCategories?: readonly string[]
  /**
   * The visitor's answers so far, `{ <category>: true | false }`; a category
   * not answered is absent. `{}` in the first frame and the hydrating render
   * (the build knows no visitor); the stored answers arrive right after.
   */
  readonly consent?: ConsentAnswers
  /**
   * Records the visitor's answers, merged over the previous ones; a category
   * not in `consentCategories` is ignored. A host without a consent store
   * ignores the call.
   */
  readonly setConsent?: (answers: ConsentAnswers) => void
  /**
   * The visitor's colour scheme (appearance §4.1): `"light"`, `"dark"`, or
   * `"system"` when none is chosen. `"system"` in the first frame and the
   * hydrating render (the build knows no visitor); the stored choice arrives
   * in the update right after. A block reads it here, never from storage.
   */
  readonly colorScheme?: ColorScheme
  /**
   * Records the visitor's colour scheme; any other value is ignored. A host
   * without a colour-scheme store ignores the call.
   */
  readonly setColorScheme?: (scheme: ColorScheme) => void
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
   * Unified per-block selector — present on every render path.
   *
   * The wrapper carries NO DOM `id`. The block's component renders `id` on its
   * own root (every first-party block does), and a wrapper carrying the same id
   * put every id in the document twice — invalid HTML, and `#<id>` /
   * `aria-labelledby` resolved to the wrapper rather than the block. A host
   * looking for an anchor falls back to `[data-block-id]` for a block that
   * renders no id of its own.
   */
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
  /** The app's locale, handed to every block as `context.locale`. */
  readonly locale?: string
  /** The app's languages (envelope §2.3), handed to every block as `context.locales`. */
  readonly locales?: readonly string[]
  /** The current page in every locale, handed to every block as `context.alternates`. */
  readonly alternates?: Readonly<Record<string, string>>
  /** The visitor's consent (envelope §2.2), handed to every block as `context.consentCategories`, `consent` and `setConsent`. */
  readonly consent?: ConsentStore
  /** The visitor's colour scheme (appearance §4.1), handed to every block as `context.colorScheme` and `setColorScheme`. */
  readonly colorScheme?: ColorSchemeStore
  /**
   * The page this surface is (the runner's page key). When it changes between
   * two renders of the same mount, the page's state and the data of the
   * sources it no longer declares are dropped, while the blocks that stay —
   * an app layout's (receipt §4) — stay mounted.
   */
  readonly pageKey?: string
  /**
   * How this host writes an app link (its router's form); handed to every
   * block as `context.appHref`. Absent, a link is written as given.
   */
  readonly linkHref?: LinkHref
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
  /**
   * Block code the app gives the renderer, by block type (an app that bundles
   * its blocks). A given component is drawn as given — the module its
   * descriptor names is not loaded — and gets its props exactly as a loaded
   * block does: the `definition.props` of the type's descriptor (the
   * `blocks/manifest.json` entry handed to `DynamicArtifactProvider`) are
   * applied before it renders. A type with no descriptor has no declarations
   * and gets its props as written.
   */
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
  /**
   * The page's address, as its host exposes it (see render/address.ts): where
   * a split shell's selection and the page's `urlState` live, and where the
   * page reports a record that is not there. Absent: the document's own
   * `location.search`, with no not-found page.
   */
  readonly address?: SurfaceAddress | undefined
  /**
   * Told the selection a split shell shows (its id, or `null`), so the
   * data-bound renderer holds it as page state. Set by that renderer.
   */
  readonly onSelection?: ((key: string, id: string | null) => void) | undefined
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
