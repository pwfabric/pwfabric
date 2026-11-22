/**
 * A PAGE ASSEMBLED INTO THE APP'S LAYOUT (receipt §4), the way the runner and
 * the build both do it — step 2 of envelope §4, before anything else reads
 * the page: the page's blocks in place of the layout's page slot, the
 * layout's capabilities joined to the page's, and the layout blocks that
 * mark the current page given its address.
 *
 * @module @pwfabric/runner/layout
 */
import { assembleIntoLayout, type LayoutAssemblyProblem } from '@pwfabric/contracts'
import type { BlockManifest, SurfaceReceipt } from './types.js'

/**
 * Whether blocks of a type mark the current page: their manifest declares an
 * `activeHref` prop (`blocks/manifest.json` `definition.props`).
 */
export function marksCurrentPage(blocks: BlockManifest | undefined): (type: string) => boolean {
  const marking = new Set<string>()
  for (const entry of blocks ?? []) {
    if (entry.definition?.props?.some((p) => p?.name === 'activeHref')) marking.add(entry.blockType)
  }
  return (type) => marking.has(type)
}

/**
 * The page's root-relative address for `activeHref`: `/` for the entry
 * page, `/<key>` for any other, `""` for the not-found page (it marks no item).
 */
export function currentPageHref(key: string, entry: string, notFoundPage: boolean): string {
  if (notFoundPage) return ''
  return key === entry ? '/' : `/${key}`
}

/**
 * Page `receipt` (page `key`) assembled into `layout`. A page that says
 * `layout: false`, or an app with no layout, comes back as it is.
 */
export function assemblePage(
  layout: SurfaceReceipt | null | undefined,
  receipt: SurfaceReceipt,
  input: { readonly key: string; readonly entry: string; readonly notFoundPage?: boolean; readonly blocks?: BlockManifest }
): { receipt: SurfaceReceipt; problems: LayoutAssemblyProblem[] } {
  // The receipt shapes are the same open nodes; the contracts' are read-only.
  type Receipt = Parameters<typeof assembleIntoLayout>[1]
  const result = assembleIntoLayout(layout as unknown as Receipt | undefined, receipt as unknown as Receipt, {
    currentHref: currentPageHref(input.key, input.entry, input.notFoundPage === true),
    marksCurrent: marksCurrentPage(input.blocks),
  })
  return { receipt: result.receipt as unknown as SurfaceReceipt, problems: result.problems }
}
