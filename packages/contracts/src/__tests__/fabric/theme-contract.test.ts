/**
 * Theme contract: mode policy and brand fields, status inks, heading scale,
 * wider contrast findings, webfont allow-list, inverse set, and the ink-first
 * brand rule. Every "it is fixed" assertion sits next to a
 * positive control proving the check can fail.
 */

import { describe, it, expect } from 'vitest'
import {
  AppearanceConfigSchema,
  DEFAULT_APPEARANCE_THEME,
  THEME_STATUS_TOKENS,
  allowedWebfontsIn,
  brandInk,
  deriveDarkTheme,
  findAllowedWebfont,
  hexToRgb,
  isAllowedWebfont,
  mergeSurfaceThemes,
  parseFontStack,
  relativeLuminance,
  resolveAppearanceMode,
  resolveDarkTheme,
  surfaceThemeToCSS,
  themeContrastFindings,
  themeContrastLines,
  WEBFONT_ALLOW_LIST,
  type SurfaceTheme,
} from '../../fabric/index.js'

function ratio(a: string, b: string): number {
  const ra = hexToRgb(a)!
  const rb = hexToRgb(b)!
  const la = relativeLuminance(ra.r, ra.g, ra.b)
  const lb = relativeLuminance(rb.r, rb.g, rb.b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const full = (t: SurfaceTheme = {}): SurfaceTheme => mergeSurfaceThemes(DEFAULT_APPEARANCE_THEME, t)

/** Twelve palettes shaped like the TH round's: light, dark, pastel, saturated. */
const PALETTES: ReadonlyArray<SurfaceTheme['colors']> = [
  {},
  { primary: '#be185d', background: '#fff1f5', text: '#4a1f2b', error: '#f87171', success: '#4ade80' },
  { primary: '#22c55e', background: '#ffffff', card: '#f0fdf4', warning: '#fde047', info: '#38bdf8' },
  { primary: '#0ea5e9', background: '#0f172a', card: '#1e293b', text: '#e2e8f0', textMuted: '#94a3b8' },
  { primary: '#f97316', background: '#fffbeb', error: '#fca5a5', success: '#86efac', warning: '#fcd34d' },
  { primary: '#18181b', background: '#fafafa', card: '#ffffff', info: '#93c5fd' },
  { primary: '#a78bfa', background: '#1c1917', card: '#292524', text: '#fafaf9', error: '#ef4444' },
  { primary: '#cf6438', background: '#fdf6ee', card: '#fff', success: '#16a34a', warning: '#d97706' },
  { primary: '#e11d48', background: '#ffffff', error: '#fda4af', info: '#7dd3fc' },
  { primary: '#14b8a6', background: '#f0fdfa', card: '#ccfbf1', success: '#5eead4' },
  { primary: '#6366f1', background: '#eef2ff', warning: '#facc15', error: '#dc2626' },
  { primary: '#854d0e', background: '#fefce8', card: '#fef9c3', info: '#0284c7' },
]

describe('mode policy, contrast level, brand assets', () => {
  it('defaults to system / normal, and ignores unknown values', () => {
    expect(resolveAppearanceMode(undefined)).toEqual({ policy: 'system', contrast: 'normal' })
    expect(resolveAppearanceMode({ theme: {} })).toEqual({ policy: 'system', contrast: 'normal' })
    expect(resolveAppearanceMode({ mode: { policy: 'sepia', contrast: 7 } })).toEqual({
      policy: 'system',
      contrast: 'normal',
    })
  })

  it('reads a stated policy and contrast', () => {
    expect(resolveAppearanceMode({ mode: { policy: 'light' } })).toEqual({ policy: 'light', contrast: 'normal' })
    expect(resolveAppearanceMode({ mode: { policy: 'dark', contrast: 'high' } })).toEqual({
      policy: 'dark',
      contrast: 'high',
    })
  })

  it('the schema accepts mode and brand, and refuses a bad policy (positive control)', () => {
    const ok = AppearanceConfigSchema.safeParse({
      theme: {},
      mode: { policy: 'light', contrast: 'high' },
      brand: { logo: '/api/public/media/w1/logo.svg', favicon: '/api/public/media/w1/icon.png' },
    })
    expect(ok.success).toBe(true)
    expect(AppearanceConfigSchema.safeParse({ mode: { policy: 'sepia' } }).success).toBe(false)
    expect(AppearanceConfigSchema.safeParse({ brand: { logo: '' } }).success).toBe(false)
    // A config without the newer fields still parses.
    expect(AppearanceConfigSchema.safeParse({ theme: { colors: { primary: '#000' } } }).success).toBe(true)
  })

  it('high contrast raises the lines to 7 / 4.5', () => {
    expect(themeContrastLines()).toEqual({ text: 4.5, ui: 3 })
    expect(themeContrastLines('high')).toEqual({ text: 7, ui: 4.5 })
  })
})

describe('status inks and status text tones', () => {
  it('positive control: the default error red does NOT read as text on white', () => {
    expect(ratio(DEFAULT_APPEARANCE_THEME.colors!.error!, '#ffffff')).toBeLessThan(4.5)
  })

  it('every on-<status> ink reads on its fill, in 12 palettes x 2 modes', () => {
    for (const colors of PALETTES) {
      const light = full({ colors })
      for (const theme of [light, resolveDarkTheme(light)]) {
        const vars = surfaceThemeToCSS(theme)
        for (const s of THEME_STATUS_TOKENS) {
          const fill = theme.colors![s]!
          expect(ratio(vars[`--pw-color-on-${s}`]!, fill), `${s} on ${fill}`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('every <status>-ink reads on the page and the card, in 12 palettes x 2 modes', () => {
    for (const colors of PALETTES) {
      const light = full({ colors })
      for (const theme of [light, resolveDarkTheme(light)]) {
        const vars = surfaceThemeToCSS(theme)
        const c = theme.colors!
        for (const s of THEME_STATUS_TOKENS) {
          const ink = vars[`--pw-color-${s}-ink`]!
          expect(ratio(ink, c.background!), `${s}-ink on page`).toBeGreaterThanOrEqual(4.5)
          expect(ratio(ink, c.card!), `${s}-ink on card`).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
  })

  it('an ink that already reads is left as authored', () => {
    const vars = surfaceThemeToCSS(full({ colors: { error: '#b91c1c' } }))
    expect(vars['--pw-color-error-ink']).toBe('#b91c1c')
  })

  it('dark derives success, warning and info to the text line, like error', () => {
    const light = full({ colors: { success: '#15803d', warning: '#b45309', info: '#1d4ed8' } })
    // Positive control: these AA-on-white colours fail on the derived dark page.
    const bg = deriveDarkTheme(light).colors!.background!
    expect(ratio('#15803d', bg)).toBeLessThan(4.5)
    expect(ratio('#1d4ed8', bg)).toBeLessThan(4.5)
    const dark = deriveDarkTheme(light).colors!
    for (const s of ['success', 'warning', 'info'] as const) {
      expect(ratio(dark[s]!, dark.background!), s).toBeGreaterThanOrEqual(4.5)
      expect(ratio(dark[s]!, dark.card!), s).toBeGreaterThanOrEqual(4.5)
    }
    // The light values are the author's.
    expect(light.colors!.success).toBe('#15803d')
  })

  it('high contrast pushes the status inks to 7:1 where reachable', () => {
    const theme = full()
    const vars = surfaceThemeToCSS(theme, undefined, undefined, { contrast: 'high' })
    expect(ratio(vars['--pw-color-error-ink']!, '#ffffff')).toBeGreaterThanOrEqual(7)
    expect(ratio(vars['--pw-color-text-on-primary']!, theme.colors!.primary!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('heading scale', () => {
  it('an unstated level points at its step of the type ramp (no visual change)', () => {
    const vars = surfaceThemeToCSS(full())
    expect(vars['--pw-font-size-h1']).toBe('var(--pw-font-size-4xl, 2.25rem)')
    expect(vars['--pw-font-size-h5']).toBe('var(--pw-font-size-lg, 1.125rem)')
  })

  it('a stated level wins', () => {
    const vars = surfaceThemeToCSS(full({ typography: { fontSizeH1: '3.25rem', fontSizeH3: '1.75rem' } }))
    expect(vars['--pw-font-size-h1']).toBe('3.25rem')
    expect(vars['--pw-font-size-h3']).toBe('1.75rem')
    expect(vars['--pw-font-size-h2']).toBe('var(--pw-font-size-3xl, 1.875rem)')
  })

  it('a theme with no typography group emits none', () => {
    expect(surfaceThemeToCSS({ colors: { primary: '#000000' } })['--pw-font-size-h1']).toBeUndefined()
  })
})

describe('wider contrast findings', () => {
  it('without the option the findings are exactly the base set (gate unchanged)', () => {
    const t = full({ colors: { error: '#f87171' } })
    const base = themeContrastFindings(t)
    expect(base).toEqual([])
    expect(base.every((f) => !('group' in f))).toBe(true)
  })

  it('positive control: a 2.6:1 error colour is reported, a fixed one is not', () => {
    const failing = themeContrastFindings(full({ colors: { error: '#f87171' } }), { extended: true })
    const e = failing.find((f) => f.pair[0] === 'error' && f.pair[1] === 'background')
    expect(e).toMatchObject({ group: 'status', kind: 'text', min: 4.5 })
    expect(e!.ratio).toBeLessThan(3)
    const fixed = themeContrastFindings(full({ colors: { error: '#b91c1c' } }), { extended: true })
    expect(fixed.some((f) => f.pair[0] === 'error')).toBe(false)
  })

  it('status inks and on-status inks pass once the cascade pushes them', () => {
    for (const colors of PALETTES) {
      const light = full({ colors })
      for (const theme of [light, resolveDarkTheme(light)]) {
        const found = themeContrastFindings(theme, { extended: true })
        expect(found.filter((f) => /Ink$|^on[A-Z]/.test(f.pair[0]))).toEqual([])
      }
    }
  })

  it('reports a selected fill that cannot be told from its unselected neighbour', () => {
    const found = themeContrastFindings(full({ colors: { primary: '#eef2ff' } }), { extended: true })
    expect(found.find((f) => f.pair[0] === 'primary' && f.pair[1] === 'card')).toMatchObject({
      group: 'selection',
      kind: 'ui',
      min: 3,
    })
    // Negative control: the default indigo is distinct.
    expect(
      themeContrastFindings(full(), { extended: true }).some((f) => f.group === 'selection')
    ).toBe(false)
  })

  it('the control edge is pushed to 3:1, so the faint default border passes', () => {
    const vars = surfaceThemeToCSS(full())
    // Positive control: the divider colour itself is far under the line.
    expect(ratio(DEFAULT_APPEARANCE_THEME.colors!.border!, '#ffffff')).toBeLessThan(3)
    expect(ratio(vars['--pw-color-control-border']!, '#ffffff')).toBeGreaterThanOrEqual(3)
    expect(ratio(vars['--pw-color-control-border']!, '#f8fafc')).toBeGreaterThanOrEqual(3)
    expect(themeContrastFindings(full(), { extended: true }).some((f) => f.group === 'control')).toBe(false)
  })

  it('high contrast raises the base lines too', () => {
    // #64748b muted text on white is 4.76: AA passes, the high line does not.
    expect(themeContrastFindings(full())).toEqual([])
    const high = themeContrastFindings(full(), { contrast: 'high' })
    expect(high.find((f) => f.pair[0] === 'textMuted' && f.pair[1] === 'background')).toMatchObject({ min: 7 })
  })
})

describe('webfont allow-list', () => {
  it('parses a stack and keeps only allowed families, in order', () => {
    expect(parseFontStack(`"Playfair Display", Georgia, serif`)).toEqual(['Playfair Display', 'Georgia', 'serif'])
    expect(allowedWebfontsIn(`"Playfair Display", 'EB Garamond', Georgia, serif`).map((w) => w.family)).toEqual([
      'Playfair Display',
      'EB Garamond',
    ])
    expect(allowedWebfontsIn('Palatino, serif')).toEqual([])
    expect(allowedWebfontsIn(undefined)).toEqual([])
  })

  it('matches case-insensitively and refuses unknown families', () => {
    expect(isAllowedWebfont('nunito')).toBe(true)
    expect(isAllowedWebfont('Comic Sans MS')).toBe(false)
    expect(findAllowedWebfont('Inter')?.category).toBe('sans')
  })

  it('every entry is unique and covers Turkish', () => {
    const names = WEBFONT_ALLOW_LIST.map((w) => w.family.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
    expect(WEBFONT_ALLOW_LIST.every((w) => w.latinExt && w.weights.length > 0)).toBe(true)
  })

  it('lists Newsreader, Fira Code, Roboto Mono and Source Code Pro', () => {
    expect(findAllowedWebfont('Newsreader')).toMatchObject({ category: 'serif', italic: true, source: 'google' })
    expect(findAllowedWebfont('Fira Code')).toMatchObject({ category: 'mono', italic: false })
    expect(findAllowedWebfont('Roboto Mono')).toMatchObject({ category: 'mono', italic: true })
    expect(findAllowedWebfont('Source Code Pro')).toMatchObject({ category: 'mono', italic: true })
    expect(allowedWebfontsIn('Newsreader, Georgia, serif').map((w) => w.family)).toEqual(['Newsreader'])
  })

  it('keeps each category alphabetical', () => {
    for (const cat of ['sans', 'serif', 'display', 'mono'] as const) {
      const names = WEBFONT_ALLOW_LIST.filter((w) => w.category === cat).map((w) => w.family)
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    }
  })
})

describe('inverse set', () => {
  it('the inverse ground is the mode text colour, its ink reads on it', () => {
    for (const colors of PALETTES) {
      const light = full({ colors })
      for (const theme of [light, resolveDarkTheme(light)]) {
        const vars = surfaceThemeToCSS(theme)
        expect(vars['--pw-color-inverse-background']).toBe(theme.colors!.text)
        const bg = vars['--pw-color-inverse-background']!
        expect(ratio(vars['--pw-color-inverse-text']!, bg)).toBeGreaterThanOrEqual(4.5)
        expect(ratio(vars['--pw-color-inverse-primary']!, bg)).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('is the page turned inside out: dark on a light page, light on a dark one', () => {
    const lum = (hex: string): number => {
      const c = hexToRgb(hex)!
      return relativeLuminance(c.r, c.g, c.b)
    }
    const light = full()
    expect(lum(surfaceThemeToCSS(light)['--pw-color-inverse-background']!)).toBeLessThan(0.2)
    expect(lum(surfaceThemeToCSS(resolveDarkTheme(light))['--pw-color-inverse-background']!)).toBeGreaterThan(0.5)
  })
})

describe('ink first, brand last', () => {
  it('a brand whose ink can read is never moved', () => {
    const r = brandInk('#4f46e5')
    expect(r).toMatchObject({ brand: '#4f46e5', darkened: 0, meets: true })
    expect(ratio(r.ink, r.brand)).toBeGreaterThanOrEqual(4.5)
  })

  it('the ink moves before the brand does (white on forest green becomes a deep ink)', () => {
    const r = brandInk('#22c55e', { ink: '#ffffff' })
    expect(r.brand).toBe('#22c55e')
    expect(r.darkened).toBe(0)
    expect(ratio(r.ink, '#22c55e')).toBeGreaterThanOrEqual(4.5)
  })

  it('only when no ink reaches the line does the brand darken, by at most 4%', () => {
    // Positive control: neither black nor white reaches 5:1 on this grey.
    expect(ratio('#000000', '#737373')).toBeLessThan(5)
    expect(ratio('#ffffff', '#737373')).toBeLessThan(5)
    const r = brandInk('#737373', { min: 5 })
    expect(r.meets).toBe(true)
    expect(r.darkened).toBeGreaterThan(0)
    expect(r.darkened).toBeLessThanOrEqual(0.04)
    expect(ratio(r.ink, r.brand)).toBeGreaterThanOrEqual(5)
  })

  it('never darkens past the cap: an unreachable line is reported, not forced', () => {
    const r = brandInk('#808080', { min: 7 })
    expect(r).toMatchObject({ brand: '#808080', darkened: 0, meets: false })
  })
})
