/**
 * Dark theme variant CSS generation tests.
 *
 * Asserts that an `appearance.config.darkTheme` is resolved + emitted as BOTH a
 * manual `[data-pw-theme="dark"]` rule AND a `@media (prefers-color-scheme:dark)`
 * rule carrying the dark `--pw-color-*` vars, and that the absence of a
 * darkTheme produces zero bytes.
 *
 * @module @pwfabric/runtime/render/__tests__/dark-theme-css
 */

import { describe, it, expect } from 'vitest'
import type { SurfaceAppearanceRef } from '@pwfabric/contracts'
import { buildDarkThemeCss } from '../dark-theme-css.js'
import { resolveAppearanceDarkVars } from '../appearance-resolver.js'

describe('dark-theme-css', () => {
  it('emits BOTH a force-dark rule and a prefers-color-scheme:dark rule with dark color vars', () => {
    const appearance: SurfaceAppearanceRef = {
      config: {
        theme: { colors: { background: '#ffffff', text: '#000000' } },
        darkTheme: { colors: { background: '#0b0b0f', text: '#f5f5f5' } },
      },
    }

    const darkVars = resolveAppearanceDarkVars(appearance)
    // The dark variant overrides the resolved color tokens.
    expect(darkVars['--pw-color-background']).toBe('#0b0b0f')
    expect(darkVars['--pw-color-text']).toBe('#f5f5f5')

    const css = buildDarkThemeCss(darkVars)

    // 1. Manual force-dark rule.
    expect(css).toContain('[data-pw-surface][data-pw-theme="dark"]{')
    // 2. Auto rule via OS preference, excluding force-light.
    expect(css).toContain(
      '@media (prefers-color-scheme:dark){[data-pw-surface]:not([data-pw-theme="light"]){'
    )
    // Dark color vars appear (in both rules — the body is shared).
    expect(css).toContain('--pw-color-background:#0b0b0f')
    expect(css).toContain('--pw-color-text:#f5f5f5')
    // The dark body is emitted twice (manual + auto).
    const occurrences = css.split('--pw-color-background:#0b0b0f').length - 1
    expect(occurrences).toBe(2)
  })

  it('DERIVES a dark variant when a themed surface declares no explicit darkTheme', () => {
    const appearance: SurfaceAppearanceRef = {
      config: { theme: { colors: { background: '#ffffff', text: '#111111' } } },
    }
    const darkVars = resolveAppearanceDarkVars(appearance)
    // Neutrals are flipped: a white page background becomes a dark one, dark ink
    // becomes light. (Exact hex is derivation-defined; assert the polarity flip.)
    const bg = darkVars['--pw-color-background']
    expect(bg).toBeDefined()
    expect(bg).not.toBe('#ffffff')
    expect(buildDarkThemeCss(darkVars)).toContain('@media (prefers-color-scheme:dark)')
  })

  it('buildDarkThemeCss returns "" for an empty var map', () => {
    expect(buildDarkThemeCss({})).toBe('')
  })

  it('emits nothing when appearance is undefined (no config → no dark)', () => {
    expect(resolveAppearanceDarkVars(undefined)).toEqual({})
  })

  it('emits nothing when appearance has no config at all', () => {
    expect(resolveAppearanceDarkVars({})).toEqual({})
  })

  // ------------------------------------------------------------------
  // Surface isolation
  // ------------------------------------------------------------------
  //
  // The selector used to match on the PRESENCE of `[data-pw-surface]`. The embed
  // autoloader hydrates every such element in a document, so a host page can
  // hold several surfaces with different palettes — each emitting its own
  // <style> with the same value-less selector and `!important`. Equal
  // specificity made DOCUMENT ORDER decide, so the last surface's dark palette
  // repainted all of them. Reproduced in Chromium before the fix: a blue-themed
  // surface computed the amber surface's dark background.

  it('scopes both rules to the surface id so siblings cannot collide', () => {
    const blue = buildDarkThemeCss({ '--pw-color-background': '#0a1a2f' }, 'surface-blue')
    const amber = buildDarkThemeCss({ '--pw-color-background': '#2f1a05' }, 'surface-amber')

    expect(blue).toContain('[data-pw-surface="surface-blue"][data-pw-theme="dark"]{')
    expect(blue).toContain(
      '@media (prefers-color-scheme:dark){[data-pw-surface="surface-blue"]:not([data-pw-theme="light"]){'
    )

    // Neither stylesheet may carry a selector that also matches the other
    // surface — that is exactly what let the last one in document order win.
    expect(blue).not.toContain('[data-pw-surface="surface-amber"]')
    expect(amber).not.toContain('[data-pw-surface="surface-blue"]')
    expect(blue).not.toContain('[data-pw-surface][data-pw-theme="dark"]')
    expect(amber).not.toContain('[data-pw-surface][data-pw-theme="dark"]')
  })

  it('escapes a surface id containing quotes so the selector cannot be broken out of', () => {
    const css = buildDarkThemeCss({ '--pw-color-background': '#000' }, 'we"ird')
    expect(css).toContain('[data-pw-surface="we\\"ird"]')
  })

  it('falls back to the unscoped selector when no surface id is supplied', () => {
    const css = buildDarkThemeCss({ '--pw-color-background': '#000' })
    expect(css).toContain('[data-pw-surface][data-pw-theme="dark"]{')
  })
})

