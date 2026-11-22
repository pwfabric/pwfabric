/**
 * Expression Resolution for Block Props
 *
 * Resolves {{expression}} placeholders in block prop values.
 * Uses the existing expression engine (evaluate/interpolate) from surface/expression.
 *
 * Key behavior:
 * - Whole-value: "{{items}}" returns raw value (array, object, etc.)
 * - String interpolation: "Total: {{count}}" returns interpolated string
 * - Recursively walks block tree and nested objects/arrays in props
 * - A prop the block's manifest declares `bindable: false` is a literal: it is
 *   left exactly as written, nested values included (block-manifest, "Prop
 *   descriptor"). A prop with no declaration is bindable.
 *
 * @module @pwfabric/runtime/render/resolve-expressions
 */

import type { Block } from '@pwfabric/core'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import { BREAKPOINT_ORDER } from '@pwfabric/core'
import { evaluate, interpolate, createExpressionContext } from '../surface/expression.js'
import type { ExpressionContext } from '../surface/expression.js'
import { isExpressionLink, isLinkMember, safeDataLink, type LinkHref } from './links.js'

/**
 * The expression scope plus how this page writes an in-app link. Carried in
 * the context so a repeat's per-row context (`{ ...context, data }`) keeps it.
 */
type ResolveContext = ExpressionContext & {
  readonly linkHref?: LinkHref
  readonly literalProps?: LiteralProps
  /** Inside a `repeat`: the innermost row and its index (see rowScopeOf). */
  readonly row?: RowScope
}

/** The row a block inside a `repeat` was drawn for: `item` and `index`, the names its props read. */
export interface RowScope {
  readonly item: unknown
  readonly index: number
}

/** Block type → the names of its props that take a literal only (`bindable: false`). */
export type LiteralProps = ReadonlyMap<string, ReadonlySet<string>>

/**
 * The literal props of each block type, read from the descriptors the host
 * hands the renderer (`blocks/manifest.json` entries): every prop whose
 * `definition.props` entry says `bindable: false`. A type with none is left
 * out, so its props all resolve.
 */
export function literalPropsOf(descriptors: Iterable<DynamicBlockDescriptor>): Map<string, ReadonlySet<string>> {
  const out = new Map<string, ReadonlySet<string>>()
  for (const d of descriptors) {
    const names = (d.definition.props ?? []).filter((p) => p.bindable === false).map((p) => p.name)
    if (names.length > 0) out.set(d.blockType, new Set(names))
  }
  return out
}

// ============================================================
// WHOLE-VALUE PATTERN
// ============================================================

/**
 * Matches a string that is exactly one expression placeholder with no surrounding text.
 * e.g. "{{products}}" or "{{ state.x === 'a' ? 'primary' : 'outline' }}"
 * The inner capture uses a negative lookahead to prevent matching across }} boundaries,
 * so "{{a}} · {{b}}" is NOT treated as a whole-value expression.
 */
const WHOLE_VALUE_PATTERN = /^\{\{((?:(?!\}\}).)+)\}\}$/s

/**
 * Matches strings that contain at least one expression placeholder.
 *
 * These two patterns are the test for "a string that resolves". `pwf
 * validate` mirrors them (@pwfabric/pack, block-props.ts `isTemplate`) to warn
 * about a template on a `bindable: false` prop; change both together.
 */
const HAS_EXPRESSION_PATTERN = /\{\{.+?\}\}/

// ============================================================
// STRING RESOLUTION
// ============================================================

/**
 * Resolve a single string value.
 *
 * - If the string is exactly "{{expr}}", evaluate and return the raw value (preserving type).
 * - If the string contains embedded "{{expr}}", interpolate and return a string.
 * - Otherwise return as-is.
 */
export function resolveString(value: string, context: ExpressionContext): unknown {
  // Check for whole-value expression first
  const wholeMatch = WHOLE_VALUE_PATTERN.exec(value)
  if (wholeMatch) {
    const expr = (wholeMatch[1] ?? '').trim()
    const result = evaluate(expr, context)
    if (result.success) {
      return result.value
    }
    // On failure, return original string as fallback
    return value
  }

  // Check for embedded expressions
  if (HAS_EXPRESSION_PATTERN.test(value)) {
    const result = interpolate(value, context)
    if (result.success) {
      return result.value
    }
    // On failure, return original string as fallback
    return value
  }

  // No expressions, return as-is
  return value
}

