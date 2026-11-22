/**
 * THE APP'S FONTS (appearance §3.3, pwapp-format §2.3): the families a theme
 * ships as its own WOFF2 files. The build serves each file hashed under
 * `assets/fonts/`, declares an `@font-face` per file (`font-display: swap`),
 * preloads the body family's regular file, and declares a metric-matched
 * stand-in, `"<Family> Fallback"`, computed from the family's file and named
 * right after the family in the theme's font stacks. No font service, no
 * other origin: `font-src 'self'`.
 *
 * @module @pwfabric/cli/dev/fonts
 */
import { createHash } from 'node:crypto'
import { fallbackFaceOf, woff2Metrics, type FallbackKind } from './font-file.js'
import { isRecord } from './sources.js'

/** One file of a family, as the theme names it. */
export interface FontFile {
  readonly src: string
  readonly weight: number | string
  readonly style?: string
  readonly unicodeRange?: string
}

/** A family the theme ships. */
export interface ThemeFont {
  readonly family: string
  readonly files: readonly FontFile[]
  readonly fallback?: string
}

/** The name of a family's metric-matched stand-in. */
export function fallbackFamilyName(family: string): string {
  return `${family} Fallback`
}

/** The fonts a configuration's token sets (`theme`, `darkTheme`) ship, each family once. */
export function themeFontsOf(config: Record<string, unknown> | undefined): ThemeFont[] {
  const out: ThemeFont[] = []
  for (const key of ['theme', 'darkTheme']) {
    const set = config?.[key]
    const fonts = isRecord(set) && Array.isArray(set['fonts']) ? set['fonts'] : []
    for (const f of fonts) {
      if (!isRecord(f) || typeof f['family'] !== 'string' || !Array.isArray(f['files'])) continue
      const family = f['family'].trim()
      if (out.some((o) => o.family.toLowerCase() === family.toLowerCase())) continue
      const files = f['files'].filter((x): x is Record<string, unknown> => isRecord(x) && typeof x['src'] === 'string') as unknown as FontFile[]
      out.push({ family, files, ...(typeof f['fallback'] === 'string' ? { fallback: f['fallback'] } : {}) })
    }
  }
  return out
}

/** The fonts of several configurations (the app's and its pages' own), each family once, first named first. */
export function fontsOf(configs: readonly (Record<string, unknown> | undefined)[]): ThemeFont[] {
  const out: ThemeFont[] = []
  for (const config of configs) for (const font of themeFontsOf(config)) if (!out.some((o) => o.family.toLowerCase() === font.family.toLowerCase())) out.push(font)
  return out
}

/** The first family of a font stack, unquoted. */
function firstFamily(stack: string): string | undefined {
  return stack.split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim() || undefined
}

/**
 * The config with each shipped family's stand-in named right after it in its
 * stacks: `Inter, system-ui, sans-serif` → `Inter, "Inter Fallback", system-ui,
 * sans-serif`. The page draws the stand-in until the file arrives, so the text
 * keeps its place when it does. Every stack of the light and dark token sets.
 */
export function withFontFallbacks(config: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!config) return config
  const shipped = new Set(themeFontsOf(config).map((f) => f.family.toLowerCase()))
  if (shipped.size === 0) return config
  const fix = (group: unknown): unknown => {
    if (!isRecord(group) || !isRecord(group['typography'])) return group
    const typography = { ...group['typography'] }
    for (const key of ['fontFamily', 'headingFontFamily', 'monoFontFamily']) {
      const stack = typography[key]
      if (typeof stack !== 'string') continue
      const first = firstFamily(stack)
      if (first === undefined || !shipped.has(first.toLowerCase())) continue
      const name = fallbackFamilyName(first)
      if (stack.includes(name)) continue
      const parts = stack.split(',')
      typography[key] = [parts[0]?.trim(), `"${name}"`, ...parts.slice(1).map((p) => p.trim())].join(', ')
    }
    return { ...group, typography }
  }
  return { ...config, theme: fix(config['theme']), ...(config['darkTheme'] !== undefined ? { darkTheme: fix(config['darkTheme']) } : {}) }
}

/** The local font a family's fallback stands in with. */
function fallbackKind(fallback: string | undefined): FallbackKind {
  if (fallback === 'serif' || fallback === 'ui-serif') return 'serif'
  if (fallback === 'monospace' || fallback === 'ui-monospace') return 'monospace'
  return 'sans-serif'
}

/** Whether a file's weight is, or spans, `weight`. */
function coversWeight(file: FontFile, weight: number): boolean {
  if (typeof file.weight === 'number') return file.weight === weight
  const [lo, hi] = String(file.weight).split(/\s+/).map(Number)
  return lo !== undefined && hi !== undefined && lo <= weight && weight <= hi
}

/** Whether a file covers Latin (`A`, U+0041), or names no range. */
function coversLatin(file: FontFile): boolean {
  if (!file.unicodeRange) return true
  return file.unicodeRange.split(',').some((part) => {
    const m = /U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim())
    if (!m) return false
    const lo = parseInt((m[1] as string).replace(/\?/g, '0'), 16)
    const hi = m[2] ? parseInt(m[2], 16) : parseInt((m[1] as string).replace(/\?/g, 'F'), 16)
    return lo <= 0x41 && 0x41 <= hi
  })
}

