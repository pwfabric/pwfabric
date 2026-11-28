/**
 * The app's appearance, and each page's own: resolving a theme named by `use`
 * against the themes the app and its packs carry, and the stylesheet the shell
 * links so the page has its identity before any script runs.
 */
import { mergeColorLayers, mergeThemeBlocks } from '@pwfabric/contracts'
import { THEME_PRESETS } from '@pwfabric/runner'
import {
  DEFAULT_APPEARANCE_THEME,
  mergeSurfaceThemes,
  resolveAppearanceMode,
  resolveDarkTheme,
  surfaceThemeToCSS,
  extraColorVars,
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
  /** The theme it builds on (`extends`), before {@link resolveThemeBases} lays it underneath. */
  readonly extends?: string
  /** Where it came from, for diagnostics. */
  readonly from: string
}

/** Builds a {@link ThemeAtom} from a `ui-appearance` manifest, or null when it carries no token set. */
export function themeAtomOf(id: string, manifest: unknown, from: string): ThemeAtom | null {
  if (!isRecord(manifest)) return null
  const base = typeof manifest['extends'] === 'string' && manifest['extends'].trim() ? manifest['extends'].trim() : undefined
  // A theme that builds on another may set nothing of its own in light.
  if (!isRecord(manifest['theme']) && !base) return null
  const manifestId = typeof manifest['id'] === 'string' ? manifest['id'] : undefined
  return {
    id,
    ...(manifestId && manifestId !== id ? { manifestId } : {}),
    theme: isRecord(manifest['theme']) ? manifest['theme'] : {},
    ...(isRecord(manifest['darkTheme']) ? { darkTheme: manifest['darkTheme'] } : {}),
    ...(base ? { extends: base } : {}),
    from,
  }
}

export const THEME_BASE_NOT_FOUND = 'THEME_BASE_NOT_FOUND'
export const THEME_BASE_CYCLE = 'THEME_BASE_CYCLE'

/**
 * Every theme with its base laid underneath (appearance §3.5): a theme that
 * `extends` another writes only what differs, and is drawn as the base's token
 * sets merged per group with its own on top (light over light, dark over dark).
 * Bases chain (a base may extend another). A base that cannot be found, or a
 * chain that comes back to itself, is a warning and that theme is drawn from its
 * own tokens alone — a warning, because a pinned pack may ship a theme the app
 * never wears, and its broken base must not fail the app's build.
 */
export function resolveThemeBases(themes: readonly ThemeAtom[], diagnostics: AssembleDiagnostic[]): ThemeAtom[] {
  const done = new Map<ThemeAtom, ThemeAtom>()
  const resolve = (t: ThemeAtom, seen: readonly ThemeAtom[]): ThemeAtom => {
    const hit = done.get(t)
    if (hit) return hit
    if (!t.extends) return t
    const { extends: name, ...own } = t
    const base = findTheme(name, themes)
    let out: ThemeAtom = own
    if (!base) {
      diagnostics.push({ severity: 'warning', code: THEME_BASE_NOT_FOUND, message: `theme "${t.id}" extends "${name}", which no theme of the app or its packs is called (from ${t.from})` })
    } else if (base === t || seen.includes(base)) {
      diagnostics.push({ severity: 'warning', code: THEME_BASE_CYCLE, message: `theme "${t.id}" extends "${name}", which comes back to it: ${[...seen, t, base].map((x) => x.id).join(' → ')}` })
    } else {
      const b = resolve(base, [...seen, t])
      const dark = b.darkTheme || own.darkTheme ? { darkTheme: mergeGroups(b.darkTheme ?? {}, own.darkTheme) } : {}
      out = { ...own, theme: mergeGroups(b.theme, own.theme), ...dark }
    }
    done.set(t, out)
    return out
  }
  return themes.map((t) => resolve(t, []))
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
      // blocks merge per block, per token (appearance §3.4).
      // colors: a layer that states its own ground drops the lower layers' extra colours (appearance §3).
      out[k] =
        k === 'blocks'
          ? mergeThemeBlocks(prev, v)
          : k === 'colors' && isRecord(v) && isRecord(prev)
            ? mergeColorLayers(prev as Record<string, string>, v as Record<string, string>)
            : isRecord(v) && isRecord(prev)
              ? { ...prev, ...v }
              : v
    }
  }
  return out
}