// ============================================================
// PROP VALUE RESOLUTION
// ============================================================

/**
 * Recursively resolve expressions in a prop value.
 * - Strings are checked for expressions
 * - Arrays and plain objects are traversed
 * - Other types pass through unchanged
 */
function resolveValue(value: unknown, context: ResolveContext): unknown {
  if (typeof value === 'string') {
    return resolveString(value, context)
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context))
  }

  if (value !== null && typeof value === 'object') {
    const resolved: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveValue(val, context)
      // A link whose page is an expression (`href: "{{item.url}}"`) was left
      // as written by the host; now that its value is known, it is written in
      // the active router's form. Its value came from DATA, so it must be a
      // link and nothing else: `javascript:alert(1)` in a row is dropped and
      // the link has no href (safeDataLink). FAIL CLOSED: a value that is not
      // a string (a list, an object, a number, undefined while loading) is
      // no link either. Only a link that did not resolve — the template
      // left as written — stays as it is.
      const href = resolved[key]
      if (
        typeof val === 'string' &&
        href !== val &&
        isExpressionLink(val) &&
        isLinkMember(key, value as Record<string, unknown>)
      ) {
        const safe = typeof href === 'string' ? safeDataLink(href) : undefined
        resolved[key] = safe === undefined ? undefined : context.linkHref ? context.linkHref(safe) : safe
      }
    }
    return resolved
  }

  return value
}

/**
 * Resolve a value outside the block tree — an action, a link — against `data`
 * (the page scope, plus whatever the caller adds: `result` after a write),
 * with the same rules as a block prop: whole values keep their type, a link
 * member whose page is an expression is checked (safeDataLink) and written in
 * the router's form.
 */
export function resolveValueIn(
  value: unknown,
  data: Record<string, unknown>,
  options: {
    readonly linkHref?: LinkHref
    readonly locale?: string
    /** More helpers: the app's words, `t(id, vars?)` (messageHelpers). */
    readonly helpers?: Record<string, (...args: unknown[]) => unknown>
  } = {}
): unknown {
  const context: ResolveContext = {
    ...createExpressionContext(data, options.helpers, options.locale),
    ...(options.linkHref ? { linkHref: options.linkHref } : {}),
  }
  return resolveValue(value, context)
}

/**
 * A link template (`/confirmation?id={{result.id}}`, `{{item.url}}`)
 * resolved against `data`. A template whose page is an expression must come
 * out as a safe link (safeDataLink), else `undefined`; one that names its
 * page is the author's and only its expressions are filled in.
 */
