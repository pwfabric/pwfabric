/**
 * The app's appearance, and each page's own: resolving a theme named by `use`
 * against the themes the app and its packs carry, and the stylesheet the shell
 * links so the page has its identity before any script runs.
 */
import {
  DEFAULT_APPEARANCE_THEME,
  mergeSurfaceThemes,
  resolveAppearanceMode,
  resolveDarkTheme,
  surfaceThemeToCSS,
  type SurfaceTheme,
} from '@pwfabric/contracts'
import { withFontFallbacks } from './fonts.js'
import type { AssembleDiagnostic } from './diagnostics.js'
import { isRecord } from './sources.js'

/** A `ui-appearance` atom an app can name: its id and its token sets. */
export interface ThemeAtom {
  readonly id: string
  /** The manifest's own `id`, when it differs from the path-derived one. */
  readonly manifestId?: string
  readonly theme: Record<string, unknown>
  readonly darkTheme?: Record<string, unknown>
  /** Where it came from, for diagnostics. */
  readonly from: string
}

/** Builds a {@link ThemeAtom} from a `ui-appearance` manifest, or null when it carries no token set. */
export function themeAtomOf(id: string, manifest: unknown, from: string): ThemeAtom | null {
  if (!isRecord(manifest) || !isRecord(manifest['theme'])) return null
  const manifestId = typeof manifest['id'] === 'string' ? manifest['id'] : undefined
  return {
    id,
    ...(manifestId && manifestId !== id ? { manifestId } : {}),
    theme: manifest['theme'],
    ...(isRecord(manifest['darkTheme']) ? { darkTheme: manifest['darkTheme'] } : {}),
    from,
  }
}

/**
 * The theme a name points at. Matched as given, then as `theme-<name>`, then
 * with an `appearance-` / `theme-` prefix removed; the first atom wins (the
 * app's own themes come before its packs').
 */
export function findTheme(name: string, themes: readonly ThemeAtom[]): ThemeAtom | undefined {
  const bare = name.trim().replace(/^(appearance|theme)-/, '')
  const wanted = [name.trim(), `theme-${bare}`, bare]
  for (const w of wanted) {
    const hit = themes.find((t) => t.id === w || t.manifestId === w)
    if (hit) return hit
  }
  return undefined
}

/** Per-group merge, `over` winning. */
export function mergeGroups(base: Record<string, unknown>, over: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base)) out[k] = isRecord(v) ? { ...v } : v
  if (isRecord(over)) {
    for (const [k, v] of Object.entries(over)) {
      const prev = out[k]
      out[k] = isRecord(v) && isRecord(prev) ? { ...prev, ...v } : v
    }
  }
  return out
}

/** The theme `use` names, or undefined with THEME_NOT_FOUND reported at `path`. */
function namedTheme(
  use: string,
  themes: readonly ThemeAtom[],
  diagnostics: AssembleDiagnostic[],
  path: string
): ThemeAtom | undefined {
  const theme = findTheme(use, themes)
  if (!theme) {
    diagnostics.push({
      severity: 'warning',
      code: 'THEME_NOT_FOUND',
      message: `appearance names theme "${use}", which neither the app nor its packs carry (known: ${
        themes.map((t) => t.id).join(', ') || 'none'
      }); the runner falls back to its built-in presets`,
      path,
    })
  }
  return theme
}

function resolveConfig(
  doc: Record<string, unknown>,
  themes: readonly ThemeAtom[],
  diagnostics: AssembleDiagnostic[],
  path: string
): Record<string, unknown> {
  const use = doc['use']
  if (typeof use !== 'string' || !use.trim()) return doc
  const theme = namedTheme(use, themes, diagnostics, path)
  if (!theme) return doc
  const { use: _use, ...rest } = doc
  const out: Record<string, unknown> = { ...rest, theme: mergeGroups(theme.theme, rest['theme']) }
  if (theme.darkTheme) out['darkTheme'] = mergeGroups(theme.darkTheme, rest['darkTheme'])
  return out
}

/**
 * The app-wide appearance as the envelope carries it. A theme named by `use`
 * is resolved to its tokens here, so the published app does not depend on
 * the runner knowing the name. The three shapes a reader accepts are kept:
 * a reference (`{ config }`) stays a reference, everything else becomes a
 * bare configuration.
 */
