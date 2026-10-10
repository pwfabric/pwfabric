/**
 * Data Binding Types for Surface Renderer
 *
 * Type definitions for data-bound surface rendering.
 * These types define the shape of surface JSON definitions that include
 * dataSources, state, and expression-based prop bindings.
 *
 * @module @pwfabric/runtime/render/data-binding-types
 */

import type { SurfaceDataCache } from './data-cache.js'
import type { Block } from '@pwfabric/core'
import type { RenderableSurface, SurfaceRendererProps } from './types.js'
import type { DataServiceConfig } from '../data/types.js'

// ============================================================
// DATA SOURCE DEFINITION (Surface JSON level)
// ============================================================

/**
 * Source kinds supported in surface JSON definitions.
 * Note: 'computed' is excluded because functions can't be serialized in JSON.
 */
export type SurfaceDataSourceKind = 'rest' | 'static' | 'state' | 'entity'

/**
 * Data source definition within a surface JSON.
 * Unlike DataSourceDefinition from data/types, this is JSON-serializable.
 */
export interface SurfaceDataSourceDefinition {
  /** Unique source identifier, used as the key in expression context */
  readonly id: string
  /** Source kind */
  readonly kind: SurfaceDataSourceKind
  /** REST endpoint (may contain {{state.key}} placeholders) */
  readonly endpoint?: string
  /** HTTP method for REST sources */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Static inline data */
  readonly staticData?: unknown
  /** Auto-refresh interval in ms (0 or undefined = no auto-refresh) */
  readonly refreshInterval?: number
  /** Optional HTTP headers to include in REST requests (e.g. Authorization) */
  readonly headers?: Readonly<Record<string, string>>
  /** Entity type to list (kind: 'entity') via the platform/entities facade */
  readonly entityType?: string
  /** Optional query for entity sources (filter/sort/pagination). String
   * leaves may carry `{{state.x}}` expressions — resolved against surface
   * state before the connector is called (see render/query-state.ts). */
  readonly query?: Readonly<Record<string, unknown>>
  /** Payload bound when the source cannot be served (connector missing /
   * failed). `__errors.<id>` stays populated alongside it. */
  readonly fallback?: unknown
  /**
   * Contract parity with `dataSourceSchema.connector`: which
   * data-plane engine serves this entity source (e.g. 'graph-lists').
   * Routed through the host-provided `ConnectorEngineRegistry` when the
   * connection is registered there; absent/unregistered = the default
   * entity facade path (today's behavior).
   */
  readonly connector?: string
  /**
   * The response property holding the list — `data`, `products`, or absent
   * when the body IS the array. Dotted paths allowed for a nested one.
   */
  readonly returns?: string
  /** world auth binding BY NAME — never credential values. */
  readonly authProviderRef?: string
  /**
   * Contract parity with `dataSourceSchema.aggregate`: ask for ONE
   * NUMBER over the collection instead of its rows. The source binds
   * `{ fn, field?, value, count }` — `{{<id>.value}}` — and is exempt from
   * the list wrap. `filter` leaves may carry `{{state.x}}` like `query`.
   */
  readonly aggregate?: {
    readonly fn: 'count' | 'sum' | 'avg'
    readonly field?: string
    readonly filter?: Readonly<Record<string, unknown>>
  }
}

// ============================================================
// SURFACE ACTIONS
// ============================================================

/**
 * Action types that blocks can dispatch via their action prop.
 */
export type SurfaceActionType =
  | 'setState'
  | 'refresh'
  | 'refreshAll'
  | 'showBlock'
  | 'hideBlock'
  | 'navigate'

/**
 * Action dispatched by a block (e.g. button click, tab change).
 */
export type SurfaceAction =
  | { readonly type: 'setState'; readonly key: string; readonly value: unknown }
  | { readonly type: 'refresh'; readonly sourceId: string }
  | { readonly type: 'refreshAll' }
  | { readonly type: 'showBlock'; readonly blockId: string }
  | { readonly type: 'hideBlock'; readonly blockId: string }
  | { readonly type: 'navigate'; readonly url: string }

/**
 * What a block's `action` prop may hold: one action, or a list run in order
 * on the block's click (`block:click`) — never on its other events.
 */
