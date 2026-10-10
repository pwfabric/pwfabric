/**
 * Responsive Layout Contract Types
 *
 * Breakpoint definitions, responsive value types,
 * and block layout metadata for viewport-aware rendering.
 *
 * @module @pwfabric/contracts/fabric/layout
 */

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
 * Uses mobile-first cascade: smaller breakpoint values
 * inherit upward to larger breakpoints.
 */
export type ResponsiveValue<T> = Readonly<Partial<Record<BreakpointName, T>>>

// ============================================================
// BLOCK LAYOUT
// ============================================================

/**
 * Layout metadata for a block instance.
 *
 * Stored as `block.layout` (separate from `block.props`).
 * All fields use mobile-first cascade resolution.
 */
export interface BlockLayout {
  /** Column span per breakpoint */
  readonly span: ResponsiveValue<number>
  /** Column offset per breakpoint */
  readonly offset?: ResponsiveValue<number>
  /** Display order per breakpoint */
  readonly order?: ResponsiveValue<number>
  /** Hidden state per breakpoint */
  readonly hidden?: ResponsiveValue<boolean>
  /**
   * Per-breakpoint visibility — the `hidden md:flex` equivalent.
   *
   * `hideOn` lists the breakpoints at which the block is HIDDEN; it is
   * visible everywhere else. `showOn` is the inverse — the block is visible
   * ONLY at the listed breakpoints and hidden everywhere else. The runtime
   * emits a media-query CSS rule (keyed by the block's `data-block-id`) that
   * sets `display:none` outside the allowed range, using the same pixel
   * thresholds as the span system (`BREAKPOINTS[].minWidth`).
   *
   * Unlike `hidden` (a per-breakpoint boolean resolved against the single
   * active viewport at render time), `hideOn`/`showOn` are CSS-driven and
   * react to the live viewport width without a re-render — so a nav cluster
   * can collapse on mobile without flexWrap workarounds.
   *
   * When both are present, `showOn` wins (it is the stricter constraint).
   *
   * @example { hideOn: ['xs', 'sm'] } // hidden below the md threshold (768px)
   * @example { showOn: ['lg', 'xl'] } // visible only at lg+ (1024px–1535px)
   */
  readonly hideOn?: readonly BreakpointName[]
  readonly showOn?: readonly BreakpointName[]
  /**
   * What this block's width BELONGS TO: the surface's measured container, or
   * the screen itself.
   *
   * `container` (default) — obeys `--pw-layout-container-max-width`.
   * `viewport` — LEAVES that container and reaches the screen edge.
   *
   * Breakpoint-aware by necessity: "change shape on a narrow screen" is
   * exactly `{ xs: 'viewport', lg: 'container' }`.
   *
   * The runtime knows ONLY these two words. Which region of which shell gets
   * which scope is the PACK's vocabulary — an engine that memorises it makes a
   * second pack inexpressible: a hard-coded list of one pack's chrome block
   * names would leave every other pack's persistent rail inside the centred
   * content box instead of at the screen edge.
   *
   * @example { widthScope: { xs: 'viewport' } } // chrome: edge to edge
   * @example { widthScope: { xs: 'viewport', lg: 'container' } } // fills only when narrow
   */
  readonly widthScope?: ResponsiveValue<WidthScope>
}

/**
 * Width scope — the only vocabulary the engine has on this axis.
 *
 * There is no third value: "half", "wide", "full" belong to a shell vocabulary
 * and live in the pack. The engine applies exactly one distinction — obey the
 * measured container, or leave it.
 */
export type WidthScope = 'container' | 'viewport'

/**
 * Default block layout (full width at each breakpoint)
 */
export const DEFAULT_BLOCK_LAYOUT: BlockLayout = {
  span: { xs: 4, sm: 8, md: 8, lg: 12 },
} as const

// ============================================================
// VIEWPORT PRESETS
// ============================================================

/**
 * Preview viewport mode
 */
export type PreviewViewport = BreakpointName | 'responsive'

/**
 * Viewport preset dimensions for builder preview
 */
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
