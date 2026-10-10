/**
 * Width scope — splits blocks into groups while KEEPING SOURCE ORDER.
 *
 * WHY. If the surface root carried both the 12-column grid and
 * `maxWidth: var(--pw-layout-container-max-width)` + `margin: 0 auto`,
 * persistent chrome would sit inside the centred box too (on a 1536px screen
 * a persistent rail would start 218px in from the edge). The rule: persistent
 * navigation chrome belongs to the viewport, the content body to the measure.
 *
 * WHY GROUPS, NOT BUCKETS. A surface runs `[navbar][body…][bottombar]`.
 * Collecting `viewport`-scoped blocks into one bucket and `container` ones
 * into another would break the order and put the bottom bar next to the top
 * bar. Consecutive grouping keeps the order: three groups, three DOM siblings.
 *
 * WHY NOT 100vw. The `width:100vw; margin-inline:calc(50% - 50vw)` trick is
 * the short way out of a centred container and is NOT used: `100vw` counts
 * the scrollbar too, so every page with a vertical scrollbar would get ~15px
 * of horizontal overflow — the very defect this module exists to avoid.
 *
 * @module @pwfabric/runtime/render/width-scope
 */
import {
  DEFAULT_BLOCK_LAYOUT,
  resolveResponsiveValue,
  type Block,
  type BreakpointName,
} from '@pwfabric/core'
// `WidthScope` comes from CONTRACTS, not from core's parallel copy:
// `block.layout` is typed by contracts, and the two definitions are kept in
// sync by hand, so the contracts type is the one to follow.
import type { WidthScope } from '@pwfabric/contracts'

export interface WidthScopeChunk {
  readonly scope: WidthScope
  readonly blocks: readonly Block[]
}

/**
 * A block's scope at this breakpoint. Without a declaration it is
 * `container`, so a block that declares nothing keeps the default behaviour.
 */
export function resolveWidthScope(block: Block, viewport: BreakpointName): WidthScope {
  const layout = block.layout ?? DEFAULT_BLOCK_LAYOUT
  return resolveResponsiveValue(layout.widthScope, viewport) ?? 'container'
}

/** Groups consecutive blocks of the same scope together; order is kept. */
export function chunkByWidthScope(
  blocks: readonly Block[],
  viewport: BreakpointName
): readonly WidthScopeChunk[] {
  const chunks: { scope: WidthScope; blocks: Block[] }[] = []
  for (const block of blocks) {
    const scope = resolveWidthScope(block, viewport)
    const last = chunks[chunks.length - 1]
    if (last && last.scope === scope) last.blocks.push(block)
    else chunks.push({ scope, blocks: [block] })
  }
  return chunks
}
