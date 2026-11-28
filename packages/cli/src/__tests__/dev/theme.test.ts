import { describe, expect, it } from 'vitest'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import {
  appearanceConfigOf,
  buildThemeCss,
  findTheme,
  mergeGroups,
  resolveAppearance,
  resolvePageAppearance,
  resolveThemeBases,
  missingThemeMessage,
  THEME_NOT_FOUND,
  THEME_BASE_CYCLE,
  THEME_BASE_NOT_FOUND,
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
    // On the document and on its surfaces (the app's palette is written on [data-pw-surface] itself).
    expect(css.indexOf(':root, [data-pw-surface] {')).toBeLessThan(css.indexOf(':root[data-pw-page="night"], :root[data-pw-page="night"] [data-pw-surface] {'))
    expect(css).toMatch(/:root\[data-pw-page="night"\] \[data-pw-surface\] \{[^}]*--pw-color-background: #0b1020;/)
    expect(css).toMatch(/:root\[data-pw-page="night"\]\[data-pw-theme="dark"\] \[data-pw-surface\] \{[^}]*--pw-color-background: #000;/)
    expect(css).toMatch(/:root\[data-pw-page="night"\]:not\(\[data-pw-theme="light"\]\) \[data-pw-surface\] \{/)
    // A light-only page has no dark rule.
    expect(css).toMatch(/:root\[data-pw-page="day"\] \[data-pw-surface\] \{[^}]*--pw-color-background: #fefefe;/)
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
  it('is an error, keeping the name, when no pack carries the theme', () => {
    const d: AssembleDiagnostic[] = []
    expect(resolveAppearance({ use: 'ocean' }, [zinc], d)).toEqual({ use: 'ocean' })
    expect(d[0]?.code).toBe('THEME_NOT_FOUND')
    expect(d[0]?.severity).toBe('error')
    expect(d[0]?.message).toContain('theme-zinc')
    resolveAppearance({ use: 'ocean' }, [], d)
    // With no pack theme, the runner's own (the foundation's kept themes) are still named.
    expect(d[1]?.message).toContain('"theme-base"')
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
  it('sets color-scheme for the scheme worn, so native controls follow it', () => {
    const system = buildThemeCss({})
    expect(system).toMatch(/:root, \[data-pw-surface\] \{\n {2}color-scheme: light;/)
    expect(system).toMatch(/:root\[data-pw-theme="dark"\],\n\[data-pw-surface\]\[data-pw-theme="dark"\] \{\n {2}color-scheme: dark;/)
    expect(system).toMatch(/@media \(prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-pw-theme="light"\]\)[^{]*\{\n {2}color-scheme: dark;/)
    expect(buildThemeCss({ mode: { policy: 'dark' } })).toMatch(/:root, \[data-pw-surface\] \{\n {2}color-scheme: dark;/)
    expect(buildThemeCss({ mode: { policy: 'light' } })).toMatch(/:root, \[data-pw-surface\] \{\n {2}color-scheme: light;/)
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

describe('a page wearing its own theme does not inherit the app’s block colours', () => {
  const app = { theme: { colors: { background: '#ffffff', text: '#09090b', heading: '#09090b', link: '#1d4ed8' } } }
  const page = { key: 'night', config: { theme: { colors: { background: '#15110e', text: '#f8efe3' } } } }
  const css = buildThemeCss(app, [page])
  const pageRule = css.slice(css.indexOf(':root[data-pw-page="night"], :root[data-pw-page="night"] [data-pw-surface] {'))
  it('resets each block colour the app sets and the page does not, on the page and its surfaces', () => {
    expect(pageRule).toMatch(/^[^}]*--pw-color-heading: initial;/)
    expect(pageRule).toMatch(/^[^}]*--pw-color-link: initial;/)
  })
  it('keeps one the page sets itself (positive control)', () => {
    const own = buildThemeCss(app, [{ key: 'night', config: { theme: { colors: { ...page.config.theme.colors, heading: '#ffffff' } } } }])
    expect(own.slice(own.indexOf(':root[data-pw-page="night"]'))).toMatch(/^[^}]*--pw-color-heading: #ffffff;/)
  })
})

describe('a theme that extends another writes only what differs', () => {
  const base = themeAtomOf('theme-base', {
    theme: { colors: { primary: '#2563eb', background: '#ffffff', text: '#111827', heading: '#111827' }, border: { radius: '6px', width: '1px' } },
    darkTheme: { colors: { primary: '#60a5fa', background: '#0b0f19', text: '#f3f4f6' } },
  }, 'pack')!
  const child = themeAtomOf('theme-round', { extends: 'theme-base', theme: { border: { radius: '16px' } }, darkTheme: { colors: { primary: '#93c5fd' } } }, 'pack')!
  it('is drawn with its base underneath, light over light and dark over dark', () => {
    const d: AssembleDiagnostic[] = []
    const out = resolveThemeBases([base, child], d)
    expect(d).toEqual([])
    const round = out.find((t) => t.id === 'theme-round')!
    expect(round.theme).toEqual({ colors: base.theme['colors'], border: { radius: '16px', width: '1px' } })
    expect(round.darkTheme).toEqual({ colors: { primary: '#93c5fd', background: '#0b0f19', text: '#f3f4f6' } })
    expect(round.extends).toBeUndefined()
    // The base itself is unchanged (positive control).
    expect(out.find((t) => t.id === 'theme-base')!.theme).toEqual(base.theme)
  })
  it('a child that states its own ground drops the base’s block colours (appearance §3.1)', () => {
    const own = themeAtomOf('theme-cream', { extends: 'base', theme: { colors: { background: '#f5efe3' } } }, 'pack')!
    const out = resolveThemeBases([base, own], [])
    expect((out[1]!.theme['colors'] as Record<string, string>)['heading']).toBeUndefined()
    expect((out[1]!.theme['colors'] as Record<string, string>)['primary']).toBe('#2563eb')
  })
  it('a missing base and a cycle are errors; the theme keeps its own tokens', () => {
    const d: AssembleDiagnostic[] = []
    const lost = themeAtomOf('theme-lost', { extends: 'theme-nowhere', theme: { border: { radius: '2px' } } }, 'app')!
    const a = themeAtomOf('theme-a', { extends: 'theme-b', theme: {} }, 'app')!
    const b = themeAtomOf('theme-b', { extends: 'theme-a', theme: {} }, 'app')!
    const out = resolveThemeBases([lost, a, b], d)
    expect(d.map((x) => x.code)).toEqual([THEME_BASE_NOT_FOUND, THEME_BASE_CYCLE])
    expect(out[0]!.theme).toEqual({ border: { radius: '2px' } })
  })
})

describe('a theme’s own dark does not inherit its light block colours', () => {
  const cfg = { theme: { colors: { background: '#ffffff', text: '#111111', heading: '#111111' } }, darkTheme: { colors: { background: '#0b0b0b', text: '#f5f5f5' } } }
  it('the dark rule resets a block colour its light sets and its dark does not', () => {
    const css = buildThemeCss(cfg)
    const dark = css.slice(css.indexOf(':root[data-pw-theme="dark"]'))
    expect(dark).toMatch(/^[^}]*--pw-color-heading: initial;/)
  })
  it('so does a dark-only app (policy dark), whose one rule is light under dark', () => {
    const css = buildThemeCss({ ...cfg, mode: { policy: 'dark' } })
    expect(css).toMatch(/:root, \[data-pw-surface\] \{[^}]*--pw-color-heading: initial;/)
  })
  it('a dark that restates the colour keeps it (positive control)', () => {
    const css = buildThemeCss({ ...cfg, darkTheme: { colors: { ...cfg.darkTheme.colors, heading: '#ffffff' } } })
    expect(css.slice(css.indexOf(':root[data-pw-theme="dark"]'))).toMatch(/^[^}]*--pw-color-heading: #ffffff;/)
  })
})

describe('a theme name nothing carries is an error, never a quiet fallback', () => {
  const themes = [themeAtomOf('theme-zinc', { theme: {} }, 'pack')!, themeAtomOf('theme-paper', { theme: {} }, 'pack')!]
  it('names the missing theme and the ones there are, and says what to do', () => {
    const m = missingThemeMessage('theme-linen', themes)!
    expect(m).toContain('"theme-linen"')
    expect(m).toContain('"theme-zinc", "theme-paper"')
    expect(m).toContain('extends')
  })
  it('a theme that exists, or "default", is no finding (positive control)', () => {
    expect(missingThemeMessage('paper', themes)).toBeUndefined()
    expect(missingThemeMessage('default', themes)).toBeUndefined()
  })
  it('resolveAppearance reports it as an error', () => {
    const d: AssembleDiagnostic[] = []
    resolveAppearance({ use: 'theme-midnight' }, themes, d)
    expect(d.map((x) => [x.code, x.severity])).toEqual([[THEME_NOT_FOUND, 'error']])
  })
})

describe("the runner's presets are themes too, and only they", () => {
  it('a kept foundation theme draws from the preset with no pack: no finding', () => {
    for (const use of ['theme-base', 'zinc', 'appearance-paper', ' theme-ember ']) expect(missingThemeMessage(use, []), use).toBeUndefined()
  })
  it('a removed theme, or an object key, is still missing', () => {
    for (const use of ['theme-linen', 'slate', 'midnight', 'toString', 'constructor']) expect(missingThemeMessage(use, []), use).toContain(`"${use}"`)
  })
})
