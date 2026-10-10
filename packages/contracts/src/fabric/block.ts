/**
 * Canonical Block Type
 *
 * SurfaceDocument Canonical Type System.
 *
 * A Block is the atomic composable unit within a surface.
 * This type is the single source of truth for block instance shape,
 * shared across @pwfabric/core, @pwfabric/runtime, and the host's API.
 *
 * @module @pwfabric/contracts/fabric/block
 */

import type { BlockLayout, ResponsiveValue } from './layout.js'

/**
 * A concrete block instance within a surface.
 *
 * Invariants:
 * - `id` is unique within the surface tree
 * - `type` references a registered BlockDefinition
 * - `props` contains semantic and behavioral values (not visual styles)
 * - `style` contains CSS camelCase overrides at cascade Layer 4
 * - `layout` holds responsive grid metadata
 * - `children` is present only when the block type supports nesting
 */
export interface Block {
  /** Unique instance identifier */
  readonly id: string

  /** Block type identifier (references BlockDefinition.type) */
  readonly type: string

  /** Block properties — semantic and behavioral values only */
  readonly props: Record<string, unknown>

  /**
   * Visual style overrides
   *
   * CSS camelCase property names mapped either to a flat CSS string value OR
   * to a per-breakpoint `ResponsiveValue<string>` map (`{ xs?, sm?, md?, lg?,
   * xl?, '2xl'? }`). Sits at cascade Layer 4 — highest priority above surface
   * theme. Deleting a property restores CSS cascade inheritance automatically.
   *
   * Responsive values: inline styles can't express media queries, so for a
   * prop whose value is a `{ xs?, … }` map the runtime renders the base (xs /
   * smallest defined) value inline and emits scoped per-breakpoint media-query
   * CSS — keyed by the block's `data-block-id` — that overrides upward (the
   * same mechanism `layout.hideOn`/`showOn` and `block.states` use). Flat
   * string values are rendered inline unchanged.
   *
   * @example { borderRadius: '0', backgroundColor: '#ff0000' }
   * @example { padding: { xs: '8px', md: '24px', lg: '48px' } }
   */
  readonly style?: Readonly<Record<string, string | ResponsiveValue<string>>>

  /**
   * Interaction-state styling (token-driven hover/active/focus).
   *
   * `block.style` sits inline and cannot express pseudo-classes, so per-state
   * CSS lives here and the runtime emits SCOPED rules keyed by the block's
   * stable `data-block-id` (the same mechanism `layout.hideOn`/`showOn` use):
   *   `[data-pw-surface] [data-block-id="<id>"]:hover{…}`
   *   `…:active{…}`
   *   `…:focus-visible{…}`  (focus applied via `:focus-visible`)
   *
   * This is the semantic, rebrandable alternative to Tailwind `hover:`/`active:`
   * variants. Keys are CSS camelCase property names; values may be
   * `var(--pw-*)` token refs or literals. When present, the runtime also adds a
   * default `transition` to the block's base style so state changes animate
   * (neutralised under `prefers-reduced-motion`).
   *
   * @example { hover: { backgroundColor: 'var(--pw-color-primary-subtle)' } }
   */
  readonly states?: {
    readonly hover?: Readonly<Record<string, string>>
    readonly active?: Readonly<Record<string, string>>
    /** Applied via `:focus-visible` (keyboard focus only). */
    readonly focus?: Readonly<Record<string, string>>
  }

  /**
   * Conditional-state styling (aria/data/disabled/checked/`:has(…)` variants).
   *
   * The fixed `states` field only covers the three interaction pseudo-classes
   * (`:hover`/`:active`/`:focus-visible`). This array covers everything else a
   * block can style by STATE without JS: form pseudo-classes (`:disabled`,
   * `:checked`, `:invalid`, `:required`, `:read-only`), ARIA reflections
   * (`[aria-expanded="true"]`, `[aria-current="page"]`), `data-*` flags
   * (`[data-active]`), and structural `:has(…)` / sibling-combinator rules.
   *
   * Each entry's `selector` is a CSS suffix APPENDED to the block selector — the
   * runtime emits `[data-pw-surface] [data-block-id="<id>"]<selector>{…}`. The
   * suffix MUST start with one of `:` `[` `>` `+` `~` or whitespace (anything
   * else is skipped so a bare selector can never leak to the host page). Keys
   * are CSS camelCase property names; values may be `var(--pw-*)` token refs or
   * literals. Declarations are emitted with `!important` so they override a
   * block component's inline defaults (inline beats any plain stylesheet rule).
   *
   * @example { selector: ':disabled', style: { opacity: '0.5', cursor: 'not-allowed' } }
   * @example { selector: '[aria-expanded="true"]', style: { backgroundColor: 'var(--pw-color-primary-subtle)' } }
   * @example { selector: ':has(> img)', style: { padding: '0' } }
   */
  readonly conditionalStates?: ReadonlyArray<{
    readonly selector: string
    readonly style: Readonly<Record<string, string>>
  }>

  /**
   * Marks this block as a `group` ROOT — a hover on this block restyles
   * descendants that declare `groupStates` (the semantic, rebrandable
   * equivalent of Tailwind's `group` + `group-hover:` pattern).
   *
   * The runtime emits a scoped descendant rule keyed by the root's
   * `data-block-id`:
   *   `[data-pw-surface] [data-block-id="<rootId>"]:hover [data-block-id="<descId>"]{…}`
   * so the host element already rendered for every block (`data-block-id`)
   * is sufficient — no extra attribute is needed.
   */
  readonly groupRoot?: boolean

  /**
   * Group-state styling: declarations applied to THIS block when its nearest
   * ancestor marked `groupRoot` is hovered (Tailwind `group-hover:`).
   *
   * Keys are CSS camelCase property names; values may be `var(--pw-*)` token
   * refs or literals. Emitted with `!important` (scoped to the block) so it
   * beats a block component's inline defaults. Has effect only when an ancestor
   * declares `groupRoot: true`.
   *
   * @example { hover: { transform: 'scale(1.05)', boxShadow: 'var(--pw-shadow-lg)' } }
   */
  readonly groupStates?: {
    readonly hover?: Readonly<Record<string, string>>
  }

  /** Responsive layout metadata */
  readonly layout: BlockLayout

  /**
   * Conditional visibility expression. The renderer (resolve-expressions)
   * hides this block when the expression (e.g. "{{state.formOpen}}") resolves
   * falsy. `visibleWhen` and `if` are aliases; `visibleWhen` wins if both set.
   */
  readonly visibleWhen?: string

  /** Alias of `visibleWhen` (conditional visibility). */
  readonly if?: string

  /**
   * Item-template expansion expression. When set (e.g. "{{products}}"), the
   * renderer (resolve-expressions) resolves it to an array and renders this
   * block's `children` once per element, with `{{item.*}}` and `{{index}}` in
   * scope; cloned child ids get a `--<index>` suffix. A non-array result
   * renders no children. Without `repeat`, children render as authored.
   */
  readonly repeat?: string

  /** Optional nested children */
  readonly children?: readonly Block[]
}