/** A family's regular file for `weight`: normal style, the weight or a range spanning it, Latin first. */
function regularFile(font: ThemeFont, weight: number): FontFile | undefined {
  const normal = font.files.filter((f) => (f.style ?? 'normal') === 'normal')
  const weighted = normal.filter((f) => coversWeight(f, weight))
  return weighted.find(coversLatin) ?? weighted[0] ?? normal.find(coversLatin) ?? normal[0] ?? font.files[0]
}

/** `assets/fonts/<name>.<hash8>.woff2`: a file's served name, changing exactly when its bytes do. */
export function servedFontPath(src: string, bytes: Uint8Array): string {
  const base = (src.split('/').pop() ?? 'font.woff2').replace(/\.woff2$/i, '')
  return `assets/fonts/${base}.${createHash('sha256').update(bytes).digest('hex').slice(0, 8)}.woff2`
}

const cssString = (s: string): string => `"${s.replace(/["\\]/g, '')}"`

/** What the build serves for the app's fonts. */
export interface FontAssets {
  /** `@font-face` rules: every file, then each family's stand-in; `''` without fonts. */
  readonly css: string
  /** served path → bytes. */
  readonly files: ReadonlyMap<string, Uint8Array>
  /** The body family's regular file, as served, to preload; undefined without one. */
  readonly preload?: string
  /** The families whose stand-in is plain (`local()` alone): their file's metrics could not be read, and why. */
  readonly unreadable: readonly { readonly family: string; readonly src?: string; readonly reason: string }[]
}

/**
 * The app's fonts as served: each file the pack has, hashed under
 * `assets/fonts/` (a missing or unreadable one is the validation's
 * FONT_FILE_INVALID and is left out), an `@font-face` per file with its URL
 * relative to the theme stylesheet (`assets/`), and per family a stand-in
 * whose overrides are read from its regular file (plain, when the file's
 * metrics cannot be read). The body family's regular file is preloaded.
 */
export function fontAssetsOf(
  fonts: readonly ThemeFont[],
  pack: ReadonlyMap<string, Uint8Array>,
  body: { readonly family?: string; readonly weight?: unknown }
): FontAssets {
  const files = new Map<string, Uint8Array>()
  const served = new Map<string, string>()
  const rules: string[] = []
  const stands: string[] = []
  const unreadable: { family: string; src?: string; reason: string }[] = []
  for (const font of fonts) {
    for (const file of font.files) {
      const bytes = pack.get(file.src)
      if (!bytes) continue
      const path = served.get(file.src) ?? servedFontPath(file.src, bytes)
      served.set(file.src, path)
      files.set(path, bytes)
      rules.push(
        [
          '@font-face {',
          `  font-family: ${cssString(font.family)};`,
          `  src: url("./${path.slice('assets/'.length)}") format("woff2");`,
          `  font-weight: ${String(file.weight)};`,
          `  font-style: ${file.style ?? 'normal'};`,
          ...(file.unicodeRange ? [`  unicode-range: ${file.unicodeRange};`] : []),
          '  font-display: swap;',
          '}',
        ].join('\n')
      )
    }
    const regular = regularFile(font, 400)
    const bytes = regular ? pack.get(regular.src) : undefined
    const metrics = bytes ? woff2Metrics(bytes) : 'none'
    const kind = fallbackKind(font.fallback)
    const face = typeof metrics === 'string' ? undefined : fallbackFaceOf(metrics, kind)
    if (typeof metrics === 'string' && bytes) unreadable.push({ family: font.family, ...(regular ? { src: regular.src } : {}), reason: metrics })
    const local = face?.local ?? { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New' }[kind]
    stands.push(
      [
        '@font-face {',
        `  font-family: ${cssString(fallbackFamilyName(font.family))};`,
        `  src: local(${cssString(local)});`,
        ...(face
          ? [`  size-adjust: ${face.sizeAdjust}%;`, `  ascent-override: ${face.ascent}%;`, `  descent-override: ${face.descent}%;`, `  line-gap-override: ${face.lineGap}%;`]
          : []),
        '}',
      ].join('\n')
    )
  }
  const bodyFont = body.family ? fonts.find((f) => f.family.toLowerCase() === (body.family as string).toLowerCase()) : undefined
  const weight = Number.parseInt(String(body.weight ?? '400'), 10)
  const regular = bodyFont ? regularFile(bodyFont, Number.isFinite(weight) ? weight : 400) : undefined
  const preload = regular ? served.get(regular.src) : undefined
  return { css: [...rules, ...stands].join('\n\n'), files, unreadable, ...(preload ? { preload } : {}) }
}

/** The FONT_METRICS_UNREADABLE finding's words: the family drawn with a plain stand-in, and what that costs. */
export function unreadableMetricsMessage(u: { readonly family: string; readonly src?: string; readonly reason: string }): string {
  return `the metrics of ${u.src ?? `"${u.family}"`} cannot be read (${u.reason}): "${u.family} Fallback" is the plain local font, not matched to it, so the text may move when the font arrives`
}

/** The body family and weight of a configuration's light token set. */
export function bodyFontOf(config: Record<string, unknown> | undefined): { family?: string; weight?: unknown } {
  const theme = config?.['theme']
  const typography = isRecord(theme) && isRecord(theme['typography']) ? theme['typography'] : undefined
  const stack = typography?.['fontFamily']
  const family = typeof stack === 'string' ? firstFamily(stack) : undefined
  return { ...(family ? { family } : {}), ...(typography?.['bodyWeight'] !== undefined ? { weight: typography['bodyWeight'] } : {}) }
}
