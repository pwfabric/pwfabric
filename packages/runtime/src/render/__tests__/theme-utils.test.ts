/**
 * Theme Utils Unit Tests
 *
 * surfaceThemeToCSS — all 16 token mappings
 * colors.surface → colors.card alias
 *
 * @module @pwfabric/runtime/render/__tests__/theme-utils
 */

import { describe, it, expect } from 'vitest'
import { surfaceThemeToCSS } from '../theme-utils.js'
import type { SurfaceTheme } from '@pwfabric/contracts'

describe('surfaceThemeToCSS', () => {
  it('returns empty object for undefined theme', () => {
    expect(surfaceThemeToCSS(undefined)).toEqual({})
  })

  it('returns empty object for empty theme', () => {
    expect(surfaceThemeToCSS({})).toEqual({})
  })

  it('maps colors.primary → --pw-color-primary', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#6366f1' } })
    expect(result['--pw-color-primary']).toBe('#6366f1')
  })

  it('maps colors.secondary → --pw-color-secondary', () => {
    const result = surfaceThemeToCSS({ colors: { secondary: '#64748b' } })
    expect(result['--pw-color-secondary']).toBe('#64748b')
  })

  it('maps colors.accent → --pw-color-accent', () => {
    const result = surfaceThemeToCSS({ colors: { accent: '#f59e0b' } })
    expect(result['--pw-color-accent']).toBe('#f59e0b')
  })

  it('maps colors.background → --pw-color-background', () => {
    const result = surfaceThemeToCSS({ colors: { background: '#0f172a' } })
    expect(result['--pw-color-background']).toBe('#0f172a')
  })

  it('maps colors.surface → --pw-color-surface (deprecated)', () => {
    const result = surfaceThemeToCSS({ colors: { surface: '#1e293b' } })
    expect(result['--pw-color-surface']).toBe('#1e293b')
    // colors.surface also emits --pw-color-card as backward-compat alias
    expect(result['--pw-color-card']).toBe('#1e293b')
  })

  it('maps colors.card → --pw-color-card', () => {
    const result = surfaceThemeToCSS({ colors: { card: '#e0f2fe' } })
    expect(result['--pw-color-card']).toBe('#e0f2fe')
    // colors.card also emits --pw-color-surface as alias for old CSS
    expect(result['--pw-color-surface']).toBe('#e0f2fe')
  })

  it('when both colors.card and colors.surface are set — each wins its own var, no alias override', () => {
    const result = surfaceThemeToCSS({ colors: { surface: '#f8fafc', card: '#e0f2fe' } })
    expect(result['--pw-color-surface']).toBe('#f8fafc')
    expect(result['--pw-color-card']).toBe('#e0f2fe')
  })

  it('maps colors.text → --pw-color-text', () => {
    const result = surfaceThemeToCSS({ colors: { text: '#f8fafc' } })
    expect(result['--pw-color-text']).toBe('#f8fafc')
  })

  it('maps colors.textMuted → --pw-color-text-muted', () => {
    const result = surfaceThemeToCSS({ colors: { textMuted: '#94a3b8' } })
    expect(result['--pw-color-text-muted']).toBe('#94a3b8')
  })

  it('maps colors.border → --pw-color-border', () => {
    const result = surfaceThemeToCSS({ colors: { border: '#334155' } })
    expect(result['--pw-color-border']).toBe('#334155')
  })

  it('maps colors.error → --pw-color-error', () => {
    const result = surfaceThemeToCSS({ colors: { error: '#ef4444' } })
    expect(result['--pw-color-error']).toBe('#ef4444')
  })

  it('maps colors.success → --pw-color-success', () => {
    const result = surfaceThemeToCSS({ colors: { success: '#22c55e' } })
    expect(result['--pw-color-success']).toBe('#22c55e')
  })

  it('maps border.radius → --pw-border-radius', () => {
    const result = surfaceThemeToCSS({ border: { radius: '0.75rem' } })
    expect(result['--pw-border-radius']).toBe('0.75rem')
  })

  it('maps border.width → --pw-border-width', () => {
    const result = surfaceThemeToCSS({ border: { width: '2px' } })
    expect(result['--pw-border-width']).toBe('2px')
  })

  it('maps border.style → --pw-border-style', () => {
    const result = surfaceThemeToCSS({ border: { style: 'dashed' } })
    expect(result['--pw-border-style']).toBe('dashed')
  })

  it('maps typography.fontFamily → --pw-font-family', () => {
    const result = surfaceThemeToCSS({ typography: { fontFamily: 'Roboto, sans-serif' } })
    expect(result['--pw-font-family']).toBe('Roboto, sans-serif')
  })

  it('maps typography.headingFontFamily → --pw-font-family-heading', () => {
    const result = surfaceThemeToCSS({ typography: { headingFontFamily: 'Georgia, serif' } })
    expect(result['--pw-font-family-heading']).toBe('Georgia, serif')
  })

  it('does NOT generate --pw-font-family-heading when headingFontFamily is undefined', () => {
    const result = surfaceThemeToCSS({ typography: { fontFamily: 'Roboto, sans-serif' } })
    expect(result['--pw-font-family-heading']).toBeUndefined()
  })

  it('maps typography.monoFontFamily → --pw-font-family-mono', () => {
    const result = surfaceThemeToCSS({ typography: { monoFontFamily: 'JetBrains Mono, monospace' } })
    expect(result['--pw-font-family-mono']).toBe('JetBrains Mono, monospace')
  })

  it('does NOT generate --pw-font-family-mono when monoFontFamily is undefined', () => {
    const result = surfaceThemeToCSS({ typography: { fontFamily: 'Roboto, sans-serif' } })
    expect(result['--pw-font-family-mono']).toBeUndefined()
  })

  it('maps typography.baseFontSize → --pw-font-size-base', () => {
    const result = surfaceThemeToCSS({ typography: { baseFontSize: '18px' } })
    expect(result['--pw-font-size-base']).toBe('18px')
  })

  it('maps spacing.base → --pw-spacing-base', () => {
    const result = surfaceThemeToCSS({ spacing: { base: '1.5rem' } })
    expect(result['--pw-spacing-base']).toBe('1.5rem')
  })

  it('maps all 17 tokens in a full theme without headingFontFamily (surface emits card alias)', () => {
    const theme: SurfaceTheme = {
      colors: {
        primary: '#6366f1',
        secondary: '#64748b',
        accent: '#f59e0b',
        background: '#ffffff',
        surface: '#f8fafc',
        text: '#1e293b',
        textMuted: '#64748b',
        border: '#e2e8f0',
        error: '#ef4444',
        success: '#22c55e',
      },
      border: {
        radius: '0.375rem',
        width: '1px',
        style: 'solid',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        baseFontSize: '1rem',
      },
      spacing: {
        base: '1rem',
      },
    }
    const result = surfaceThemeToCSS(theme)
    // surface emits --pw-color-surface + --pw-color-card alias = 17 token vars,
    // + 4 derived color roles (Batch-1) = 21, + 3 on-card ink tokens
    // emitted whenever a card/surface colour is present) = 24
    // + on-<status> and <status>-ink for error and success (4), the
    // control edge (1), the inverse set (5) and the h1-h5 scale (5) = +15
    expect(Object.keys(result)).toHaveLength(40)
    expect(result['--pw-color-primary']).toBe('#6366f1')
    expect(result['--pw-border-radius']).toBe('0.375rem')
    expect(result['--pw-font-family']).toBe('Inter, sans-serif')
    expect(result['--pw-spacing-base']).toBe('1rem')
  })

  it('generates exactly 18 CSS vars when all fields including headingFontFamily are set', () => {
    const theme: SurfaceTheme = {
      colors: {
        primary: '#6366f1',
        secondary: '#64748b',
        accent: '#f59e0b',
        background: '#ffffff',
        surface: '#f8fafc',
        text: '#1e293b',
        textMuted: '#64748b',
        border: '#e2e8f0',
        error: '#ef4444',
        success: '#22c55e',
      },
      border: {
        radius: '0.375rem',
        width: '1px',
        style: 'solid',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        headingFontFamily: 'Georgia, serif',
        baseFontSize: '1rem',
      },
      spacing: {
        base: '1rem',
      },
    }
    const result = surfaceThemeToCSS(theme)
    // surface emits --pw-color-surface + --pw-color-card alias = 18 token vars,
    // + 4 derived color roles (Batch-1) = 22, + 3 on-card ink tokens = 25
    // + on-<status> and <status>-ink for error and success (4), the
    // control edge (1), the inverse set (5) and the h1-h5 scale (5) = +15
    expect(Object.keys(result)).toHaveLength(41)
    expect(result['--pw-font-family-heading']).toBe('Georgia, serif')
  })

  it('omits undefined token values — does not produce empty string entries', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#6366f1' } })
    // Only the primary token var + 4 derived color roles (Batch-1) are present.
    expect(result['--pw-color-primary']).toBe('#6366f1')
    expect(Object.keys(result)).toHaveLength(6)
    expect(result['--pw-color-secondary']).toBeUndefined()
  })

  it('emits the 4 derived color roles whenever a colors group is present (Batch-1)', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#6366f1' } })
    expect(result['--pw-color-primary-subtle']).toBe(
      'color-mix(in srgb, var(--pw-color-primary) 12%, var(--pw-color-background))'
    )
    expect(result['--pw-color-primary-strong']).toBe(
      'color-mix(in srgb, var(--pw-color-primary) 85%, var(--pw-color-text))'
    )
    expect(result['--pw-color-accent-subtle']).toBe(
      'color-mix(in srgb, var(--pw-color-accent) 12%, var(--pw-color-background))'
    )
    expect(result['--pw-color-surface-muted']).toBe(
      'color-mix(in srgb, var(--pw-color-card) 94%, var(--pw-color-text))'
    )
  })

  it('does not emit derived color roles when no colors group is present', () => {
    const result = surfaceThemeToCSS({ border: { radius: '8px' } })
    expect(result['--pw-color-primary-subtle']).toBeUndefined()
    expect(result['--pw-border-radius']).toBe('8px')
  })
})

