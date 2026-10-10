/**
 * WCAG Color Contrast Checking
 *
 * Implements the WCAG 2.0 contrast ratio algorithm for verifying
 * text and UI component color accessibility. Supports AA and AAA
 * conformance levels for both normal and large text.
 *
 * @see https://www.w3.org/TR/WCAG20/#contrast-ratiodef
 * @module @pwfabric/runtime/a11y/contrast
 */

// ============================================================
// TYPES
// ============================================================

/** Result of a WCAG contrast check */
export interface ContrastResult {
  /** The calculated contrast ratio (e.g. 4.5) */
  ratio: number
  /** Meets WCAG AA for normal text (>= 4.5:1) */
  meetsAA: boolean
  /** Meets WCAG AAA for normal text (>= 7:1) */
  meetsAAA: boolean
  /** Meets WCAG AA for large text (>= 3:1) */
  meetsAALarge: boolean
  /** Meets WCAG AAA for large text (>= 4.5:1) */
  meetsAAALarge: boolean
}

// ============================================================
// CONSTANTS
// ============================================================

/** WCAG 2.0 contrast ratio thresholds */
const THRESHOLDS = {
  AA_NORMAL: 4.5,
  AAA_NORMAL: 7,
  AA_LARGE: 3,
  AAA_LARGE: 4.5,
} as const

// ============================================================
// COLOR PRIMITIVES
// ============================================================

// `hexToRgb` / `relativeLuminance` MOVED to
// `@pwfabric/contracts` (`fabric/appearance-cascade`) in the
// the appearance cascade derives on-card ink from luminance
// and the dark variant from HSL, and it now lives in `contracts` so runtime,
// the exporter and the composer share ONE implementation. Re-exported here so the a11y
// module keeps its full public surface and existing imports keep working.
import { hexToRgb, relativeLuminance } from '@pwfabric/contracts'

export { hexToRgb, relativeLuminance }

// ============================================================
// CONTRAST RATIO
// ============================================================

/**
 * Calculate the contrast ratio between two hex colors.
 *
 * The ratio is always >= 1, with 1 meaning identical colors
 * and 21 being the maximum (black vs white).
 *
 * @param color1 - First hex color string
 * @param color2 - Second hex color string
 * @returns Contrast ratio, or 0 if either color is invalid
 */
export function contrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1)
  const rgb2 = hexToRgb(color2)

  if (!rgb1 || !rgb2) return 0

  const lum1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b)
  const lum2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b)

  const lighter = Math.max(lum1, lum2)
  const darker = Math.min(lum1, lum2)

  return (lighter + 0.05) / (darker + 0.05)
}

// ============================================================
// WCAG CHECKS
// ============================================================

/**
 * Check a foreground/background color pair against all WCAG contrast levels.
 *
 * @param foreground - Foreground (text) hex color
 * @param background - Background hex color
 * @returns ContrastResult with ratio and pass/fail for each WCAG level
 */
export function checkContrast(foreground: string, background: string): ContrastResult {
  const ratio = contrastRatio(foreground, background)

  return {
    ratio,
    meetsAA: ratio >= THRESHOLDS.AA_NORMAL,
    meetsAAA: ratio >= THRESHOLDS.AAA_NORMAL,
    meetsAALarge: ratio >= THRESHOLDS.AA_LARGE,
    meetsAAALarge: ratio >= THRESHOLDS.AAA_LARGE,
  }
}

/**
 * Quick check whether a color pair meets a specific WCAG conformance level.
 *
 * @param foreground - Foreground (text) hex color
 * @param background - Background hex color
 * @param level - WCAG conformance level ('AA' or 'AAA')
 * @param large - Whether the text is "large" (>= 18pt or >= 14pt bold) (default false)
 * @returns `true` if the contrast ratio meets the specified level
 */
export function meetsWCAG(
  foreground: string,
  background: string,
  level: 'AA' | 'AAA',
  large = false
): boolean {
  const ratio = contrastRatio(foreground, background)

  if (level === 'AA') {
    return large ? ratio >= THRESHOLDS.AA_LARGE : ratio >= THRESHOLDS.AA_NORMAL
  }

  // AAA
  return large ? ratio >= THRESHOLDS.AAA_LARGE : ratio >= THRESHOLDS.AAA_NORMAL
}
