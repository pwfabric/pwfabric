/**
 * Surface Theme Types
 *
 * Surface Theme Engine — CSS custom property–based theming system.
 *
 * A SurfaceTheme defines the visual identity of a surface through semantic tokens
 * that map to CSS custom properties injected on the surface root element.
 *
 * Cascade layers (highest → lowest priority):
 * Layer 4: block.style overrides
 *   Layer 3: block component variant logic
 *   Layer 2: surface theme (this type → CSS custom properties)
 *   Layer 1: platform defaults (@layer pw-defaults in pw-defaults.css)
 *
 * @module @pwfabric/contracts/fabric/surface-theme
 */

// ============================================================
// COLOR TOKENS
// ============================================================

/**
 * Surface color token set
 *
 * Maps to --pw-color-* CSS custom properties.
 */
export interface SurfaceThemeColors {
  /** Primary brand color — buttons, links, highlights */
  primary?: string
  /** Secondary brand color — supporting UI elements */
  secondary?: string
  /** Accent color — badges, highlights, call-to-action */
  accent?: string
  /** Surface background color (replaces styleVariables['surface-bg']) */
  background?: string
  /** Card / container background color. */
  card?: string
  /** Primary text color */
  text?: string
  /** Muted / secondary text color */
  textMuted?: string
  /** Border color for dividers, inputs, cards */
  border?: string
  /** Error state color */
  error?: string
  /** Success state color */
  success?: string
  /** Warning state color */
  warning?: string
  /** Informational state color */
  info?: string
  /** Text color for use on primary-colored backgrounds */
  textOnPrimary?: string
}

// ============================================================
// BORDER TOKENS
// ============================================================

/**
 * Surface border token set
 *
 * Maps to --pw-border-* CSS custom properties.
 */
export interface SurfaceThemeBorder {
  /** Border radius — e.g. '8px', '0.5rem', '9999px' */
  radius?: string
  /** Border width — e.g. '1px', '2px' */
  width?: string
  /** Border style — 'solid' | 'dashed' | 'dotted' */
  style?: string
  /** Large border radius variant — e.g. '0.75rem', '1rem' */
  radiusLarge?: string
  /** Small border radius — e.g. '0.125rem' (2px). Maps to --pw-border-radius-sm. */
  radiusSmall?: string
  /** Extra-large border radius — e.g. '1rem' (16px). Maps to --pw-border-radius-xl. */
  radiusXl?: string
  /** 2x-large border radius — e.g. '1.5rem' (24px). Maps to --pw-border-radius-2xl. */
  radius2xl?: string
  /** Pill / fully-rounded radius — e.g. '9999px'. Maps to --pw-border-radius-full. */
  radiusFull?: string
}

// ============================================================
// TYPOGRAPHY TOKENS
// ============================================================

/**
 * Surface typography token set
 *
 * Maps to --pw-font-* CSS custom properties.
 */
