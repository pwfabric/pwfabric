/**
 * The app's appearance: resolving a theme named by `use` against the themes
 * the app and its packs carry, and the stylesheet the shell links so the page
 * has its identity before any script runs.
 */
import {
  DEFAULT_APPEARANCE_THEME,
  findAllowedWebfont,
  mergeSurfaceThemes,
  parseFontStack,
  resolveAppearanceMode,
  resolveDarkTheme,
  surfaceThemeToCSS,
  type AllowedWebfont,
  type SurfaceTheme,
} from '@pwfabric/contracts'
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

function resolveConfig(
  doc: Record<string, unknown>,
  themes: readonly ThemeAtom[],
  diagnostics: AssembleDiagnostic[],
  path: string
): Record<string, unknown> {
  const use = doc['use']
  if (typeof use !== 'string' || !use.trim()) return doc
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
    return doc
  }
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

function declList(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
}

function modeBlocks(policy: 'light' | 'dark' | 'system', light: string, dark: string, darkOverLight: string): string {
  if (policy === 'light') return `:root, [data-pw-surface] {\n${light}\n}`
  if (policy === 'dark') return `:root, [data-pw-surface] {\n${darkOverLight}\n}`
  return `:root, [data-pw-surface] {
${light}
}

:root[data-pw-theme="dark"],
[data-pw-surface][data-pw-theme="dark"] {
${dark}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-pw-theme="light"]),
  [data-pw-surface]:not([data-pw-theme="light"]) {
${dark}
  }
}`
}

/**
 * `assets/theme.css`: the full token set as custom properties (light, the
 * dark variant per the mode policy) and the document binding — page margin,
 * body font and colours — so the app wears its identity before hydration.
 */
export function buildThemeCss(config: Record<string, unknown> | undefined): string {
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
  return `${modeBlocks(policy, declList(lightVars), declList(darkVars), declList({ ...lightVars, ...darkVars }))}

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

/**
 * The webfonts a theme names and may load: the first family of the body,
 * heading and mono stacks, and only when it is on the engine's allow-list. A
 * free-text family never becomes a URL.
 */
export function themeWebfonts(config: Record<string, unknown> | undefined): AllowedWebfont[] {
  const theme = config?.['theme']
  const typography = isRecord(theme) && isRecord(theme['typography']) ? theme['typography'] : undefined
  const out: AllowedWebfont[] = []
  for (const key of ['fontFamily', 'headingFontFamily', 'monoFontFamily']) {
    const stack = typography?.[key]
    const first = parseFontStack(typeof stack === 'string' ? stack : undefined)[0]
    const font = first === undefined ? undefined : findAllowedWebfont(first)
    if (font && !out.some((f) => f.family === font.family)) out.push(font)
  }
  return out
}

/** One stylesheet address for the families, or null when there are none. */
export function webfontStylesheetHref(fonts: readonly AllowedWebfont[]): string | null {
  if (fonts.length === 0) return null
  const families = fonts.map((f) => {
    const weights = [...new Set(f.weights)].sort((a, b) => a - b)
    const name = encodeURIComponent(f.family).replace(/%20/g, '+')
    if (weights.length === 0) return `family=${name}`
    if (!f.italic) return `family=${name}:wght@${weights.join(';')}`
    const tuples = [...weights.map((w) => `0,${w}`), ...weights.map((w) => `1,${w}`)]
    return `family=${name}:ital,wght@${tuples.join(';')}`
  })
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}
