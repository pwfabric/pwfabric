/**
 * Appearance Cascade — the SINGLE implementation of theme → CSS.
 *
 * Before this module the same token mapping existed in EIGHT
 * places: `runtime/render/theme-utils.ts` plus a per-atom `theme/cascade.ts` in
 * every `ui-appearance` pack atom. Those copies were required to stay
 * byte-identical (a divergence repaints the surface after the atom bundle
 * loads) but nothing enforced it — the `audit-cascade-sync` gate the copies'
 * comments referred to was never written, and the baselines had already drifted.
 *
 * The atom bundles never loaded (the kind is `bundled:false / json-payload`), so
 * the copies were dead weight. They are gone; this is the only cascade.
 *
 * It lives in `contracts` because it is the one place all three consumers can
 * reach: the renderer, the theme exporter and the composer
 * (bake the dark variant at write time). Everything here is PURE — no DOM, no
 * React, no zod — so the leaf position is honest.
 *
 * @module @pwfabric/contracts/fabric/appearance-cascade
 */

import type { SurfaceTheme, SurfaceThemeColors } from './surface-theme.js'
import type { AppearanceContrast } from './surface-appearance.js'

/** The four status colours, in the order the cascade emits their inks. */
export const THEME_STATUS_TOKENS = ['error', 'success', 'warning', 'info'] as const
export type ThemeStatusToken = (typeof THEME_STATUS_TOKENS)[number]

/**
 * Options for `surfaceThemeToCSS`. Every field optional; omitting the object
 * gives the default (AA) output.
 */
export interface SurfaceThemeCssOptions {
  /**
   * The contrast the app promises (`appearanceConfig.mode.contrast`). `high`
   * pushes every derived ink to 7:1 and every UI edge (focus ring, control
   * border) to 4.5:1 instead of 4.5 / 3.
   */
  readonly contrast?: AppearanceContrast
}

/** The contrast lines for a contrast level: text first, UI components second. */
export function themeContrastLines(contrast: AppearanceContrast = 'normal'): { text: number; ui: number } {
  return contrast === 'high' ? { text: 7, ui: 4.5 } : { text: 4.5, ui: 3 }
}

// ============================================================
// COLOR PRIMITIVES
// ============================================================

/**
 * Parse a hex color string to its RGB components.
 *
 * Supports 3-digit (#RGB), 4-digit (#RGBA), 6-digit (#RRGGBB), and 8-digit
 * (#RRGGBBAA) hex formats. The alpha channel is parsed but not returned
 * (contrast/luminance work on opaque colors).
 *
 * @param hex - A hex color string (with or without leading #)
 * @returns RGB object, or null if the format is invalid
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Strip leading #
  let cleaned = hex.startsWith('#') ? hex.slice(1) : hex

  // Expand shorthand (3 or 4 digit)
  if (cleaned.length === 3 || cleaned.length === 4) {
    cleaned = cleaned
      .split('')
      .map((c) => c + c)
      .join('')
  }

  // Validate length (6 or 8 digit)
  if (cleaned.length !== 6 && cleaned.length !== 8) {
    return null
  }

  // Validate hex characters
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) {
    return null
  }

  const r = parseInt(cleaned.slice(0, 2), 16)
  const g = parseInt(cleaned.slice(2, 4), 16)
  const b = parseInt(cleaned.slice(4, 6), 16)

  return { r, g, b }
}

/**
 * Calculate the relative luminance of an RGB color.
 *
 * Uses the sRGB linearization formula from WCAG 2.0:
 * - Divide each channel by 255 to get a value in [0, 1]
 * - Apply sRGB gamma correction (linearize)
 * - Combine using luminance coefficients: 0.2126R + 0.7152G + 0.0722B
 *
 * @param r - Red channel (0-255)
 * @param g - Green channel (0-255)
 * @param b - Blue channel (0-255)
 * @returns Relative luminance in the range [0, 1]
 *
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const linearize = (channel: number): number => {
    const srgb = channel / 255
    return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4)
  }

  const rLin = linearize(r)
  const gLin = linearize(g)
  const bLin = linearize(b)

  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin
}

/** Lightness polarity of a hex colour: true = "light" (luminance >= 0.5).
 * Returns null when the value is not a parseable hex (e.g. a CSS var) — the
 * on-card derivation then stays out of the way. */
function isLightColor(hex: string): boolean | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return relativeLuminance(rgb.r, rgb.g, rgb.b) >= 0.5
}

// ============================================================
// SEMANTIC TOKEN MAP
// ============================================================

/**
 * Convert a SurfaceTheme to a CSS custom property map.
 *
 * The returned object is suitable for use as React inline `style` props on the
 * [data-pw-surface] root element. Undefined theme values are omitted so that the
 * CSS cascade falls through to @layer pw-defaults.
 *
 * Token mapping:
 * - colors.primary        → --pw-color-primary
 * - colors.secondary      → --pw-color-secondary
 * - colors.accent         → --pw-color-accent
 * - colors.background     → --pw-color-background
 * - colors.card           → --pw-color-card (+ --pw-color-surface alias)
 * - colors.surface        → --pw-color-surface (+ --pw-color-card alias) [@deprecated]
 * - colors.text           → --pw-color-text
 * - colors.textMuted      → --pw-color-text-muted
 * - colors.border         → --pw-color-border
 * - colors.error          → --pw-color-error
 * - colors.success        → --pw-color-success
 * - colors.warning        → --pw-color-warning
 * - colors.info           → --pw-color-info
 * - colors.textOnPrimary  → --pw-color-text-on-primary
 * - (derived) --pw-color-primary-subtle / -strong, --pw-color-accent-subtle,
 *   --pw-color-surface-muted — color-mix() from role vars (always emitted)
 * - border.*              → --pw-border-radius{,-sm,-lg,-xl,-2xl,-full}, -width, -style
 * - typography.*          → --pw-font-*, --pw-line-height-*, --pw-letter-spacing-*
 * - spacing.*             → --pw-spacing-base, --pw-space-{xs..xxl}
 * - shadows.*             → --pw-shadow-card/button + ramp sm/md/lg/xl
 * - motion.*              → --pw-duration-*, --pw-easing*
 * - layout.*              → --pw-layout-*, --pw-space-section-{x,y}
 * - focus.*               → --pw-focus-ring-{color,width,offset}
 * - zIndex.*              → --pw-z-{sticky,nav,dropdown,drawer,modal,toast}
 */