export interface SurfaceThemeTypography {
  /** Body font family stack */
  fontFamily?: string
  /** Heading-specific font family (falls back to fontFamily if not set) */
  headingFontFamily?: string
  /**
   * Monospace font family stack — code/pre, inline `code`, and mono UI
   * (e.g. command palette). Maps to --pw-font-family-mono. Keeping this a token
   * (not a hard-coded stack in each block) lets a tenant / UI-kit re-brand it.
   */
  monoFontFamily?: string
  /** Base font size — e.g. '1rem', '16px' */
  baseFontSize?: string
  /** Heading font weight — e.g. '700', '600', '900' */
  headingWeight?: string
  /** Heading line height — e.g. '1.2', '1.1', '1.4' */
  headingLineHeight?: string
  /** Heading letter spacing — e.g. '0em', '-0.02em', '0.05em' */
  letterSpacing?: string
  /** Body text line height — e.g. '1.5', '1.6', '1.75' */
  bodyLineHeight?: string
  /** Small/secondary text size — e.g. '0.875rem', '14px' */
  fontSizeSm?: string
  /** Extra-small/caption text size — e.g. '0.75rem', '12px' */
  fontSizeXs?: string
  /** Large text size — e.g. '1.125rem' (18px). Maps to --pw-font-size-lg. */
  fontSizeLg?: string
  /** Extra-large text size — e.g. '1.25rem' (20px). Maps to --pw-font-size-xl. */
  fontSizeXl?: string
  /** 2x-large text size — e.g. '1.5rem' (24px). Maps to --pw-font-size-2xl. */
  fontSize2xl?: string
  /** 3x-large text size — e.g. '1.875rem' (30px). Maps to --pw-font-size-3xl. */
  fontSize3xl?: string
  /** 4x-large display size — e.g. '2.25rem' (36px). Maps to --pw-font-size-4xl. */
  fontSize4xl?: string
  /** Body font weight — e.g. '400', '500'. Maps to --pw-font-weight-body. */
  bodyWeight?: string
  /** Body letter spacing — e.g. '0em', '0.01em'. Maps to --pw-letter-spacing-body. */
  bodyLetterSpacing?: string
  /**
   * Heading scale. One size per level, so a theme can say "display
   * headings" without every heading block picking its own step of the type
   * ramp. Maps to --pw-font-size-h1 … --pw-font-size-h5. When unset the
   * cascade derives each from the type ramp (h1 = fontSize4xl … h5 =
   * fontSizeLg), so a theme that never mentions them keeps the ramp's sizes.
   */
  fontSizeH1?: string
  fontSizeH2?: string
  fontSizeH3?: string
  fontSizeH4?: string
  fontSizeH5?: string
}

// ============================================================
// SPACING TOKENS
// ============================================================

/**
 * Surface spacing token set
 *
 * Maps to --pw-spacing-* CSS custom properties.
 */
export interface SurfaceThemeSpacing {
  /** Base spacing unit used for gaps and padding — e.g. '1rem', '16px' */
  base?: string
  /** Named spacing scale (8px-grid, base-derived). Maps to --pw-space-{xs..xxl}. */
  /** Extra-small step — e.g. '0.25rem' (4px) */
  xs?: string
  /** Small step — e.g. '0.5rem' (8px) */
  sm?: string
  /** Medium step (≈ base) — e.g. '1rem' (16px) */
  md?: string
  /** Large step — e.g. '1.5rem' (24px) */
  lg?: string
  /** Extra-large step — e.g. '2rem' (32px) */
  xl?: string
  /** 2x-large step — e.g. '3rem' (48px) */
  xxl?: string
}

// ============================================================
// SHADOW TOKENS
// ============================================================

/**
 * Surface shadow token set
 *
 * Maps to --pw-shadow-* CSS custom properties.
 */
export interface SurfaceThemeShadows {
  /** Card / container box shadow */
  card?: string
  /** Button box shadow */
  button?: string
  /** Elevation ramp — subtle (resting cards). Maps to --pw-shadow-sm. */
  sm?: string
  /** Elevation ramp — medium (raised cards, dropdowns). Maps to --pw-shadow-md. */
  md?: string
  /** Elevation ramp — large (popovers, drawers). Maps to --pw-shadow-lg. */
  lg?: string
  /** Elevation ramp — extra-large (modals, toasts). Maps to --pw-shadow-xl. */
  xl?: string
}

// ============================================================
// FOCUS TOKENS (a11y)
// ============================================================

/**
 * Surface focus-ring token set (WCAG 2.4.7 / 2.4.11)
 *
 * Centralises the keyboard focus indicator so a tenant re-skin can't silently
 * break focus visibility (previously each interactive block hard-coded its ring).
 * Maps to --pw-focus-ring-{color,width,offset}.
 */
export interface SurfaceThemeFocus {
  /** Focus ring color — e.g. a brand color or 'var(--pw-color-primary)' */
  ringColor?: string
  /** Focus ring width — e.g. '2px', '3px' */
  ringWidth?: string
  /** Focus ring offset from the element edge — e.g. '2px' */
  ringOffset?: string
}

// ============================================================
// Z-INDEX TOKENS
// ============================================================

