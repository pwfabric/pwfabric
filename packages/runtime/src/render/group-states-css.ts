/**
 * Group-hover scoped CSS generation (Tailwind `group` + `group-hover:`).
 *
 * A parent container marked `groupRoot: true` is a hover SOURCE: hovering it
 * restyles descendants that declare `groupStates.hover`. `block.style` is inline
 * and can express neither the ancestor `:hover` nor the descendant relationship,
 * so the runtime emits a scoped descendant rule keyed by BOTH block ids:
 *
 *   `[data-pw-surface] [data-block-id="<rootId>"]:hover [data-block-id="<thisId>"]{ … }`
 *
 * The host element already rendered for every block (`data-block-id`) is
 * sufficient on both ends — no extra attribute is needed. Keys are CSS camelCase
 * property names (converted to kebab-case); declarations are emitted with
 * `!important` because a block COMPONENT often applies the same property inline
 * with its own default and inline beats any plain stylesheet rule. Scoped to the
 * one descendant under the one root.
 *
 * Only the NEAREST ancestor with `groupRoot:true` drives a block's
 * `groupStates`; a block with `groupStates.hover` but no `groupRoot` ancestor
 * emits zero bytes. Surfaces using no `groupStates` emit zero bytes so existing
 * surfaces are byte-identical.
 *
 * @module @pwfabric/runtime/render/group-states-css
 */

import type { Block } from '@pwfabric/core'
import { blockIdAttr, blockSelector, camelToKebab } from './scoped-css.js'

/** Serialize a camelCase decl record to `prop:value !important;…` (values pass through). */
function declsToCss(decls: Readonly<Record<string, string>>): string {
  return Object.entries(decls)
    .map(([prop, value]) => `${camelToKebab(prop)}:${value} !important`)
    .join(';')
}

/**
 * Emit the scoped group-hover rule for a single descendant block, given the id
 * of the nearest `groupRoot` ancestor. Targets
 * `[data-block-id="<rootId>"]:hover [data-block-id="<thisId>"]` scoped under the
 * surface root. Returns '' when the descendant declares no non-empty
 * `groupStates.hover` record.
 */
export function blockGroupStatesCss(
  rootId: string,
  thisId: string,
  groupStates: NonNullable<Block['groupStates']>,
  surfaceId?: string
): string {
  const decls = groupStates.hover
  if (!decls || Object.keys(decls).length === 0) return ''
  // `blockSelector(rootId)` already includes the `[data-pw-surface]` prefix; the
  // descendant half is just the bare `[data-block-id]` attribute selector (the
  // shared surface scope is carried by the root half).
  return `${blockSelector(rootId, surfaceId)}:hover ${blockIdAttr(thisId)}{${declsToCss(decls)}}`
}

/**
 * Walk a surface block tree tracking the nearest ancestor marked
 * `groupRoot: true`; for each block declaring `groupStates.hover` UNDER such an
 * ancestor, concatenate its scoped group-hover CSS. Blocks with `groupStates`
 * but no `groupRoot` ancestor — and surfaces with no `groupStates` at all —
 * emit zero bytes (existing surfaces byte-identical).
 */
export function collectGroupStatesCss(blocks: readonly Block[], surfaceId?: string): string {
  let css = ''
  const walk = (block: Block, nearestRootId: string | undefined): void => {
    if (block.groupStates && nearestRootId !== undefined) {
      css += blockGroupStatesCss(nearestRootId, block.id, block.groupStates, surfaceId)
    }
    // This block becomes the nearest root for its own descendants when it is a
    // group root (innermost groupRoot wins).
    const rootForChildren = block.groupRoot ? block.id : nearestRootId
    if (block.children) {
      for (const child of block.children) walk(child, rootForChildren)
    }
  }
  for (const block of blocks) walk(block, undefined)
  return css
}