// ---------------------------------------------------------------------------
// Project layer in the DERIVED dark variant
// ---------------------------------------------------------------------------
// The light path takes `projectTheme` as the middle cascade layer
// (resolveAppearanceVars), the dark path did not — it derived from the
// surface's own theme alone. A page inheriting its colours from its Project
// therefore rendered the project palette in light and the PLATFORM DEFAULT
// brand in dark. Measured on staging: light #C8102E (correct), dark #4f46e5.
describe('resolveAppearanceDarkVars — project theme layer', () => {
  const projectTheme = { colors: { primary: '#C8102E', accent: '#FFB81C' } }

  it('derives the dark variant from the project palette when the surface sets no brand of its own', () => {
    const darkVars = resolveAppearanceDarkVars({ config: { theme: {} } }, projectTheme)
    // Brand hues are KEPT by deriveDarkTheme — only neutrals flip — so the
    // project's brand must survive into dark.
    expect(darkVars['--pw-color-primary']?.toLowerCase()).toBe('#c8102e')
    expect(darkVars['--pw-color-accent']?.toLowerCase()).toBe('#ffb81c')
  })

  it("lets the surface's own token still beat the project's", () => {
    const darkVars = resolveAppearanceDarkVars(
      { config: { theme: { colors: { primary: '#00AA00' } } } },
      projectTheme
    )
    expect(darkVars['--pw-color-primary']?.toLowerCase()).toBe('#00aa00')
    expect(darkVars['--pw-color-accent']?.toLowerCase()).toBe('#ffb81c')
  })

  it('an explicitly baked darkTheme still wins — an author choice beats a derivation', () => {
    const darkVars = resolveAppearanceDarkVars(
      { config: { theme: {}, darkTheme: { colors: { primary: '#123456' } } } },
      projectTheme
    )
    expect(darkVars['--pw-color-primary']).toBe('#123456')
  })

  it('no config still means no dark CSS, project theme or not', () => {
    expect(resolveAppearanceDarkVars(undefined, projectTheme)).toEqual({})
    expect(resolveAppearanceDarkVars({}, projectTheme)).toEqual({})
  })
})

describe('resolveAppearanceDarkVars — an explicit dark theme OVERRIDES the derivation', () => {
  // An authoring tool may write darkTheme as sparse overrides; merged over the
  // LIGHT default, one edited dark colour would give a white page with dark
  // text in dark mode.
  const light = { colors: { primary: '#22c55e', background: '#f0fdf4', card: '#dcfce7', text: '#14532d' } }

  it('keeps the derived dark ground when only one dark colour is set', () => {
    const darkVars = resolveAppearanceDarkVars({
      config: { theme: light, darkTheme: { colors: { primary: '#86efac' } } },
    })
    expect(darkVars['--pw-color-primary']).toBe('#86efac')
    const derived = resolveAppearanceDarkVars({ config: { theme: light } })
    expect(darkVars['--pw-color-background']).toBe(derived['--pw-color-background'])
    expect(darkVars['--pw-color-background']).not.toBe('#ffffff')
    expect(darkVars['--pw-color-text']).toBe(derived['--pw-color-text'])
  })

  it("layers project dark overrides under the surface's own", () => {
    const darkVars = resolveAppearanceDarkVars(
      { config: { theme: light, darkTheme: { colors: { accent: '#222222' } } } },
      undefined,
      { colors: { accent: '#111111', border: '#333333' } }
    )
    expect(darkVars['--pw-color-accent']).toBe('#222222')
    expect(darkVars['--pw-color-border']).toBe('#333333')
  })

  it('applies project dark overrides even when the surface carries no config', () => {
    const darkVars = resolveAppearanceDarkVars(undefined, light, { colors: { accent: '#111111' } })
    expect(darkVars['--pw-color-accent']).toBe('#111111')
    expect(darkVars['--pw-color-background']).not.toBe('#ffffff')
  })
})
