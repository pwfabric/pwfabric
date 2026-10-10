/**
 * Theme Utils — New Token Mapping Tests (RED phase)
 *
 * Tests for the 11 new tokens being added in the theme system expansion
 * from 17 to 28 tokens:
 *
 * Colors (3):   warning, info, textOnPrimary
 * Border (1):   radiusLarge
 * Shadows (2):  card, button
 * Motion (5):   durationFast, durationNormal, durationSlow, easing, easingBounce
 *
 * These tests MUST fail until:
 *   1. @pwfabric/contracts — SurfaceThemeColors, SurfaceThemeBorder gain new fields;
 *      SurfaceThemeShadows and SurfaceThemeMotion interfaces are created;
 *      SurfaceTheme gains `shadows` and `motion` top-level keys.
 *   2. @pwfabric/runtime — surfaceThemeToCSS() maps all 11 new tokens to
 *      their corresponding --pw-* CSS custom properties.
 *
 * @module @pwfabric/runtime/render/__tests__/theme-utils-new-tokens
 */

import { describe, it, expect } from 'vitest'
import { surfaceThemeToCSS } from '../theme-utils.js'
import type { SurfaceTheme } from '@pwfabric/contracts'

// ---------------------------------------------------------------------------
// COLOR TOKENS (3 new)
// ---------------------------------------------------------------------------