export type BlockActionProp = SurfaceAction | readonly SurfaceAction[]

/**
 * A behavior stored on a published surface — maps an event trigger to one or more actions.
 * The `event` field accepts canonical colon form (`block:click`) or legacy dot form
 * (`surface.load`) — normalized at match time by `canonicalizeEventType`.
 */
export interface RuntimeBehavior {
  readonly id: string
  readonly event: string
  readonly targetBlockId?: string
  readonly actions: readonly SurfaceAction[]
}

// ============================================================
// DATA-BOUND SURFACE
// ============================================================

/**
 * Surface definition extended with data binding capabilities.
 * This is the shape of a surface JSON that uses live data.
 */
export interface DataBoundSurface {
  /**
   * Stable surface id — SurfaceRenderer's render scope.
   *
   * Omitted from this type originally, which made the drop invisible: the
   * renderer decomposes the surface into blocks/appearance/capabilities and
   * rebuilds it, and a field the type never had could not survive the rebuild.
   * Downstream, `[data-pw-surface]` rendered with an EMPTY value and every
   * per-surface rule (dark theme, visibility, interaction states) fell back to
   * the value-less selector shared by every surface in the document — the exact
   * collision the scoping was added to prevent.
   */
  readonly id?: string
  /** Block composition */
  readonly blocks: readonly Block[]
  /** ui-appearance atom reference (theme + layout + styleVariables consolidated). */
  readonly appearance?: RenderableSurface['appearance']
  /** capability list — `platform/persistence` carries dataSources + initialState in its config. */
  readonly capabilities?: RenderableSurface['capabilities']
}

// ============================================================
// RENDERER PROPS
// ============================================================

/**
 * Props for DataBoundSurfaceRenderer.
 * Extends SurfaceRendererProps but accepts a DataBoundSurface.
 */
export interface DataBoundSurfaceRendererProps extends Omit<SurfaceRendererProps, 'surface'> {
  /** Surface definition with optional dataSources and state */
  readonly surface: DataBoundSurface
  /** Stored behaviors to execute when their trigger event fires on the bus */
  readonly behaviors?: readonly RuntimeBehavior[]
  /**
   * Intercept a `navigate` action before the default `window.location.assign`
   * fallback runs. Return `true` to signal the host handled it (e.g. swapped
   * to a sibling page in place, connected-preview style) — the default hard
   * navigation is skipped. Return `false`/`undefined` to fall through to the
   * default behavior.
   */
  readonly onNavigateAction?: (url: string) => boolean
  /**
   * What to render while the initial `fetchAllSources` pass is in flight.
   *
   * - `'gate'` (default) — the historical behavior: an all-or-nothing
   *   "Loading data..." placeholder replaces the ENTIRE block tree until the
   *   first fetch settles. Kept as the default so existing consumers (e.g.
   *   published `/s/` pages) are byte-identical.
   * - `'immediate'` — render the block tree right away; expressions bound to
   *   still-loading sources resolve to `undefined` (never a literal `{{…}}`
   *   string — path expressions always evaluate successfully) and fill in as
   *   each source lands. Static chrome (navbar, headings, footer) is visible
   *   from the first frame. Pair with the `__loading.<sourceId>` /
   *   `__anyLoading` expression keys to drive per-widget skeletons.
   */
  readonly loadingStrategy?: 'gate' | 'immediate'
  /**
   * Yesterday's rows while today's load. A source whose key (see
   * `dataSourceCacheKey`) is present is seeded from the cache on the first
   * frame and still re-fetched; the fresh result replaces the seed and is
   * written back. Pairs naturally with `loadingStrategy: 'immediate'`.
   */
  readonly dataCache?: SurfaceDataCache

  /**
   * Configuration for the DataService this renderer creates.
   *
   * IT WAS NEVER PASSED. `<DataCapabilityProvider>` was mounted bare, so the
   * service was built with no config — which means `getAccessToken` was always
   * undefined and every `authProviderRef` on every rest source resolved to
   * nobody. The field parsed, travelled and was read by a resolver that could
   * not exist. Threading it is the repair; it is also what lets a host say
   * which origin is its own, so our API can be called with a cookie and
   * nobody else's can.
   */
  readonly dataServiceConfig?: DataServiceConfig
}
