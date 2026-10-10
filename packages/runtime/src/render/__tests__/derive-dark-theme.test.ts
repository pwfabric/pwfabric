/**
 * deriveDarkTheme tests — the light→dark derivation.
 * Neutrals flip lightness; brand + semantic hues are preserved; non-colour
 * categories pass through unchanged.
 */

import { describe, it, expect } from 'vitest'
import type { SurfaceTheme } from '@pwfabric/contracts'
import { deriveDarkTheme } from '../derive-dark-theme.js'
import { relativeLuminance, hexToRgb, contrastRatio } from '../../a11y/contrast.js'

const lum = (hex: string): number => {
  const rgb = hexToRgb(hex)
  return rgb ? relativeLuminance(rgb.r, rgb.g, rgb.b) : NaN
}

const LIGHT: SurfaceTheme = {
  colors: {
    primary: '#1d4ed8',
    secondary: '#38bdf8',
    accent: '#0891b2',
    background: '#ffffff',
    card: '#ffffff',
    text: '#09090b',
    textMuted: '#71717a',
    border: '#e4e4e7',
    error: '#dc2626',
    success: '#16a34a',
    warning: '#d97706',
    info: '#2563eb',
    textOnPrimary: '#ffffff',
  },
  border: { radius: '8px' },
  typography: { fontFamily: 'Inter' },
}

describe('deriveDarkTheme', () => {
  it('flips the neutral ramp — light background becomes dark, dark text becomes light', () => {
    const dark = deriveDarkTheme(LIGHT)
    expect(lum(dark.colors!.background!)).toBeLessThan(0.2) // was white → dark
    expect(lum(dark.colors!.text!)).toBeGreaterThan(0.6) // was near-black → light
    expect(lum(dark.colors!.card!)).toBeLessThan(0.25) // dark card
  })

  it('keeps card ABOVE background in lightness (elevation ordering survives)', () => {
    const dark = deriveDarkTheme(LIGHT)
    expect(lum(dark.colors!.card!)).toBeGreaterThan(lum(dark.colors!.background!))
  })

  it('preserves semantic hues unchanged', () => {
    const dark = deriveDarkTheme(LIGHT)
    expect(dark.colors!.secondary).toBe('#38bdf8')
    expect(dark.colors!.success).toBe('#16a34a')
  })

  it('derives the error colour for dark: same red, lifted until it reads as text', () => {
    const dark = deriveDarkTheme(LIGHT)
    // Positive control: the light red on the dark ground is under AA.
    expect(contrastRatio('#dc2626', dark.colors!.background!)).toBeLessThan(4.5)
    expect(dark.colors!.error).not.toBe('#dc2626')
    expect(contrastRatio(dark.colors!.error!, dark.colors!.background!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(dark.colors!.error!, dark.colors!.card!)).toBeGreaterThanOrEqual(4.5)
    const { r, g, b } = hexToRgb(dark.colors!.error!)!
    expect(r).toBeGreaterThan(g)
    expect(r).toBeGreaterThan(b)
  })

  it('keeps the brand hue while guaranteeing the control still separates', () => {
    // Hue preservation is not absolute: a primary that lands on the same side
    // of the ramp as the flipped ground is invisible, which is worse than a
    // slightly lighter brand colour. `#1d4ed8` on this theme's derived dark
    // ground measured 2.86:1 — under the 3:1 WCAG floor for UI components — so
    // it is lifted by lightness alone.
    const dark = deriveDarkTheme(LIGHT)
    expect(contrastRatio(dark.colors!.primary!, dark.colors!.background!)).toBeGreaterThanOrEqual(3)
    // Still the same blue: hue survives, only lightness moved.
    expect(dark.colors!.primary).toMatch(/^#[0-9a-f]{6}$/)
    const rgb = { r: 0x2c, g: 0x5c, b: 0xe3 }
    expect(dark.colors!.primary).toBe(
      '#' + [rgb.r, rgb.g, rgb.b].map((v) => v.toString(16).padStart(2, '0')).join('')
    )
    // The label on it stays readable after the lift.
    expect(contrastRatio(dark.colors!.textOnPrimary!, dark.colors!.primary!)).toBeGreaterThanOrEqual(4.5)
  })

  it('yields readable body text on the derived dark background (WCAG AA)', () => {
    const dark = deriveDarkTheme(LIGHT)
    expect(contrastRatio(dark.colors!.text!, dark.colors!.background!)).toBeGreaterThanOrEqual(4.5)
  })

  it('passes non-colour categories through unchanged', () => {
    const dark = deriveDarkTheme(LIGHT)
    expect(dark.border).toEqual(LIGHT.border)
    expect(dark.typography).toEqual(LIGHT.typography)
  })

  it('leaves non-hex colour values untouched (e.g. a CSS var reference)', () => {
    const dark = deriveDarkTheme({ colors: { background: 'var(--x)', text: '#000000' } })
    expect(dark.colors!.background).toBe('var(--x)')
  })
})
