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
import type { LinkHref } from './links.js'
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
   * Contract parity with `dataSourceSchema.notFoundWhenEmpty`: the source is
   * the record the page shows; settled with no record, the page tells its
   * host's address it is not found (render/address-sync.ts).
   */
  readonly notFoundWhenEmpty?: boolean
  /**
   * Contract parity with `dataSourceSchema.requiresSession`: only a signed-in
   * visitor can be answered for this source (data-protocol §2.6). While the
   * host says nobody is signed in it is not asked: it settles as a refused
   * read (`__errors.<id>` "unauthenticated"), and a sign-in asks it.
   */
  readonly requiresSession?: boolean
  /**
   * Contract parity with `dataSourceSchema.connector`: which
   * data-plane engine serves this entity source (e.g. 'graph-lists').
   * Routed through the host-provided `ConnectorEngineRegistry` when the
   * connection is registered there; absent/unregistered = the host's
   * entity facade, when it provides one. Absent means the app's own records
   * of `entityType` (data-protocol §2.2) — the reference runner serves those
   * from the app's record endpoints, never from a default connection.
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
   * Contract parity with `dataSourceSchema.fields`: the record's fields,
   * name → declared type. A write to the source sends these, each as its
   * type, and no other named value (render/source-writer.ts).
   */
  readonly fields?: Readonly<Record<string, string>>
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
  | 'write'
  | AuthActionType

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
  | WriteAction
  | AuthAction

// ============================================================
// IDENTITY: STATE AND ACTIONS
// ============================================================

/**
 * The visitor's identity, as the page may read it: `{{__auth.*}}`, and
 * `{{me.*}}` for `__auth.user`.
 *
 * STATE, NOT WORDS. The host (a runner) knows who is signed in and how one
 * signs in; the page decides what to say about it and where. Read-only and
 * without secrets: no token, no session id, nothing a page could replay.
 */
export interface SurfaceAuthState {
  /** A visitor is signed in, through any door. */
  readonly signedIn: boolean
  /** Who; null while nobody is signed in. */
  readonly user: SurfaceAuthUser | null
  /**
   * The ways in this app offers, in the host's order: `password`, a provider
   * method (`google`, `microsoft`, …), `issuer` for an external issuer.
   * Empty: the app has no door, and `auth:*` actions do nothing.
   */
  readonly methods: readonly string[]
  /**
   * Who may make an account: `open` (anyone — offer to sign up), `invite`
   * (only with an invitation), `closed` (nobody registers here).
   */
  readonly registration: 'open' | 'invite' | 'closed'
  /**
   * Why the last sign-in did not succeed — a code, never a sentence:
   * `refused` (the credentials were not accepted), `invalid` (the request was
   * not acceptable, e.g. a field missing), `exists` (register: the account
   * exists), `unavailable` (the method is not offered), `network`, `server`,
   * or the code a provider round trip came back with (`access_denied`,
   * `expired`, … lower-case). Null when there is nothing to report.
   */
  readonly error: string | null
}

/** The signed-in visitor. Fields a door did not supply are absent; `roles` is always a list. */
export interface SurfaceAuthUser {
  readonly id: string
  readonly name?: string
  readonly email?: string
  readonly roles: readonly string[]
}

export type AuthActionType = 'auth:signIn' | 'auth:register' | 'auth:signOut'

/**
 * What a block can ask of the host's identity: start signing in (by one
 * method, or the host's choice), register, sign out.
 *
 * Fired from a form's submit, the form's field values travel with it (the
 * password door reads `email`, `password` and, to register, `name`) — see
 * {@link SurfaceAuthHost.onAction}. The runtime itself performs none of them:
 * signing in is the host's business, and without a host they do nothing.
 */
export type AuthAction =
  | { readonly type: 'auth:signIn'; readonly method?: string }
  | { readonly type: 'auth:register'; readonly method?: string }
  | { readonly type: 'auth:signOut' }

/** The host's identity, handed to the renderer: what the page reads, and where its `auth:*` actions go. */
export interface SurfaceAuthHost {
  readonly state: SurfaceAuthState
  /**
   * An `auth:*` action a block or a behavior fired. `values` are the fields of
   * the form whose submit fired it (by input name); absent for a click.
   */
  readonly onAction?: (
    action: AuthAction,
    input: { readonly values?: Readonly<Record<string, unknown>> }
  ) => void
}

/**
 * Write one record of a source (data-protocol §1.3): create, update or delete.
 * `id` names the record of an update or a delete; `values` are the fields.
 * After a successful write every source is fetched again. `statusKeys`
 * drives page state as a form binding's does (§4.2).
 */
export interface WriteAction {
  readonly type: 'write'
  readonly sourceId: string
  readonly op: 'create' | 'update' | 'delete'
  readonly id?: string | number
  readonly values?: Readonly<Record<string, unknown>>
  readonly statusKeys?: {
    readonly loading?: string
    readonly success?: string
    readonly error?: string
    readonly reason?: string
    readonly fields?: string
    readonly detail?: string
  }
}

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
  /** The block whose event it hears. A template id inside a `repeat` names every copy (`<id>--<index>`). */
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
  /**
   * The page title (receipt `title`). It may carry expressions —
   * `{{dish.0.name}}` — resolved like a block prop against the page scope;
   * the renderer reports the result through `onTitle`.
   */
  readonly title?: string
  /**
   * The page in a sentence (receipt `description`), resolved like `title` and
   * reported through `onDescription` — a page's `<meta name="description">`.
   */
  readonly description?: string
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
   * Told the page title whenever it resolves to something new: the surface's
   * `title` with its expressions filled in (`Granola` once the dish has
   * loaded). `undefined` while it resolves to nothing — the record is not
   * loaded, or there is no title — so the host shows its own. The host
   * decides what to do with it (a runner sets `document.title`).
   */
  readonly onTitle?: (title: string | undefined) => void
  /** Like `onTitle`, for the surface's `description`. */
  readonly onDescription?: (description: string | undefined) => void
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
   *   loading placeholder (`ui.loading`) replaces the ENTIRE block tree until the
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
   * How the host writes an in-app link (`/session?id=4` → `#/session?id=4`).
   * A host rewrites the links it can read before render; a link whose page is
   * an expression (`href: "{{item.url}}"`) it leaves as written, and the
   * renderer passes its resolved value through this. See render/links.ts.
   */
  readonly linkHref?: LinkHref
  /**
   * The app's locale (BCP 47, `en-GB` — `app/plan.json` `locale`, carried as
   * `project.json` `locale`). `date()`, `currency()`, `number()` and
   * `n.toLocaleString()` write in it; absent, in the visitor's.
   */
  readonly locale?: string

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
  /**
   * The visitor's identity (`{{__auth.*}}`, `{{me.*}}`) and the host that acts
   * on `auth:*` actions. Absent: nobody is signed in and the actions do nothing.
   */
  readonly identity?: SurfaceAuthHost
}