export function resolveLinkTemplate(
  template: string,
  data: Record<string, unknown>,
  linkHref?: LinkHref
): string | undefined {
  const resolved = resolveValueIn({ successRedirect: template }, data, linkHref ? { linkHref } : {}) as {
    successRedirect?: unknown
  }
  const out = resolved.successRedirect
  if (typeof out !== 'string') return undefined
  // An unresolvable expression is left as written; a link with braces in it
  // goes nowhere useful.
  return /\{\{/.test(out) ? undefined : out
}

// ============================================================
// BLOCK EXPRESSION RESOLUTION
// ============================================================

/**
 * Resolve all {{expression}} placeholders in a block tree.
 *
 * Creates a deep copy of the blocks with all string prop values
 * containing expressions resolved against the provided data context.
 *
 * @param blocks - Block array to resolve
 * @param data - Data context (keyed by source ID, plus 'state')
 * @param helpers - Optional additional helper functions
 * @param options.linkHref - Writes a resolved in-app link in the host's router
 *   form; applied to links whose page is an expression (see links.ts)
 * @param options.literalProps - Per block type, the props left as written
 *   (`bindable: false`; see literalPropsOf)
 * @param options.locale - The app's locale (BCP 47) dates and numbers are
 *   written in; absent, the visitor's
 * @returns New block array with resolved prop values
 */
export function resolveBlockExpressions(
  blocks: readonly Block[],
  data: Record<string, unknown>,
  helpers?: Record<string, (...args: unknown[]) => unknown>,
  options: { readonly linkHref?: LinkHref; readonly literalProps?: LiteralProps; readonly locale?: string } = {}
): Block[] {
  const context: ResolveContext = {
    ...createExpressionContext(data, helpers, options.locale),
    ...(options.linkHref ? { linkHref: options.linkHref } : {}),
    ...(options.literalProps && options.literalProps.size > 0 ? { literalProps: options.literalProps } : {}),
  }
  return blocks
    .map((block) => resolveBlock(block, context, false))
    .filter((b): b is Block => b !== null)
}

/**
 * A block may carry a conditional-visibility expression — `visibleWhen` (or the
 * shorthand `if`) — a template string evaluated against surface state/data. When
 * it resolves falsy the block (and its subtree) is omitted from the render
 * entirely. This drives state-driven UI in the blocks-array receipt path:
 * form↔success toggles, wizard steps, "show X only when {{state.y}}". The
 * companion is a `setState` action (e.g. a form's onSubmitAction) flipping state.
 *
 * Falsy = empty string, 'false', 'undefined', 'null', '0', NaN or a falsy primitive.
 */
function isFalsyCondition(value: unknown): boolean {
  if (value == null || value === false) return true
  if (typeof value === 'string') {
    const t = value.trim().toLowerCase()
    return t === '' || t === 'false' || t === 'undefined' || t === 'null' || t === '0'
  }
  if (typeof value === 'number') return value === 0 || Number.isNaN(value)
  return false
}

/**
 * Evaluate a `visibleWhen` / `if` condition. Unlike a prop, a condition that
 * cannot be evaluated has NO fallback value: a prop keeps its raw template so
 * the author can see it, but a raw template in a condition is a non-empty
 * string — truthy — and the block would show forever (a "no results" empty
 * state beside the results). FAIL CLOSED: not evaluable means hidden.
 */
function evaluateCondition(
  condition: string,
  context: ExpressionContext
): { ok: true; value: unknown } | { ok: false; error: string } {
  const whole = WHOLE_VALUE_PATTERN.exec(condition)
  if (whole) {
    const r = evaluate((whole[1] ?? '').trim(), context)
    return r.success ? { ok: true, value: r.value } : { ok: false, error: r.error }
  }
  if (HAS_EXPRESSION_PATTERN.test(condition)) {
    const r = interpolate(condition, context)
    return r.success ? { ok: true, value: r.value } : { ok: false, error: r.error }
  }
  return { ok: true, value: condition }
}

/** One warning per block + condition, not one per render. */
const warnedConditions = new Set<string>()

function warnUnevaluable(blockId: string, condition: string, error: string): void {
  const nodeEnv = typeof process !== 'undefined' ? process.env?.['NODE_ENV'] : undefined
  if (nodeEnv === 'production') return
  const key = `${blockId}|${condition}`
  if (warnedConditions.has(key)) return
  if (warnedConditions.size > 500) warnedConditions.clear()
  warnedConditions.add(key)
  console.warn(
    `[surface] block "${blockId}": visibleWhen ${JSON.stringify(condition)} could not be evaluated, so the block is HIDDEN. ${error}`
  )
}

/** The block that gathers its descendants' fields into one submission. */
function isFormBlock(block: Block): boolean {
  const type = String((block as { type?: unknown }).type ?? '')
  return type === 'form' || type.endsWith('/form')
}

/** `layout.hidden` is responsive; every breakpoint, so no authored one wins. */
const HIDDEN_AT_EVERY_BREAKPOINT: Readonly<Record<string, boolean>> = Object.freeze(
  Object.fromEntries(BREAKPOINT_ORDER.map((bp) => [bp, true]))
)

/**
 * Hidden but still mounted: the wrapper gets `display: none` through the
 * block's own layout (`layout.hidden`, the same switch the responsive layout
 * uses), so the renderer keeps the subtree — and its inputs — in the DOM.
 */
function hideInPlace(block: Block): Block {
  const layout = block.layout as unknown as Record<string, unknown> | undefined
  return { ...block, layout: { ...(layout ?? {}), hidden: HIDDEN_AT_EVERY_BREAKPOINT } } as Block
}

/**
 * Resolve expressions in a single block and its children recursively.
 * Returns null when the block's `visibleWhen`/`if` condition resolves falsy
 * (or cannot be evaluated — see evaluateCondition).
 *
 * A reserved surface-state key `__show:<blockId>` (written by `showBlock`/
 * `hideBlock` actions) acts as a visibility OVERRIDE that is checked BEFORE
 * the `visibleWhen`/`if` template evaluation:
 *   - `true`  → block is forced VISIBLE (visibleWhen/if skipped)
 *   - `false` → block is forced HIDDEN
 *   - absent  → fall through to the visibleWhen/if logic
 *
 * The key is read directly from the context data (not via the template
 * evaluator) because the colon in `__show:<id>` breaks the path grammar.
 *
 * INSIDE A FORM, HIDDEN MEANS HIDDEN — NOT UNMOUNTED. A wizard is
 * one `form` whose steps are sections gated by `visibleWhen: {{state.step == N}}`.
 * The form block gathers its values from the DOM (`new FormData(form)`), so an
 * unmounted step contributed nothing: the RSVP wizard submitted an empty
 * record, and going "back" remounted step 1 with empty inputs. A block under a
 * form is therefore kept in the tree with `layout.hidden` (display:none) — its
 * inputs keep their values and stay part of the submission. The form itself,
 * and everything outside forms, still unmounts as before.
 */
function resolveBlock(block: Block, context: ResolveContext, insideForm: boolean): Block | null {
  const stateMap = context.data['state'] as Record<string, unknown> | undefined
  const override = stateMap?.[`__show:${block.id}`]
  let hidden = override === false
  if (override !== true && override !== false) {
    const condition = (block as { visibleWhen?: unknown; if?: unknown }).visibleWhen
      ?? (block as { visibleWhen?: unknown; if?: unknown }).if
    if (typeof condition === 'string' && condition.trim()) {
      const r = evaluateCondition(condition, context)
      if (!r.ok) {
        warnUnevaluable(block.id, condition, r.error)
        hidden = true
      } else if (isFalsyCondition(r.value)) {
        hidden = true
      }
    }
  }
  if (hidden && !insideForm) return null

  const resolved = resolveVisibleBlock(block, context, insideForm || isFormBlock(block))
  return hidden ? hideInPlace(resolved) : resolved
}

function resolveVisibleBlock(block: Block, context: ResolveContext, insideForm: boolean): Block {
  const resolvedProps = block.props ? resolveProps(block, block.props, context) : block.props

  // Item-template expansion (repeat + {{item.*}} scope): a block carrying a
  // block-level `repeat` expression treats its authored children as a PER-ITEM
  // TEMPLATE. The binding resolves to an array; for each element the template
  // subtree is cloned and re-resolved with `item` and `index` added to the
  // expression context — so `{{item.Title}}` / `{{index}}` resolve per row.
  // Cloned block ids get a `--<index>` suffix (unique React keys /
  // data-block-id). Without `repeat` nothing changes (children resolve
  // normally, byte-identical to the previous behavior); a non-array binding
  // (source still loading) expands to zero children rather than leaking the
  // raw template. First consumer: the repeater block family — but the
  // contract is deliberately block-agnostic (a plain container can repeat).
  const repeatExpr = (block as { repeat?: unknown }).repeat
  if (typeof repeatExpr === 'string' && repeatExpr.trim() && block.children?.length) {
    const resolved = resolveValue(repeatExpr, context)
    const items = Array.isArray(resolved) ? resolved : []
    const template = block.children
    const expanded: Block[] = []
    for (let index = 0; index < items.length; index++) {
      const itemContext: ResolveContext = {
        ...context,
        data: { ...context.data, item: items[index], index },
        row: { item: items[index], index },
      }
      for (const child of template) {
        const clone = resolveBlock(suffixIds(child, index), itemContext, insideForm)
        if (clone) expanded.push(clone)
      }
    }
    const { repeat: _repeat, ...rest } = block as Block & { repeat?: unknown }
    return withRow(markRepeatExpanded({ ...(rest as Block), props: resolvedProps, children: expanded }), context.row)
  }

  if (block.children) {
    return withRow(
      {
        ...block,
        props: resolvedProps,
        children: block.children
          .map((child) => resolveBlock(child, context, insideForm))
          .filter((b): b is Block => b !== null),
      },
      context.row
    )
  }

  return withRow(
    {
      ...block,
      props: resolvedProps,
    },
    context.row
  )
}

/**
 * A BLOCK DRAWN FOR A ROW REMEMBERS THE ROW (envelope, behaviors).
 *
 * A block's props read `{{item.*}}` and `{{index}}` inside a `repeat`; a
 * behavior aimed at that block is resolved when its event fires, against the
 * page scope — which has no `item`, so a per-row write (delete this cart
 * line) could not be said. The resolved block carries its row under a symbol
 * key (it survives spread, never reaches JSON, like REPEAT_EXPANDED), and the
 * dispatcher adds `item` and `index` to a behavior's scope from the block
 * the event came from (`rowScopeOf`). In a nested repeat it is the innermost
 * row, the one the block's own props read.
 */
const ROW_SCOPE: unique symbol = Symbol.for('pwfabric.rowScope')

function withRow(block: Block, row: RowScope | undefined): Block {
  return row ? ({ ...block, [ROW_SCOPE]: row } as Block) : block
}

/** The row a resolved block was drawn for, or undefined outside a `repeat`. */
export function rowScopeOf(block: Block | undefined): RowScope | undefined {
  return (block as { [ROW_SCOPE]?: RowScope } | undefined)?.[ROW_SCOPE]
}

/**
 * A block's props, resolved — except those its manifest declares
 * `bindable: false`, which are copied as written: a code sample that shows
 * `{{state.x}}` must show those braces, not the value.
 */
function resolveProps(block: Block, props: Record<string, unknown>, context: ResolveContext): Record<string, unknown> {
  const literal = context.literalProps?.get(block.type)
  if (!literal) return resolveValue(props, context) as Record<string, unknown>
  const bound: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(props)) if (!literal.has(key)) bound[key] = val
  const resolved = resolveValue(bound, context) as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(props)) out[key] = literal.has(key) ? val : resolved[key]
  return out
}

