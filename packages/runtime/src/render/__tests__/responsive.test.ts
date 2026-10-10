/**
 * Responsive Utilities Tests
 *
 * Tests for viewport-aware layout resolution, breakpoint detection,
 * and mobile-first cascade behavior.
 *
 * @module @pwfabric/runtime/render/__tests__/responsive
 */

import { describe, it, expect } from 'vitest'
import {
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
  resolveBlockLayout,
  resolveMeasureStyle,
  resolveSurfaceRootStyle,
} from '../responsive.js'
import {
  BREAKPOINTS,
  BREAKPOINT_ORDER,
  DEFAULT_BLOCK_LAYOUT,
  type BlockLayout,
  type BreakpointName,
} from '@pwfabric/core'

// ============================================================
// resolveResponsiveValue
// ============================================================

describe('resolveResponsiveValue', () => {
  it('should cascade mobile-first correctly (xs value applies to all larger)', () => {
    const responsive = { xs: 4 }

    expect(resolveResponsiveValue(responsive, 'xs')).toBe(4)
    expect(resolveResponsiveValue(responsive, 'sm')).toBe(4)
    expect(resolveResponsiveValue(responsive, 'md')).toBe(4)
    expect(resolveResponsiveValue(responsive, 'lg')).toBe(4)
    expect(resolveResponsiveValue(responsive, 'xl')).toBe(4)
    expect(resolveResponsiveValue(responsive, '2xl')).toBe(4)
  })

  it('should return specific breakpoint value when set', () => {
    const responsive = { xs: 4, md: 8, lg: 12 }

    expect(resolveResponsiveValue(responsive, 'xs')).toBe(4)
    expect(resolveResponsiveValue(responsive, 'sm')).toBe(4)
    expect(resolveResponsiveValue(responsive, 'md')).toBe(8)
    expect(resolveResponsiveValue(responsive, 'lg')).toBe(12)
    expect(resolveResponsiveValue(responsive, 'xl')).toBe(12)
    expect(resolveResponsiveValue(responsive, '2xl')).toBe(12)
  })

  it('should return undefined for empty responsive value', () => {
    expect(resolveResponsiveValue({}, 'lg')).toBeUndefined()
  })

  it('should return undefined for undefined responsive value', () => {
    expect(resolveResponsiveValue(undefined, 'lg')).toBeUndefined()
  })

  it('should handle single breakpoint set in middle', () => {
    const responsive = { md: 6 }

    expect(resolveResponsiveValue(responsive, 'xs')).toBeUndefined()
    expect(resolveResponsiveValue(responsive, 'sm')).toBeUndefined()
    expect(resolveResponsiveValue(responsive, 'md')).toBe(6)
    expect(resolveResponsiveValue(responsive, 'lg')).toBe(6)
    expect(resolveResponsiveValue(responsive, 'xl')).toBe(6)
  })

  it('should handle all breakpoints set', () => {
    const responsive = { xs: 1, sm: 2, md: 3, lg: 4, xl: 5, '2xl': 6 }

    for (const [i, bp] of BREAKPOINT_ORDER.entries()) {
      expect(resolveResponsiveValue(responsive, bp)).toBe(i + 1)
    }
  })

  it('should not treat 0 as undefined (falsy edge case)', () => {
    const responsive = { xs: 0 }

    expect(resolveResponsiveValue(responsive, 'xs')).toBe(0)
    expect(resolveResponsiveValue(responsive, 'lg')).toBe(0)
  })

  it('should work with boolean values', () => {
    const responsive = { xs: true, lg: false }

    expect(resolveResponsiveValue(responsive, 'xs')).toBe(true)
    expect(resolveResponsiveValue(responsive, 'sm')).toBe(true)
    expect(resolveResponsiveValue(responsive, 'lg')).toBe(false)
    expect(resolveResponsiveValue(responsive, '2xl')).toBe(false)
  })

  it('should work with string values', () => {
    const responsive = { xs: 'small', lg: 'large' }

    expect(resolveResponsiveValue(responsive, 'xs')).toBe('small')
    expect(resolveResponsiveValue(responsive, 'md')).toBe('small')
    expect(resolveResponsiveValue(responsive, 'lg')).toBe('large')
  })
})

// ============================================================
// resolveBlockLayout
// ============================================================

