/**
 * Per-prop responsive style CSS generation (block.style values vary by breakpoint).
 *
 * `block.style` sits inline and can express a single value per property; it
 * cannot express media queries. A style prop whose value is a
 * `ResponsiveValue<string>` map (`{ xs?, sm?, md?, lg?, xl?, '2xl'? }`) instead
 * of a flat string declares a value that varies per breakpoint. The renderer
 * flattens the base (`xs` / smallest defined) value inline so SSR / no-JS get a
 * sane default; this collector emits the LARGER-breakpoint values as scoped,
 * mobile-first `min-width` media-query rules — keyed by the block's
 * `data-block-id` — that override upward. Same mechanism `layout.hideOn`/
 * `showOn` (visibility-css) and `block.states` (states-css) use.
 *
 * For a block with `style.padding = { xs:'8px', md:'24px', lg:'48px' }`:
 *
 *   `@media (min-width:768px){[data-pw-surface] [data-block-id="<id>"]{padding:24px}}`
 *   `@media (min-width:1024px){[data-pw-surface] [data-block-id="<id>"]{padding:48px}}`
 *
 * The `xs` (base) value is NOT emitted here — it is rendered inline by the
 * renderer. Flat string values emit zero bytes (the inline path owns them).
 * Blocks without any responsive style value emit zero bytes so existing
 * surfaces are byte-identical.
 *
 * @module @pwfabric/runtime/render/responsive-style-css
 */

import type { Block } from '@pwfabric/core'
import { BREAKPOINTS, BREAKPOINT_ORDER } from '@pwfabric/core'
import type { BreakpointName } from '@pwfabric/core'
import { blockSelector, camelToKebab, collectScopedCss, LAYOUT_HOIST_KEYS, WRAPPER_ATTR } from './scoped-css.js'

/** Breakpoint name → `minWidth` px (same thresholds the span/visibility systems use). */
function minWidthFor(bp: BreakpointName): number {
  return BREAKPOINTS.find((b) => b.name === bp)?.minWidth ?? 0
}

/** A per-breakpoint value map (the responsive form of a style prop value). */
type ResponsiveStyleValue = Partial<Record<BreakpointName, string>>

/** A style prop value is responsive when it is a non-null object (not a flat string). */
function isResponsiveValue(value: unknown): value is ResponsiveStyleValue {
  return typeof value === 'object' && value !== null
}

/**
 * Emit the scoped per-breakpoint media-query CSS for a single block's
 * responsive style props. Targets `[data-block-id="<id>"]` scoped under the
 * surface root so it cannot leak to the host page. Only breakpoints LARGER than
 * `xs` are emitted (the `xs`/base value is inline); each emitted breakpoint key
 * becomes a `@media (min-width:<px>)` rule. Returns '' when the block declares
 * no responsive style value.
 */
export function blockResponsiveStyleCss(
  blockId: string,
  style: NonNullable<Block['style']>,
  surfaceId?: string
): string {
  const selector = blockSelector(blockId, surfaceId)
  // Group declarations by breakpoint so one prop's md value and another prop's
  // md value share a single `@media` rule (mirrors how a mobile-first stylesheet
  // would be authored). The base (smallest defined breakpoint per prop) is a
  // NON-media rule so ALL breakpoints live in the stylesheet — never inline.
  // (Inline always beats stylesheet rules incl. @media, so a flattened-inline
  // base would pin the value and the larger @media overrides would never apply.)
  // THE HOISTING RULE APPLIES ON THE SELECTOR SIDE TOO.
  //
  // `[data-block-id]` matches BOTH the wrapper AND the component root. For flat
  // values the renderer hoists margin/maxWidth/flex to the wrapper and removes
  // them from the root; for responsive values the value leaves the inline style
  // and lands here, so without the same split here the rule would apply TWICE
  // (`marginTop:'-40%'` → both -335px and -256px).
  //
  // Hence two sets: hoisted keys go ONLY to the wrapper, the rest ONLY to the
  // component root.
  const HOIST = new Set<string>(LAYOUT_HOIST_KEYS)
  const baseDecls: string[] = []
  const byBreakpoint = new Map<BreakpointName, string[]>()
  const baseHoist: string[] = []
  const byBreakpointHoist = new Map<BreakpointName, string[]>()

  for (const [prop, value] of Object.entries(style)) {
    if (!isResponsiveValue(value)) continue // flat string → inline path owns it
    let baseTaken = false
    // BREAKPOINT_ORDER is mobile-first ascending → first defined key is the base.
    for (const bp of BREAKPOINT_ORDER) {
      const v = value[bp]
      if (v === undefined) continue
      // `!important`: a block COMPONENT often applies the same CSS property
      // inline with its own default (e.g. the text block sets
      // `font-size: var(--pw-font-size-base)`). Inline beats any stylesheet rule,
      // so without `!important` the author's responsive value would be pinned to
      // the component default. Scoped to `[data-block-id]`, this only overrides
      // the one block's own responsive props. Base + larger are both `!important`
      // at equal specificity → source order (larger emitted later) wins on match.
      const hoisted = HOIST.has(prop)
      const bag = hoisted ? baseHoist : baseDecls
      const map = hoisted ? byBreakpointHoist : byBreakpoint
      if (!baseTaken) {
        bag.push(`${camelToKebab(prop)}:${v} !important`)
        baseTaken = true
      } else {
        const decls = map.get(bp) ?? []
        decls.push(`${camelToKebab(prop)}:${v} !important`)
        map.set(bp, decls)
      }
    }
  }

  let css = ''
  // Base (non-media) first, then ascending breakpoint order so larger
  // breakpoints (later in source) win the cascade at equal specificity.
  const emit = (sel: string, base: string[], map: Map<BreakpointName, string[]>): void => {
    if (base.length > 0) css += `${sel}{${base.join(';')}}`
    for (const bp of BREAKPOINT_ORDER) {
      const decls = map.get(bp)
      if (!decls || decls.length === 0) continue
      css += `@media (min-width:${minWidthFor(bp)}px){${sel}{${decls.join(';')}}}`
    }
  }
  emit(`${selector}:not(${WRAPPER_ATTR})`, baseDecls, byBreakpoint)
  emit(`${selector}${WRAPPER_ATTR}`, baseHoist, byBreakpointHoist)
  return css
}

/**
 * Walk a surface block tree and concatenate the per-block responsive style CSS
 * for every block declaring a `ResponsiveValue` style prop. Blocks with only
 * flat string style values (or no style) are skipped (zero bytes emitted) so
 * existing surfaces are byte-identical.
 */
export function collectResponsiveStyleCss(blocks: readonly Block[], surfaceId?: string): string {
  return collectScopedCss(blocks, (block) =>
    block.style ? blockResponsiveStyleCss(block.id, block.style, surfaceId) : ''
  )
}