/**
 * THE BLOCK THAT EXPANDED A REPEAT OWNS ITS CLONES' LAYOUT.
 *
 * `repeat` is stripped from the resolved block, so the renderer could no
 * longer tell a repeater from any other parent: every clone got the surface
 * default `gridColumn: span 12`, and inside the repeater's own grid
 * (`repeat(auto-fit, minmax(…))`) a 12-column span put each item on a row of
 * its own — every repeater wall rendered as one column. The mark survives
 * object spread (an own enumerable symbol key) and never reaches JSON, so the
 * surface document is unchanged; the renderer reads it through
 * `isRepeatExpanded` and leaves the clones to the parent's own grid.
 */
const REPEAT_EXPANDED: unique symbol = Symbol.for('pwfabric.repeatExpanded')

function markRepeatExpanded(block: Block): Block {
  return { ...block, [REPEAT_EXPANDED]: true } as Block
}

/** True when this resolved block expanded a `repeat` — its children are clones. */
export function isRepeatExpanded(block: Block | undefined): boolean {
  return (block as { [REPEAT_EXPANDED]?: unknown } | undefined)?.[REPEAT_EXPANDED] === true
}

/**
 * Deep-clone a template subtree, suffixing every block id with `--<index>` so
 * expanded clones stay unique across rows (React keys, data-block-id lookups,
 * label htmlFor targets).
 */
function suffixIds(block: Block, index: number): Block {
  return {
    ...block,
    id: `${block.id}--${index}`,
    ...(block.children
      ? { children: block.children.map((c) => suffixIds(c, index)) }
      : {}),
  }
}
