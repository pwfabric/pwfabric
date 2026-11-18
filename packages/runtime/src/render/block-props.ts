/**
 * The props a block renders with — its manifest's declarations applied.
 *
 * A pack block's props are declared once, in its manifest (`definition.props`),
 * and reach the renderer in the descriptor the host hands it
 * (`blocks/manifest.json`). Before the block renders, the renderer fills in
 * each missing prop's default, coerces a value to its declared shape where
 * that loses nothing, and keeps a value that still does not fit as written,
 * with a developer warning (`applyBlockProps`, @pwfabric/contracts). A block therefore reads
 * `props.size` and gets `'md'` when the receipt left it out — it needs no
 * schema and no `?? 'md'` of its own.
 *
 * Never throws. A prop that does not fit is a DEVELOPER warning: it is printed
 * once per block type, prop and problem when the page runs under `pwf dev`
 * (which sets `globalThis.__pwfabric_dev`), and is silent for a visitor — the
 * receipts were checked at `pwf validate` / `pwf build`.
 *
 * Pure: the same props and declarations give the same result, on the server
 * and in the browser alike, so a pre-rendered page hydrates without a
 * mismatch.
 *
 * @module @pwfabric/runtime/render/block-props
 */

import { applyBlockProps, type BlockPropDescriptor, type PropIssue } from '@pwfabric/contracts'

const warned = new Set<string>()

/** Whether the page runs under `pwf dev` (its reload client sets the flag before the app starts). */
export function isDevHost(): boolean {
  return (globalThis as { __pwfabric_dev?: unknown }).__pwfabric_dev === true
}

function warnOnce(blockType: string, issue: PropIssue): void {
  const key = `${blockType}\u0000${issue.path}\u0000${issue.code}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(`[pwfabric] block "${blockType}": ${issue.message} — it renders with its default. Fix the receipt or the manifest.`)
}

/**
 * `props` with the declarations of `blockType` applied (see the module
 * header). The same object comes back when nothing changes.
 */
export function blockPropsForRender(
  blockType: string,
  props: Readonly<Record<string, unknown>> | undefined,
  descriptors: readonly BlockPropDescriptor[] | undefined
): Readonly<Record<string, unknown>> {
  const given = props ?? EMPTY
  return applyBlockProps(given, descriptors, isDevHost() ? (issue) => warnOnce(blockType, issue) : undefined)
}

const EMPTY: Readonly<Record<string, unknown>> = Object.freeze({})
