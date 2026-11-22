import { describe, expect, it } from 'vitest'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import {
  appearanceConfigOf,
  buildThemeCss,
  findTheme,
  mergeGroups,
  resolveAppearance,
  resolvePageAppearance,
  themeAtomOf,
  type ThemeAtom,
} from '../../dev/theme.js'
import { fontsOf, withFontFallbacks } from '../../dev/fonts.js'

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

describe('resolvePageAppearance (a page names its own theme)', () => {
  const app = { config: { theme: { colors: { primary: '#18181b', text: '#09090b', accent: 'gold' } }, mode: { policy: 'light' } }, theme: zinc }
  const path = 'app/surfaces/p.receipt.json'

  it('a page that names another theme wears it, dark variant its own, the app’s other members kept', () => {
    const d: AssembleDiagnostic[] = []
    expect(resolvePageAppearance({ use: 'dusk' }, app, [zinc, dusk], d, path)).toEqual({
      wears: 'own',
      config: { theme: { colors: { primary: '#000' } }, darkTheme: { colors: { primary: '#fff' } }, mode: { policy: 'light' } },
    })
    // The reference shape reads the same; the page's own tokens go over the theme's per group.
    expect(resolvePageAppearance({ config: { use: 'dusk', theme: { colors: { text: '#111' } }, mode: { policy: 'dark' } } }, app, [zinc, dusk], d, path)).toEqual({
      wears: 'own',
      config: { theme: { colors: { primary: '#000', text: '#111' } }, darkTheme: { colors: { primary: '#fff' } }, mode: { policy: 'dark' } },
    })
    expect(d).toEqual([])
  })

  it('the app’s dark variant does not follow the page onto a theme that has none', () => {
    const withDark = { config: { theme: { colors: { primary: '#000' } }, darkTheme: { colors: { primary: '#fff' } } }, theme: dusk }
    expect(resolvePageAppearance({ use: 'zinc' }, withDark, [zinc, dusk], [], path)).toEqual({ wears: 'own', config: { theme: zinc.theme } })
  })

  it('the app’s theme named again, no appearance, or one that changes nothing: the app’s', () => {
    expect(resolvePageAppearance({ use: 'theme-zinc' }, app, [zinc, dusk], [], path)).toEqual({ wears: 'app' })
    expect(resolvePageAppearance(undefined, app, [zinc], [], path)).toEqual({ wears: 'app' })
    expect(resolvePageAppearance({ config: { mode: { policy: 'light' } } }, app, [zinc], [], path)).toEqual({ wears: 'app' })
  })

  it('a page with no theme of its own starts from the app’s', () => {
    expect(resolvePageAppearance({ theme: { colors: { primary: 'red' } } }, app, [zinc], [], path)).toEqual({
      wears: 'own',
      config: { theme: { colors: { primary: 'red', text: '#09090b', accent: 'gold' } }, mode: { policy: 'light' } },
    })
  })

  it('an unknown name is THEME_NOT_FOUND at the receipt, and the receipt keeps it as written', () => {
    const d: AssembleDiagnostic[] = []
    expect(resolvePageAppearance({ use: 'ocean' }, app, [zinc], d, path)).toEqual({ wears: 'as-written' })
    expect(d.map((x) => [x.code, x.path])).toEqual([['THEME_NOT_FOUND', path]])
    expect(resolvePageAppearance('zinc', app, [zinc], [], path)).toEqual({ wears: 'as-written' })
  })

  it('names the stand-in of the page theme’s own font', () => {
    const serif = themeAtomOf(
      'serif',
      { theme: { typography: { fontFamily: 'Nunito, sans-serif' }, fonts: [{ family: 'Nunito', files: [{ src: 'media/fonts/nunito.woff2', weight: 400 }] }] } },
      'pack'
    ) as ThemeAtom
    const r = resolvePageAppearance({ use: 'serif' }, app, [zinc, serif], [], path)
    expect(r.wears === 'own' && (r.config['theme'] as { typography: { fontFamily: string } }).typography.fontFamily).toBe('Nunito, "Nunito Fallback", sans-serif')
  })
})

describe('the theme stylesheet with pages of their own', () => {
  it('grounds each such page under :root[data-pw-page], after the app’s palette, by its own mode', () => {
    const css = buildThemeCss({ theme: { colors: { background: '#fff' } } }, [
      { key: 'night', config: { theme: { colors: { background: '#0b1020' } }, darkTheme: { colors: { background: '#000' } } } },
      { key: 'day', config: { theme: { colors: { background: '#fefefe' } }, mode: { policy: 'light' } } },
    ])
    expect(css.indexOf(':root, [data-pw-surface] {')).toBeLessThan(css.indexOf(':root[data-pw-page="night"] {'))
    expect(css).toMatch(/:root\[data-pw-page="night"\] \{[^}]*--pw-color-background: #0b1020;/)
    expect(css).toMatch(/:root\[data-pw-page="night"\]\[data-pw-theme="dark"\] \{[^}]*--pw-color-background: #000;/)
    expect(css).toMatch(/:root\[data-pw-page="night"\]:not\(\[data-pw-theme="light"\]\) \{/)
    // A light-only page has no dark rule.
    expect(css).toMatch(/:root\[data-pw-page="day"\] \{[^}]*--pw-color-background: #fefefe;/)
    expect(css).not.toContain(':root[data-pw-page="day"][data-pw-theme="dark"]')
    // No page of its own: the stylesheet is the app's alone.
    expect(buildThemeCss({ theme: { colors: { background: '#fff' } } })).not.toContain('data-pw-page')
  })

  it('carries the font rules it is given first, and none without', () => {
    expect(buildThemeCss(undefined, [], '@font-face { font-family: "X"; }').startsWith('@font-face { font-family: "X"; }')).toBe(true)
    expect(buildThemeCss(undefined)).not.toContain('@font-face')
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

describe('font fallbacks (fonts.ts)', () => {
  const font = (family: string) => ({ family, files: [{ src: `media/fonts/${family.toLowerCase().replace(/ /g, '-')}.woff2`, weight: 400 }] })

  it("names a shipped family's stand-in right after it in its stack, and leaves any other stack as it is", () => {
    const config = withFontFallbacks({
      theme: {
        typography: { fontFamily: 'Nunito, ui-sans-serif, sans-serif', headingFontFamily: '"Playfair Display", Georgia, serif', monoFontFamily: 'Menlo, monospace' },
        fonts: [font('Nunito'), font('Playfair Display')],
      },
      darkTheme: { colors: {} },
    }) as { theme: { typography: Record<string, string> }; darkTheme: unknown }
    expect(config.theme.typography['fontFamily']).toBe('Nunito, "Nunito Fallback", ui-sans-serif, sans-serif')
    expect(config.theme.typography['headingFontFamily']).toBe('"Playfair Display", "Playfair Display Fallback", Georgia, serif')
    expect(config.theme.typography['monoFontFamily']).toBe('Menlo, monospace')
    expect(config.darkTheme).toEqual({ colors: {} })
    // Idempotent.
    expect(withFontFallbacks(config)).toEqual(config)
  })

  it('names nothing for a family the theme does not ship (no font service)', () => {
    const plain = { theme: { typography: { fontFamily: 'Inter, sans-serif' } } }
    expect(withFontFallbacks(plain)).toEqual(plain)
  })

  it("takes each family once across the app's and its pages' configurations", () => {
    expect(fontsOf([{ theme: { fonts: [font('Nunito')] } }, { theme: { fonts: [font('nunito'), font('Inter')] } }]).map((f) => f.family)).toEqual(['Nunito', 'Inter'])
  })
})
