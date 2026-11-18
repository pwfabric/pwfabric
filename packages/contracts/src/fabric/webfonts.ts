/**
 * Webfont allow-list — the families a theme may name and expect to be LOADED.
 *
 * WHY: a family named as free text is loaded by nothing, so "Playfair
 * Display" renders as the next family in the stack, or the preset's own font
 * leaks through. Loading arbitrary names is not an answer either (a typo becomes a
 * network request, a paid family becomes a licence problem).
 *
 * This is DATA ONLY: which families are allowed, their category, the weights
 * worth requesting and whether the family covers Turkish (latin-ext). Loading
 * belongs to the publish and preview paths (the backend), and choosing belongs
 * to an editor's font picker; both read this one list so they cannot disagree.
 *
 * Every family here is served by Google Fonts under the SIL Open Font Licence.
 *
 * @module @pwfabric/contracts/webfonts
 */

export type WebfontCategory = 'sans' | 'serif' | 'display' | 'mono'

export interface AllowedWebfont {
  /** The family name exactly as a font stack names it. */
  readonly family: string
  readonly category: WebfontCategory
  /** Weights worth loading (the family may offer more). */
  readonly weights: readonly number[]
  /** True when the family ships italics. */
  readonly italic: boolean
  /** True when latin-ext is covered (Turkish: ğ ş ı İ). */
  readonly latinExt: boolean
  /** Where it is served from. */
  readonly source: 'google'
  /**
   * A local font reshaped to this family's metrics, drawn until the webfont
   * arrives, so the text does not move when it does (no layout shift on the
   * swap). Percentages, as CSS `@font-face` takes them.
   */
  readonly fallback: WebfontFallback
}

/** A metric-matched stand-in: `local(<local>)` with `size-adjust` and the vertical overrides. */
export interface WebfontFallback {
  /** A font every visitor has: `Arial`, `Times New Roman` or `Courier New`. */
  readonly local: 'Arial' | 'Times New Roman' | 'Courier New'
  /** `size-adjust`, % — makes the average glyph width match. */
  readonly sizeAdjust: number
  /** `ascent-override`, % (of the adjusted size). */
  readonly ascent: number
  /** `descent-override`, %. */
  readonly descent: number
  /** `line-gap-override`, %. */
  readonly lineGap: number
}

/**
 * Fallback metrics per family: `[local, size-adjust, ascent, descent, line gap]`.
 * Derived from each family's and the local font's own metrics (units per em,
 * ascender, descender, line gap, average character width — the Capsize
 * metrics data); regenerate when a family is added.
 */
const FALLBACKS: Readonly<Record<string, readonly [WebfontFallback['local'], number, number, number, number]>> = {
  'DM Sans': ['Arial', 104.53, 94.9, 29.66, 0],
  'IBM Plex Sans': ['Arial', 101.17, 101.32, 27.18, 0],
  'Inter': ['Arial', 107.12, 90.44, 22.52, 0],
  'Lato': ['Arial', 97.69, 101.03, 21.8, 0],
  'Manrope': ['Arial', 103.19, 103.31, 29.07, 0],
  'Montserrat': ['Arial', 112.83, 85.79, 22.25, 0],
  'Noto Sans': ['Arial', 106.33, 100.54, 27.56, 0],
  'Nunito': ['Arial', 101.39, 99.71, 34.82, 0],
  'Open Sans': ['Arial', 105.15, 101.65, 27.86, 0],
  'Outfit': ['Arial', 99.82, 100.18, 26.05, 0],
  'Poppins': ['Arial', 112.16, 93.62, 31.21, 8.92],
  'Raleway': ['Arial', 103.86, 90.51, 22.53, 0],
  'Roboto': ['Arial', 99.78, 92.98, 24.47, 0],
  'Rubik': ['Arial', 104.98, 89.06, 23.81, 0],
  'Source Sans 3': ['Arial', 93.76, 109.21, 42.66, 0],
  'Work Sans': ['Arial', 111.93, 83.09, 21.71, 0],
  'Cormorant Garamond': ['Times New Roman', 96.98, 95.27, 29.59, 0],
  'EB Garamond': ['Times New Roman', 94.77, 106.26, 31.44, 0],
  'Libre Baskerville': ['Times New Roman', 127.26, 76.22, 21.22, 0],
  'Lora': ['Times New Roman', 115.2, 87.33, 23.78, 0],
  'Merriweather': ['Times New Roman', 122.09, 80.59, 22.36, 0],
  'Newsreader': ['Times New Roman', 105.48, 69.68, 25.12, 0],
  'Noto Serif': ['Times New Roman', 118.4, 90.29, 24.75, 0],
  'Playfair Display': ['Times New Roman', 111.26, 97.25, 22.56, 0],
  'Source Serif 4': ['Times New Roman', 117.91, 87.87, 28.41, 0],
  'DM Serif Display': ['Times New Roman', 109.78, 94.37, 30.51, 0],
  'Space Grotesk': ['Arial', 109.69, 89.71, 26.62, 0],
  'Fira Code': ['Courier New', 99.98, 99.02, 32.21, 0],
  'IBM Plex Mono': ['Courier New', 99.98, 102.52, 27.5, 0],
  'JetBrains Mono': ['Courier New', 99.98, 102.02, 30, 0],
  'Roboto Mono': ['Courier New', 100, 104.79, 27.1, 0],
  'Source Code Pro': ['Courier New', 99.98, 98.42, 27.3, 0],
}