describe('surfaceThemeToCSS — new color tokens', () => {
  it('should map colors.warning to --pw-color-warning', () => {
    // Arrange
    const theme: SurfaceTheme = { colors: { warning: '#f59e0b' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-color-warning']).toBe('#f59e0b')
  })

  it('should map colors.info to --pw-color-info', () => {
    // Arrange
    const theme: SurfaceTheme = { colors: { info: '#0369a1' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-color-info']).toBe('#0369a1')
  })

  it('should map colors.textOnPrimary to --pw-color-text-on-primary', () => {
    // Arrange
    const theme: SurfaceTheme = { colors: { textOnPrimary: '#ffffff' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-color-text-on-primary']).toBe('#ffffff')
  })

  it('should omit --pw-color-warning when colors.warning is undefined', () => {
    // Arrange
    const theme: SurfaceTheme = { colors: { primary: '#6366f1' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-color-warning']).toBeUndefined()
  })

  it('should omit --pw-color-info when colors.info is undefined', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#6366f1' } })
    expect(result['--pw-color-info']).toBeUndefined()
  })

  it('should omit --pw-color-text-on-primary when colors.textOnPrimary is undefined', () => {
    const result = surfaceThemeToCSS({ colors: { primary: '#6366f1' } })
    expect(result['--pw-color-text-on-primary']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// BORDER TOKEN (1 new)
// ---------------------------------------------------------------------------

describe('surfaceThemeToCSS — new border token', () => {
  it('should map border.radiusLarge to --pw-border-radius-lg', () => {
    // Arrange
    const theme: SurfaceTheme = { border: { radiusLarge: '0.75rem' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-border-radius-lg']).toBe('0.75rem')
  })

  it('should omit --pw-border-radius-lg when border.radiusLarge is undefined', () => {
    // Arrange
    const theme: SurfaceTheme = { border: { radius: '0.375rem' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-border-radius-lg']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// SHADOW TOKENS (2 new — new top-level category)
// ---------------------------------------------------------------------------

describe('surfaceThemeToCSS — shadow tokens', () => {
  it('should map shadows.card to --pw-shadow-card', () => {
    // Arrange
    const theme: SurfaceTheme = { shadows: { card: '0 1px 3px rgba(0,0,0,0.1)' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-shadow-card']).toBe('0 1px 3px rgba(0,0,0,0.1)')
  })

  it('should map shadows.button to --pw-shadow-button', () => {
    // Arrange
    const theme: SurfaceTheme = { shadows: { button: 'none' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-shadow-button']).toBe('none')
  })

  it('should map both shadow tokens simultaneously', () => {
    // Arrange
    const theme: SurfaceTheme = {
      shadows: {
        card: '0 1px 3px rgba(0,0,0,0.1)',
        button: 'none',
      },
    }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-shadow-card']).toBe('0 1px 3px rgba(0,0,0,0.1)')
    expect(result['--pw-shadow-button']).toBe('none')
  })

  it('should return empty object when theme has no shadows key', () => {
    // Arrange
    const theme: SurfaceTheme = { colors: { primary: '#6366f1' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-shadow-card']).toBeUndefined()
    expect(result['--pw-shadow-button']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// MOTION TOKENS (5 new — new top-level category)
// ---------------------------------------------------------------------------

describe('surfaceThemeToCSS — motion tokens', () => {
  it('should map motion.durationFast to --pw-duration-fast', () => {
    // Arrange
    const theme: SurfaceTheme = { motion: { durationFast: '150ms' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-duration-fast']).toBe('150ms')
  })

  it('should map motion.durationNormal to --pw-duration-normal', () => {
    // Arrange
    const theme: SurfaceTheme = { motion: { durationNormal: '300ms' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-duration-normal']).toBe('300ms')
  })

  it('should map motion.durationSlow to --pw-duration-slow', () => {
    // Arrange
    const theme: SurfaceTheme = { motion: { durationSlow: '500ms' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-duration-slow']).toBe('500ms')
  })

  it('should map motion.easing to --pw-easing', () => {
    // Arrange
    const theme: SurfaceTheme = { motion: { easing: 'cubic-bezier(0.4, 0, 0.2, 1)' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-easing']).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('should map motion.easingBounce to --pw-easing-bounce', () => {
    // Arrange
    const theme: SurfaceTheme = { motion: { easingBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-easing-bounce']).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)')
  })

  it('should map all 5 motion tokens simultaneously', () => {
    // Arrange
    const theme: SurfaceTheme = {
      motion: {
        durationFast: '150ms',
        durationNormal: '300ms',
        durationSlow: '500ms',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        easingBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-duration-fast']).toBe('150ms')
    expect(result['--pw-duration-normal']).toBe('300ms')
    expect(result['--pw-duration-slow']).toBe('500ms')
    expect(result['--pw-easing']).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
    expect(result['--pw-easing-bounce']).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)')
  })

  it('should return empty object when theme has no motion key', () => {
    // Arrange
    const theme: SurfaceTheme = { colors: { primary: '#6366f1' } }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert
    expect(result['--pw-duration-fast']).toBeUndefined()
    expect(result['--pw-duration-normal']).toBeUndefined()
    expect(result['--pw-duration-slow']).toBeUndefined()
    expect(result['--pw-easing']).toBeUndefined()
    expect(result['--pw-easing-bounce']).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// FULL THEME — 29-token count assertion (surface emits card alias)
// ---------------------------------------------------------------------------

describe('surfaceThemeToCSS — full 28-token theme', () => {
  it('should generate exactly 29 CSS vars when all tokens including headingFontFamily are set', () => {
    // Arrange — all 28 tokens set (17 existing + 11 new)
    // colors.surface also emits --pw-color-card alias → +1 = 29
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
        // 3 new color tokens
        warning: '#f59e0b',
        info: '#0369a1',
        textOnPrimary: '#ffffff',
      },
      border: {
        radius: '0.375rem',
        width: '1px',
        style: 'solid',
        // 1 new border token
        radiusLarge: '0.75rem',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        headingFontFamily: 'Georgia, serif',
        baseFontSize: '1rem',
      },
      spacing: {
        base: '1rem',
      },
      // 2 new shadow tokens
      shadows: {
        card: '0 1px 3px rgba(0,0,0,0.1)',
        button: 'none',
      },
      // 5 new motion tokens
      motion: {
        durationFast: '150ms',
        durationNormal: '300ms',
        durationSlow: '500ms',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        easingBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert — 29 token vars + 4 derived color roles (Batch-1) + 3 on-card ink
    // tokens (emitted when a card/surface colour is present) = 36
    // + on-<status> and <status>-ink for the four statuses (8), the
    // control edge (1), the inverse set (5) and the h1-h5 scale (5) = +19
    expect(Object.keys(result)).toHaveLength(56)
  })

  it('should generate exactly 28 CSS vars when all tokens are set but headingFontFamily is omitted', () => {
    // Arrange — 28 tokens (29 minus headingFontFamily)
    // colors.surface also emits --pw-color-card alias → +1
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
        warning: '#f59e0b',
        info: '#0369a1',
        textOnPrimary: '#ffffff',
      },
      border: {
        radius: '0.375rem',
        width: '1px',
        style: 'solid',
        radiusLarge: '0.75rem',
      },
      typography: {
        fontFamily: 'Inter, sans-serif',
        baseFontSize: '1rem',
      },
      spacing: {
        base: '1rem',
      },
      shadows: {
        card: '0 1px 3px rgba(0,0,0,0.1)',
        button: 'none',
      },
      motion: {
        durationFast: '150ms',
        durationNormal: '300ms',
        durationSlow: '500ms',
        easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
        easingBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
    }

    // Act
    const result = surfaceThemeToCSS(theme)

    // Assert — 28 token vars + 4 derived color roles (Batch-1) + 3 on-card ink
    // tokens = 35
    // + on-<status> and <status>-ink for the four statuses (8), the
    // control edge (1), the inverse set (5) and the h1-h5 scale (5) = +19
    expect(Object.keys(result)).toHaveLength(55)
  })
})
