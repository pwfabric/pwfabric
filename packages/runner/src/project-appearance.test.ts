/**
 * `pwpack/appearance.json` → embed `appearance` option shape.
 *
 * The two are NOT the same shape, and nothing checked the handoff. The project
 * file holds a CONFIG (`{ theme, styleVariables, … }`); embed's option is a
 * surface appearance REF (`{ config }`) that OVERRIDES `surface.appearance`
 * outright. Passing the config straight through replaced each surface's correct
 * ref with an object the resolver cannot read — it looks for
 * `appearance.config.theme`, finds nothing, and falls back to the platform
 * baseline.
 *
 * Every exported app would paint indigo regardless of the theme it shipped (a
 * zinc `#18181b` primary would render as `#4f46e5`).
 *
 * @module @pwfabric/runner/project-appearance.test
 */

import { describe, it, expect } from 'vitest'
import { projectAppearanceRef } from './run-app.js'
import { THEME_PRESETS } from './theme-presets.js'

describe('projectAppearanceRef', () => {
  it('wraps a bare config so the resolver can read config.theme', () => {
    const config = { theme: { colors: { primary: '#18181b' } }, styleVariables: {} }
    const ref = projectAppearanceRef(config)
    expect(ref).toEqual({ config })
    // The shape the resolver actually reaches for:
    expect((ref as { config: { theme: { colors: { primary: string } } } }).config.theme.colors.primary).toBe('#18181b')
  })

  it('recognises a config by any of its token groups', () => {
    for (const key of ['theme', 'styleVariables', 'darkTheme', 'keyframes']) {
      const config = { [key]: {} }
      expect(projectAppearanceRef(config)).toEqual({ config })
    }
  })

  it('passes an already-ref-shaped value through untouched', () => {
    // A pwpack written before this fix, or one whose project file was authored
    // as a ref, must not get double-wrapped into `{ config: { config } }`.
    const ref = { config: { theme: { colors: { primary: '#fabd00' } } } }
    expect(projectAppearanceRef(ref)).toBe(ref)
  })

  it('passes the legacy { use } fallback through rather than wrapping it', () => {
    // `assembleWebApp` used to write `{ use: 'default' }` when a project had no
    // snapshot. It carries no tokens, so wrapping it would invent an empty
    // config that overrides the surface's real one.
    const legacy = { use: 'default' }
    expect(projectAppearanceRef(legacy)).toBeUndefined()
  })

  it('returns undefined for nothing, so the surface ref survives', () => {
    // The caller falls back to `receipt.appearance` — the surface's own, correct
    // ref. Returning a truthy empty object here would override it with nothing.
    expect(projectAppearanceRef(null)).toBeUndefined()
    expect(projectAppearanceRef(undefined)).toBeUndefined()
    expect(projectAppearanceRef('nope')).toBeUndefined()
    expect(projectAppearanceRef(42)).toBeUndefined()
  })
})

describe('projectAppearanceRef — a bare theme name resolves to its tokens', () => {
  // Apps written before the backend resolved names carry { use } and nothing
  // else; the name used to resolve to nothing and the app painted indigo.
  it('resolves { use: "theme-zinc" } to the zinc token set', () => {
    const ref = projectAppearanceRef({ use: 'theme-zinc' })
    const theme = ref?.config['theme'] as { colors: { primary: string }; typography: { fontFamily: string } }
    expect(theme.colors.primary).toBe('#18181b')
    expect(theme.typography.fontFamily).toBe(
      (THEME_PRESETS['theme-zinc'] as { typography: { fontFamily: string } }).typography.fontFamily
    )
    expect(ref?.config['use']).toBeUndefined()
  })

  it('accepts the bare name too ("forest")', () => {
    const theme = projectAppearanceRef({ use: 'forest' })?.config['theme'] as { colors: { primary: string } }
    expect(theme.colors.primary).toBe('#22c55e')
  })

  it('lets the colours the document states win over the preset (a stated brand palette)', () => {
    const ref = projectAppearanceRef({ use: 'theme-ocean', theme: { colors: { primary: '#e8590c' } }, darkTheme: { colors: { accent: '#111111' } } })
    const theme = ref?.config['theme'] as { colors: { primary: string; background: string }; border: { radius: string } }
    expect(theme.colors.primary).toBe('#e8590c')
    // Everything else still comes from the preset, not the platform default.
    expect(theme.colors.background).toBe('#f0f9ff')
    expect(theme.border.radius).toBe((THEME_PRESETS['theme-ocean'] as { border: { radius: string } }).border.radius)
    expect(ref?.config['darkTheme']).toEqual({ colors: { accent: '#111111' } })
  })

  it('leaves an unknown name alone (positive control: no preset, no invented tokens)', () => {
    expect(projectAppearanceRef({ use: 'hizlikargo' })).toBeUndefined()
    expect(projectAppearanceRef({ use: 'hizlikargo', theme: { colors: { primary: '#000000' } } })).toEqual({
      config: { use: 'hizlikargo', theme: { colors: { primary: '#000000' } } },
    })
  })

  it('does not mutate the preset table', () => {
    const before = JSON.stringify(THEME_PRESETS['theme-rose'])
    projectAppearanceRef({ use: 'theme-rose', theme: { colors: { primary: '#000000' } } })
    expect(JSON.stringify(THEME_PRESETS['theme-rose'])).toBe(before)
  })

  it('carries the six foundation themes', () => {
    expect(Object.keys(THEME_PRESETS).sort()).toEqual([
      'theme-forest',
      'theme-midnight',
      'theme-ocean',
      'theme-rose',
      'theme-sunset',
      'theme-zinc',
    ])
  })
})
