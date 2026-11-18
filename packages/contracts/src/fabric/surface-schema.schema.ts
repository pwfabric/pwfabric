/**
 * The zod schemas of `surface-schema.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { SurfaceAppearanceRefSchema } from './surface-appearance.schema.js'
import { findDuplicateBlockIds } from './surface-schema.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const blockSnapshotSchema: z.ZodType<any> = z.lazy(() =>
  z.object({
    id: z.string().min(1).optional(),
    type: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    // Visual style overrides. Each prop value is EITHER a flat CSS
    // string OR a per-breakpoint ResponsiveValue map. The runtime renders the
    // base (xs) value inline and emits scoped media-query CSS for the larger
    // breakpoints. Without the union here z.record(z.string()) would reject
    // (strip) any responsive object value on persist.
    style: z
      .record(
        z.string(), z.union([
          z.string(),
          z
            .object({
              xs: z.string().optional(),
              sm: z.string().optional(),
              md: z.string().optional(),
              lg: z.string().optional(),
              xl: z.string().optional(),
              '2xl': z.string().optional(),
            })
            .strict(),
        ])
      )
      .optional(),
    // Interaction-state styling (token-driven hover/active/focus). The runtime
    // emits scoped `[data-block-id]:hover/:active/:focus-visible` CSS rules from
    // these records. Without them here z.object would strip them on persist.
    states: z
      .object({
        hover: z.record(z.string(), z.string()).optional(),
        active: z.record(z.string(), z.string()).optional(),
        focus: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    // Conditional-state styling (aria/data/disabled/checked/:has variants). Each
    // entry is a CSS suffix selector + decl record; the runtime emits scoped
    // `[data-block-id]<selector>{…}` rules. Without this here z.object would
    // strip it on persist.
    conditionalStates: z
      .array(z.object({ selector: z.string(), style: z.record(z.string(), z.string()) }))
      .optional(),
    // Group-hover styling (Tailwind `group` + `group-hover:`). `groupRoot` marks
    // a hover-source ancestor; `groupStates.hover` are decls applied to a
    // descendant when its nearest `groupRoot` ancestor is hovered. The runtime
    // emits scoped `[data-block-id="<root>"]:hover [data-block-id="<desc>"]{…}`
    // rules. Without them here z.object would strip them on persist.
    groupRoot: z.boolean().optional(),
    groupStates: z
      .object({
        hover: z.record(z.string(), z.string()).optional(),
      })
      .optional(),
    layout: z.record(z.string(), z.unknown()).optional(),
    // Conditional visibility (resolve-expressions): the renderer hides a block
    // whose `visibleWhen` / `if` expression (e.g. "{{state.formOpen}}") is falsy.
    // Without these here, z.object stripped them on persist — so create_surface/
    // canonical surfaces lost their form↔success / show-on-state gating.
    visibleWhen: z.string().optional(),
    if: z.string().optional(),
    // Item-template expansion (resolve-expressions): a block carrying `repeat`
    // (e.g. "{{products}}") treats its children as a per-item template, cloned
    // once per element of the resolved array with `{{item.*}}` / `{{index}}` in
    // scope. The runtime has expanded it since the repeater family landed; the
    // schema did not know it, so z.object stripped it on persist and a
    // validated snapshot lost its list. Additive and optional — a snapshot
    // without it parses exactly as before.
    repeat: z.string().optional(),
    children: z.array(blockSnapshotSchema).optional(),
  })
)

// ============================================================
// LEGACY SURFACE THEME SCHEMA (retained for AppearanceConfig validation)

/**
 * Zod schema for the legacy SurfaceTheme shape.
 *
 * The appearance work moved `theme` off the surface root and into
 * `surface.appearance.config.theme`. This schema is kept here because:
 * 1. An appearance pack accepts this exact shape as its world-supplied
 *    config payload.
 * 2. Some API-layer validators still reference the loose theme shape
 *    (marketplace validation, composer-validator).
 *
 * Retired surface root usage — no longer directly attached to
 * `surfaceDocumentSchema`.
 */
export const surfaceThemeSchema = z
  .object({
    // `card` is the container colour's one name; the old `surface` key is
    // refused rather than ignored, so a theme written for it fails loudly.
    colors: z
      .record(z.string(), z.string())
      .refine((c) => !('surface' in c), {
        message: 'colors.surface is not a theme colour — use colors.card',
        path: ['surface'],
      })
      .optional(),
    border: z
      .object({
        radius: z.string().optional(),
        width: z.string().optional(),
        style: z.string().optional(),
        radiusLarge: z.string().optional(),
      })
      .optional(),
    typography: z
      .object({
        fontFamily: z.string().optional(),
        headingFontFamily: z.string().optional(),
        baseFontSize: z.string().optional(),
        headingWeight: z.string().optional(),
        headingLineHeight: z.string().optional(),
        letterSpacing: z.string().optional(),
        bodyLineHeight: z.string().optional(),
        fontSizeSm: z.string().optional(),
        fontSizeXs: z.string().optional(),
      })
      .optional(),
    spacing: z.object({ base: z.string().optional() }).optional(),
    layout: z
      .object({
        gap: z.string().optional(),
        padding: z.string().optional(),
        containerMaxWidth: z.string().optional(),
        gridGap: z.string().optional(),
      })
      .optional(),
    shadows: z
      .object({
        card: z.string().optional(),
        button: z.string().optional(),
      })
      .optional(),
    motion: z
      .object({
        durationFast: z.string().optional(),
        durationNormal: z.string().optional(),
        durationSlow: z.string().optional(),
        easing: z.string().optional(),
        easingBounce: z.string().optional(),
      })
      .optional(),
  })
  .optional()

