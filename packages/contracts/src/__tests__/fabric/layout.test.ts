/**
 * Layout Contract Tests
 *
 * Tests for breakpoint definitions, responsive value types,
 * and block layout metadata.
 *
 * @module @pwfabric/contracts/fabric/__tests__/layout
 */

import { describe, it, expect } from 'vitest'
import type {
  BreakpointName,
  BreakpointDefinition,
  ResponsiveValue,
  BlockLayout,
  PreviewViewport,
} from '../../fabric/layout.js'
import {
  BREAKPOINTS,
  BREAKPOINT_ORDER,
  DEFAULT_BLOCK_LAYOUT,
  VIEWPORT_PRESETS,
} from '../../fabric/layout.js'

describe('BreakpointName', () => {
  it('should accept all valid breakpoint names', () => {
    const names: BreakpointName[] = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']
    expect(names).toHaveLength(6)
  })
})

describe('BREAKPOINTS', () => {
  it('should define 6 breakpoints', () => {
    expect(BREAKPOINTS).toHaveLength(6)
  })

  it('should be ordered by minWidth ascending', () => {
    for (let i = 1; i < BREAKPOINTS.length; i++) {
      expect(BREAKPOINTS[i]?.minWidth).toBeGreaterThan(BREAKPOINTS[i - 1]?.minWidth ?? -1)
    }
  })

  it('should start with xs at 0px', () => {
    expect(BREAKPOINTS[0]?.name).toBe('xs')
    expect(BREAKPOINTS[0]?.minWidth).toBe(0)
  })

  it('should have correct column counts', () => {
    const columnMap: Record<string, number> = {}
    for (const bp of BREAKPOINTS) {
      columnMap[bp.name] = bp.columns
    }
    expect(columnMap).toEqual({
      xs: 4,
      sm: 8,
      md: 8,
      lg: 12,
      xl: 12,
      '2xl': 12,
    })
  })

  it('should have labels for all breakpoints', () => {
    for (const bp of BREAKPOINTS) {
      expect(bp.label).toBeTruthy()
      expect(typeof bp.label).toBe('string')
    }
  })

  it('should satisfy BreakpointDefinition interface', () => {
    const bp = BREAKPOINTS[0] as BreakpointDefinition
    expect(bp.name).toBeDefined()
    expect(bp.minWidth).toBeDefined()
    expect(bp.columns).toBeDefined()
    expect(bp.label).toBeDefined()
  })
})

describe('BREAKPOINT_ORDER', () => {
  it('should match BREAKPOINTS order', () => {
    expect(BREAKPOINT_ORDER).toEqual(BREAKPOINTS.map((bp) => bp.name))
  })

  it('should have 6 entries', () => {
    expect(BREAKPOINT_ORDER).toHaveLength(6)
  })
})

describe('ResponsiveValue', () => {
  it('should allow partial breakpoint values', () => {
    const value: ResponsiveValue<number> = { xs: 4, lg: 12 }
    expect(value.xs).toBe(4)
    expect(value.lg).toBe(12)
    expect(value.md).toBeUndefined()
  })

  it('should support different value types', () => {
    const boolValue: ResponsiveValue<boolean> = { xs: true, lg: false }
    expect(boolValue.xs).toBe(true)
    expect(boolValue.lg).toBe(false)
  })

  it('should allow empty object', () => {
    const empty: ResponsiveValue<number> = {}
    expect(Object.keys(empty)).toHaveLength(0)
  })
})

describe('BlockLayout', () => {
  it('should require span field', () => {
    const layout: BlockLayout = {
      span: { xs: 4, lg: 6 },
    }
    expect(layout.span.xs).toBe(4)
    expect(layout.span.lg).toBe(6)
  })

  it('should support all optional fields', () => {
    const layout: BlockLayout = {
      span: { xs: 4 },
      offset: { lg: 2 },
      order: { xs: 1, lg: 0 },
      hidden: { xs: true, md: false },
    }
    expect(layout.offset?.lg).toBe(2)
    expect(layout.order?.xs).toBe(1)
    expect(layout.hidden?.xs).toBe(true)
  })
})

describe('DEFAULT_BLOCK_LAYOUT', () => {
  it('should span full width at each breakpoint', () => {
    expect(DEFAULT_BLOCK_LAYOUT.span.xs).toBe(4)
    expect(DEFAULT_BLOCK_LAYOUT.span.sm).toBe(8)
    expect(DEFAULT_BLOCK_LAYOUT.span.md).toBe(8)
    expect(DEFAULT_BLOCK_LAYOUT.span.lg).toBe(12)
  })

  it('should not have offset, order, or hidden', () => {
    expect(DEFAULT_BLOCK_LAYOUT.offset).toBeUndefined()
    expect(DEFAULT_BLOCK_LAYOUT.order).toBeUndefined()
    expect(DEFAULT_BLOCK_LAYOUT.hidden).toBeUndefined()
  })
})

describe('PreviewViewport', () => {
  it('should accept breakpoint names', () => {
    const viewport: PreviewViewport = 'lg'
    expect(viewport).toBe('lg')
  })

  it('should accept responsive mode', () => {
    const viewport: PreviewViewport = 'responsive'
    expect(viewport).toBe('responsive')
  })
})

describe('VIEWPORT_PRESETS', () => {
  it('should have presets for all breakpoints', () => {
    for (const name of BREAKPOINT_ORDER) {
      expect(VIEWPORT_PRESETS[name]).toBeDefined()
      expect(VIEWPORT_PRESETS[name]?.width).toBeGreaterThan(0)
      expect(VIEWPORT_PRESETS[name]?.height).toBe('auto')
    }
  })

  it('should have xs preset at 375px', () => {
    expect(VIEWPORT_PRESETS.xs.width).toBe(375)
  })

  it('should have widths matching or exceeding breakpoint minWidths', () => {
    for (const bp of BREAKPOINTS) {
      if (bp.name === 'xs') continue // xs preset (375) > 0 is fine
      expect(VIEWPORT_PRESETS[bp.name]?.width).toBeGreaterThanOrEqual(bp.minWidth)
    }
  })
})
