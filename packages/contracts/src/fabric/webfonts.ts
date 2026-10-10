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
 * @module @pwfabric/contracts/fabric/webfonts
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
}

const f = (
  family: string,
  category: WebfontCategory,
  weights: readonly number[],
  italic = true,
  latinExt = true
): AllowedWebfont => ({ family, category, weights, italic, latinExt, source: 'google' })

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