// ============================================================
// DATA SOURCE SCHEMA (persistence capability config)

/**
 * Data source declaration. It lives inside the `platform/persistence`
 * capability config.
 */
export const dataSourceSchema = z.object({
  id: z.string(),
  kind: z.enum(['rest', 'static', 'state', 'entity']),
  endpoint: z.string().optional(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']).optional(),
  staticData: z.unknown().optional(),
  refreshInterval: z.number().optional(),
  // 'entity' kind: list records of `entityType` via the platform/entities facade.
  // The records bind as a list under the source id — {{<id>}} (the items
  // array; `{{data.<id>}}` is the same value) — and refresh on refreshAll
  // (e.g. after a form→entity create). An `aggregate` source binds one
  // object instead: {{<id>.value}}. Backs the read half of the
  // entities CRUD capability (EntityDataSource).
  entityType: z.string().optional(),
  query: z.record(z.string(), z.unknown()).optional(),
  /**
   * The response property holding the list — `data`, `products`, or absent
   * when the body IS the array. Without it, a `rest` source hands the binding
   * context a whole JSON body while an `entity` source hands it an array, and
   * a block bound to a list cannot take both.
   */
  returns: z.string().optional(),
  // which connection serves this source (e.g. 'graph-lists'); absent =
  // the app's own records of `entityType` (data-protocol §2.2).
  connector: z.string().optional(),
  // reference to the world connection/auth binding BY NAME;
  // never carries credential values (auth law).
  authProviderRef: z.string().optional(),
  /**
   * Sample payload for a source NOTHING IS CONNECTED to serve — a connector
   * the host did not register, no entity facade, no records base (a pack
   * gallery, a preview). The runtime binds it with the source's `query`
   * applied, and `__errorCodes.<id>` is `"unconnected"`. A REAL failure — a
   * refused read, a not-found, a server error, a network failure — binds no
   * rows, whatever `fallback` says (data-protocol §2.5). Shape mirrors the
   * live payload: an array for list sources.
   */
  fallback: z.unknown().optional(),
  /**
   * The source is THE RECORD THE PAGE SHOWS (a detail page's `?id=`). When it
   * settles with no record — a 404, no row, or not fetched because the path
   * value it needs is empty — the page is not found: the host renders the
   * app's not-found page at this address (data-protocol, envelope §3). A
   * refused read or a server error is not "not found"; it is the source's
   * error state.
   */
  notFoundWhenEmpty: z.boolean().optional(),
  /**
   * THE RECORD'S FIELDS, name → declared type (`entities.json` "Field
   * types"). A write to this source — a form binding, the `write` action —
   * sends only these, each as its type (a number field's `"10"` goes as
   * `10`, a checkbox's `"on"` as `true`); any other named value (a one-time
   * code, a confirmation box) stays on the page (data-protocol §4.1).
   * Absent: the write sends what it gathered, as gathered. A builder writes
   * it onto an own-records `entity` source from the type's declaration; an
   * author MAY write it on any source.
   */
  fields: z.record(z.string(), z.string()).optional(),
  /**
   * Ask for ONE NUMBER over the collection instead of its rows. The
   * source binds `{ fn, field?, value, count }` — `{{<id>.value}}` is the
   * number — and is exempt from the list wrap. `count` needs no field; the
   * rest reduce `field`. `filter` is the `query.filter` shape. The platform
   * serves it from `GET …/records/<type>/count` and `…/aggregate`, so a
   * counter on an intake collection does not list what it may not list, and
   * a public one does not hand every row to a stranger to count. Optional.
   * Read only on `kind: 'entity'` sources. `fn` is exactly what the platform
   * serves today; a published enum can widen later, never narrow.
   */
  aggregate: z
    .object({
      fn: z.enum(['count', 'sum', 'avg']),
      field: z.string().optional(),
      filter: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
})

// ============================================================
// SURFACE BEHAVIOR SCHEMA (event → actions)

/**
 * One action the runtime can dispatch. Mirrors the runtime `SurfaceAction`
 * union one-to-one; `navigate` URLs are guarded at dispatch (http(s)/relative).
 */
export const surfaceActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('setState'), key: z.string().min(1), value: z.unknown().optional() }),
  z.object({ type: z.literal('refresh'), sourceId: z.string().min(1) }),
  z.object({ type: z.literal('refreshAll') }),
  z.object({ type: z.literal('showBlock'), blockId: z.string().min(1) }),
  z.object({ type: z.literal('hideBlock'), blockId: z.string().min(1) }),
  z.object({ type: z.literal('navigate'), url: z.string().min(1) }),
  /**
   * Write ONE record of a source — create, update or delete (data-protocol
   * §1.3). `id` names the record of an update or a delete; `values` are the
   * fields of a create or an update. Both are resolved like the rest of the
   * action. Who may write is the server's access rules; after a successful
   * write every source is fetched again (`refreshAll`). `statusKeys` drives
   * page state like a form binding's (§4.2).
   */
  z.object({
    type: z.literal('write'),
    sourceId: z.string().min(1),
    op: z.enum(['create', 'update', 'delete']),
    id: z.union([z.string(), z.number()]).optional(),
    values: z.record(z.string(), z.unknown()).optional(),
    statusKeys: z
      .object({
        loading: z.string().min(1).optional(),
        success: z.string().min(1).optional(),
        error: z.string().min(1).optional(),
        reason: z.string().min(1).optional(),
        fields: z.string().min(1).optional(),
        detail: z.string().min(1).optional(),
      })
      .optional(),
  }),
  /**
   * The visitor's identity (session-protocol "identity on the page"): start
   * signing in — by `method` (`password`, a provider method, `issuer`) or the
   * host's choice — register, sign out. The host performs them; fired from a
   * form's submit, the form's values (`email`, `password`, `name`) go along.
   */
  z.object({ type: z.literal('auth:signIn'), method: z.string().min(1).optional() }),
  z.object({ type: z.literal('auth:register'), method: z.string().min(1).optional() }),
  z.object({ type: z.literal('auth:signOut') }),
])