export function resolveAppearance(
  doc: unknown,
  themes: readonly ThemeAtom[],
  diagnostics: AssembleDiagnostic[],
  path = 'app/definitions/appearance.json'
): Record<string, unknown> | undefined {
  if (!isRecord(doc)) return undefined
  if (isRecord(doc['config'])) return { ...doc, config: resolveConfig(doc['config'], themes, diagnostics, path) }
  return resolveConfig(doc, themes, diagnostics, path)
}

/** The configuration inside any of the three appearance shapes. */
export function appearanceConfigOf(doc: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!doc) return undefined
  return isRecord(doc['config']) ? doc['config'] : doc
}

/** The theme atom an appearance document names by `use` (in any of its shapes), or undefined. Reports nothing. */
export function namedThemeOf(doc: unknown, themes: readonly ThemeAtom[]): ThemeAtom | undefined {
  const config = isRecord(doc) ? appearanceConfigOf(doc) : undefined
  const use = config?.['use']
  return typeof use === 'string' && use.trim() ? findTheme(use, themes) : undefined
}

/** What a page wears: the app's appearance, its own (resolved), or its receipt's `appearance` as written. */
export type PageAppearance =
  | { readonly wears: 'app' }
  | { readonly wears: 'own'; readonly config: Record<string, unknown> }
  | { readonly wears: 'as-written' }

/** `value` as JSON with every object's keys sorted: two configurations compare equal whatever order they were written in. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    isRecord(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v
  )
}

/**
 * A PAGE'S OWN APPEARANCE (its receipt's `appearance`), resolved at build to
 * the whole configuration the page wears (appearance §1):
 *
 *  - a page that names a theme (`use`) wears it: that theme's tokens, light
 *    and dark (the atom's own `darkTheme`; without one the renderer derives
 *    the dark variant), with the app's other members (`mode`,
 *    `styleVariables`, `brand`, …) kept. A page that names the theme the app
 *    wears gets the app's tokens, overrides included;
 *  - a page that names none starts from the app's configuration;
 *  - the page's own members then apply over that: `theme` and `darkTheme`
 *    per group, an object member per key, anything else replaced.
 *
 * The result carries its fonts' stand-ins in its stacks, as the app's does (fonts.ts).
 * A page that comes out wearing exactly the app's configuration — no
 * `appearance`, or one that changes nothing — wears the app's (`'app'`). A
 * theme name neither the app nor its packs carry is THEME_NOT_FOUND, as for
 * the app, and the receipt keeps it as written (`'as-written'`).
 *
 * @param app the app's resolved configuration (`appearanceConfigOf`, stand-ins
 *   named) and the theme atom its `use` names.
 */
export function resolvePageAppearance(
  raw: unknown,
  app: { readonly config: Record<string, unknown> | undefined; readonly theme: ThemeAtom | undefined },
  themes: readonly ThemeAtom[],
  diagnostics: AssembleDiagnostic[],
  path: string
): PageAppearance {
  if (raw === undefined) return { wears: 'app' }
  if (!isRecord(raw)) return { wears: 'as-written' }
  const doc = appearanceConfigOf(raw) as Record<string, unknown>
  const { use, ...own } = doc
  const appConfig = app.config ?? {}
  let base: Record<string, unknown> = appConfig
  if (typeof use === 'string' && use.trim()) {
    const theme = namedTheme(use, themes, diagnostics, path)
    if (!theme) return { wears: 'as-written' }
    if (theme !== app.theme) {
      const { theme: _theme, darkTheme: _darkTheme, ...members } = appConfig
      base = { ...members, theme: theme.theme, ...(theme.darkTheme ? { darkTheme: theme.darkTheme } : {}) }
    }
  }
  const config: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(own)) {
    const prev = base[key]
    config[key] =
      key === 'theme' || key === 'darkTheme'
        ? mergeGroups(isRecord(prev) ? prev : {}, value)
        : isRecord(value) && isRecord(prev)
          ? { ...prev, ...value }
          : value
  }
  const resolved = withFontFallbacks(config) as Record<string, unknown>
  return canonicalJson(resolved) === canonicalJson(appConfig) ? { wears: 'app' } : { wears: 'own', config: resolved }
}

