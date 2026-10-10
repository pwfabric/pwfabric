/**
 * Per-breakpoint visibility CSS generation (the `hidden md:flex` equivalent).
 *
 * `block.layout.hideOn` / `block.layout.showOn` declare at which breakpoints a
 * block is hidden / the only breakpoints where it is visible. Inline styles
 * can't express media queries, so the runtime emits scoped CSS rules — keyed
 * by the block's `data-block-id` — into the surface's generated `<style>`
 * (alongside the box-sizing reset). The pixel thresholds are the SAME
 * `BREAKPOINTS[].minWidth` values the span system uses.
 *
 * Semantics:
 *   - `hideOn: ['xs','sm']` → hidden across the xs+sm ranges → hidden below the
 *     md threshold (768px) → `@media (max-width:767.98px){ display:none }`.
 *   - `showOn: ['lg','xl']` → visible ONLY in the lg+xl ranges → hidden below
 *     lg (1024px) AND at/above the breakpoint after xl (2xl = 1536px).
 *   - `showOn` is the inverse of `hideOn`; when both are present `showOn` wins.
 *
 * @module @pwfabric/runtime/render/visibility-css
 */

import type { Block } from '@pwfabric/core'
import { BREAKPOINTS, BREAKPOINT_ORDER } from '@pwfabric/core'
import type { BreakpointName } from '@pwfabric/core'
import { blockSelector, collectScopedCss } from './scoped-css.js'

/** Sub-pixel epsilon so `max-width` ranges don't overlap the next `min-width`. */
const MAX_EPSILON = 0.02

/** `[minWidth, maxExclusive)` pixel range a named breakpoint covers. */
function rangeFor(bp: BreakpointName): { min: number; maxExclusive: number } {
  const idx = BREAKPOINTS.findIndex((b) => b.name === bp)
  const def = BREAKPOINTS[idx]
  const next = BREAKPOINTS[idx + 1]
  return {
    min: def?.minWidth ?? 0,
    maxExclusive: next?.minWidth ?? Number.POSITIVE_INFINITY,
  }
}

/**
 * Resolve the SET of breakpoints at which a block must be hidden, given its
 * `hideOn` / `showOn` declarations. `showOn` takes precedence (the block is
 * hidden at every breakpoint NOT listed in `showOn`).
 */
export function resolveHiddenBreakpoints(
  hideOn: readonly BreakpointName[] | undefined,
  showOn: readonly BreakpointName[] | undefined
): BreakpointName[] {
  if (showOn && showOn.length > 0) {
    const visible = new Set(showOn)
    return BREAKPOINT_ORDER.filter((bp) => !visible.has(bp))
  }
  if (hideOn && hideOn.length > 0) {
    const hide = new Set(hideOn)
    return BREAKPOINT_ORDER.filter((bp) => hide.has(bp))
  }
  return []
}

/**
 * Collapse a set of hidden breakpoints into the minimal set of
 * `[min, maxExclusive)` pixel ranges (contiguous breakpoints merge).
 */
function collapseRanges(hidden: BreakpointName[]): { min: number; maxExclusive: number }[] {
  // Order by the canonical breakpoint order so contiguity is by ascending width.
  const ordered = BREAKPOINT_ORDER.filter((bp) => hidden.includes(bp))
  const out: { min: number; maxExclusive: number }[] = []
  for (const bp of ordered) {
    const r = rangeFor(bp)
    const last = out[out.length - 1]
    if (last && last.maxExclusive === r.min) {
      last.maxExclusive = r.maxExclusive // contiguous → extend
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** Build a single `@media` condition for a `[min, maxExclusive)` range. */
function mediaCondition(min: number, maxExclusive: number): string {
  const parts: string[] = []
  if (min > 0) parts.push(`(min-width:${min}px)`)
  if (Number.isFinite(maxExclusive)) parts.push(`(max-width:${maxExclusive - MAX_EPSILON}px)`)
  return parts.join(' and ')
}

/**
 * Emit the CSS rule(s) that hide a single block at the resolved breakpoints.
 * Targets `[data-block-id="<id>"]` scoped under the surface root so it cannot
 * leak to the host page. Uses `!important` so the rule beats the inline layout
 * style (`display:grid`/flex on the wrapper) it must override.
 *
 * Returns '' when there is nothing to hide.
 */
export function blockVisibilityCss(
  blockId: string,
  hidden: BreakpointName[],
  surfaceId?: string
): string {
  if (hidden.length === 0) return ''
  const ranges = collapseRanges(hidden)
  // The whole spectrum is hidden (no showOn match anywhere): unconditional hide.
  const everything = ranges.length === 1 && ranges[0]!.min === 0 && !Number.isFinite(ranges[0]!.maxExclusive)
  const selector = blockSelector(blockId, surfaceId)
  if (everything) {
    return `${selector}{display:none !important}`
  }
  return ranges
    .map((r) => {
      const cond = mediaCondition(r.min, r.maxExclusive)
      return `@media ${cond}{${selector}{display:none !important}}`
    })
    .join('')
}

/**
 * Walk a surface block tree and concatenate the per-block visibility CSS for
 * every block declaring `hideOn` / `showOn`. Blocks without either are skipped
 * (zero bytes emitted) so existing surfaces are byte-identical.
 */
export function collectVisibilityCss(blocks: readonly Block[], surfaceId?: string): string {
  return collectScopedCss(blocks, (block) => {
    const layout = block.layout as
      | { hideOn?: readonly BreakpointName[]; showOn?: readonly BreakpointName[] }
      | undefined
    if (layout && (layout.hideOn?.length || layout.showOn?.length)) {
      const hidden = resolveHiddenBreakpoints(layout.hideOn, layout.showOn)
      return blockVisibilityCss(block.id, hidden, surfaceId)
    }
    return ''
  })
}