export function surfaceThemeToCSS(
  theme: SurfaceTheme | undefined,
  defaults?: SurfaceTheme,
  projectTheme?: SurfaceTheme,
  options: SurfaceThemeCssOptions = {}
): Record<string, string> {
  const lines = themeContrastLines(options.contrast)
  // When a `defaults` base is supplied (the platform DEFAULT_APPEARANCE_THEME),
  // merge per-category so an empty/partial surface theme still emits the full
  // token set — the surface config overrides only the keys it sets.
  //
  // `projectTheme` is an optional middle layer — a Project's
  // shared theme, applied AFTER platform defaults but BEFORE this surface's
  // own override. A surface that hasn't touched a given token inherits the
  // project's; one that has, keeps winning. Omitting projectTheme reproduces
  // the exact pre-Stage-2 two-layer behaviour (defaults → surface only).
  const merged: SurfaceTheme | undefined = defaults
    ? {
        colors: { ...defaults.colors, ...projectTheme?.colors, ...theme?.colors },
        border: { ...defaults.border, ...projectTheme?.border, ...theme?.border },
        typography: { ...defaults.typography, ...projectTheme?.typography, ...theme?.typography },
        spacing: { ...defaults.spacing, ...projectTheme?.spacing, ...theme?.spacing },
        shadows: { ...defaults.shadows, ...projectTheme?.shadows, ...theme?.shadows },
        motion: { ...defaults.motion, ...projectTheme?.motion, ...theme?.motion },
        layout: { ...defaults.layout, ...projectTheme?.layout, ...theme?.layout },
        focus: { ...defaults.focus, ...projectTheme?.focus, ...theme?.focus },
        zIndex: { ...defaults.zIndex, ...projectTheme?.zIndex, ...theme?.zIndex },
      }
    : theme

  if (!merged) return {}

  const vars: Record<string, string> = {}
  const { colors, border, typography, spacing, shadows, motion, layout, focus, zIndex } = merged

  // Color tokens
  if (colors?.primary) vars['--pw-color-primary'] = colors.primary
  if (colors?.secondary) vars['--pw-color-secondary'] = colors.secondary
  if (colors?.accent) vars['--pw-color-accent'] = colors.accent
  if (colors?.background) vars['--pw-color-background'] = colors.background
  // colors.card → --pw-color-card (primary) + --pw-color-surface (alias for backward compat)
  if (colors?.card) {
    vars['--pw-color-card'] = colors.card
    if (!colors?.surface) vars['--pw-color-surface'] = colors.card
  }
  // colors.surface (@deprecated) → --pw-color-surface (primary) + --pw-color-card (alias)
  if (colors?.surface) {
    vars['--pw-color-surface'] = colors.surface
    if (!colors?.card) vars['--pw-color-card'] = colors.surface
  }
  if (colors?.text) vars['--pw-color-text'] = colors.text
  if (colors?.textMuted) vars['--pw-color-text-muted'] = colors.textMuted
  if (colors?.border) vars['--pw-color-border'] = colors.border
  if (colors?.error) vars['--pw-color-error'] = colors.error
  if (colors?.success) vars['--pw-color-success'] = colors.success
  if (colors?.warning) vars['--pw-color-warning'] = colors.warning
  if (colors?.info) vars['--pw-color-info'] = colors.info
  // The button ink owes 4.5:1 to the fill it sits on, and it is pushed there
  // the same way `on-accent` is. Passed through untouched, white ink on common
  // mid-tone brand fills lands under AA (2.3-3.7:1). The brand fill is NOT
  // moved — the ink is. An ink that already reads is left exactly as authored.
  // Emitted only when the theme states an ink, so an unset one still falls
  // through to @layer pw-defaults.
  if (colors?.textOnPrimary !== undefined) {
    vars['--pw-color-text-on-primary'] =
      colors.primary !== undefined
        ? ensureInk(colors.textOnPrimary, colors.primary, lines.text)
        : colors.textOnPrimary
  }
  // Blocks that paint on an accent ground (announcement-bar, chat-panel,
  // avatar) read `--pw-color-on-accent`; without it they fall back to the
  // baseline near-black, which on a dark-derived accent is about 1.5:1. So the
  // pair is symmetric with `primary`: an ink chosen for the accent, then pushed
  // until it reads as text.
  if (colors?.accent) {
    vars['--pw-color-on-accent'] = ensureInk(inkFor(colors.accent), colors.accent, lines.text)
  }

  // ---- status colours: an ink ON each, and each AS text --------------------
  //
  // A status colour does two jobs, like primary. As a FILL (a destructive
  // button, a solid badge, an alert band) it needs an ink that reads on it:
  // `--pw-color-on-<status>`. As TEXT (a field error, a "Paid" label, an alert's
  // words) it owes the text line to the page and the card: `--pw-color-<status>-ink`.
  // Without them a destructive button paints `--pw-color-background` on the
  // error fill (often 2.6-3.9:1), and typical status colours read as text under
  // AA. The fill is never moved, the ink is: same rule as on-accent.
  {
    const statusGrounds = [colors?.background, colors?.card ?? colors?.surface].filter(
      (g): g is string => typeof g === 'string'
    )
    for (const status of THEME_STATUS_TOKENS) {
      const value = colors?.[status]
      if (!value) continue
      vars[`--pw-color-on-${status}`] = ensureInk(inkFor(value), value, lines.text)
      vars[`--pw-color-${status}-ink`] = statusGrounds.length
        ? ensureAgainst(value, statusGrounds, lines.text)
        : value
    }
  }

  // Derived color roles (Batch-1) — computed via color-mix() from the EXISTING
  // role vars so they stay fully rebrandable (a theme changes primary/accent and
  // these track automatically). They reference only the always-present --pw-color-*
  // role vars, not any optional theme input, so they're emitted whenever a colors
  // group is present.
  if (colors) {
    vars['--pw-color-primary-subtle'] =
      'color-mix(in srgb, var(--pw-color-primary) 12%, var(--pw-color-background))'
    // Mixed toward the theme's own TEXT, not a hard-coded #000. "Strong" means
    // "further from the page than primary is" — on a light theme that is darker,
    // but on a dark theme it must be BRIGHTER. Mixing toward black muddied every
    // dark palette, and since derives a dark variant for every themed
    // surface, that is now the common case rather than the exception.
    //
    // The retired `amber-onyx` atom had already made this correction in its own
    // cascade copy and flagged it as an upstream candidate; the copy was deleted
    // with the engine, so the fix is landed here where the one cascade lives.
    vars['--pw-color-primary-strong'] =
      'color-mix(in srgb, var(--pw-color-primary) 85%, var(--pw-color-text))'
    vars['--pw-color-accent-subtle'] =
      'color-mix(in srgb, var(--pw-color-accent) 12%, var(--pw-color-background))'
    vars['--pw-color-surface-muted'] =
      'color-mix(in srgb, var(--pw-color-card) 94%, var(--pw-color-text))'
  }

  // On-card ink derivation (contrast safety): the cascade
  // derives on-card ink so blocks read correctly on a card WITHOUT a per-palette
  // styleVariable. ALWAYS emitted as a LITERAL (never a var reference): blocks
  // redefine `--pw-color-text: var(--pw-color-text-on-card, var(--pw-color-text))`
  // on a card, so if on-card were undefined that redefinition is a SELF-REFERENCE
  // cycle → the property becomes invalid-at-computed-value. Emitting a concrete
  // value always breaks the cycle.
  //
  //  - Card on the SAME lightness side as the page → ink is the theme's own
  //    text/muted (no visual change; just makes the redefinition concrete).
  //  - Card on the OPPOSITE side (white card on a dark page, or vice-versa) →
  //    a contrasting ink derived from the card's luminance, so the card stays
  //    readable.
  const cardColor = colors?.card ?? colors?.surface
  if (cardColor) {
    const cardLight = isLightColor(cardColor)
    const bgLight = colors?.background ? isLightColor(colors.background) : cardLight
    const inverted = cardLight !== null && bgLight !== null && cardLight !== bgLight
    const ink = inverted
      ? cardLight
        ? '#1a1a1a'
        : '#f5f5f5'
      : colors?.text ?? (cardLight ? '#1a1a1a' : '#f5f5f5')
    vars['--pw-color-text-on-card'] = ink
    vars['--pw-color-text-muted-on-card'] = inverted
      ? `color-mix(in srgb, ${ink} 62%, var(--pw-color-card))`
      : colors?.textMuted ?? `color-mix(in srgb, ${ink} 62%, var(--pw-color-card))`
  }

  // ---- primary as INK -------------------------------------------------------
  //
  // The brand hue does two jobs and they need two values. As a FILL, `primary`
  // pairs with `text-on-primary` and is fine. As TEXT it owes 4.5:1 against
  // whatever it sits on, and `deriveDarkTheme` deliberately preserves brand
  // hues — so an indigo primary stays indigo while the surface goes dark.
  // Measured on a rendered dark surface: 2.48–2.83 across 33 sites in
  // 20 blocks. Radix formalises the same split (step 9 solid, step 11 text);
  // this is that text step.
  //
  // REPLACES `--pw-color-link-on-card`, which was this exact value under a name
  // that fit one caller. A stat icon and a tab label are not "a link on a card",
  // and a token whose name lies teaches the next reader the wrong rule — the
  // defect class this whole pass has been closing. No alias is kept: two names
  // for one value is what we are removing.
  //
  // Emitted OUTSIDE the card block on purpose. `link-on-card` lived inside
  // `if (cardColor)`, so a theme that declares no card/surface never got it and
  // every call site silently fell back to its literal. Ink belongs to `primary`,
  // not to the card; the card only decides what it is measured AGAINST.
  if (colors?.primary) {
    const ground = cardColor ?? colors?.background
    vars['--pw-color-primary-ink'] = ground
      ? ensureSeparation(colors.primary, ground, lines.text)
      : colors.primary
  }

  // ---- control edge -----------------------------------------------------------
  //
  // `border` is a divider colour: a hairline between two cards may be faint.
  // The edge of an INPUT may not; it is the only thing that says "type here"
  // (WCAG 1.4.11: 3:1 against what it sits on). The default #e2e8f0 on white is
  // 1.23:1. Controls get their own edge, the border pushed until it clears the
  // UI line on the page and the card; dividers keep the faint one.
  if (colors?.border) {
    const grounds = [colors.background, cardColor].filter((g): g is string => typeof g === 'string')
    vars['--pw-color-control-border'] = grounds.length
      ? ensureAgainst(colors.border, grounds, lines.ui)
      : colors.border
  }

  // ---- inverse set ------------------------------------------------------------
  //
  // A band that stands out from the page (a "dark band" on a light app, a
  // footer strip) cannot paint itself with `--pw-color-text` as its ground and
  // a hard-coded light ink: on a dark device the text colour is LIGHT, so the
  // "dark" band would come out light with light words on it. The
  // inverse set is the page turned inside out, in whichever mode this map is
  // for: the ground is the mode's own text colour, the ink its own background
  // (pushed to the text line), and the brand hue re-measured against the new
  // ground. Emitted only when the theme states both text and background.
  if (colors?.text && colors?.background) {
    const inverseBg = colors.text
    const inverseText = ensureInk(colors.background, inverseBg, lines.text)
    vars['--pw-color-inverse-background'] = inverseBg
    vars['--pw-color-inverse-text'] = inverseText
    vars['--pw-color-inverse-text-muted'] = `color-mix(in srgb, ${inverseText} 72%, ${inverseBg})`
    vars['--pw-color-inverse-border'] = `color-mix(in srgb, ${inverseText} 24%, ${inverseBg})`
    if (colors.primary) {
      vars['--pw-color-inverse-primary'] = ensureSeparation(colors.primary, inverseBg, lines.text)
    }
  }

  // Border tokens
  if (border?.radius) vars['--pw-border-radius'] = border.radius
  if (border?.width) vars['--pw-border-width'] = border.width
  if (border?.style) vars['--pw-border-style'] = border.style
  if (border?.radiusLarge) vars['--pw-border-radius-lg'] = border.radiusLarge
  // Radius scale (Batch-1) → --pw-border-radius-{sm,xl,2xl,full}
  if (border?.radiusSmall) vars['--pw-border-radius-sm'] = border.radiusSmall
  if (border?.radiusXl) vars['--pw-border-radius-xl'] = border.radiusXl
  if (border?.radius2xl) vars['--pw-border-radius-2xl'] = border.radius2xl
  if (border?.radiusFull) vars['--pw-border-radius-full'] = border.radiusFull

  // Typography tokens
  if (typography?.fontFamily) vars['--pw-font-family'] = typography.fontFamily
  if (typography?.headingFontFamily) vars['--pw-font-family-heading'] = typography.headingFontFamily
  if (typography?.monoFontFamily) vars['--pw-font-family-mono'] = typography.monoFontFamily
  if (typography?.baseFontSize) vars['--pw-font-size-base'] = typography.baseFontSize
  if (typography?.headingWeight) vars['--pw-font-weight-heading'] = typography.headingWeight
  if (typography?.headingLineHeight) vars['--pw-line-height-heading'] = typography.headingLineHeight
  if (typography?.letterSpacing) vars['--pw-letter-spacing-heading'] = typography.letterSpacing
  if (typography?.bodyLineHeight) vars['--pw-line-height-body'] = typography.bodyLineHeight
  if (typography?.fontSizeSm) vars['--pw-font-size-sm'] = typography.fontSizeSm
  if (typography?.fontSizeXs) vars['--pw-font-size-xs'] = typography.fontSizeXs
  // Type scale (Batch-1) → --pw-font-size-{lg,xl,2xl,3xl,4xl}
  if (typography?.fontSizeLg) vars['--pw-font-size-lg'] = typography.fontSizeLg
  if (typography?.fontSizeXl) vars['--pw-font-size-xl'] = typography.fontSizeXl
  if (typography?.fontSize2xl) vars['--pw-font-size-2xl'] = typography.fontSize2xl
  if (typography?.fontSize3xl) vars['--pw-font-size-3xl'] = typography.fontSize3xl
  if (typography?.fontSize4xl) vars['--pw-font-size-4xl'] = typography.fontSize4xl
  // Body typography (Batch-1)
  if (typography?.bodyWeight) vars['--pw-font-weight-body'] = typography.bodyWeight
  if (typography?.bodyLetterSpacing) vars['--pw-letter-spacing-body'] = typography.bodyLetterSpacing
  // Heading scale -> --pw-font-size-h1..h5. A stated size wins; an
  // unstated one points at its step of the type ramp, so a theme that never
  // mentions headings renders exactly as it did.
  if (typography) {
    const steps: ReadonlyArray<readonly [string, string | undefined, string]> = [
      ['h1', typography.fontSizeH1, 'var(--pw-font-size-4xl, 2.25rem)'],
      ['h2', typography.fontSizeH2, 'var(--pw-font-size-3xl, 1.875rem)'],
      ['h3', typography.fontSizeH3, 'var(--pw-font-size-2xl, 1.5rem)'],
      ['h4', typography.fontSizeH4, 'var(--pw-font-size-xl, 1.25rem)'],
      ['h5', typography.fontSizeH5, 'var(--pw-font-size-lg, 1.125rem)'],
    ]
    for (const [level, stated, derived] of steps) vars[`--pw-font-size-${level}`] = stated ?? derived
  }

  // Spacing tokens
  if (spacing?.base) vars['--pw-spacing-base'] = spacing.base
  // Named spacing scale (8px-grid) → --pw-space-{xs..xxl}
  if (spacing?.xs !== undefined) vars['--pw-space-xs'] = spacing.xs
  if (spacing?.sm !== undefined) vars['--pw-space-sm'] = spacing.sm
  if (spacing?.md !== undefined) vars['--pw-space-md'] = spacing.md
  if (spacing?.lg !== undefined) vars['--pw-space-lg'] = spacing.lg
  if (spacing?.xl !== undefined) vars['--pw-space-xl'] = spacing.xl
  if (spacing?.xxl !== undefined) vars['--pw-space-xxl'] = spacing.xxl

  // Shadow tokens
  if (shadows?.card !== undefined) vars['--pw-shadow-card'] = shadows.card
  if (shadows?.button !== undefined) vars['--pw-shadow-button'] = shadows.button
  // Elevation ramp → --pw-shadow-{sm..xl}
  if (shadows?.sm !== undefined) vars['--pw-shadow-sm'] = shadows.sm
  if (shadows?.md !== undefined) vars['--pw-shadow-md'] = shadows.md
  if (shadows?.lg !== undefined) vars['--pw-shadow-lg'] = shadows.lg
  if (shadows?.xl !== undefined) vars['--pw-shadow-xl'] = shadows.xl

  // Motion tokens
  if (motion?.durationFast !== undefined) vars['--pw-duration-fast'] = motion.durationFast
  if (motion?.durationNormal !== undefined) vars['--pw-duration-normal'] = motion.durationNormal
  if (motion?.durationSlow !== undefined) vars['--pw-duration-slow'] = motion.durationSlow
  if (motion?.easing !== undefined) vars['--pw-easing'] = motion.easing
  if (motion?.easingBounce !== undefined) vars['--pw-easing-bounce'] = motion.easingBounce

  // Layout tokens
  if (layout?.gap !== undefined) vars['--pw-layout-surface-gap'] = layout.gap
  if (layout?.padding !== undefined) vars['--pw-layout-surface-padding'] = layout.padding
  if (layout?.containerMaxWidth !== undefined)
    vars['--pw-layout-container-max-width'] = layout.containerMaxWidth
  if (layout?.gridGap !== undefined) vars['--pw-layout-grid-gap'] = layout.gridGap
  // Fluid section padding tokens (layout) — section blocks read these as
  // their default paddingBlock/paddingInline so spacing is theme-driven + responsive.
  if (layout?.sectionPaddingY !== undefined) vars['--pw-space-section-y'] = layout.sectionPaddingY
  if (layout?.sectionPaddingX !== undefined) vars['--pw-space-section-x'] = layout.sectionPaddingX

  // Focus tokens (a11y) → --pw-focus-ring-{color,width,offset}
  // The ring is a UI component (WCAG 1.4.11 / 2.4.11): 3:1 against the page
  // AND the card it may sit on, in whichever mode this map is for. Five of six
  // presets carried indigo #4f46e5 — 2.84:1 on midnight's own ground — and a
  // ring chosen for a light page fell under 3:1 on the derived dark ground,
  // which passes the ring through. Hue and saturation stay; only lightness
  // moves, and only when it has to.
  if (focus?.ringColor !== undefined) {
    const grounds = [colors?.background, cardColor].filter((g): g is string => typeof g === 'string')
    vars['--pw-focus-ring-color'] = grounds.length
      ? ensureAgainst(focus.ringColor, grounds, lines.ui)
      : focus.ringColor
  }
  if (focus?.ringWidth !== undefined) vars['--pw-focus-ring-width'] = focus.ringWidth
  if (focus?.ringOffset !== undefined) vars['--pw-focus-ring-offset'] = focus.ringOffset

  // Z-index scale → --pw-z-{sticky,nav,dropdown,drawer,modal,toast}
  if (zIndex?.sticky !== undefined) vars['--pw-z-sticky'] = String(zIndex.sticky)
  if (zIndex?.nav !== undefined) vars['--pw-z-nav'] = String(zIndex.nav)
  if (zIndex?.dropdown !== undefined) vars['--pw-z-dropdown'] = String(zIndex.dropdown)
  if (zIndex?.drawer !== undefined) vars['--pw-z-drawer'] = String(zIndex.drawer)
  if (zIndex?.modal !== undefined) vars['--pw-z-modal'] = String(zIndex.modal)
  if (zIndex?.toast !== undefined) vars['--pw-z-toast'] = String(zIndex.toast)

  return vars
}

