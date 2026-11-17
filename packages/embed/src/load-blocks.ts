/**
 * Loading a page's block modules before it is drawn.
 *
 * WHY. The renderer draws a block whose module is not loaded yet as a
 * skeleton, and the module is asked for only when the block is drawn. A
 * container's children are drawn only once the container's own module is in,
 * so a page arrived in waves — one round trip per nesting level — and every
 * wave pushed the content under it down: the layout shift of a page "filling
 * in". Asking for every module the page names at once, and drawing only when
 * they are in, turns the waves into one round trip and the page into one
 * commit.
 *
 * Never a reason not to draw: a module that fails or is slow is left to the
 * block's own wrapper (its skeleton, its error), and the wait is capped.
 *
 * @module @pwfabric/embed/load-blocks
 */

import { BlockModuleLoader } from '@pwfabric/runtime'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'

/** How long a page waits for its block modules before it is drawn anyway. */
export const BLOCK_WAIT_MS = 3000

/** Every block `type` in a block tree (`blocks` and each node's `children`), in tree order, once each. */
export function surfaceBlockTypes(blocks: unknown): string[] {
  const out = new Set<string>()
  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue
      const n = node as { type?: unknown; children?: unknown }
      if (typeof n.type === 'string' && n.type) out.add(n.type)
      walk(n.children)
    }
  }
  walk(blocks)
  return [...out]
}

/**
 * Loads the modules of every block type `blocks` places, in parallel, and
 * resolves when they have all settled or `waitMs` has passed — whichever is
 * first. It never rejects. Types without a descriptor are skipped (the
 * renderer draws those its own way).
 */
export async function loadBlocks(
  blocks: unknown,
  descriptors: readonly DynamicBlockDescriptor[] | undefined,
  waitMs: number = BLOCK_WAIT_MS
): Promise<void> {
  if (!descriptors || descriptors.length === 0) return
  const byType = new Map(descriptors.map((d) => [d.blockType, d]))
  const loads = surfaceBlockTypes(blocks)
    .map((t) => byType.get(t))
    .filter((d): d is DynamicBlockDescriptor => d !== undefined && !BlockModuleLoader.isLoaded(d.blockType))
    .map((d) => BlockModuleLoader.loadAtom(d).then(
      () => undefined,
      () => undefined
    ))
  if (loads.length === 0) return
  let timer: ReturnType<typeof setTimeout> | undefined
  const capped = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs)
  })
  try {
    await Promise.race([Promise.all(loads).then(() => undefined), capped])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
