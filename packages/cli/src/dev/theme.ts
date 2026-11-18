/**
 * The app's appearance: resolving a theme named by `use` against the themes
 * the app and its packs carry, and the stylesheet the shell links so the page
 * has its identity before any script runs.
 */
import {
  DEFAULT_APPEARANCE_THEME,
  mergeSurfaceThemes,
  resolveAppearanceMode,
  resolveDarkTheme,
  surfaceThemeToCSS,
  type SurfaceTheme,
} from '@pwfabric/contracts'
import { findAllowedWebfont, parseFontStack, type AllowedWebfont } from '@pwfabric/contracts/webfonts'
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
  const faces = fallbackFontFaces(themeWebfonts(config))
  return `${faces ? `${faces}\n` : ''}${modeBlocks(policy, declList(lightVars), declList(darkVars), declList({ ...lightVars, ...darkVars }))}

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

/** The typography group of a config's light theme, or undefined. */
function typographyOf(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  const theme = config?.['theme']
  return isRecord(theme) && isRecord(theme['typography']) ? theme['typography'] : undefined
}

/** The allowed weight nearest `wanted` (a CSS weight as the theme writes it). */
function nearestWeight(font: AllowedWebfont, wanted: unknown): number {
  const w = Number.parseInt(String(wanted ?? ''), 10)
  const target = Number.isFinite(w) ? w : 400
  return [...font.weights].sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)[0] ?? 400
}

/** Weights the pack's blocks draw body text in besides the body weight (medium, semibold, bold labels). */
const BODY_EMPHASIS = [500, 600, 700]

/**
 * The webfonts a theme names and may load: the first family of the body,
 * heading and mono stacks, and only when it is on the engine's allow-list. A
 * free-text family never becomes a URL.
 *
 * Only the styles the theme draws are asked for — every webfont style is a
 * download on the first visit, and a theme asking for all of them (italics
 * included) cost one app fourteen. A heading family gets the heading weight;
 * a body family its body weight and the emphasis weights blocks use; a mono
 * family regular. No italics: a browser slants the upright face itself.
 */
export function themeWebfonts(config: Record<string, unknown> | undefined): AllowedWebfont[] {
  const typography = typographyOf(config)
  const out: { font: AllowedWebfont; weights: Set<number> }[] = []
  const roles: readonly [string, (font: AllowedWebfont) => number[]][] = [
    ['fontFamily', (font) => [nearestWeight(font, typography?.['bodyWeight'] ?? '400'), ...BODY_EMPHASIS.filter((w) => font.weights.includes(w))]],
    ['headingFontFamily', (font) => [nearestWeight(font, typography?.['headingWeight'] ?? '700')]],
    ['monoFontFamily', (font) => [nearestWeight(font, '400')]],
  ]
  for (const [key, weights] of roles) {
    const stack = typography?.[key]
    const first = parseFontStack(typeof stack === 'string' ? stack : undefined)[0]
    const font = first === undefined ? undefined : findAllowedWebfont(first)
    if (!font) continue
    let entry = out.find((e) => e.font.family === font.family)
    if (!entry) out.push((entry = { font, weights: new Set() }))
    for (const w of weights(font)) entry.weights.add(w)
  }
  return out.map(({ font, weights }) => ({ ...font, italic: false, weights: [...weights].sort((a, b) => a - b) }))
}

/** The name of a webfont's metric-matched stand-in (see {@link fallbackFontFaces}). */
export function fallbackFamilyName(family: string): string {
  return `${family} Fallback`
}

/**
 * The config with each allow-listed webfont's stand-in named right after it
 * in its stack: `Nunito, sans-serif` → `Nunito, "Nunito Fallback", sans-serif`.
 * The page draws the stand-in until the webfont arrives, so the text keeps
 * its place when it does. Every stack in the light and dark themes; anything
 * else is left as it is.
 */
export function withWebfontFallbacks(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config) return config
  const fix = (group: unknown): unknown => {
    if (!isRecord(group) || !isRecord(group['typography'])) return group
    const typography = { ...group['typography'] }
    for (const key of ['fontFamily', 'headingFontFamily', 'monoFontFamily']) {
      const stack = typography[key]
      if (typeof stack !== 'string') continue
      const families = parseFontStack(stack)
      const font = families[0] === undefined ? undefined : findAllowedWebfont(families[0])
      if (!font) continue
      const name = fallbackFamilyName(font.family)
      if (families.includes(name)) continue
      const quote = (f: string): string => (/^[A-Za-z-]+$/.test(f) ? f : `"${f.replace(/"/g, '')}"`)
      typography[key] = [families[0] as string, name, ...families.slice(1)].map(quote).join(', ')
    }
    return { ...group, typography }
  }
  return { ...config, theme: fix(config['theme']), ...(config['darkTheme'] !== undefined ? { darkTheme: fix(config['darkTheme']) } : {}) }
}

/** `@font-face` rules for the stand-ins of the webfonts the theme loads. */
export function fallbackFontFaces(fonts: readonly AllowedWebfont[]): string {
  return fonts
    .map(
      (f) => `@font-face {
  font-family: "${fallbackFamilyName(f.family)}";
  src: local("${f.fallback.local}");
  size-adjust: ${f.fallback.sizeAdjust}%;
  ascent-override: ${f.fallback.ascent}%;
  descent-override: ${f.fallback.descent}%;
  line-gap-override: ${f.fallback.lineGap}%;
}
`
    )
    .join('\n')
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
