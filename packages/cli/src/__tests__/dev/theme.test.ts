import { describe, expect, it } from 'vitest'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import {
  appearanceConfigOf,
  buildThemeCss,
  findTheme,
  mergeGroups,
  resolveAppearance,
  themeAtomOf,
  themeWebfonts,
  webfontStylesheetHref,
  type ThemeAtom,
} from '../../dev/theme.js'

const zinc = themeAtomOf('theme-zinc', { id: 'theme-zinc', theme: { colors: { primary: '#18181b', text: '#09090b' } } }, 'pack') as ThemeAtom
const dusk = themeAtomOf(
  'dusk',
  { id: 'night-dusk', theme: { colors: { primary: '#000' } }, darkTheme: { colors: { primary: '#fff' } } },
  'app'
) as ThemeAtom

describe('theme atoms', () => {
  it('reads a ui-appearance manifest', () => {
    expect(zinc).toEqual({ id: 'theme-zinc', theme: { colors: { primary: '#18181b', text: '#09090b' } }, from: 'pack' })
    expect(dusk.manifestId).toBe('night-dusk')
    expect(dusk.darkTheme).toEqual({ colors: { primary: '#fff' } })
    expect(themeAtomOf('x', { id: 'x' }, 'p')).toBeNull()
    expect(themeAtomOf('x', null, 'p')).toBeNull()
  })
  it('finds a theme by id, by theme- prefix, bare, or by manifest id', () => {
    const themes = [dusk, zinc]
    expect(findTheme('theme-zinc', themes)).toBe(zinc)
    expect(findTheme('zinc', themes)).toBe(zinc)
    expect(findTheme('appearance-zinc', themes)).toBe(zinc)
    expect(findTheme('night-dusk', themes)).toBe(dusk)
    expect(findTheme('theme-dusk', themes)).toBe(dusk)
    expect(findTheme('ocean', themes)).toBeUndefined()
  })
  it('merges per group, the override winning', () => {
    expect(mergeGroups({ colors: { a: 1, b: 2 }, radius: 1 }, { colors: { b: 3 }, radius: 2, extra: { x: 1 } })).toEqual({
      colors: { a: 1, b: 3 },
      radius: 2,
      extra: { x: 1 },
    })
    expect(mergeGroups({ a: 1 }, 'not-an-object')).toEqual({ a: 1 })
  })
})

describe('resolveAppearance', () => {
  it('resolves `use` to the theme tokens with the document on top', () => {
    const d: AssembleDiagnostic[] = []
    expect(resolveAppearance({ use: 'zinc', theme: { colors: { primary: 'red' } }, mode: { policy: 'light' } }, [zinc], d)).toEqual({
      theme: { colors: { primary: 'red', text: '#09090b' } },
      mode: { policy: 'light' },
    })
    expect(d).toEqual([])
  })
  it('carries the theme dark variant and keeps the reference shape', () => {
    const out = resolveAppearance({ config: { use: 'dusk' } }, [dusk], [])
    expect(out).toEqual({ config: { theme: { colors: { primary: '#000' } }, darkTheme: { colors: { primary: '#fff' } } } })
    expect(appearanceConfigOf(out)).toEqual(out?.['config'])
  })
  it('warns and keeps the name when no pack carries the theme', () => {
    const d: AssembleDiagnostic[] = []
    expect(resolveAppearance({ use: 'ocean' }, [zinc], d)).toEqual({ use: 'ocean' })
    expect(d[0]?.code).toBe('THEME_NOT_FOUND')
    expect(d[0]?.message).toContain('theme-zinc')
    resolveAppearance({ use: 'ocean' }, [], d)
    expect(d[1]?.message).toContain('known: none')
  })
  it('passes bare configurations through and ignores non-objects', () => {
    expect(resolveAppearance({ theme: { colors: {} } }, [], [])).toEqual({ theme: { colors: {} } })
    expect(resolveAppearance({ use: '  ' }, [], [])).toEqual({ use: '  ' })
    expect(resolveAppearance(undefined, [], [])).toBeUndefined()
    expect(appearanceConfigOf(undefined)).toBeUndefined()
  })
})

describe('buildThemeCss', () => {
  it('emits light, forced-dark and device-dark blocks under the system policy', () => {
    const css = buildThemeCss({ theme: { colors: { primary: '#123456' } }, styleVariables: { brand: '1px', '--x': '2', bad: 3 } })
    expect(css).toContain('--pw-color-primary: #123456;')
    expect(css).toContain('--brand: 1px;')
    expect(css).toContain('--x: 2;')
    expect(css).toContain(':root[data-pw-theme="dark"]')
    expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(css).toMatch(/html, body \{\n {2}margin: 0;/)
  })
  it('honours light-only and dark-only', () => {
    const light = buildThemeCss({ mode: { policy: 'light' } })
    expect(light).not.toContain('prefers-color-scheme')
    const dark = buildThemeCss({ mode: { policy: 'dark' } })
    expect(dark).not.toContain('prefers-color-scheme')
    expect(dark).not.toContain('data-pw-theme')
    expect(buildThemeCss(undefined)).toContain('--pw-color-primary')
  })
})

describe('webfonts', () => {
  it('links only allow-listed first families', () => {
    const fonts = themeWebfonts({
      theme: { typography: { fontFamily: 'Inter, system-ui', headingFontFamily: '"My Paid Font", Roboto', monoFontFamily: 'Inter' } },
    })
    expect(fonts.map((f) => f.family)).toEqual(['Inter'])
    expect(webfontStylesheetHref(fonts)).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter.*&display=swap$/)
    expect(webfontStylesheetHref([])).toBeNull()
    expect(themeWebfonts(undefined)).toEqual([])
  })
  it('requests italics only for families that ship them, and bare families without weights', () => {
    expect(webfontStylesheetHref([{ family: 'A B', category: 'serif', weights: [700, 400], italic: true }])).toBe(
      'https://fonts.googleapis.com/css2?family=A+B:ital,wght@0,400;0,700;1,400;1,700&display=swap'
    )
    expect(webfontStylesheetHref([{ family: 'C', category: 'serif', weights: [], italic: false }])).toBe(
      'https://fonts.googleapis.com/css2?family=C&display=swap'
    )
  })
  it('loads a newly allow-listed family from the list, not a hardcoded set', () => {
    const fonts = themeWebfonts({
      theme: {
        typography: {
          fontFamily: 'Inter, sans-serif',
          headingFontFamily: 'Newsreader, Georgia, serif',
          monoFontFamily: '"Source Code Pro", monospace',
        },
      },
    })
    expect(fonts.map((f) => f.family)).toEqual(['Inter', 'Newsreader', 'Source Code Pro'])
    const href = webfontStylesheetHref(fonts)
    expect(href).toContain('family=Newsreader:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700')
    expect(href).toContain('family=Source+Code+Pro:ital,wght@0,400;0,500;1,400;1,500')
    expect(webfontStylesheetHref(themeWebfonts({ theme: { typography: { monoFontFamily: 'Fira Code' } } }))).toBe(
      'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap'
    )
  })
})
