/**
 * Conditional-state CSS generation (aria/data/disabled/checked/`:has(…)` variants).
 *
 * `block.style` sits inline and cannot express pseudo-classes or attribute
 * selectors, and the fixed `block.states` field only covers the three
 * interaction pseudo-classes (`:hover`/`:active`/`:focus-visible`). Everything
 * else a block can style by STATE without JS — form pseudo-classes
 * (`:disabled`, `:checked`, `:invalid`, `:required`), ARIA reflections
 * (`[aria-expanded="true"]`), `data-*` flags (`[data-active]`), and structural
 * `:has(…)` / sibling rules — lives in `block.conditionalStates`. Each entry's
 * `selector` is a CSS suffix APPENDED to the block selector, so the runtime
 * emits:
 *
 *   `[data-pw-surface] [data-block-id="<id>"]:disabled{ … }`
 *   `[data-pw-surface] [data-block-id="<id>"][aria-expanded="true"]{ … }`
 *   `[data-pw-surface] [data-block-id="<id>"]:has(> img){ … }`
 *
 * Keys are CSS camelCase property names (converted to kebab-case); declarations
 * are emitted with `!important` because a block COMPONENT often applies the same
 * CSS property inline with its own default, and inline beats any plain
 * stylesheet rule. Scoped to `[data-block-id]`, so it only overrides the one
 * block. Blocks without `conditionalStates` emit zero bytes so existing surfaces
 * are byte-identical.
 *
 * @module @pwfabric/runtime/render/conditional-states-css
 */

import type { Block } from '@pwfabric/core'
import { blockSelector, camelToKebab, collectScopedCss } from './scoped-css.js'

/** Serialize a camelCase decl record to `prop:value !important;…` (values pass through). */
function declsToCss(decls: Readonly<Record<string, string>>): string {
  return Object.entries(decls)
    .map(([prop, value]) => `${camelToKebab(prop)}:${value} !important`)
    .join(';')
}

/**
 * A conditional-state selector must be a SUFFIX that attaches directly to the
 * block selector — never a bare/standalone selector that could match (and leak
 * to) unrelated elements on the host page. Valid first characters:
 *   `:` pseudo-class/element (`:disabled`, `:has(…)`)
 *   `[` attribute selector (`[aria-expanded="true"]`, `[data-active]`)
 *   `>` `+` `~` combinators (`> img`, `+ .x`, `~ .y`)
 *   whitespace — descendant combinator (` .child`)
 * Anything else (a bare `.class`, `div`, `*`, empty string) is rejected.
 */
function isValidSuffixSelector(selector: string): boolean {
  if (typeof selector !== 'string' || selector.length === 0) return false
  const first = selector.charAt(0)
  return first === ':' || first === '[' || first === '>' || first === '+' || first === '~' || /\s/.test(first)
}

/**
 * Emit the scoped CSS rule(s) for a single block's conditional states. Targets
 * `[data-block-id="<id>"]<selector>` scoped under the surface root so it cannot
 * leak to the host page. Entries with a malformed `selector` (not a valid
 * suffix) or an empty `style` record are skipped. Returns '' when the block
 * declares no usable conditional state.
 */
export function blockConditionalStatesCss(
  blockId: string,
  conditionalStates: NonNullable<Block['conditionalStates']>,
  surfaceId?: string
): string {
  const selector = blockSelector(blockId, surfaceId)
  let css = ''
  for (const entry of conditionalStates) {
    if (!entry || !isValidSuffixSelector(entry.selector)) continue
    const decls = entry.style
    if (!decls || Object.keys(decls).length === 0) continue
    // Same wrapper-exclusion as states-css: the id matches two elements; the
    // visual rule must land on the component root, not the square wrapper.
    css += `${selector}:not([data-block-wrapper])${entry.selector}{${declsToCss(decls)}}`
  }
  return css
}

/**
 * Walk a surface block tree and concatenate the per-block conditional-state CSS
 * for every block declaring `conditionalStates`. Blocks without it are skipped
 * (zero bytes emitted) so existing surfaces are byte-identical.
 */
export function collectConditionalStatesCss(blocks: readonly Block[], surfaceId?: string): string {
  return collectScopedCss(blocks, (block) =>
    block.conditionalStates
      ? blockConditionalStatesCss(block.id, block.conditionalStates, surfaceId)
      : ''
  )
}
