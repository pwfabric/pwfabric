/**
 * WCAG Color Contrast Tests
 *
 * @module @pwfabric/runtime/a11y/__tests__/contrast
 */

import { describe, it, expect } from 'vitest'
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  checkContrast,
  meetsWCAG,
} from '../contrast.js'

// ============================================================
// hexToRgb
// ============================================================

describe('hexToRgb()', () => {
  it('parses 6-digit hex with #', () => {
    const rgb = hexToRgb('#ffffff')
    expect(rgb).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('parses 6-digit hex without #', () => {
    const rgb = hexToRgb('000000')
    expect(rgb).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('parses 3-digit shorthand', () => {
    const rgb = hexToRgb('#fff')
    expect(rgb).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('parses 4-digit shorthand (with alpha)', () => {
    const rgb = hexToRgb('#000f')
    expect(rgb).toEqual({ r: 0, g: 0, b: 0 })
  })

  it('parses 8-digit hex (with alpha channel)', () => {
    const rgb = hexToRgb('#ff0000ff')
    expect(rgb).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('returns null for invalid hex characters', () => {
    expect(hexToRgb('#zzzzzz')).toBeNull()
  })

  it('returns null for wrong length', () => {
    expect(hexToRgb('#12')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
  })

  it('parses mixed case hex', () => {
    const rgb = hexToRgb('#FF0000')
    expect(rgb).toEqual({ r: 255, g: 0, b: 0 })
  })
})

// ============================================================
// relativeLuminance
// ============================================================

describe('relativeLuminance()', () => {
  it('black has luminance 0', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0)
  })

  it('white has luminance 1', () => {
    const lum = relativeLuminance(255, 255, 255)
    expect(lum).toBeCloseTo(1, 5)
  })

  it('returns value between 0 and 1', () => {
    const lum = relativeLuminance(128, 128, 128)
    expect(lum).toBeGreaterThan(0)
    expect(lum).toBeLessThan(1)
  })

  it('linearizes values above 0.03928 threshold correctly', () => {
    // High value channel — uses power formula
    const lum = relativeLuminance(255, 0, 0)
    expect(lum).toBeCloseTo(0.2126, 3)
  })

  it('linearizes values below threshold (sRGB <= 0.03928)', () => {
    // Very dark values use division formula
    const lum = relativeLuminance(10, 0, 0)
    expect(lum).toBeGreaterThan(0)
  })
})

// ============================================================
// contrastRatio
// ============================================================

describe('contrastRatio()', () => {
  it('black vs white is 21:1', () => {
    const ratio = contrastRatio('#000000', '#ffffff')
    expect(ratio).toBeCloseTo(21, 0)
  })

  it('same color has ratio 1:1', () => {
    const ratio = contrastRatio('#888888', '#888888')
    expect(ratio).toBeCloseTo(1, 1)
  })

  it('returns 0 for invalid color', () => {
    expect(contrastRatio('invalid', '#fff')).toBe(0)
    expect(contrastRatio('#fff', 'invalid')).toBe(0)
  })

  it('ratio is symmetric', () => {
    const r1 = contrastRatio('#000', '#fff')
    const r2 = contrastRatio('#fff', '#000')
    expect(r1).toBeCloseTo(r2, 5)
  })
})

// ============================================================
// checkContrast
// ============================================================

describe('checkContrast()', () => {
  it('black on white passes all WCAG levels', () => {
    const result = checkContrast('#000000', '#ffffff')
    expect(result.ratio).toBeGreaterThan(20)
    expect(result.meetsAA).toBe(true)
    expect(result.meetsAAA).toBe(true)
    expect(result.meetsAALarge).toBe(true)
    expect(result.meetsAAALarge).toBe(true)
  })

  it('very similar colors fail all WCAG levels', () => {
    const result = checkContrast('#777777', '#888888')
    expect(result.meetsAA).toBe(false)
    expect(result.meetsAAA).toBe(false)
  })

  it('returns ratio of 0 for truly invalid colors', () => {
    const result = checkContrast('#xyz123', '#fff')
    expect(result.ratio).toBe(0)
    expect(result.meetsAA).toBe(false)
  })
})

// ============================================================
// meetsWCAG
// ============================================================

describe('meetsWCAG()', () => {
  it('passes AA check for sufficient contrast', () => {
    expect(meetsWCAG('#000000', '#ffffff', 'AA')).toBe(true)
  })

  it('passes AA-large check (large=true) with lower ratio threshold', () => {
    // 3:1 needed for large text; black on white is 21:1
    expect(meetsWCAG('#000000', '#ffffff', 'AA', true)).toBe(true)
  })

  it('passes AAA check for high contrast', () => {
    expect(meetsWCAG('#000000', '#ffffff', 'AAA')).toBe(true)
  })

  it('passes AAA-large check (large=true)', () => {
    expect(meetsWCAG('#000000', '#ffffff', 'AAA', true)).toBe(true)
  })

  it('fails AA for low contrast colors', () => {
    expect(meetsWCAG('#aaaaaa', '#bbbbbb', 'AA')).toBe(false)
  })

  it('fails AAA for low contrast', () => {
    expect(meetsWCAG('#555555', '#666666', 'AAA')).toBe(false)
  })
})