function declList(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
}

/** The selectors one palette is written under: its light rule, and that rule refined by a mode (`[data-pw-theme="dark"]`, `:not(…)`). */
interface PaletteScope {
  readonly light: readonly string[]
  readonly refined: (refinement: string) => readonly string[]
}

/** The app's palette: the document and every surface. */
const APP_SCOPE: PaletteScope = {
  light: [':root', '[data-pw-surface]'],
  refined: (r) => [`:root${r}`, `[data-pw-surface]${r}`],
}

/** A page's own palette: the document while it shows that page (`<html data-pw-page="<key>">`). */
function pageScope(key: string): PaletteScope {
  const root = `:root[data-pw-page="${key.replace(/["\\]/g, (c) => `\\${c}`)}"]`
  return { light: [root], refined: (r) => [`${root}${r}`] }
}

function modeBlocks(
  scope: PaletteScope,
  policy: 'light' | 'dark' | 'system',
  light: string,
  dark: string,
  darkOverLight: string
): string {
  const lightSel = scope.light.join(', ')
  if (policy === 'light') return `${lightSel} {\n${light}\n}`
  if (policy === 'dark') return `${lightSel} {\n${darkOverLight}\n}`
  return `${lightSel} {
${light}
}

${scope.refined('[data-pw-theme="dark"]').join(',\n')} {
${dark}
}

@media (prefers-color-scheme: dark) {
  ${scope.refined(':not([data-pw-theme="light"])').join(',\n  ')} {
${dark}
  }
}`
}

/** One configuration's palette (light, and dark per its mode policy) under `scope`. */
function paletteCss(config: Record<string, unknown> | undefined, scope: PaletteScope): string {
  const cfg = config as { theme?: SurfaceTheme; darkTheme?: SurfaceTheme; styleVariables?: Record<string, unknown> } | undefined
  const { policy, contrast } = resolveAppearanceMode(cfg)
  const options = { contrast }
  const lightVars = surfaceThemeToCSS(cfg?.theme, DEFAULT_APPEARANCE_THEME, undefined, options)
  if (isRecord(cfg?.styleVariables)) {
    for (const [key, value] of Object.entries(cfg.styleVariables)) {
      if (typeof value !== 'string') continue
      lightVars[key.startsWith('--') ? key : `--${key}`] = value
    }
  }
  const light = mergeSurfaceThemes(DEFAULT_APPEARANCE_THEME, cfg?.theme)
  const darkVars = surfaceThemeToCSS(resolveDarkTheme(light, cfg?.darkTheme), undefined, undefined, options)
  return modeBlocks(scope, policy, declList(lightVars), declList(darkVars), declList({ ...lightVars, ...darkVars }))
}

/** A page that wears its own appearance: its key and its resolved configuration ({@link resolvePageAppearance}). */
export interface PageTheme {
  readonly key: string
  readonly config: Record<string, unknown>
}

/**
 * `assets/theme.css`: the full token set as custom properties (light, the
 * dark variant per the mode policy) and the document binding — page margin,
 * body font and colours — so the app wears its identity before hydration.
 * Each page that wears its own appearance (`pages`) has its palette under
 * `:root[data-pw-page="<key>"]`, after the app's, so the document's ground is
 * the page's from the first paint. The app's fonts — an `@font-face` per file
 * and each family's stand-in (fonts.ts `fontAssetsOf`) — come first.
 */
export function buildThemeCss(config: Record<string, unknown> | undefined, pages: readonly PageTheme[] = [], fontCss = ''): string {
  const faces = fontCss
  const palettes = [paletteCss(config, APP_SCOPE), ...pages.map((p) => paletteCss(p.config, pageScope(p.key)))].join('\n\n')
  return `${faces ? `${faces}\n` : ''}${palettes}

html, body {
  margin: 0;
  font-family: var(--pw-font-family, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  font-size: var(--pw-font-size-base, 16px);
  color: var(--pw-color-text, #1e293b);
  background: var(--pw-color-background, #ffffff);
}
h1, h2, h3, h4, h5, h6 {
  font-family: var(--pw-font-family-heading, inherit);
}
code, pre, kbd {
  font-family: var(--pw-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
}
`
}

