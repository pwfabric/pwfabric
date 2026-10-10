/**
 * Appearance cascade tests.
 *
 * The transform lives in `contracts` so the theme exporter (export
 * `theme.css`), an editor (bake the dark variant at write time) and the
 * renderer share ONE implementation. Coverage is per-package, so these tests
 * live here with it.
 *
 * @module @pwfabric/contracts/__tests__/fabric/appearance-cascade
 */

import { describe, it, expect } from 'vitest'
import {
  hexToRgb,
  relativeLuminance,
  surfaceThemeToCSS,
  deriveDarkTheme,
} from '../../fabric/appearance-cascade.js'
import { DEFAULT_APPEARANCE_THEME } from '../../fabric/surface-theme.js'
import type { SurfaceTheme } from '../../fabric/surface-theme.js'

/** WCAG contrast ratio — local to the test so the assertions stay readable. */
function contrast(a: string, b: string): number {
  const ra = hexToRgb(a)!
  const rb = hexToRgb(b)!
  const la = relativeLuminance(ra.r, ra.g, ra.b)
  const lb = relativeLuminance(rb.r, rb.g, rb.b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

describe('hexToRgb', () => {
  it('parses 6-digit hex', () => {
    expect(hexToRgb('#4f46e5')).toEqual({ r: 0x4f, g: 0x46, b: 0xe5 })
  })

  it('parses without the leading hash', () => {
    expect(hexToRgb('ffffff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('expands 3-digit shorthand', () => {
    expect(hexToRgb('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#f00')).toEqual({ r: 255, g: 0, b: 0 })
  })

  it('accepts 4- and 8-digit forms, dropping alpha', () => {
    expect(hexToRgb('#ffffff80')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#fff8')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('returns null for values it cannot parse', () => {
    // A CSS var reference or a named colour must NOT be guessed at — callers
    // keep the original value instead.
    expect(hexToRgb('var(--brand)')).toBeNull()
    expect(hexToRgb('rebeccapurple')).toBeNull()
    expect(hexToRgb('#12345')).toBeNull()
    expect(hexToRgb('#gggggg')).toBeNull()
  })
})

describe('relativeLuminance', () => {
  it('anchors black at 0 and white at 1', () => {
    expect(relativeLuminance(0, 0, 0)).toBe(0)
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5)
  })

  it('weights green above red above blue (WCAG coefficients)', () => {
    const r = relativeLuminance(255, 0, 0)
    const g = relativeLuminance(0, 255, 0)
    const b = relativeLuminance(0, 0, 255)
    expect(g).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
  })

  it('applies the sRGB gamma break for very dark channels', () => {
    // Below 0.03928 the curve is linear, not the 2.4 power — a low channel must
    // not collapse to zero.
    expect(relativeLuminance(1, 1, 1)).toBeGreaterThan(0)
  })
})

describe('surfaceThemeToCSS', () => {
  it('returns an empty map for no theme and no defaults', () => {
    expect(surfaceThemeToCSS(undefined)).toEqual({})
  })

  it('maps each token group to its --pw-* custom property', () => {
    const vars = surfaceThemeToCSS({
      colors: { primary: '#4f46e5', text: '#111111' },
      border: { radius: '8px', width: '1px', style: 'solid' },
      typography: { fontFamily: 'Inter', baseFontSize: '16px' },
      spacing: { base: '8px', md: '16px' },
      shadows: { card: '0 1px 2px #0001' },
      motion: { durationFast: '150ms', easing: 'ease' },
      layout: { gridGap: '24px' },
      focus: { ringColor: '#4f46e5', ringWidth: '2px' },
      zIndex: { modal: 500 },
    } as SurfaceTheme)

    expect(vars['--pw-color-primary']).toBe('#4f46e5')
    expect(vars['--pw-border-radius']).toBe('8px')
    expect(vars['--pw-font-family']).toBe('Inter')
    expect(vars['--pw-space-md']).toBe('16px')
    expect(vars['--pw-shadow-card']).toBe('0 1px 2px #0001')
    expect(vars['--pw-duration-fast']).toBe('150ms')
    expect(vars['--pw-layout-grid-gap']).toBe('24px')
    expect(vars['--pw-focus-ring-width']).toBe('2px')
    // Numeric z-index is stringified — CSS custom properties are strings.
    expect(vars['--pw-z-modal']).toBe('500')
  })

  it('omits tokens the theme does not set so the cascade can fall through', () => {
    const vars = surfaceThemeToCSS({ colors: { primary: '#4f46e5' } } as SurfaceTheme)
    expect(vars['--pw-border-radius']).toBeUndefined()
    expect(vars['--pw-font-family']).toBeUndefined()
  })

  it('merges over defaults so a sparse theme still emits the full set', () => {
    const vars = surfaceThemeToCSS(
      { colors: { primary: '#fabd00' } } as SurfaceTheme,
      DEFAULT_APPEARANCE_THEME
    )
    expect(vars['--pw-color-primary']).toBe('#fabd00')
    expect(vars['--pw-color-background']).toBe(DEFAULT_APPEARANCE_THEME.colors?.background)
    expect(vars['--pw-font-family']).toBeDefined()
  })

  it('layers projectTheme between the defaults and the surface override', () => {
    const vars = surfaceThemeToCSS(
      { colors: { primary: '#111111' } } as SurfaceTheme,
      DEFAULT_APPEARANCE_THEME,
      { colors: { primary: '#222222', accent: '#333333' } } as SurfaceTheme
    )
    // Surface wins over project…
    expect(vars['--pw-color-primary']).toBe('#111111')
    // …but the project still supplies what the surface never touched.
    expect(vars['--pw-color-accent']).toBe('#333333')
  })

  it('emits the card colour as --pw-color-card only', () => {
    const fromCard = surfaceThemeToCSS({ colors: { card: '#f8fafc' } } as SurfaceTheme)
    expect(fromCard['--pw-color-card']).toBe('#f8fafc')
    expect(fromCard['--pw-color-surface']).toBeUndefined()
  })

  it('emits derived roles as color-mix() so a rebrand tracks automatically', () => {
    // These reference the role vars rather than baking values, so changing
    // primary/accent updates them without re-running any JS.
    const vars = surfaceThemeToCSS({ colors: { primary: '#4f46e5' } } as SurfaceTheme)
    expect(vars['--pw-color-primary-subtle']).toContain('color-mix(in srgb, var(--pw-color-primary)')
    // "Strong" mixes toward the theme's TEXT, never a hard-coded #000: on a dark
    // palette it must read BRIGHTER than primary, and mixing toward black muddied
    // it. Since the cascade derives a dark variant for every themed surface, that is
    // the common case rather than the exception.
    expect(vars['--pw-color-primary-strong']).toBe(
      'color-mix(in srgb, var(--pw-color-primary) 85%, var(--pw-color-text))'
    )
    expect(vars['--pw-color-accent-subtle']).toContain('var(--pw-color-accent)')
    expect(vars['--pw-color-surface-muted']).toContain('var(--pw-color-card)')
  })

  describe('on-card ink derivation', () => {
    // Always a LITERAL, never a var reference: blocks redefine
    // `--pw-color-text: var(--pw-color-text-on-card, var(--pw-color-text))` on a
    // card, so an undefined on-card token makes that a self-reference cycle and
    // the property becomes invalid-at-computed-value.

    it('keeps the theme ink when card and page share a lightness side', () => {
      const vars = surfaceThemeToCSS({
        colors: { background: '#ffffff', card: '#f8fafc', text: '#1e293b' },
      } as SurfaceTheme)
      expect(vars['--pw-color-text-on-card']).toBe('#1e293b')
    })

    it('contrasts the ink when the card inverts against the page', () => {
      const vars = surfaceThemeToCSS({
        colors: { background: '#0b0b0f', card: '#ffffff', text: '#f5f5f5' },
      } as SurfaceTheme)
      // A white card on a dark page needs dark ink, not the page's light text.
      expect(vars['--pw-color-text-on-card']).toBe('#1a1a1a')
      expect(vars['--pw-color-text-muted-on-card']).toContain('color-mix')
      // No primary in this theme, so no ink to derive — ink belongs to the
      // brand hue, and there is no brand hue here.
      expect(vars['--pw-color-primary-ink']).toBeUndefined()
    })

    it('emits nothing when there is no card colour to reason about', () => {
      const vars = surfaceThemeToCSS({ colors: { primary: '#4f46e5' } } as SurfaceTheme)
      expect(vars['--pw-color-text-on-card']).toBeUndefined()
    })

    it('stays out of the way when the card is an unparseable value', () => {
      const vars = surfaceThemeToCSS({
        colors: { background: '#ffffff', card: 'var(--brand-card)', text: '#111111' },
      } as SurfaceTheme)
      // isLightColor returns null → not treated as inverted; falls back to text.
      expect(vars['--pw-color-text-on-card']).toBe('#111111')
    })
  })
})

describe('deriveDarkTheme', () => {
  const light: SurfaceTheme = {
    ...DEFAULT_APPEARANCE_THEME,
    colors: {
      ...DEFAULT_APPEARANCE_THEME.colors,
      background: '#ffffff',
      card: '#f8fafc',
      text: '#1e293b',
      textMuted: '#64748b',
      border: '#e2e8f0',
      primary: '#4f46e5',
    },
  }

  it('flips the neutral ramp', () => {
    const dark = deriveDarkTheme(light)
    expect(dark.colors?.background).not.toBe('#ffffff')
    // A near-white ground lands in the anchored dark band.
    const bg = hexToRgb(dark.colors!.background!)!
    expect(relativeLuminance(bg.r, bg.g, bg.b)).toBeLessThan(0.1)
  })

  it('keeps brand and semantic hues so the theme stays recognisable', () => {
    const dark = deriveDarkTheme(light)
    expect(dark.colors?.primary).toBe('#4f46e5')
    expect(dark.colors?.error).toBe(light.colors?.error)
    expect(dark.colors?.success).toBe(light.colors?.success)
  })

  it('lifts text into a light band', () => {
    const dark = deriveDarkTheme(light)
    const t = hexToRgb(dark.colors!.text!)!
    expect(relativeLuminance(t.r, t.g, t.b)).toBeGreaterThan(0.5)
  })

  it('keeps card above background so elevation ordering survives the flip', () => {
    const dark = deriveDarkTheme(light)
    const bg = hexToRgb(dark.colors!.background!)!
    const card = hexToRgb(dark.colors!.card!)!
    expect(relativeLuminance(card.r, card.g, card.b)).toBeGreaterThan(
      relativeLuminance(bg.r, bg.g, bg.b)
    )
  })

  it('passes mode-independent categories through untouched', () => {
    const dark = deriveDarkTheme(light)
    expect(dark.typography).toEqual(light.typography)
    expect(dark.spacing).toEqual(light.spacing)
    expect(dark.border).toEqual(light.border)
    expect(dark.zIndex).toEqual(light.zIndex)
  })

  it('deepens the card shadow — depth on a dark ground is a glow, not a hairline', () => {
    const dark = deriveDarkTheme(light)
    expect(dark.shadows?.card).toBe('0 4px 16px rgba(0,0,0,0.5)')
  })

  it('leaves unparseable colours alone rather than guessing', () => {
    const dark = deriveDarkTheme({
      ...light,
      colors: { ...light.colors, text: 'var(--ink)', border: 'currentColor' },
    })
    expect(dark.colors?.text).toBe('var(--ink)')
    expect(dark.colors?.border).toBe('currentColor')
  })

  it('handles a theme with no colours at all', () => {
    const dark = deriveDarkTheme({ typography: { fontFamily: 'Inter' } } as SurfaceTheme)
    expect(dark.colors?.background).toBeDefined()
    expect(dark.typography?.fontFamily).toBe('Inter')
  })

  it('preserves a hue tint through the flip (a blue-grey border stays blue-grey)', () => {
    const dark = deriveDarkTheme(light)
    const border = hexToRgb(dark.colors!.border!)!
    // slate-200 is faintly blue: blue channel stays the largest.
    expect(border.b).toBeGreaterThan(border.r)
  })

  // ------------------------------------------------------------------
  // Control visibility on the flipped ground
  // ------------------------------------------------------------------
  //
  // Preserving brand hue is right for a chromatic brand, but a NEUTRAL or
  // already-dark primary is emphatic in light mode *because* it is dark. Flip
  // the ground without touching it and both end up on the same side: the
  // button vanishes. Found by exporting a real app — zinc's primary measured
  // 17.7:1 on white and 1.08:1 on its own derived dark ground.

  it('lifts a neutral primary that would vanish on the dark ground', () => {
    const zinc: SurfaceTheme = {
      ...DEFAULT_APPEARANCE_THEME,
      colors: {
        ...DEFAULT_APPEARANCE_THEME.colors,
        primary: '#18181b',
        background: '#ffffff',
        textOnPrimary: '#fafafa',
      },
    }
    const dark = deriveDarkTheme(zinc)
    expect(contrast(dark.colors!.primary!, dark.colors!.background!)).toBeGreaterThanOrEqual(3)
    // Hue/saturation survive — a neutral stays neutral, it does not turn blue.
    const rgb = hexToRgb(dark.colors!.primary!)!
    expect(Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)).toBeLessThan(24)
  })

  it('re-inks the primary when it was lifted, so the label still reads', () => {
    const zinc: SurfaceTheme = {
      ...DEFAULT_APPEARANCE_THEME,
      colors: { ...DEFAULT_APPEARANCE_THEME.colors, primary: '#18181b', background: '#ffffff' },
    }
    const dark = deriveDarkTheme(zinc)
    expect(contrast(dark.colors!.textOnPrimary!, dark.colors!.primary!)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves a primary that already separates completely alone', () => {
    const gold: SurfaceTheme = {
      ...DEFAULT_APPEARANCE_THEME,
      colors: { ...DEFAULT_APPEARANCE_THEME.colors, primary: '#fabd00', background: '#ffffff' },
    }
    const dark = deriveDarkTheme(gold)
    // Untouched: the brand hue is the whole point when it already works.
    expect(dark.colors?.primary).toBe('#fabd00')
    expect(dark.colors?.textOnPrimary).toBe(DEFAULT_APPEARANCE_THEME.colors?.textOnPrimary)
  })

  it('is deterministic', () => {
    expect(deriveDarkTheme(light)).toEqual(deriveDarkTheme(light))
  })

  it('covers every hue sector of the HSL conversion', () => {
    // hslToHex branches on the 60-degree sector; drive all six so none rots.
    const hues = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff']
    for (const bg of hues) {
      const dark = deriveDarkTheme({ colors: { background: bg } } as SurfaceTheme)
      expect(dark.colors?.background).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

// ============================================================
// ON-COLOUR PAIRS MUST READ (measured: showcase, dark theme, Chromium)
// ============================================================

describe('appearance cascade — on-colour pairs meet AA', () => {
  const ratio = (a: string, b: string): number => {
    const hex = (h: string): [number, number, number] => {
      const n = parseInt(h.replace('#', ''), 16)
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    }
    const lum = (c: [number, number, number]): number => {
      const t = c.map((v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      })
      return 0.2126 * (t[0] as number) + 0.7152 * (t[1] as number) + 0.0722 * (t[2] as number)
    }
    const [la, lb] = [lum(hex(a)), lum(hex(b))]
    const [hi, lo] = la > lb ? [la, lb] : [lb, la]
    return (hi + 0.05) / (lo + 0.05)
  }

  it('emits --pw-color-on-accent whenever it emits an accent', () => {
    // The gap this closes: `accent` shipped without its on-colour while
    // `primary` had one, so blocks painting on an accent ground fell back to
    // the baseline near-black — 1.5:1 on a dark-derived accent.
    const vars = surfaceThemeToCSS({ colors: { accent: '#f59e0b' } })
    expect(vars['--pw-color-accent']).toBe('#f59e0b')
    expect(vars['--pw-color-on-accent']).toBeDefined()
    expect(ratio(vars['--pw-color-on-accent'] as string, '#f59e0b')).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps on-accent readable on a dark accent too', () => {
    const vars = surfaceThemeToCSS({ colors: { accent: '#1e3a8a' } })
    expect(ratio(vars['--pw-color-on-accent'] as string, '#1e3a8a')).toBeGreaterThanOrEqual(4.5)
  })

  it('pushes primary-ink to AA against a dark card', () => {
    // Ink is TEXT, so it owes 4.5:1 — not the 3:1 floor a fill owes.
    // deriveDarkTheme preserves brand hues, so an indigo primary stayed indigo
    // while the card went dark: measured 3.05:1 on a rendered surface.
    const vars = surfaceThemeToCSS({
      colors: { primary: '#4f46e5', card: '#111c27', background: '#0f0f0f', text: '#d0d8e7' },
    })
    const link = vars['--pw-color-primary-ink'] as string
    expect(link.startsWith('#')).toBe(true)
    expect(ratio(link, '#111c27')).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves an already-readable link untouched', () => {
    const vars = surfaceThemeToCSS({
      colors: { primary: '#1d4ed8', card: '#ffffff', background: '#ffffff', text: '#09090b' },
    })
    expect(vars['--pw-color-primary-ink']).toBe('#1d4ed8')
  })
})

describe('primary-ink is not tied to the card', () => {
  it('is emitted even when the theme declares no card or surface', () => {
    // The gap this closes: the value used to live inside `if (cardColor)` under
    // the name link-on-card, so a theme with no card never got it and all 33
    // call sites fell back to their literal.
    const vars = surfaceThemeToCSS({ colors: { primary: '#4f46e5', background: '#0f0f0f' } })
    expect(vars['--pw-color-primary-ink']).toBeDefined()
    expect(vars['--pw-color-card']).toBeUndefined()
  })

  it('no longer emits the retired link-on-card name', () => {
    const vars = surfaceThemeToCSS({
      colors: { primary: '#4f46e5', card: '#111c27', background: '#0f0f0f', text: '#d0d8e7' },
    })
    expect(vars['--pw-color-link-on-card']).toBeUndefined()
    expect(vars['--pw-color-primary-ink']).toBeDefined()
  })
})
