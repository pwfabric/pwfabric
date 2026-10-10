/**
 * Theme contrast in every mode.
 *
 * Four failure modes, each reproduced on real preset values:
 *
 *   - a button ink passed through the cascade untouched — white on forest
 *     #22c55e is 2.28:1, and the dark derivation would keep the same pair;
 *   - a focus ring passed through too — indigo #4f46e5 is 2.84:1 on
 *     midnight's own ground, and a light ring falls under 3:1 on the
 *     derived dark ground;
 *   - an explicit sparse `darkTheme` merged over the LIGHT default turns one
 *     edited dark colour into a white dark mode;
 *   - re-deriving an already-dark theme can put midnight's textMuted at
 *     4.02:1 on its card.
 *
 * Every fix has a positive control: the old input, or the old code path,
 * is shown failing next to the new one passing.
 *
 * @module @pwfabric/contracts/__tests__/fabric/theme-contrast
 */

import { describe, it, expect } from 'vitest'
import {
  hexToRgb,
  relativeLuminance,
  surfaceThemeToCSS,
  deriveDarkTheme,
  mergeSurfaceThemes,
  resolveDarkTheme,
  themeContrastFindings,
  THEME_TEXT_CONTRAST_MIN,
  THEME_UI_CONTRAST_MIN,
} from '../../fabric/appearance-cascade.js'
import { DEFAULT_APPEARANCE_THEME } from '../../fabric/surface-theme.js'
import type { SurfaceTheme } from '../../fabric/surface-theme.js'