export const THEME_NOT_FOUND = 'THEME_NOT_FOUND'

/**
 * Why a `use` names no theme the app or its packs carry, or undefined when it
 * names one (or is `default`, the platform's own look). An error, not a quiet
 * fallback: an app whose theme went away — a pack's next major removed it — would
 * otherwise draw in another look nobody chose. The message names the theme and
 * the ones there are, so the author moves the app to one of them on purpose or
 * writes the app's own theme.
 */
export function missingThemeMessage(use: string, themes: readonly ThemeAtom[]): string | undefined {
  if (use.trim() === 'default' || findTheme(use, themes) || isRunnerPreset(use)) return undefined
  const known = [...new Set([...themes.map((t) => t.id), ...Object.keys(THEME_PRESETS)])]
  return `appearance names theme "${use.trim()}", which neither the app nor its packs carry — a pack upgrade may have removed it. Name one of ${known.map((k) => `"${k}"`).join(', ')}, or write the app's own theme (a theme atom that "extends" one of them and sets what differs)`
}

/**
 * A theme the runner itself carries (its presets: the foundation's kept themes).
 * It draws as named even when no pinned pack carries the atom, so it is no
 * finding — only a name nothing at all can draw is.
 */
function isRunnerPreset(use: string): boolean {
  const name = use.trim()
  return Object.hasOwn(THEME_PRESETS, name) || Object.hasOwn(THEME_PRESETS, `theme-${name.replace(/^(appearance|theme)-/, '')}`)
}

/** The theme `use` names, or undefined with THEME_NOT_FOUND reported at `path`. */
function namedTheme(
  use: string,
  themes: readonly ThemeAtom[],
  diagnostics: AssembleDiagnostic[],
  path: string
): ThemeAtom | undefined {
  const missing = missingThemeMessage(use, themes)
  if (missing) diagnostics.push({ severity: 'error', code: THEME_NOT_FOUND, message: missing, path })
  return findTheme(use, themes)
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
  // On its surfaces too: the app's palette is written on [data-pw-surface] itself,
  // which a rule on the document alone does not reach.
  return { light: [root, `${root} [data-pw-surface]`], refined: (r) => [`${root}${r}`, `${root}${r} [data-pw-surface]`] }
}

function modeBlocks(
  scope: PaletteScope,
  policy: 'light' | 'dark' | 'system',
  lightVars: string,
  darkVars: string,
  darkOverLightVars: string
): string {
  // Native controls (date pickers, checkboxes, select popups, scrollbars) draw in the scheme worn.
  const light = `  color-scheme: light;\n${lightVars}`
  const dark = `  color-scheme: dark;\n${darkVars}`
  const darkOverLight = `  color-scheme: dark;\n${darkOverLightVars}`
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
function paletteCss(config: Record<string, unknown> | undefined, scope: PaletteScope, resets: readonly string[] = []): string {
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
  // A block colour the app sets and this page does not is reset, so the app's
  // value (chosen for its ground) does not reach the page's own (appearance §3.1).
  for (const name of resets) {
    if (!(name in lightVars)) lightVars[name] = 'initial'
    if (!(name in darkVars)) darkVars[name] = 'initial'
  }
  // Its own dark the same way: a block colour its light sets and its dark does not
  // is reset there, or the light value (a dark heading) reaches the dark ground.
  // Custom styleVariables are the author's and stay as written.
  for (const name of Object.keys(extraColorVars(light.colors as Record<string, string> | undefined))) {
    if (!(name in darkVars)) darkVars[name] = 'initial'
  }
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
  const appCfg = config as { theme?: SurfaceTheme; darkTheme?: SurfaceTheme } | undefined
  const appExtras = Object.keys({ ...extraColorVars(appCfg?.theme?.colors as Record<string, string> | undefined), ...extraColorVars(appCfg?.darkTheme?.colors as Record<string, string> | undefined) })
  const palettes = [paletteCss(config, APP_SCOPE), ...pages.map((p) => paletteCss(p.config, pageScope(p.key), appExtras))].join('\n\n')
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