// ============================================================
// DARK VARIANT DERIVATION
// ============================================================

interface Hsl {
  h: number
  s: number
  l: number
}

/** RGB (0-255) → HSL (h 0-360, s/l 0-1). */
function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  const d = max - min
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0)
        break
      case gn:
        h = (bn - rn) / d + 2
        break
      default:
        h = (rn - gn) / d + 4
    }
    h *= 60
  }
  return { h, s, l }
}

/** HSL → hex (#rrggbb). */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (hp >= 0 && hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = l - c / 2
  const to255 = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${to255(r)}${to255(g)}${to255(b)}`
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Parse a hex colour to HSL; null when the value is not a hex the parser accepts
 * (e.g. a CSS var reference or a named colour) — the caller then keeps the
 * original value unchanged rather than guessing. */
function toHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsl(rgb.r, rgb.g, rgb.b) : null
}

/**
 * Re-target a colour's lightness into [lo, hi] while keeping its hue and
 * saturation. Used to move a neutral to the opposite end of the ramp: a near-
 * white background (l~1) becomes a dark background, a dark ink becomes a light
 * ink — without losing a subtle tint (a faintly-blue border stays faintly blue).
 */
function retargetLightness(hex: string, lo: number, hi: number): string {
  const hsl = toHsl(hex)
  if (!hsl) return hex
  const flipped = 1 - hsl.l
  return hslToHex(hsl.h, hsl.s, clamp(flipped, lo, hi))
}

/** Set an absolute lightness (hue/sat kept). Used to place card/border a fixed
 * step above the derived background so elevation ordering survives the flip. */
function withLightness(hex: string, l: number): string {
  const hsl = toHsl(hex)
  if (!hsl) return hex
  return hslToHex(hsl.h, hsl.s, clamp(l, 0, 1))
}

/** Lightness of a hex in [0,1], or a fallback when unparseable. */
function lightnessOf(hex: string, fallback: number): number {
  return toHsl(hex)?.l ?? fallback
}

/**
 * Derive a dark SurfaceTheme from a (fully-merged) light one. Neutrals flip;
 * brand + semantic hues are preserved. Non-colour categories (typography,
 * spacing, borders, motion, layout, focus, z-index) are mode-independent and
 * pass through unchanged. Shadows are deepened for a dark ground.
 *
 * Pass a FULL theme (merged over the platform defaults) so every neutral has a
 * concrete value to flip.
 *
 * Runs at WRITE time (an editor can bake the result into
 * `appearance.config.darkTheme` so the author can see and edit it) and, for
 * surfaces that carry no baked variant, at render time as the fallback.
 */
/** WCAG contrast ratio between two hex colours; null when either is unparseable. */
function contrastOf(a: string, b: string): number | null {
  const ra = hexToRgb(a)
  const rb = hexToRgb(b)
  if (!ra || !rb) return null
  const la = relativeLuminance(ra.r, ra.g, ra.b)
  const lb = relativeLuminance(rb.r, rb.g, rb.b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Keep a control colour VISIBLE against the ground it sits on.
 *
 * `deriveDarkTheme` preserves brand hues so a theme stays recognisably itself —
 * right for a chromatic brand (gold stays gold). But a NEUTRAL or already-dark
 * primary is emphatic in light mode precisely because it is dark; flipping the
 * ground beneath it without touching it leaves both on the same side of the
 * ramp and the control disappears. Measured on the shipped themes: zinc's
 * primary went from 17.7:1 on white to 1.08:1 on the derived dark ground —
 * an invisible button.
 *
 * So: keep hue and saturation, move LIGHTNESS until the pair clears `min`
 * (3:1, the WCAG floor for UI components). Walk in steps rather than jumping to
 * white so a colour that only just fails moves only just enough.
 */
function ensureSeparation(colour: string, ground: string, min = 3): string {
  const current = contrastOf(colour, ground)
  if (current === null || current >= min) return colour
  const hsl = toHsl(colour)
  const groundL = lightnessOf(ground, 0.1)
  if (!hsl) return colour
  // Move AWAY from the ground: lighter on a dark ground, darker on a light one.
  const up = groundL < 0.5
  for (let step = 1; step <= 20; step++) {
    const l = clamp(up ? hsl.l + step * 0.05 : hsl.l - step * 0.05, 0, 1)
    const candidate = hslToHex(hsl.h, hsl.s, l)
    const ratio = contrastOf(candidate, ground)
    if (ratio !== null && ratio >= min) return candidate
    if (l === 0 || l === 1) break
  }
  return up ? '#ffffff' : '#000000'
}

/** Ink that reads on `bg` — used when a control colour has been re-targeted and
 * the old on-colour ink would land on the wrong side. */
function inkFor(bg: string): string {
  const rgb = hexToRgb(bg)
  if (!rgb) return '#ffffff'
  return relativeLuminance(rgb.r, rgb.g, rgb.b) >= 0.5 ? '#1a1a1a' : '#fafafa'
}

/**
 * An INK that reads as text (`min`, default 4.5:1) on `ground`.
 *
 * `ensureSeparation` walks a colour in ONE direction picked from the ground's
 * HSL lightness and falls back to pure white or black. That is the wrong tool
 * for an ink: white on forest #22c55e (HSL lightness 0.45) walked "up", could
 * not get any whiter, and came back as the same failing white.
 *
 * So: an ink that already reads is kept. Otherwise the side that CAN reach
 * `min` is chosen — the author's side first — and the GROUND's own hue is
 * walked toward it, so a failing white on green becomes a deep green rather
 * than a grey. Black or white is the last resort.
 */
function ensureInk(ink: string, ground: string, min = 4.5): string {
  const current = contrastOf(ink, ground)
  if (current === null || current >= min) return ink
  const g = hexToRgb(ground)
  const gh = toHsl(ground)
  if (!g || !gh) return ink
  const groundLum = relativeLuminance(g.r, g.g, g.b)
  const i = hexToRgb(ink)
  const inkIsLighter = i ? relativeLuminance(i.r, i.g, i.b) > groundLum : groundLum < 0.18
  const reachable = {
    light: 1.05 / (groundLum + 0.05) >= min,
    dark: (groundLum + 0.05) / 0.05 >= min,
  }
  const sides: Array<'light' | 'dark'> = inkIsLighter ? ['light', 'dark'] : ['dark', 'light']
  for (const side of sides) {
    if (!reachable[side]) continue
    const dir = side === 'light' ? 1 : -1
    for (let step = 1; step <= 50; step++) {
      const l = clamp(gh.l + dir * step * 0.02, 0, 1)
      const candidate = hslToHex(gh.h, gh.s, l)
      const ratio = contrastOf(candidate, ground)
      if (ratio !== null && ratio >= min) return candidate
      if (l === 0 || l === 1) break
    }
    return side === 'light' ? '#ffffff' : '#000000'
  }
  const onBlack = contrastOf('#000000', ground) ?? 0
  const onWhite = contrastOf('#ffffff', ground) ?? 0
  return onBlack >= onWhite ? '#000000' : '#ffffff'
}

/**
 * A colour that clears `min` against EVERY ground it may sit on — page and
 * card. Hue and saturation are kept; lightness walks away from the grounds
 * first, then toward them. When no single lightness clears them all (a white
 * page with a black card) the candidate with the best worst-case ratio is
 * returned rather than pretending.
 */
function ensureAgainst(colour: string, grounds: readonly string[], min = 3): string {
  const worst = (c: string): number | null => {
    let w: number | null = null
    for (const g of grounds) {
      const r = contrastOf(c, g)
      if (r === null) continue
      w = w === null ? r : Math.min(w, r)
    }
    return w
  }
  const start = worst(colour)
  if (start === null || start >= min) return colour
  const hsl = toHsl(colour)
  if (!hsl) return colour
  const meanL = grounds.reduce((sum, g) => sum + lightnessOf(g, 0.5), 0) / grounds.length
  let best = { colour, ratio: start }
  for (const dir of meanL < 0.5 ? [1, -1] : [-1, 1]) {
    for (let step = 1; step <= 50; step++) {
      const l = clamp(hsl.l + dir * step * 0.02, 0, 1)
      const candidate = hslToHex(hsl.h, hsl.s, l)
      const ratio = worst(candidate) ?? 0
      if (ratio >= min) return candidate
      if (ratio > best.ratio) best = { colour: candidate, ratio }
      if (l === 0 || l === 1) break
    }
  }
  return best.colour
}

export function deriveDarkTheme(light: SurfaceTheme): SurfaceTheme {
  const c: SurfaceThemeColors = light.colors ?? {}

  // Background: near-white → deep neutral. Anchor the dark ground's lightness.
  const bgHex = c.background ?? '#ffffff'
  const bgDark = retargetLightness(bgHex, 0.06, 0.16)
  const bgL = lightnessOf(bgDark, 0.1)

  // Card/surface sit one elevation step ABOVE the background (lighter in dark).
  const cardStepL = clamp(bgL + 0.05, 0, 1)
  const borderL = clamp(bgL + 0.14, 0, 1)

  // Brand hues are kept — but a control has to stay visible on the new ground.
  // See `ensureSeparation`: only colours that actually fail the 3:1 UI floor
  // move, and they move by lightness alone, so the hue survives.
  const primaryDark = c.primary !== undefined ? ensureSeparation(c.primary, bgDark) : undefined
  const accentDark = c.accent !== undefined ? ensureSeparation(c.accent, bgDark) : undefined
  // If primary was re-targeted, the ink that sat on it may now be on the wrong
  // side — a light primary with light text is the same defect one layer in.
  const textOnPrimaryDark =
    primaryDark !== undefined && primaryDark !== c.primary ? inkFor(primaryDark) : undefined

  // Text is measured against BOTH dark grounds. The lightness bands below were
  // tuned on light palettes; re-deriving an already-dark theme (midnight) put
  // textMuted at 4.02:1 on its card. Only a value under 4.5 moves.
  const cardSource = c.card ?? c.surface
  const darkGrounds = [bgDark, ...(cardSource !== undefined ? [withLightness(cardSource, cardStepL)] : [])]

  const colors: SurfaceThemeColors = {
    ...c, // brand + semantic kept unless separation forced a move
    background: bgDark,
    ...(primaryDark !== undefined ? { primary: primaryDark } : {}),
    ...(accentDark !== undefined ? { accent: accentDark } : {}),
    ...(textOnPrimaryDark !== undefined ? { textOnPrimary: textOnPrimaryDark } : {}),
    ...(c.card !== undefined ? { card: withLightness(c.card, cardStepL) } : {}),
    ...(c.surface !== undefined ? { surface: withLightness(c.surface, cardStepL) } : {}),
    ...(c.text !== undefined
      ? { text: ensureAgainst(retargetLightness(c.text, 0.86, 0.96), darkGrounds, 4.5) }
      : {}),
    ...(c.textMuted !== undefined
      ? { textMuted: ensureAgainst(retargetLightness(c.textMuted, 0.58, 0.74), darkGrounds, 4.5) }
      : {}),
    ...(c.border !== undefined ? { border: withLightness(c.border, borderL) } : {}),
    // The error colour is TEXT — a field message, an alert's words. No single
    // red reads on both grounds: an AA
    // red on white (#b91c1c, 6.5:1) is ~2.6:1 on the derived dark page, and a
    // red that reads on dark fails on white. So the light value stays the
    // author's and the dark one is DERIVED — same hue, lightness walked until
    // it clears 4.5 on the dark page and card, like text and textMuted above.
    // An error that already reads on dark does not move.
    ...(c.error !== undefined ? { error: ensureAgainst(c.error, darkGrounds, 4.5) } : {}),
    // The other three status colours are text just as often ("Paid", "Low
    // stock", a hint line): a green chosen for white is under AA on the
    // derived dark page. Same rule.
    ...(c.success !== undefined ? { success: ensureAgainst(c.success, darkGrounds, 4.5) } : {}),
    ...(c.warning !== undefined ? { warning: ensureAgainst(c.warning, darkGrounds, 4.5) } : {}),
    ...(c.info !== undefined ? { info: ensureAgainst(c.info, darkGrounds, 4.5) } : {}),
  }

  // Depth on a dark ground comes from a soft black glow, not a hairline shadow.
  const shadows = light.shadows
    ? {
        ...light.shadows,
        ...(light.shadows.card !== undefined ? { card: '0 4px 16px rgba(0,0,0,0.5)' } : {}),
      }
    : light.shadows

  return { ...light, colors, ...(shadows ? { shadows } : {}) }
}

// ============================================================
// LAYERS AND MODES
// ============================================================

/**
 * Merge theme layers per category, later layers winning, into one theme.
 *
 * The one merge the platform does everywhere — defaults < project < surface —
 * written once. Each group (colors, typography, …) is merged shallowly; a key
 * whose value is not a plain object is taken from the last layer that sets it.
 * `undefined` layers are skipped, so optional layers can be passed as they are.
 */
export function mergeSurfaceThemes(...layers: ReadonlyArray<SurfaceTheme | undefined>): SurfaceTheme {
  const isGroup = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
  const out: Record<string, unknown> = {}
  for (const layer of layers) {
    if (!layer) continue
    for (const [key, value] of Object.entries(layer as Record<string, unknown>)) {
      if (value === undefined) continue
      const prev = out[key]
      out[key] = isGroup(value) ? { ...(isGroup(prev) ? prev : {}), ...value } : value
    }
  }
  return out as SurfaceTheme
}

/**
 * The dark theme a surface actually wears: the DERIVED dark of its full light
 * theme, with any explicit dark overrides on top.
 *
 * An explicit `darkTheme` is an OVERRIDE of the derivation, never a theme of
 * its own: an editor's dark tab stores only the tokens the author changed.
 * Merging it over the LIGHT default instead would turn one edited dark colour
 * into a dark mode with a white page and dark text. A fully baked dark variant
 * still renders as baked: every token it sets wins.
 *
 * @param light  a FULL light theme (merged over DEFAULT_APPEARANCE_THEME)
 * @param overrides  dark override layers, lowest first (project, then surface)
 */
export function resolveDarkTheme(
  light: SurfaceTheme,
  ...overrides: ReadonlyArray<SurfaceTheme | undefined>
): SurfaceTheme {
  return mergeSurfaceThemes(deriveDarkTheme(light), ...overrides)
}

/** One pair a theme fails, as it would RENDER (after the cascade's pushes). */
export interface ThemeContrastFinding {
  /** Theme tokens, foreground first: `['textMuted', 'card']`, `['focus.ringColor', 'background']`. */
  readonly pair: readonly [string, string]
  readonly foreground: string
  readonly background: string
  readonly ratio: number
  /** 4.5 for text, 3 for a UI component (the focus ring); 7 / 4.5 at high contrast. */
  readonly min: number
  readonly kind: 'text' | 'ui'
  /**
   * Which family of pairs this is. `base` is always checked; the others come
   * only with `{ extended: true }`:
   *
   *   status     the error colour as text, each status ink as text, each
   *              `on-<status>` ink on its fill
   *   selection  a selected item (primary fill) against an unselected one
   *              (card / page): badge, segmented control, stepper
   *   control    the control edge against the page and the card
   *
   * Absent unless `{ extended: true }` was passed; read it as `base`.
   */
  readonly group?: ThemeContrastGroup
}

export type ThemeContrastGroup = 'base' | 'status' | 'selection' | 'control'

/** WCAG AA line for text pairs. */
export const THEME_TEXT_CONTRAST_MIN = 4.5
/** WCAG line for UI components (the focus indicator). */
export const THEME_UI_CONTRAST_MIN = 3

/** Options for `themeContrastFindings`. */
export interface ThemeContrastOptions {
  /**
   * Also check the status, selection and control pairs. Off by default so a
   * gate that refuses on findings stays narrow; a caller that wants the wider
   * picture (a warning list, an editor's theme card) opts in.
   */
  readonly extended?: boolean
  /** The contrast level the app promises; `high` raises the lines to 7 / 4.5. */
  readonly contrast?: AppearanceContrast
}

/**
 * The contrast pairs a theme FAILS, measured on what the cascade emits.
 *
 * Base, always: text and textMuted on background and card, and the button ink
 * on primary (text line); the focus ring on background and card (UI line).
 *
 * Extended (`{ extended: true }`):
 *   - status: the raw error colour on background and card (blocks still paint
 *     it as text), every `<status>-ink` on background and card, every
 *     `on-<status>` ink on its own fill (text line);
 *   - selection: the primary fill against the card and the page, the line a
 *     selected badge / segment / step owes its unselected neighbour (UI line);
 *   - control: the control edge on background and card (UI line).
 *
 * Inks, the ring and the control edge are measured AFTER `surfaceThemeToCSS`
 * pushes them, so a value the cascade corrects is not reported; the neutrals
 * and the raw colours are measured as written, because nothing moves them.
 * Unparseable values (a `var()`) are skipped.
 *
 * Pass a FULL theme for the mode being checked: the light theme merged over
 * the defaults, or `resolveDarkTheme(light, …)` for dark.
 */
export function themeContrastFindings(
  theme: SurfaceTheme,
  options: ThemeContrastOptions = {}
): ThemeContrastFinding[] {
  const c = theme.colors ?? {}
  const card = c.card ?? c.surface
  const lines = themeContrastLines(options.contrast)
  const findings: ThemeContrastFinding[] = []
  const check = (
    pair: [string, string],
    fg: string | undefined,
    bg: string | undefined,
    kind: 'text' | 'ui',
    group: ThemeContrastGroup = 'base'
  ): void => {
    if (fg === undefined || bg === undefined) return
    const ratio = contrastOf(fg, bg)
    const min = kind === 'text' ? lines.text : lines.ui
    if (ratio === null || ratio >= min) return
    const finding: ThemeContrastFinding = {
      pair,
      foreground: fg,
      background: bg,
      ratio: Math.round(ratio * 100) / 100,
      min,
      kind,
      // `group` is set only when the caller opted in to extended findings.
      ...(options.extended ? { group } : {}),
    }
    findings.push(finding)
  }
  check(['text', 'background'], c.text, c.background, 'text')
  check(['text', 'card'], c.text, card, 'text')
  check(['textMuted', 'background'], c.textMuted, c.background, 'text')
  check(['textMuted', 'card'], c.textMuted, card, 'text')
  const emitted = surfaceThemeToCSS(
    { colors: c, ...(theme.focus ? { focus: theme.focus } : {}) },
    undefined,
    undefined,
    options.contrast ? { contrast: options.contrast } : {}
  )
  check(['textOnPrimary', 'primary'], emitted['--pw-color-text-on-primary'], c.primary, 'text')
  check(['focus.ringColor', 'background'], emitted['--pw-focus-ring-color'], c.background, 'ui')
  check(['focus.ringColor', 'card'], emitted['--pw-focus-ring-color'], card, 'ui')
  if (!options.extended) return findings

  // status
  check(['error', 'background'], c.error, c.background, 'text', 'status')
  check(['error', 'card'], c.error, card, 'text', 'status')
  for (const status of THEME_STATUS_TOKENS) {
    const ink = emitted[`--pw-color-${status}-ink`]
    check([`${status}Ink`, 'background'], ink, c.background, 'text', 'status')
    check([`${status}Ink`, 'card'], ink, card, 'text', 'status')
    const onName = `on${status.charAt(0).toUpperCase()}${status.slice(1)}`
    check([onName, status], emitted[`--pw-color-on-${status}`], c[status], 'text', 'status')
  }
  // selection
  check(['primary', 'card'], c.primary, card, 'ui', 'selection')
  check(['primary', 'background'], c.primary, c.background, 'ui', 'selection')
  // control
  check(['controlBorder', 'background'], emitted['--pw-color-control-border'], c.background, 'ui', 'control')
  check(['controlBorder', 'card'], emitted['--pw-color-control-border'], card, 'ui', 'control')
  return findings
}

// ============================================================
// BRAND AND INK
// ============================================================

/** What `brandInk` settled on. */
export interface BrandInkResult {
  /** The ink to write on the brand fill. */
  readonly ink: string
  /** The brand fill: the author's value unless it had to darken. */
  readonly brand: string
  /** How much the brand's lightness was lowered, 0..maxDarken (0.04 = 4%). */
  readonly darkened: number
  /** True when the pair clears `min`. */
  readonly meets: boolean
}

/**
 * Ink first, brand last: the rule for text on a brand fill.
 *
 * 1. The ink moves: the preferred ink is kept if it reads; otherwise the
 *    cascade's ink push picks the brand's own deep (or light) tone, then black
 *    or white. This is exactly what `surfaceThemeToCSS` does for
 *    `text-on-primary`, so the helper and the rendered page agree.
 * 2. Only when no ink can reach `min` (a mid-tone brand at a 7:1 promise) does
 *    the BRAND move, darkening its lightness by at most `maxDarken` (default
 *    0.04, i.e. 4%). The caller shows that as "adjusted for accessibility".
 *
 * Pure; the cascade never darkens a brand on its own. Call this where the
 * author's colour is chosen.
 */
export function brandInk(
  brand: string,
  options: { readonly ink?: string; readonly min?: number; readonly maxDarken?: number } = {}
): BrandInkResult {
  const min = options.min ?? THEME_TEXT_CONTRAST_MIN
  const maxDarken = Math.max(0, options.maxDarken ?? 0.04)
  const preferred = options.ink ?? inkFor(brand)
  const first = ensureInk(preferred, brand, min)
  const firstRatio = contrastOf(first, brand)
  if (firstRatio === null) return { ink: preferred, brand, darkened: 0, meets: false }
  if (firstRatio >= min) return { ink: first, brand, darkened: 0, meets: true }
  const hsl = toHsl(brand)
  if (hsl) {
    const STEP = 0.005
    for (let d = STEP; d <= maxDarken + 1e-9; d += STEP) {
      const darker = hslToHex(hsl.h, hsl.s, clamp(hsl.l - d, 0, 1))
      const ink = ensureInk(preferred, darker, min)
      const ratio = contrastOf(ink, darker)
      if (ratio !== null && ratio >= min) {
        return { ink, brand: darker, darkened: Math.round(d * 1000) / 1000, meets: true }
      }
    }
  }
  return { ink: first, brand, darkened: 0, meets: false }
}