function contrast(a: string, b: string): number {
  const ra = hexToRgb(a)!
  const rb = hexToRgb(b)!
  const la = relativeLuminance(ra.r, ra.g, ra.b)
  const lb = relativeLuminance(rb.r, rb.g, rb.b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** HSL hue of a hex, degrees — to prove an ink kept the brand's hue. */
function hue(hex: string): number {
  const { r, g, b } = hexToRgb(hex)!
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  if (d === 0) return 0
  let h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  h *= 60
  return h
}

/** Preset values that fail without the cascade's corrections. */
const OLD = {
  forest: {
    colors: { primary: '#22c55e', background: '#f0fdf4', card: '#dcfce7', text: '#14532d', textMuted: '#166534', textOnPrimary: '#ffffff' },
    focus: { ringColor: '#4f46e5' },
  },
  midnight: {
    colors: { primary: '#818cf8', background: '#0f172a', card: '#1e293b', text: '#e2e8f0', textMuted: '#94a3b8', textOnPrimary: '#0f172a' },
    focus: { ringColor: '#4f46e5' },
  },
  zinc: {
    colors: { primary: '#18181b', background: '#ffffff', card: '#ffffff', text: '#09090b', textMuted: '#71717a', textOnPrimary: '#fafafa' },
    focus: { ringColor: '#18181b' },
  },
} satisfies Record<string, SurfaceTheme>

/** foundation 4.0.2 — the AA patch. */
const PRESETS: Record<string, SurfaceTheme> = {
  forest: { colors: { primary: '#22c55e', secondary: '#16a34a', accent: '#4ade80', background: '#f0fdf4', card: '#dcfce7', text: '#14532d', textMuted: '#166534', border: '#bbf7d0', textOnPrimary: '#052e16' }, focus: { ringColor: '#1a9447' } },
  ocean: { colors: { primary: '#0ea5e9', secondary: '#06b6d4', accent: '#38bdf8', background: '#f0f9ff', card: '#e0f2fe', text: '#0c4a6e', textMuted: '#0369a1', border: '#bae6fd', textOnPrimary: '#082f49' }, focus: { ringColor: '#0b81b7' } },
  sunset: { colors: { primary: '#f97316', secondary: '#ef4444', accent: '#fb923c', background: '#fff7ed', card: '#ffedd5', text: '#431407', textMuted: '#9a3412', border: '#fed7aa', textOnPrimary: '#431407' }, focus: { ringColor: '#ce5805' } },
  rose: { colors: { primary: '#e11d48', secondary: '#ec4899', accent: '#fb7185', background: '#fff1f2', card: '#ffe4e6', text: '#881337', textMuted: '#9f1239', border: '#fecdd3', textOnPrimary: '#ffffff' }, focus: { ringColor: '#e11d48' } },
  midnight: { colors: { primary: '#818cf8', secondary: '#a78bfa', accent: '#c4b5fd', background: '#0f172a', card: '#1e293b', text: '#e2e8f0', textMuted: '#94a3b8', border: '#334155', textOnPrimary: '#0f172a' }, focus: { ringColor: '#818cf8' } },
  zinc: { colors: { primary: '#18181b', secondary: '#f4f4f5', accent: '#f4f4f5', background: '#ffffff', card: '#ffffff', text: '#09090b', textMuted: '#71717a', border: '#e4e4e7', textOnPrimary: '#fafafa' }, focus: { ringColor: '#71717a' } },
}

const full = (t: SurfaceTheme): SurfaceTheme => mergeSurfaceThemes(DEFAULT_APPEARANCE_THEME, t)

describe('text-on-primary is pushed to AA, like on-accent', () => {
  it('turns white on forest into an ink that reads, in the brand hue', () => {
    const t = OLD.forest
    // Positive control: the authored pair fails.
    expect(contrast(t.colors.textOnPrimary, t.colors.primary)).toBeLessThan(2.3)
    const ink = surfaceThemeToCSS(t)['--pw-color-text-on-primary']!
    expect(contrast(ink, t.colors.primary)).toBeGreaterThanOrEqual(4.5)
    // A deep green, not a grey: the ink walks the fill's own hue.
    expect(Math.abs(hue(ink) - hue(t.colors.primary))).toBeLessThan(3)
  })

  it('leaves an ink that already reads exactly as authored', () => {
    expect(surfaceThemeToCSS(OLD.zinc)['--pw-color-text-on-primary']).toBe('#fafafa')
    expect(surfaceThemeToCSS(PRESETS.forest!)['--pw-color-text-on-primary']).toBe('#052e16')
    expect(surfaceThemeToCSS(PRESETS.rose!)['--pw-color-text-on-primary']).toBe('#ffffff')
  })

  it('fixes the same pair in the derived dark mode', () => {
    const dark = deriveDarkTheme(full(OLD.forest))
    // Positive control: the derivation alone still carries the failing white.
    expect(dark.colors?.textOnPrimary).toBe('#ffffff')
    const ink = surfaceThemeToCSS(dark)['--pw-color-text-on-primary']!
    expect(contrast(ink, dark.colors!.primary!)).toBeGreaterThanOrEqual(4.5)
  })

  it('pushes an ink authored for a light fill, and still omits an ink the theme never set', () => {
    const ink = surfaceThemeToCSS({ colors: { primary: '#f5d90a', textOnPrimary: '#ffffff' } })['--pw-color-text-on-primary']!
    expect(contrast(ink, '#f5d90a')).toBeGreaterThanOrEqual(4.5)
    expect(surfaceThemeToCSS({ colors: { primary: '#f5d90a' } })['--pw-color-text-on-primary']).toBeUndefined()
  })

  it('passes an unparseable primary and its ink through untouched', () => {
    const vars = surfaceThemeToCSS({ colors: { primary: 'var(--brand)', textOnPrimary: '#ffffff' } })
    expect(vars['--pw-color-text-on-primary']).toBe('#ffffff')
  })
})

describe('the focus ring clears 3:1 on page and card', () => {
  it('lifts indigo off midnight\'s ground', () => {
    const t = OLD.midnight
    expect(contrast('#4f46e5', t.colors.background)).toBeLessThan(3) // positive control: 2.84
    const ring = surfaceThemeToCSS(t)['--pw-focus-ring-color']!
    expect(contrast(ring, t.colors.background)).toBeGreaterThanOrEqual(3)
    expect(contrast(ring, t.colors.card)).toBeGreaterThanOrEqual(3)
  })

  it('keeps a near-black ring visible when zinc goes dark', () => {
    const dark = deriveDarkTheme(full(OLD.zinc))
    expect(dark.focus?.ringColor).toBe('#18181b') // the derivation passes it through: 1.08:1
    const vars = surfaceThemeToCSS(dark)
    const ring = vars['--pw-focus-ring-color']!
    expect(contrast(ring, dark.colors!.background!)).toBeGreaterThanOrEqual(3)
    expect(contrast(ring, dark.colors!.card!)).toBeGreaterThanOrEqual(3)
  })

  it('leaves a ring that already clears 3:1 untouched', () => {
    expect(surfaceThemeToCSS(PRESETS.forest!)['--pw-focus-ring-color']).toBe('#1a9447')
    expect(surfaceThemeToCSS(DEFAULT_APPEARANCE_THEME)['--pw-focus-ring-color']).toBe('#4f46e5')
  })

  it('emits the ring as written when the theme has no ground to measure against', () => {
    expect(surfaceThemeToCSS({ focus: { ringColor: '#4f46e5' } })['--pw-focus-ring-color']).toBe('#4f46e5')
  })

  it('returns the best compromise when no lightness clears both grounds', () => {
    const vars = surfaceThemeToCSS({ colors: { background: '#ffffff', card: '#000000' }, focus: { ringColor: '#777777' } })
    const ring = vars['--pw-focus-ring-color']!
    const worst = Math.min(contrast(ring, '#ffffff'), contrast(ring, '#000000'))
    // The best any grey can do against white AND black is ~4.58 — 3 is reachable here,
    // so the ring must clear it.
    expect(worst).toBeGreaterThanOrEqual(3)
  })
})

describe('deriveDarkTheme keeps text at AA on both dark grounds', () => {
  it('lifts midnight\'s textMuted off its derived card', () => {
    const dark = deriveDarkTheme(full(OLD.midnight))
    expect(contrast(dark.colors!.textMuted!, dark.colors!.card!)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(dark.colors!.text!, dark.colors!.card!)).toBeGreaterThanOrEqual(4.5)
  })

  it('does not move a derived text that already reads (light palettes unchanged)', () => {
    const light = full(PRESETS.forest!)
    const dark = deriveDarkTheme(light)
    // #14532d flipped into the 0.86–0.96 band reads on its own; ensureAgainst must not move it.
    expect(contrast(dark.colors!.text!, dark.colors!.background!)).toBeGreaterThan(7)
  })
})

describe('an explicit dark override sits on the DERIVED dark', () => {
  const light = full(PRESETS.forest!)
  const sparse: SurfaceTheme = { colors: { primary: '#86efac' } }

  it('keeps the derived dark ground and applies the one override', () => {
    const dark = resolveDarkTheme(light, sparse)
    expect(dark.colors?.primary).toBe('#86efac')
    expect(dark.colors?.background).toBe(deriveDarkTheme(light).colors?.background)
    expect(contrast(dark.colors!.background!, '#000000')).toBeLessThan(2)
    // Positive control: the old reading — sparse dark merged over the LIGHT default.
    const old = surfaceThemeToCSS(sparse, DEFAULT_APPEARANCE_THEME)
    expect(old['--pw-color-background']).toBe('#ffffff')
  })

  it('layers project overrides under surface overrides', () => {
    const dark = resolveDarkTheme(light, { colors: { accent: '#111111', text: '#fefefe' } }, { colors: { accent: '#222222' } })
    expect(dark.colors?.accent).toBe('#222222')
    expect(dark.colors?.text).toBe('#fefefe')
  })

  it('renders a fully baked dark variant as baked', () => {
    const baked = deriveDarkTheme(light)
    expect(resolveDarkTheme(light, baked)).toEqual(baked)
  })
})

describe('mergeSurfaceThemes', () => {
  it('merges each group shallowly, later layers winning, skipping undefined layers', () => {
    const merged = mergeSurfaceThemes(
      { colors: { primary: '#111111', text: '#222222' }, border: { radius: '4px' } },
      undefined,
      { colors: { primary: '#333333' }, typography: { fontFamily: 'Georgia' } }
    )
    expect(merged).toEqual({
      colors: { primary: '#333333', text: '#222222' },
      border: { radius: '4px' },
      typography: { fontFamily: 'Georgia' },
    })
  })

  it('does not mutate its inputs', () => {
    const a: SurfaceTheme = { colors: { primary: '#111111' } }
    mergeSurfaceThemes(a, { colors: { primary: '#222222' } })
    expect(a.colors?.primary).toBe('#111111')
  })
})

describe('themeContrastFindings — what renders, in every mode', () => {
  it('reports nothing for the six foundation 4.0.2 presets, light and derived dark', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const light = full(preset)
      expect(themeContrastFindings(light), `${name} light`).toEqual([])
      expect(themeContrastFindings(resolveDarkTheme(light)), `${name} dark`).toEqual([])
    }
  })

  it('does not report a pair the cascade corrects (old forest ink, old midnight ring)', () => {
    expect(themeContrastFindings(full(OLD.forest))).toEqual([])
    expect(themeContrastFindings(full(OLD.midnight))).toEqual([])
  })

  it('reports neutrals it cannot correct, with the pair, the ratio and the line', () => {
    const findings = themeContrastFindings(full({ colors: { text: '#cccccc', textMuted: '#dddddd' } }))
    const pairs = findings.map((f) => f.pair.join('/'))
    expect(pairs).toEqual(['text/background', 'text/card', 'textMuted/background', 'textMuted/card'])
    for (const f of findings) {
      expect(f.kind).toBe('text')
      expect(f.min).toBe(THEME_TEXT_CONTRAST_MIN)
      expect(f.ratio).toBeLessThan(THEME_TEXT_CONTRAST_MIN)
    }
  })

  it('reports a ring no lightness can rescue as a UI finding', () => {
    // A saturated ring on grounds of opposite polarity at 3:1 apart: nothing clears both.
    const findings = themeContrastFindings({
      colors: { background: '#ffffff', card: '#595959', text: '#000000', textMuted: '#000000' },
      focus: { ringColor: '#ff0000' },
    })
    const ring = findings.filter((f) => f.kind === 'ui')
    expect(ring.length).toBeGreaterThan(0)
    expect(ring[0]!.min).toBe(THEME_UI_CONTRAST_MIN)
  })

  it('skips unparseable values rather than passing or failing them', () => {
    expect(themeContrastFindings({ colors: { text: 'var(--ink)', background: '#ffffff' } })).toEqual([])
  })
})

