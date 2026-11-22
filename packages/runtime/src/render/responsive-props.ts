/**
 * Breakpoint-valued props: `direction: { xs: 'column', md: 'row' }`.
 *
 * A block reads its props as plain values; it does not know breakpoints. A
 * prop written as a breakpoint map — an object whose every key is a
 * breakpoint name — is therefore resolved for the breakpoint the page is
 * drawn at, mobile first (the value of the widest named breakpoint not wider
 * than it), before the block and the renderer's own layout read it. A block
 * whose declared prop is itself an object keeps the map as written.
 *
 * The first frame is drawn at the phone breakpoint and, beside it, at every
 * wider one; what the resolved value changes in inline styles becomes that
 * breakpoint's CSS (the CLI's static layout), so the page is right at every
 * width before any script runs. Responsive `style` values do not come here:
 * they are CSS rules already (responsive-style-css.ts).
 *
 * Pure, and the same object back when no prop is a breakpoint map.
 *
 * @module @pwfabric/runtime/render/responsive-props
 */

import type { Block, BreakpointName } from '@pwfabric/core'
import { BREAKPOINT_ORDER, resolveResponsiveValue } from '@pwfabric/core'
import type { BlockPropDescriptor } from '@pwfabric/contracts'

const BREAKPOINTS = new Set<string>(BREAKPOINT_ORDER)

/** An object whose every key (at least one) is a breakpoint name. */
export function isBreakpointMap(value: unknown): value is Readonly<Partial<Record<BreakpointName, unknown>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  return keys.length > 0 && keys.every((k) => BREAKPOINTS.has(k))
}

/** The declared shape takes an object: a breakpoint-keyed object is then a value, not a map. */
function declaresObject(descriptor: BlockPropDescriptor | undefined): boolean {
  const type = (descriptor?.jsonSchema as { type?: unknown } | undefined)?.type
  return type === 'object' || (Array.isArray(type) && type.includes('object'))
}

/** `block` with each breakpoint-map prop resolved at `viewport`. */
export function resolveResponsiveProps(
  block: Block,
  viewport: BreakpointName,
  declared?: readonly BlockPropDescriptor[]
): Block {
  const props = block.props as Record<string, unknown> | undefined
  if (!props) return block
  let out: Record<string, unknown> | null = null
  for (const [name, value] of Object.entries(props)) {
    if (!isBreakpointMap(value)) continue
    if (declaresObject(declared?.find((d) => d.name === name))) continue
    out ??= { ...props }
    const resolved = resolveResponsiveValue(value as Readonly<Partial<Record<BreakpointName, unknown>>>, viewport)
    if (resolved === undefined) delete out[name]
    else out[name] = resolved
  }
  return out ? ({ ...block, props: out } as Block) : block
}
