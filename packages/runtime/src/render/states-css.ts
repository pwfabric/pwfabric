/**
 * Interaction-state CSS generation (token-driven hover/active/focus).
 *
 * `block.style` sits inline and cannot express pseudo-classes, so per-state
 * styling lives in `block.states` and the runtime emits scoped CSS rules —
 * keyed by the block's `data-block-id` — into the surface's generated
 * `<style>` (the SAME mechanism `layout.hideOn`/`showOn` use). For a block
 * with `states`, the runtime emits:
 *
 *   `[data-pw-surface] [data-block-id="<id>"]:hover{ … }`
 *   `[data-pw-surface] [data-block-id="<id>"]:active{ … }`
 *   `[data-pw-surface] [data-block-id="<id>"]:focus-visible{ … }`
 *
 * Keys are CSS camelCase property names (converted to kebab-case); values pass
 * through untouched, so `var(--pw-color-primary-subtle)` works. Blocks without
 * `states` emit zero bytes so existing surfaces are byte-identical.
 *
 * @module @pwfabric/runtime/render/states-css
 */

import type { Block } from '@pwfabric/core'
import { blockSelector, camelToKebab, collectScopedCss } from './scoped-css.js'

/** Pseudo-state → selector suffix. `focus` maps to `:focus-visible`. */
const STATE_SELECTORS: Record<'hover' | 'active' | 'focus', string> = {
  hover: ':hover',
  active: ':active',
  focus: ':focus-visible',
}

/** Serialize a camelCase decl record to `prop:value;…` (values pass through). */
function declsToCss(decls: Readonly<Record<string, string>>): string {
  return Object.entries(decls)
    .map(([prop, value]) => `${camelToKebab(prop)}:${value}`)
    .join(';')
}

/**
 * Emit the scoped CSS rule(s) for a single block's interaction states. Targets
 * `[data-block-id="<id>"]<pseudo>` scoped under the surface root so it cannot
 * leak to the host page. Returns '' when the block declares no non-empty state.
 */
export function blockStatesCss(
  blockId: string,
  states: NonNullable<Block['states']>,
  surfaceId?: string
): string {
  const selector = blockSelector(blockId, surfaceId)
  let css = ''
  for (const key of ['hover', 'active', 'focus'] as const) {
    const decls = states[key]
    if (!decls || Object.keys(decls).length === 0) continue
    // `data-block-id` lives on BOTH the renderer wrapper and the component root
    // (the wrapper keeps `data-block-wrapper`). A state rule keyed on the bare
    // id therefore fired twice: the square wrapper took the hover box-shadow
    // (square corners bleeding out from under a rounded card) and transforms
    // compounded. Exclude the wrapper — visual states belong to the styled
    // component root only.
    css += `${selector}:not([data-block-wrapper])${STATE_SELECTORS[key]}{${declsToCss(decls)}}`
  }
  return css
}

/**
 * Walk a surface block tree and concatenate the per-block interaction-state CSS
 * for every block declaring `states`. Blocks without `states` are skipped (zero
 * bytes emitted) so existing surfaces are byte-identical.
 */
export function collectStatesCss(blocks: readonly Block[], surfaceId?: string): string {
  return collectScopedCss(blocks, (block) =>
    block.states ? blockStatesCss(block.id, block.states, surfaceId) : ''
  )
}