describe('resolveBlockLayout', () => {
  it('should return correct spans for each breakpoint', () => {
    const layout: BlockLayout = {
      span: { xs: 4, sm: 8, md: 8, lg: 12 },
    }

    expect(resolveBlockLayout(layout, 'xs').span).toBe(4)
    expect(resolveBlockLayout(layout, 'sm').span).toBe(8)
    expect(resolveBlockLayout(layout, 'md').span).toBe(8)
    expect(resolveBlockLayout(layout, 'lg').span).toBe(12)
    expect(resolveBlockLayout(layout, 'xl').span).toBe(12)
    expect(resolveBlockLayout(layout, '2xl').span).toBe(12)
  })

  it('should resolve offset when present', () => {
    const layout: BlockLayout = {
      span: { xs: 4, lg: 6 },
      offset: { lg: 3 },
    }

    expect(resolveBlockLayout(layout, 'xs').offset).toBeUndefined()
    expect(resolveBlockLayout(layout, 'lg').offset).toBe(3)
  })

  it('should resolve order when present', () => {
    const layout: BlockLayout = {
      span: { xs: 4, lg: 12 },
      order: { xs: 2, lg: 1 },
    }

    expect(resolveBlockLayout(layout, 'xs').order).toBe(2)
    expect(resolveBlockLayout(layout, 'lg').order).toBe(1)
  })

  it('should resolve hidden when present', () => {
    const layout: BlockLayout = {
      span: { xs: 4, lg: 12 },
      hidden: { xs: true, md: false },
    }

    expect(resolveBlockLayout(layout, 'xs').hidden).toBe(true)
    expect(resolveBlockLayout(layout, 'sm').hidden).toBe(true)
    expect(resolveBlockLayout(layout, 'md').hidden).toBe(false)
    expect(resolveBlockLayout(layout, 'lg').hidden).toBe(false)
  })

  it('should return undefined for optional fields when not set', () => {
    const layout: BlockLayout = {
      span: { xs: 4 },
    }

    const result = resolveBlockLayout(layout, 'lg')
    expect(result.offset).toBeUndefined()
    expect(result.order).toBeUndefined()
    expect(result.hidden).toBeUndefined()
  })
})

// ============================================================
// getBreakpointForWidth
// ============================================================

describe('getBreakpointForWidth', () => {
  it('should return correct breakpoint name for various widths', () => {
    expect(getBreakpointForWidth(0)).toBe('xs')
    expect(getBreakpointForWidth(375)).toBe('xs')
    expect(getBreakpointForWidth(639)).toBe('xs')
    expect(getBreakpointForWidth(640)).toBe('sm')
    expect(getBreakpointForWidth(768)).toBe('md')
    expect(getBreakpointForWidth(1024)).toBe('lg')
    expect(getBreakpointForWidth(1280)).toBe('xl')
    expect(getBreakpointForWidth(1536)).toBe('2xl')
    expect(getBreakpointForWidth(3840)).toBe('2xl')
  })

  it('should return xs for negative widths', () => {
    expect(getBreakpointForWidth(-100)).toBe('xs')
  })

  it('should match exact breakpoint boundaries', () => {
    for (const bp of BREAKPOINTS) {
      expect(getBreakpointForWidth(bp.minWidth)).toBe(bp.name)
    }
  })

  it('should return previous breakpoint just below boundary', () => {
    expect(getBreakpointForWidth(639)).toBe('xs')
    expect(getBreakpointForWidth(767)).toBe('sm')
    expect(getBreakpointForWidth(1023)).toBe('md')
    expect(getBreakpointForWidth(1279)).toBe('lg')
    expect(getBreakpointForWidth(1535)).toBe('xl')
  })
})

// ============================================================
// BREAKPOINTS CONSTANT
// ============================================================

describe('BREAKPOINTS constant', () => {
  it('should have 6 entries', () => {
    expect(BREAKPOINTS).toHaveLength(6)
  })

  it('should include xs, sm, md, lg, xl, 2xl', () => {
    const names = BREAKPOINTS.map((bp) => bp.name)
    expect(names).toEqual(['xs', 'sm', 'md', 'lg', 'xl', '2xl'])
  })

  it('should have each entry with name, minWidth, columns, label', () => {
    for (const bp of BREAKPOINTS) {
      expect(bp.name).toBeDefined()
      expect(typeof bp.minWidth).toBe('number')
      expect(typeof bp.columns).toBe('number')
      expect(typeof bp.label).toBe('string')
    }
  })
})

// ============================================================
// DEFAULT_BLOCK_LAYOUT
// ============================================================