describe('deriveDarkTheme derives a dark error colour that reads', () => {
  // An AA red on white; passed into dark unchanged it would not read.
  const light = full({ ...PRESETS.forest!, colors: { ...PRESETS.forest!.colors, error: '#b91c1c' } })

  it('no single red reads on both grounds — the reason the dark one is derived', () => {
    const dark = deriveDarkTheme(light)
    expect(contrast('#b91c1c', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    // Positive control: the light red on the derived dark ground — the old output.
    expect(contrast('#b91c1c', dark.colors!.background!)).toBeLessThan(4.5)
  })

  it('pushes error to 4.5:1 on the dark page and card, keeping its hue', () => {
    const dark = deriveDarkTheme(light)
    const err = dark.colors!.error!
    expect(err).not.toBe('#b91c1c')
    expect(contrast(err, dark.colors!.background!)).toBeGreaterThanOrEqual(THEME_TEXT_CONTRAST_MIN)
    expect(contrast(err, dark.colors!.card!)).toBeGreaterThanOrEqual(THEME_TEXT_CONTRAST_MIN)
    expect(Math.abs(hue(err) - hue('#b91c1c'))).toBeLessThan(3)
    // The light theme keeps the author's red.
    expect(light.colors!.error).toBe('#b91c1c')
  })

  it('reaches every shipped preset and the platform default', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const dark = deriveDarkTheme(full({ ...preset, colors: { ...preset.colors, error: '#b91c1c' } }))
      const c = dark.colors!
      expect(contrast(c.error!, c.background!), name).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.error!, c.card!), name).toBeGreaterThanOrEqual(4.5)
    }
    const dflt = deriveDarkTheme(full({})).colors!
    expect(contrast(dflt.error!, dflt.background!)).toBeGreaterThanOrEqual(4.5)
  })

  it('leaves an error that already reads on dark as authored', () => {
    const dark = deriveDarkTheme(full({ colors: { error: '#f87171' } }))
    expect(dark.colors!.error).toBe('#f87171')
  })

  it('reaches the resolved dark theme too, under a sparse override that does not touch error', () => {
    const dark = resolveDarkTheme(light, { colors: { primary: '#86efac' } })
    expect(contrast(dark.colors!.error!, dark.colors!.background!)).toBeGreaterThanOrEqual(4.5)
  })
})
