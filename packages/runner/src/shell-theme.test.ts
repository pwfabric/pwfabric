// @vitest-environment jsdom
/**
 * The shell's own chrome (the sign-in gate, the fallback pill) sits OUTSIDE
 * the surface root that carries the theme variables, so it has to be handed
 * them. These cases pin that hand-off: the same cascade the renderer uses,
 * read off the embed-seeded runtime namespace, never a named import.
 */
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import * as runtime from '@pwfabric/runtime'
import {
  applyThemeVars,
  applyShellDarkMode,
  shellDarkThemeVars,
  shellModePolicy,
  shellThemeVars,
  ensureShellStyles,
} from './shell-theme.js'

const g = globalThis as { __pwfabric_runtime?: unknown }

beforeEach(() => {
  g.__pwfabric_runtime = runtime
  document.head.innerHTML = ''
})
afterEach(() => {
  delete g.__pwfabric_runtime
})

describe('shellThemeVars', () => {
  it('resolves the project theme over the platform baseline, like the renderer', () => {
    const vars = shellThemeVars({
      config: {
        theme: { colors: { primary: '#0f766e' }, typography: { fontFamily: 'Lora, serif' } },
      },
    })
    expect(vars['--pw-color-primary']).toBe('#0f766e')
    expect(vars['--pw-font-family']).toBe('Lora, serif')
    // Tokens the project did not set still arrive, from the baseline.
    expect(vars['--pw-color-background']).toBe('#ffffff')
    expect(vars['--pw-border-radius']).toBeTruthy()
  })

  it('carries styleVariables through, as the renderer does', () => {
    const vars = shellThemeVars({ config: { styleVariables: { 'brand-ink': '#123', '--x': '1' } } })
    expect(vars['--brand-ink']).toBe('#123')
    expect(vars['--x']).toBe('1')
  })

  it('without a runtime namespace, only what the project spelled out — the sheet fallbacks do the rest', () => {
    delete g.__pwfabric_runtime
    expect(shellThemeVars({ config: { theme: { colors: { primary: '#000' } } } })).toEqual({})
    expect(shellThemeVars({ config: { styleVariables: { a: 'b' } } })).toEqual({ '--a': 'b' })
  })

  it('no appearance: nothing to apply', () => {
    expect(shellThemeVars(undefined)).toEqual({})
  })
})

describe('applyThemeVars / ensureShellStyles', () => {
  it('sets each variable on the element', () => {
    const el = document.createElement('div')
    applyThemeVars(el, { '--pw-color-text': '#eee' })
    expect(el.style.getPropertyValue('--pw-color-text')).toBe('#eee')
  })

  it('injects the sheet once', () => {
    ensureShellStyles()
    ensureShellStyles()
    expect(document.querySelectorAll('#pwapp-shell-css')).toHaveLength(1)
  })
})

describe('shell dark mode', () => {
  const light = { colors: { primary: '#22c55e', background: '#f0fdf4', card: '#dcfce7', text: '#14532d' } }

  it('resolves the same dark mode the surface wears: derived, overrides on top', () => {
    const vars = shellDarkThemeVars({ config: { theme: light, darkTheme: { colors: { accent: '#a3e635' } } } })
    expect(vars['--pw-color-accent']).toBe('#a3e635')
    // Derived ground, not the light one and not the platform white.
    expect(vars['--pw-color-background']).toBeTruthy()
    expect(vars['--pw-color-background']).not.toBe('#f0fdf4')
    expect(vars['--pw-color-background']).not.toBe('#ffffff')
  })

  it('no appearance, or no runtime namespace: nothing (the chrome stays light, no guess)', () => {
    expect(shellDarkThemeVars(undefined)).toEqual({})
    delete g.__pwfabric_runtime
    expect(shellDarkThemeVars({ config: { theme: light } })).toEqual({})
  })

  it('falls back to the plain derivation on a runtime without resolveDarkTheme', () => {
    const { resolveDarkTheme: _r, mergeSurfaceThemes: _m, ...older } = runtime as Record<string, unknown>
    g.__pwfabric_runtime = older
    const vars = shellDarkThemeVars({ config: { theme: light } })
    expect(vars['--pw-color-background']).not.toBe('#f0fdf4')
  })

  it('injects one !important sheet for the chrome, under the OS preference and a forced dark', () => {
    applyShellDarkMode({ '--pw-color-background': '#0b0b0b' })
    applyShellDarkMode({ '--pw-color-background': '#101010' })
    const sheets = document.querySelectorAll('#pwapp-shell-dark-css')
    expect(sheets).toHaveLength(1)
    const css = sheets[0]!.textContent ?? ''
    expect(css).toContain('@media (prefers-color-scheme:dark)')
    expect(css).toContain('html:not([data-pw-theme="light"]) :is(#pwapp-sign-in-gate,#pwapp-session-pill,#pwapp-login-error)')
    expect(css).toContain('html[data-pw-theme="dark"]')
    expect(css).toContain('--pw-color-background:#101010 !important')
  })

  it('removes the sheet when there is nothing dark to apply', () => {
    applyShellDarkMode({ '--pw-color-background': '#0b0b0b' })
    applyShellDarkMode({})
    expect(document.getElementById('pwapp-shell-dark-css')).toBeNull()
  })
})

describe('the mode policy reaches the chrome', () => {
  const vars = { '--pw-color-background': '#0b0b0b' }
  const sheet = (): string => document.getElementById('pwapp-shell-dark-css')?.textContent ?? ''

  it('reads the policy off the appearance ref, system by default', () => {
    expect(shellModePolicy(undefined)).toBe('system')
    expect(shellModePolicy({ config: {} })).toBe('system')
    expect(shellModePolicy({ config: { mode: { policy: 'light' } } })).toBe('light')
    expect(shellModePolicy({ config: { mode: { policy: 'dark' } } })).toBe('dark')
    expect(shellModePolicy({ config: { mode: { policy: 'sepia' } } })).toBe('system')
  })

  it('system keeps the device rule (positive control), light drops the sheet, dark applies it always', () => {
    applyShellDarkMode(vars, document, 'system')
    expect(sheet()).toContain('prefers-color-scheme:dark')
    applyShellDarkMode(vars, document, 'light')
    expect(document.getElementById('pwapp-shell-dark-css')).toBeNull()
    applyShellDarkMode(vars, document, 'dark')
    expect(sheet()).not.toContain('prefers-color-scheme')
    expect(sheet()).toContain('--pw-color-background:#0b0b0b !important')
  })
})