const f = (
  family: string,
  category: WebfontCategory,
  weights: readonly number[],
  italic = true,
  latinExt = true
): AllowedWebfont => {
  const m = FALLBACKS[family]
  if (!m) throw new Error(`webfonts: no fallback metrics for "${family}"`)
  const fallback: WebfontFallback = { local: m[0], sizeAdjust: m[1], ascent: m[2], descent: m[3], lineGap: m[4] }
  return { family, category, weights, italic, latinExt, source: 'google', fallback }
}

/** The allowed families, alphabetical within each category. */
export const WEBFONT_ALLOW_LIST: readonly AllowedWebfont[] = [
  // sans
  f('DM Sans', 'sans', [400, 500, 700]),
  f('IBM Plex Sans', 'sans', [400, 500, 600, 700]),
  f('Inter', 'sans', [400, 500, 600, 700]),
  f('Lato', 'sans', [400, 700]),
  f('Manrope', 'sans', [400, 500, 600, 700], false),
  f('Montserrat', 'sans', [400, 500, 600, 700]),
  f('Noto Sans', 'sans', [400, 500, 700]),
  f('Nunito', 'sans', [400, 600, 700]),
  f('Open Sans', 'sans', [400, 600, 700]),
  f('Outfit', 'sans', [400, 500, 600, 700], false),
  f('Poppins', 'sans', [400, 500, 600, 700]),
  f('Raleway', 'sans', [400, 500, 600, 700]),
  f('Roboto', 'sans', [400, 500, 700]),
  f('Rubik', 'sans', [400, 500, 700]),
  f('Source Sans 3', 'sans', [400, 600, 700]),
  f('Work Sans', 'sans', [400, 500, 600, 700]),
  // serif
  f('Cormorant Garamond', 'serif', [400, 500, 600, 700]),
  f('EB Garamond', 'serif', [400, 500, 600, 700]),
  f('Libre Baskerville', 'serif', [400, 700]),
  f('Lora', 'serif', [400, 500, 600, 700]),
  f('Merriweather', 'serif', [400, 700]),
  f('Newsreader', 'serif', [400, 500, 600, 700]),
  f('Noto Serif', 'serif', [400, 700]),
  f('Playfair Display', 'serif', [400, 600, 700]),
  f('Source Serif 4', 'serif', [400, 600, 700]),
  // display
  f('DM Serif Display', 'display', [400]),
  f('Space Grotesk', 'display', [400, 500, 700], false),
  // mono
  f('Fira Code', 'mono', [400, 500], false),
  f('IBM Plex Mono', 'mono', [400, 500]),
  f('JetBrains Mono', 'mono', [400, 500]),
  f('Roboto Mono', 'mono', [400, 500]),
  f('Source Code Pro', 'mono', [400, 500]),
]

const BY_NAME = new Map(WEBFONT_ALLOW_LIST.map((w) => [w.family.toLowerCase(), w]))

/**
 * The families of a CSS font stack, unquoted, in order:
 * `'"Playfair Display", Georgia, serif'` → `['Playfair Display', 'Georgia', 'serif']`.
 */
export function parseFontStack(stack: string | undefined | null): string[] {
  if (!stack) return []
  return stack
    .split(',')
    .map((part) => part.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter((part) => part.length > 0)
}

/** The allow-list entry for a family name (case-insensitive), or undefined. */
export function findAllowedWebfont(family: string): AllowedWebfont | undefined {
  return BY_NAME.get(family.trim().toLowerCase())
}

/** True when the family may be loaded. */
export function isAllowedWebfont(family: string): boolean {
  return findAllowedWebfont(family) !== undefined
}

/**
 * The allowed families a stack names, in stack order, without duplicates:
 * what a loader should request for this stack. System and generic families
 * (Georgia, serif) are not on the list and are simply left out.
 */
export function allowedWebfontsIn(stack: string | undefined | null): AllowedWebfont[] {
  const out: AllowedWebfont[] = []
  for (const family of parseFontStack(stack)) {
    const hit = findAllowedWebfont(family)
    if (hit && !out.includes(hit)) out.push(hit)
  }
  return out
}