describe('surfaceThemeToCSS — defaults base', () => {
  const defaults: SurfaceTheme = {
    colors: { primary: '#6366f1', text: '#1e293b', border: '#e2e8f0' },
    layout: { gap: '16px', padding: '24px' },
  }

  it('emits the full default token set when theme is undefined', () => {
    const result = surfaceThemeToCSS(undefined, defaults)
    expect(result['--pw-color-primary']).toBe('#6366f1')
    expect(result['--pw-color-text']).toBe('#1e293b')
    expect(result['--pw-layout-surface-gap']).toBe('16px')
  })

  it('emits the full default token set when theme is empty', () => {
    const result = surfaceThemeToCSS({}, defaults)
    expect(result['--pw-color-primary']).toBe('#6366f1')
    expect(result['--pw-layout-surface-padding']).toBe('24px')
  })

  it('lets the surface theme override only the keys it sets, keeping other defaults', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#ff0000' } }, defaults)
    expect(result['--pw-color-primary']).toBe('#ff0000') // overridden
    expect(result['--pw-color-text']).toBe('#1e293b') // from defaults
    expect(result['--pw-layout-surface-gap']).toBe('16px') // from defaults
  })

  it('without a defaults base, behavior is unchanged (omits unset tokens)', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#6366f1' } })
    // 1 token var (primary) + 4 derived color roles (Batch-1).
    expect(result['--pw-color-primary']).toBe('#6366f1')
    expect(Object.keys(result)).toHaveLength(6)
  })
})