/**
 * A behavior DECLARED by the surface (or brought in by a pattern): when
 * `event` fires — optionally only from `targetBlockId` — run `actions`.
 * Declaring behaviors in the document is what lets a pack ship one and a
 * composer write one. Declared behaviors live in `platform/persistence` config next to
 * `dataSources`/`initialState` (same state machinery) and merge with any
 * host-provided behaviors at render time.
 * `event` accepts canonical colon form (`block:click`) or legacy dot form.
 */
export const surfaceBehaviorSchema = z.object({
  id: z.string().min(1),
  event: z.string().min(1),
  targetBlockId: z.string().optional(),
  actions: z.array(surfaceActionSchema).min(1),
})

/**
 * Capability binding on a surface.
 *
 * `platform/persistence` capability config now carries
 * `dataSources` and `initialState` (moved off the surface root).
 */
export const capabilityBindingSchema = z.object({
  capability: z.string(),
  required: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})

// ============================================================
// SURFACE DOCUMENT SCHEMA (consolidated shape)

/**
 * Zod schema for a complete SurfaceDocument.
 *
 * Surface root holds ONLY declarations + references + metadata:
 *   - blocks         (UI tree — block atom refs by type)
 *   - appearance     (ui-appearance atom ref + config)
 *   - capabilities[] (capability bindings — persistence config holds
 *                     dataSources + initialState)
 *   - description/tags/thumbnailUrl (metadata)
 *
 * Retired from root (migrated):
 *   - theme          → surface.appearance.config.theme
 *   - styleVariables → surface.appearance.config.styleVariables
 *   - dataSources    → persistence capability config
 *   - initialState   → persistence capability config
 *
 * Used for validating surface definitions in persistence (surfaces.ts)
 * and for the context.surface field in composer routes.
 */
export const surfaceDocumentSchema = z.object({
  blocks: z.array(blockSnapshotSchema).optional().default([]),

  // appearance reference (replaces theme + styleVariables + layout roots)
  appearance: SurfaceAppearanceRefSchema.optional(),

  // Capability bindings — persistence config now holds dataSources + initialState
  capabilities: z.array(capabilityBindingSchema).optional(),

  // Metadata fields embedded in definition for round-trip preservation
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  thumbnailUrl: z.string().optional(),
})

/**
 * `surfaceDocumentSchema` plus the uniqueness rule: a `custom` issue at every
 * repeat AFTER the first (`['blocks', 2, 'id']` for the second copy of a
 * band). Opt-in for writers; readers keep `surfaceDocumentSchema`.
 */
export const surfaceDocumentStrictSchema = surfaceDocumentSchema.superRefine((doc, ctx) => {
  for (const dup of findDuplicateBlockIds(doc.blocks)) {
    for (const path of dup.paths.slice(1)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path,
        message: `Duplicate block id '${dup.id}' — every block in a surface needs its own id`,
      })
    }
  }
})
