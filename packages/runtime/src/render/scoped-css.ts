/**
 * Shared helpers for the scoped per-block CSS collectors.
 *
 * The runtime emits several kinds of scoped `<style>` rules keyed by a block's
 * stable `data-block-id` (visibility / interaction-states / responsive-style /
 * conditional-states / group-states). They all share the SAME primitives:
 *
 *   - `cssEscapeId(id)`      — conservative attribute-value escaper for block ids.
 *   - `camelToKebab(prop)`   — CSS camelCase property name → kebab-case.
 *   - `blockSelector(id)`    — `[data-pw-surface] [data-block-id="<escaped>"]`,
 *                              the scoped base selector every rule attaches to.
 *   - `collectScopedCss(blocks, perBlockFn)` — walk the block tree (including
 *                              children) and concatenate each block's CSS as
 *                              produced by `perBlockFn(block)`.
 *
 * Centralising these keeps the per-collector files focused on their own
 * selector/declaration semantics and guarantees byte-identical output across
 * the family (the same escaper, the same selector string, the same walk order).
 *
 * @module @pwfabric/runtime/render/scoped-css
 */

import type { Block } from '@pwfabric/core'

/** Conservative CSS attribute-selector value escaper (block ids are slugs, but be safe). */
export function cssEscapeId(id: string): string {
  return id.replace(/["\\]/g, '\\$&')
}

/** camelCase CSS property → kebab-case (e.g. `backgroundColor` → `background-color`). */
export function camelToKebab(prop: string): string {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

/** The bare `[data-block-id="<escaped-id>"]` attribute selector (no surface scope). */
export function blockIdAttr(id: string): string {
  return `[data-block-id="${cssEscapeId(id)}"]`
}

/**
 * The surface-root selector a scoped rule hangs off.
 *
 * With a `surfaceId` this is `[data-pw-surface="<id>"]` — scope carried by the
 * attribute's VALUE, not merely its presence. That matters because the embed
 * autoloader hydrates EVERY `[data-pw-surface]` element in a document, so a host
 * page can hold several surfaces at once; a value-less selector makes each
 * surface's rules apply to all of them, and the last one in document order wins.
 *
 * Without a `surfaceId` it degrades to the historical `[data-pw-surface]`, which
 * is correct for rules whose content is identical for every surface (the base
 * CSS) and for unit tests that render a single surface.
 */
export function surfaceScope(surfaceId?: string): string {
  return surfaceId ? `[data-pw-surface="${cssEscapeId(surfaceId)}"]` : '[data-pw-surface]'
}

/**
 * The scoped base selector a per-block rule attaches to:
 * `[data-pw-surface="<sid>"] [data-block-id="<escaped-id>"]`. Scoped under the
 * surface root so a rule can never leak to the host page — and, when the surface
 * id is supplied, never to a SIBLING surface that happens to reuse a block id.
 */
export function blockSelector(id: string, surfaceId?: string): string {
  return `${surfaceScope(surfaceId)} ${blockIdAttr(id)}`
}

/**
 * Walk a surface block tree (depth-first, children after their parent — the
 * order all collectors used) and concatenate the per-block CSS produced by
 * `perBlockFn(block)`. Blocks for which `perBlockFn` returns '' contribute zero
 * bytes, so existing surfaces stay byte-identical.
 */
export function collectScopedCss(
  blocks: readonly Block[],
  perBlockFn: (block: Block) => string
): string {
  let css = ''
  const walk = (block: Block): void => {
    css += perBlockFn(block)
    if (block.children) {
      for (const child of block.children) walk(child)
    }
  }
  for (const block of blocks) walk(block)
  return css
}

/**
 * Style keys HOISTED to the wrapper — kept here so the renderer and the
 * responsive CSS generator see the SAME list.
 *
 * This list is a RULE: these keys apply to the outer wrapper, not the
 * component root. For flat values the renderer hoists them; for responsive
 * values the value leaves the inline style entirely and lands in CSS, so the
 * same rule has to be expressed on the selector side — otherwise the rule
 * matches both the wrapper and the root and the value is applied TWICE
 * (`marginTop:'-40%'` would move content by both -335px and -256px).
 */
export const FLEX_HOIST_KEYS = ['flex', 'flexGrow', 'flexShrink', 'flexBasis'] as const

export const LAYOUT_HOIST_KEYS = [
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'maxWidth',
  'minWidth',
  ...FLEX_HOIST_KEYS,
] as const

/** The attribute that tells the wrapper from the component root (the same marker states-css uses). */
export const WRAPPER_ATTR = '[data-block-wrapper]'