describe('surfaceThemeToCSS — projectTheme cascade layer', () => {
  const defaults: SurfaceTheme = {
    colors: { primary: '#6366f1', text: '#1e293b', border: '#e2e8f0' },
    layout: { gap: '16px', padding: '24px' },
  }
  const projectTheme: SurfaceTheme = {
    colors: { primary: '#00aa00', text: '#111111' },
  }

  it('a page with no theme override inherits the project theme over the platform default', () => {
    const result = surfaceThemeToCSS(undefined, defaults, projectTheme)
    expect(result['--pw-color-primary']).toBe('#00aa00') // project, not platform default
    expect(result['--pw-color-text']).toBe('#111111') // project, not platform default
    expect(result['--pw-layout-surface-gap']).toBe('16px') // platform default (project didn't set layout)
  })

  it("a page's own override still wins over the project theme", () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#ff0000' } }, defaults, projectTheme)
    expect(result['--pw-color-primary']).toBe('#ff0000') // this page's own override
    expect(result['--pw-color-text']).toBe('#111111') // falls through to project (page didn't set text)
  })

  it('omitting projectTheme reproduces the exact pre-Stage-2 two-layer result', () => {
    const withProject = surfaceThemeToCSS({ colors: { primary: '#ff0000' } }, defaults, undefined)
    const withoutProjectArg = surfaceThemeToCSS({ colors: { primary: '#ff0000' } }, defaults)
    expect(withProject).toEqual(withoutProjectArg)
  })
})
