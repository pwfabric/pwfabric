/**
 * Responsive Rendering Utilities
 *
 * Viewport-aware layout resolution for runtime rendering.
 * Re-exports pure functions from @pwfabric/core and provides
 * React-specific viewport hook.
 *
 * @module @pwfabric/runtime/render/responsive
 */

import * as React from 'react'
import type { BlockLayout, BreakpointName } from '@pwfabric/core'
import {
  BREAKPOINTS,
  resolveSpanAtBreakpoint,
  resolveResponsiveValue,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
} from '@pwfabric/core'

// Re-export pure functions for convenience
export {
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
} from '@pwfabric/core'

// ============================================================
// BLOCK STYLE RESOLUTION
// ============================================================

/**
 * Resolve the complete block layout at a given viewport breakpoint.
 * Returns span, offset, order, and hidden values.
 */
export function resolveBlockLayout(
  layout: BlockLayout,
  viewport: BreakpointName
): {
  span: number
  offset: number | undefined
  order: number | undefined
  hidden: boolean | undefined
} {
  return {
    span: resolveSpanAtBreakpoint(layout, viewport),
    offset: resolveResponsiveValue(layout.offset, viewport),
    order: resolveResponsiveValue(layout.order, viewport),
    hidden: resolveResponsiveValue(layout.hidden, viewport),
  }
}

/**
 * Surface root — carries NO MEASURE.
 *
 * If the root carried both the 12-column grid and
 * `maxWidth: var(--pw-layout-container-max-width)` + `margin: 0 auto`,
 * persistent chrome would sit inside the centred box too (a persistent rail
 * would start well in from the screen edge, as part of the narrower container).
 *
 * The measure goes to the inner container through `resolveMeasureStyle`;
 * the root is flow only.
 */
export function resolveSurfaceRootStyle(
  gap: string | number = 16,
  padding: string | number = 0
): React.CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'column',
    gap: typeof gap === 'number' ? `${gap}px` : gap,
    padding: typeof padding === 'number' ? `${padding}px` : padding,
  }
}

/**
 * Measured container — the wrapper of `container`-scoped blocks.
 *
 * The 12-column grid and `containerMaxWidth` live HERE. Blocks that declare
 * `widthScope:'viewport'` are drawn as SIBLINGS of this container, not its
 * children — the escape is placement, not a CSS trick (see render/width-scope.ts).
 */
export function resolveMeasureStyle(
  viewport: BreakpointName,
  gap: string | number = 16,
  padding: string | number = 24,
  containerMaxWidth = 'var(--pw-layout-container-max-width)'
): React.CSSProperties {
  const columns = getColumnsAtBreakpoint(viewport)
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: typeof gap === 'number' ? `${gap}px` : gap,
    padding: typeof padding === 'number' ? `${padding}px` : padding,
    maxWidth: containerMaxWidth,
    margin: '0 auto',
    width: '100%',
  }
}

// ============================================================
// VIEWPORT HOOK
// ============================================================

/**
 * React hook that returns the current viewport breakpoint.
 * Uses matchMedia for efficient viewport detection.
 *
 * Returns 'lg' on server (SSR fallback).
 */
export function useViewport(): BreakpointName {
  const [breakpoint, setBreakpoint] = React.useState<BreakpointName>('lg')

  React.useEffect(() => {
    // Set initial value from current window width
    setBreakpoint(getBreakpointForWidth(window.innerWidth))

    // Create media query listeners for each breakpoint transition
    const listeners: { mql: MediaQueryList; handler: () => void }[] = []

    for (const bp of BREAKPOINTS) {
      const mql = window.matchMedia(`(min-width: ${bp.minWidth}px)`)
      const handler = (): void => {
        setBreakpoint(getBreakpointForWidth(window.innerWidth))
      }
      mql.addEventListener('change', handler)
      listeners.push({ mql, handler })
    }

    return () => {
      for (const { mql, handler } of listeners) {
        mql.removeEventListener('change', handler)
      }
    }
  }, [])

  return breakpoint
}
