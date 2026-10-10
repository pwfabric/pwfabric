/**
 * Block Layout Schema
 *
 * Zod schemas for layout validation, per-type default spans,
 * and mobile-first cascade resolution.
 *
 * @module @pwfabric/core/blocks/layout-schema
 */

import { z } from 'zod'

// ============================================================
// BREAKPOINT DEFINITIONS
// ============================================================

/**
 * Named breakpoints aligned with Tailwind CSS conventions
 */
export type BreakpointName = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl'

/**
 * Breakpoint definition with min-width and column count
 */
export interface BreakpointDefinition {
  readonly name: BreakpointName
  readonly minWidth: number
  readonly columns: number
  readonly label: string
}

/**
 * Ordered breakpoint definitions (smallest to largest)
 */
export const BREAKPOINTS: readonly BreakpointDefinition[] = [
  { name: 'xs', minWidth: 0, columns: 4, label: 'Mobile' },
  { name: 'sm', minWidth: 640, columns: 8, label: 'Mobile Landscape' },
  { name: 'md', minWidth: 768, columns: 8, label: 'Tablet' },
  { name: 'lg', minWidth: 1024, columns: 12, label: 'Desktop' },
  { name: 'xl', minWidth: 1280, columns: 12, label: 'Large Desktop' },
  { name: '2xl', minWidth: 1536, columns: 12, label: 'Extra Large' },
] as const

/**
 * Ordered breakpoint names for iteration and cascade resolution
 */
export const BREAKPOINT_ORDER: readonly BreakpointName[] = [
  'xs',
  'sm',
  'md',
  'lg',
  'xl',
  '2xl',
] as const

// ============================================================
// RESPONSIVE VALUE TYPE
// ============================================================

/**
 * A value that can vary per breakpoint.
 */
export type ResponsiveValue<T> = Readonly<Partial<Record<BreakpointName, T>>>

// ============================================================
// BLOCK LAYOUT
// ============================================================

/**
 * Layout metadata for a block instance.
 */
export interface BlockLayout {
  readonly span: ResponsiveValue<number>
  readonly offset?: ResponsiveValue<number>
  readonly order?: ResponsiveValue<number>
  readonly hidden?: ResponsiveValue<boolean>
  /**
   * Per-breakpoint visibility (the `hidden md:flex` equivalent).
   * `hideOn` = breakpoints where the block is hidden; `showOn` = the only
   * breakpoints where it is visible. CSS/media-query driven (see runtime
   * renderer), using the same pixel thresholds as the span system.
   */
  readonly hideOn?: readonly BreakpointName[]
  readonly showOn?: readonly BreakpointName[]
  /**
   * What this block's width belongs to: the surface's measured container, or
   * the screen itself.
   *
   * `container` (default) — respects `--pw-layout-container-max-width`.
   * `viewport` — LEAVES that container and reaches the edge of the screen.
   *
   * Breakpoint-aware, because "change shape on a narrow screen" is exactly
   * this: `{ xs: 'viewport', lg: 'container' }`.
   *
   * The engine knows NO words beyond these two. Which region of which shell
   * has which scope is the pack's vocabulary; if the engine memorised it, a
   * second pack could not express itself.
   */
  readonly widthScope?: ResponsiveValue<WidthScope>
}

export const DEFAULT_BLOCK_LAYOUT: BlockLayout = {
  span: { xs: 4, sm: 8, md: 8, lg: 12 },
} as const

// ============================================================
// VIEWPORT PRESETS
// ============================================================

export type PreviewViewport = BreakpointName | 'responsive'

export const VIEWPORT_PRESETS: Record<
  BreakpointName,
  { readonly width: number; readonly height: 'auto' }
> = {
  xs: { width: 375, height: 'auto' },
  sm: { width: 640, height: 'auto' },
  md: { width: 768, height: 'auto' },
  lg: { width: 1024, height: 'auto' },
  xl: { width: 1280, height: 'auto' },
  '2xl': { width: 1536, height: 'auto' },
} as const

// ============================================================
// ZOD SCHEMAS
// ============================================================

export const responsiveNumberSchema = z
  .object({
    xs: z.number().int().min(0).optional(),
    sm: z.number().int().min(0).optional(),
    md: z.number().int().min(0).optional(),
    lg: z.number().int().min(0).optional(),
    xl: z.number().int().min(0).optional(),
    '2xl': z.number().int().min(0).optional(),
  })
  .strict()

export const responsiveBooleanSchema = z
  .object({
    xs: z.boolean().optional(),
    sm: z.boolean().optional(),
    md: z.boolean().optional(),
    lg: z.boolean().optional(),
    xl: z.boolean().optional(),
    '2xl': z.boolean().optional(),
  })
  .strict()

export const breakpointNameSchema = z.enum(['xs', 'sm', 'md', 'lg', 'xl', '2xl'])

/**
 * Width scope — the ONLY vocabulary the engine knows on this axis.
 *
 * `container` fits the measured container, `viewport` leaves it. There is no
 * third value: in-between words such as "half", "wide" or "full" belong to a
 * shell's vocabulary and live in the pack. The engine applies only the
 * difference between "fit the container" and "leave the container".
 */
export const widthScopeSchema = z.enum(['container', 'viewport'])
export type WidthScope = z.infer<typeof widthScopeSchema>

export const responsiveWidthScopeSchema = z
  .object({
    xs: widthScopeSchema.optional(),
    sm: widthScopeSchema.optional(),
    md: widthScopeSchema.optional(),
    lg: widthScopeSchema.optional(),
    xl: widthScopeSchema.optional(),
    '2xl': widthScopeSchema.optional(),
  })
  .strict()

export const blockLayoutSchema = z.object({
  span: responsiveNumberSchema,
  offset: responsiveNumberSchema.optional(),
  order: responsiveNumberSchema.optional(),
  hidden: responsiveBooleanSchema.optional(),
  hideOn: z.array(breakpointNameSchema).optional(),
  showOn: z.array(breakpointNameSchema).optional(),
  widthScope: responsiveWidthScopeSchema.optional(),
})

// ============================================================
// CASCADE RESOLUTION
// ============================================================

export function resolveResponsiveValue<T>(
  responsive: ResponsiveValue<T> | undefined,
  breakpoint: BreakpointName
): T | undefined {
  if (!responsive) return undefined
  const targetIndex = BREAKPOINT_ORDER.indexOf(breakpoint)
  for (let i = targetIndex; i >= 0; i--) {
    const bp = BREAKPOINT_ORDER[i]
    if (!bp) continue
    if (responsive[bp] !== undefined) {
      return responsive[bp]
    }
  }
  return undefined
}

export function resolveSpanAtBreakpoint(layout: BlockLayout, breakpoint: BreakpointName): number {
  const span = resolveResponsiveValue(layout.span, breakpoint)
  if (span !== undefined) return span
  const bpDef = BREAKPOINTS.find((bp) => bp.name === breakpoint)
  return bpDef?.columns ?? 12
}

export function getColumnsAtBreakpoint(breakpoint: BreakpointName): number {
  const bpDef = BREAKPOINTS.find((bp) => bp.name === breakpoint)
  return bpDef?.columns ?? 12
}

export function getBreakpointForWidth(width: number): BreakpointName {
  for (let i = BREAKPOINTS.length - 1; i >= 0; i--) {
    const bp = BREAKPOINTS[i]
    if (bp && width >= bp.minWidth) {
      return bp.name
    }
  }
  return 'xs'
}