describe('DEFAULT_BLOCK_LAYOUT', () => {
  it('should have correct full-width values', () => {
    expect(DEFAULT_BLOCK_LAYOUT.span.xs).toBe(4)
    expect(DEFAULT_BLOCK_LAYOUT.span.sm).toBe(8)
    expect(DEFAULT_BLOCK_LAYOUT.span.md).toBe(8)
    expect(DEFAULT_BLOCK_LAYOUT.span.lg).toBe(12)
  })

  it('should not have offset, order, or hidden by default', () => {
    expect(DEFAULT_BLOCK_LAYOUT.offset).toBeUndefined()
    expect(DEFAULT_BLOCK_LAYOUT.order).toBeUndefined()
    expect(DEFAULT_BLOCK_LAYOUT.hidden).toBeUndefined()
  })
})

// ============================================================
// resolveSpanAtBreakpoint
// ============================================================

describe('resolveSpanAtBreakpoint', () => {
  it('should return defined span value', () => {
    const layout: BlockLayout = { span: { xs: 2, lg: 6 } }

    expect(resolveSpanAtBreakpoint(layout, 'xs')).toBe(2)
    expect(resolveSpanAtBreakpoint(layout, 'lg')).toBe(6)
  })

  it('should cascade from smaller breakpoints', () => {
    const layout: BlockLayout = { span: { xs: 3 } }

    expect(resolveSpanAtBreakpoint(layout, 'lg')).toBe(3)
    expect(resolveSpanAtBreakpoint(layout, '2xl')).toBe(3)
  })

  it('should return full column width when no span defined', () => {
    const layout: BlockLayout = { span: {} }

    expect(resolveSpanAtBreakpoint(layout, 'xs')).toBe(4)
    expect(resolveSpanAtBreakpoint(layout, 'sm')).toBe(8)
    expect(resolveSpanAtBreakpoint(layout, 'md')).toBe(8)
    expect(resolveSpanAtBreakpoint(layout, 'lg')).toBe(12)
  })
})

// ============================================================
// getColumnsAtBreakpoint
// ============================================================

describe('getColumnsAtBreakpoint', () => {
  it('should return 4 columns for xs', () => {
    expect(getColumnsAtBreakpoint('xs')).toBe(4)
  })

  it('should return 8 columns for sm and md', () => {
    expect(getColumnsAtBreakpoint('sm')).toBe(8)
    expect(getColumnsAtBreakpoint('md')).toBe(8)
  })

  it('should return 12 columns for lg, xl, 2xl', () => {
    expect(getColumnsAtBreakpoint('lg')).toBe(12)
    expect(getColumnsAtBreakpoint('xl')).toBe(12)
    expect(getColumnsAtBreakpoint('2xl')).toBe(12)
  })
})

// ============================================================
// resolveMeasureStyle / resolveSurfaceRootStyle
// ============================================================

describe('resolveMeasureStyle', () => {
  it('should return grid CSS for a given viewport', () => {
    const style = resolveMeasureStyle('lg')

    expect(style.display).toBe('grid')
    expect(style.gridTemplateColumns).toBe('repeat(12, 1fr)')
    expect(style.gap).toBe('16px')
  })

  it('should use custom gap', () => {
    const style = resolveMeasureStyle('xs', 24)

    expect(style.gridTemplateColumns).toBe('repeat(4, 1fr)')
    expect(style.gap).toBe('24px')
  })

  it('should respect column count at each breakpoint', () => {
    const breakpoints: BreakpointName[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']
    const expectedColumns = [4, 8, 8, 12, 12, 12]

    for (const [i, bp] of breakpoints.entries()) {
      const style = resolveMeasureStyle(bp)
      expect(style.gridTemplateColumns).toBe(`repeat(${expectedColumns[i]}, 1fr)`)
    }
  })

  // The measure lives HERE, not on the root.
  it('carries the measure and the centring itself', () => {
    const style = resolveMeasureStyle('lg')
    expect(style.maxWidth).toBe('var(--pw-layout-container-max-width)')
    expect(style.margin).toBe('0 auto')
  })
})

describe('resolveSurfaceRootStyle', () => {
  // The root carries no measure — otherwise chrome would sit inside the
  // centred box too (at 1536px a rail would start 218px in from the edge).
  it('carries NO measure — neither maxWidth nor centring', () => {
    const style = resolveSurfaceRootStyle()
    expect(style.maxWidth).toBeUndefined()
    expect(style.margin).toBeUndefined()
  })

  it('is a flow container — a vertical stack', () => {
    const style = resolveSurfaceRootStyle()
    expect(style.display).toBe('flex')
    expect(style.flexDirection).toBe('column')
  })
})