/**
 * Surface stacking-order token set
 *
 * A single ordered scale for overlay layers so a modal never renders behind a
 * sticky navbar / floating dock. Maps to --pw-z-{nav,dropdown,sticky,drawer,modal,toast}.
 */
export interface SurfaceThemeZIndex {
  /** Sticky/affixed in-flow elements (sticky headers within content) */
  sticky?: number
  /** Site navbar */
  nav?: number
  /** Dropdown / popover menus */
  dropdown?: number
  /** Off-canvas drawer */
  drawer?: number
  /** Modal dialog + its backdrop */
  modal?: number
  /** Toast / notification (always on top) */
  toast?: number
}

// ============================================================
// MOTION TOKENS
// ============================================================

/**
 * Surface motion token set
 *
 * Maps to --pw-duration-* and --pw-easing-* CSS custom properties.
 */
export interface SurfaceThemeMotion {
  /** Fast transition duration — e.g. '150ms' */
  durationFast?: string
  /** Normal transition duration — e.g. '300ms' */
  durationNormal?: string
  /** Slow transition duration — e.g. '500ms' */
  durationSlow?: string
  /** Default easing function — e.g. 'cubic-bezier(0.4, 0, 0.2, 1)' */
  easing?: string
  /** Bouncy easing function — e.g. 'cubic-bezier(0.34, 1.56, 0.64, 1)' */
  easingBounce?: string
}

// ============================================================
// LAYOUT TOKENS
// ============================================================

/**
 * Surface layout token set
 *
 * Controls the structural dimensions of the surface render pipeline.
 * Maps to --pw-layout-* CSS custom properties.
 */
export interface SurfaceThemeLayout {
  /** Gap between root grid cells — e.g. '1rem', '16px' */
  gap?: string
  /** Outer padding of the surface root element — e.g. '1.5rem', '24px' */
  padding?: string
  /** Max-width for content containers (SectionBlock) — e.g. '1280px', '90ch' */
  containerMaxWidth?: string
  /** Gap between cells in GridBlock — e.g. '1rem', '16px' */
  gridGap?: string
  /**
   * Default VERTICAL padding for section bands. Best-practice fluid value
   * (`clamp(min, vw, max)`) so it scales with the viewport without breakpoints —
   * e.g. 'clamp(2.5rem, 5vw, 4rem)' (~40→64px). Maps to --pw-space-section-y.
   */
  sectionPaddingY?: string
  /**
   * Default HORIZONTAL padding (gutter) for section bands — fluid, e.g.
   * 'clamp(1rem, 3vw, 1.5rem)' (~16→24px). Maps to --pw-space-section-x.
   */
  sectionPaddingX?: string
}

// ============================================================
// SURFACE THEME
// ============================================================

/**
 * Surface theme definition
 *
 * All fields are optional — unset tokens inherit from platform defaults.
 * The theme is serialised into the surface definition and converted to
 * CSS custom properties at render time via surfaceThemeToCSS().
 *
 * @example
 * ```typescript
 * const myTheme: SurfaceTheme = {
 *   colors: {
 *     primary: '#6366f1',
 *     background: '#0f172a',
 *     text: '#f8fafc',
 *   },
 *   border: { radius: '0.75rem' },
 * }
 * ```
 */
export interface SurfaceTheme {
  colors?: SurfaceThemeColors
  border?: SurfaceThemeBorder
  typography?: SurfaceThemeTypography
  spacing?: SurfaceThemeSpacing
  shadows?: SurfaceThemeShadows
  motion?: SurfaceThemeMotion
  layout?: SurfaceThemeLayout
  focus?: SurfaceThemeFocus
  zIndex?: SurfaceThemeZIndex
}

// ============================================================
// PLATFORM DEFAULT THEME (single source of truth)
// ============================================================

/**
 * Platform default surface theme — the canonical "Layer 1" baseline.
 *
 * Single source of truth for the default appearance token values.
 * Keeping them here, rather than as static CSS in the runtime or in an
 * appearance pack, lets the runtime resolver fall back to a full token set synchronously (no
 * flash before the async appearance atom loads), the appearance-default atom
 * derive its baseline from one place (no drift), and surface configs / alternate
 * UI-kit appearance packs override on top.
 *
 * Values are identical to the former pw-defaults.css (zero visual change).
 */
export const DEFAULT_APPEARANCE_THEME: SurfaceTheme = {
  colors: {
    // indigo-600 (not indigo-500 #6366f1): white-on-primary = 6.29:1, clears WCAG AA
    // (≥4.5) for primary buttons/badges. #6366f1 was 4.47:1 — just under AA.
    primary: '#4f46e5',
    secondary: '#64748b',
    accent: '#f59e0b',
    background: '#ffffff',
    card: '#f8fafc',
    text: '#1e293b',
    textMuted: '#64748b',
    border: '#e2e8f0',
    error: '#ef4444',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#0369a1',
    textOnPrimary: '#ffffff',
  },
  border: {
    radius: '0.375rem',
    width: '1px',
    style: 'solid',
    radiusLarge: '0.75rem',
    // Radius scale (Batch-1) — additive, all optional.
    radiusSmall: '0.125rem',
    radiusXl: '1rem',
    radius2xl: '1.5rem',
    radiusFull: '9999px',
  },
  typography: {
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    headingFontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    monoFontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    baseFontSize: '1rem',
    headingWeight: '700',
    headingLineHeight: '1.2',
    letterSpacing: '0em',
    bodyLineHeight: '1.5',
    fontSizeSm: '0.875rem',
    fontSizeXs: '0.75rem',
    // Type scale (Batch-1) — additive, all optional, full ramp for headings/display.
    fontSizeLg: '1.125rem',
    fontSizeXl: '1.25rem',
    fontSize2xl: '1.5rem',
    fontSize3xl: '1.875rem',
    fontSize4xl: '2.25rem',
    // Body typography (Batch-1).
    bodyWeight: '400',
    bodyLetterSpacing: '0em',
  },
  spacing: {
    base: '1rem',
    // 8px-grid named scale — a closed vocabulary for block padding/gap props.
    xs: '0.25rem',
    sm: '0.5rem',
    md: '1rem',
    lg: '1.5rem',
    xl: '2rem',
    xxl: '3rem',
  },
  shadows: {
    card: '0 1px 3px rgba(0,0,0,0.1)',
    button: 'none',
    // Elevation ramp (matches the card block's variant shadows).
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 6px rgba(0,0,0,0.07)',
    lg: '0 10px 15px rgba(0,0,0,0.10)',
    xl: '0 20px 25px rgba(0,0,0,0.15)',
  },
  motion: {
    durationFast: '150ms',
    durationNormal: '300ms',
    durationSlow: '500ms',
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easingBounce: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
  layout: {
    // Full-bleed model: top-level sections are full-width bands (their own
    // background goes edge-to-edge) and stack flush — so the surface root adds
    // NO outer padding and NO inter-band gap. Each section owns its vertical
    // rhythm (sectionPaddingY) and centers its content at containerMaxWidth.
    gap: '0px',
    padding: '0px',
    containerMaxWidth: '1280px',
    gridGap: '16px',
    // Fluid section padding (best-practice: clamp scales with viewport, no
    // breakpoints — mobile shrinks automatically). Tailwind py-10→py-16 / px-4→px-6.
    sectionPaddingY: 'clamp(2.5rem, 5vw, 4rem)',
    sectionPaddingX: 'clamp(1rem, 3vw, 1.5rem)',
  },
  focus: {
    // Matches the default primary so the focus ring is on-brand + AA-contrasting;
    // tenants override ringColor to keep focus visible against their palette.
    ringColor: '#4f46e5',
    ringWidth: '2px',
    ringOffset: '2px',
  },
  zIndex: {
    // Single ordered stacking scale — overlays never render behind chrome.
    sticky: 50,
    nav: 100,
    dropdown: 200,
    drawer: 300,
    modal: 400,
    toast: 500,
  },
}
