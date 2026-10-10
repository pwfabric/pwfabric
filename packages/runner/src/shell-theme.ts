/**
 * The shell's own chrome, in the app's appearance.
 *
 * The sign-in gate and the fallback session pill are drawn by the runner, not
 * by the renderer, so they live OUTSIDE `[data-pw-surface]` — the element the
 * renderer puts the theme variables on. Inheritance cannot reach them. Two
 * things close that gap:
 *
 *  1. `shellThemeVars` resolves the project's appearance with the SAME cascade
 *     the renderer runs (`surfaceThemeToCSS` over `DEFAULT_APPEARANCE_THEME`,
 *     then `styleVariables`), and `applyThemeVars` sets the result on the
 *     chrome element itself.
 *  2. One stylesheet (`#pwapp-shell-css`) styles that chrome from those
 *     variables — `var(--token, <old literal>)` — so a runtime too old to
 *     resolve anything still paints the previous look.
 *
 * Runtime values are read off the embed-seeded `__pwfabric_runtime`
 * namespace, never imported by name: the pwapp import-map shims are partial
 * lists, and a missing named export fails the whole runner module at link
 * time (see entity-facade.ts).
 *
 * @module @pwfabric/runner/shell-theme
 */

type ThemeToCss = (
  theme: unknown,
  defaults?: unknown,
  projectTheme?: unknown
) => Record<string, string>

function runtimeNs(): Record<string, unknown> {
  return (globalThis as { __pwfabric_runtime?: Record<string, unknown> }).__pwfabric_runtime ?? {}
}

/** The CSS variables the shell chrome should carry for this appearance. */
export function shellThemeVars(
  appearance: { config?: Record<string, unknown> } | null | undefined
): Record<string, string> {
  const cfg = appearance?.config
  if (!cfg) return {}
  const ns = runtimeNs()
  const toCss = ns['surfaceThemeToCSS']
  const defaults = ns['DEFAULT_APPEARANCE_THEME']
  const themeVars =
    typeof toCss === 'function' && defaults
      ? (toCss as ThemeToCss)(cfg['theme'] ?? undefined, defaults)
      : {}

  const custom: Record<string, string> = {}
  const styleVariables = cfg['styleVariables']
  if (styleVariables && typeof styleVariables === 'object') {
    for (const [key, value] of Object.entries(styleVariables as Record<string, unknown>)) {
      if (typeof value !== 'string') continue
      custom[key.startsWith('--') ? key : `--${key}`] = value
    }
  }
  return { ...themeVars, ...custom }
}

type ThemeMerge = (...layers: unknown[]) => unknown
type DarkResolve = (light: unknown, ...overrides: unknown[]) => unknown
type DarkDerive = (light: unknown) => unknown

/**
 * The DARK variables the shell chrome should carry — the same dark mode the
 * surface wears: the derivation of the app's full light theme, with the app's
 * `darkTheme` overrides on top.
 *
 * The chrome only ever got the light set, so on a dark OS the app turned dark
 * around a white sign-in gate and a white session pill. Read off the runtime
 * namespace like everything here; a runtime too old to carry `resolveDarkTheme`
 * still derives (without overrides), and one with neither leaves the chrome
 * light rather than guessing.
 */
export function shellDarkThemeVars(
  appearance: { config?: Record<string, unknown> } | null | undefined
): Record<string, string> {
  const cfg = appearance?.config
  if (!cfg) return {}
  const ns = runtimeNs()
  const toCss = ns['surfaceThemeToCSS']
  const defaults = ns['DEFAULT_APPEARANCE_THEME']
  const merge = ns['mergeSurfaceThemes']
  const resolveDark = ns['resolveDarkTheme']
  const derive = ns['deriveDarkTheme']
  if (typeof toCss !== 'function' || !defaults) return {}
  if (typeof merge === 'function' && typeof resolveDark === 'function') {
    const light = (merge as ThemeMerge)(defaults, cfg['theme'] ?? undefined)
    return (toCss as ThemeToCss)((resolveDark as DarkResolve)(light, cfg['darkTheme'] ?? undefined))
  }
  if (typeof derive === 'function') {
    const own = (cfg['theme'] ?? {}) as Record<string, Record<string, unknown> | undefined>
    const base = defaults as Record<string, Record<string, unknown> | undefined>
    const light: Record<string, unknown> = {}
    for (const k of new Set([...Object.keys(base), ...Object.keys(own)])) light[k] = { ...base[k], ...own[k] }
    return (toCss as ThemeToCss)((derive as DarkDerive)(light))
  }
  return {}
}

const DARK_SHEET_ID = 'pwapp-shell-dark-css'

/** `appearanceConfig.mode.policy`, read without importing it by name. */
export type ShellModePolicy = 'light' | 'dark' | 'system'

/**
 * The app's mode policy off its appearance ref: `system` unless the config says
 * `light` or `dark`. Read here rather than imported (see the module note: the
 * runner never imports runtime values by name).
 */
export function shellModePolicy(ref: { config?: Record<string, unknown> } | undefined): ShellModePolicy {
  const mode = ref?.config?.['mode']
  const policy = mode && typeof mode === 'object' ? (mode as Record<string, unknown>)['policy'] : undefined
  return policy === 'light' || policy === 'dark' ? policy : 'system'
}
const SHELL_SELECTORS = '#pwapp-sign-in-gate,#pwapp-session-pill,#pwapp-login-error'

/**
 * Put the chrome in dark mode when the OS asks for it, unless the document is
 * forced light — the rule the surface follows (`data-pw-theme="light"` opts
 * out). `!important` because the light set sits INLINE on each chrome element
 * (`applyThemeVars`), and an inline declaration beats any stylesheet rule
 * otherwise. Replaces an earlier sheet, so a second call reflects new values.
 */
export function applyShellDarkMode(
  vars: Readonly<Record<string, string>>,
  doc: Document = document,
  policy: ShellModePolicy = 'system'
): void {
  const body = Object.entries(vars)
    .map(([name, value]) => `${name}:${value} !important`)
    .join(';')
  doc.getElementById(DARK_SHEET_ID)?.remove()
  // A light-only app keeps its chrome light on a dark device, as its pages do.
  if (!body || policy === 'light') return
  const style = doc.createElement('style')
  style.id = DARK_SHEET_ID
  style.textContent =
    policy === 'dark'
      ? `:is(${SHELL_SELECTORS}){${body}}`
      : `html[data-pw-theme="dark"] :is(${SHELL_SELECTORS}){${body}}` +
        `@media (prefers-color-scheme:dark){html:not([data-pw-theme="light"]) :is(${SHELL_SELECTORS}){${body}}}`
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

export function applyThemeVars(el: HTMLElement, vars: Readonly<Record<string, string>>): void {
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value)
}

const SHEET_ID = 'pwapp-shell-css'

/**
 * Token names used below, all emitted by the contracts appearance cascade:
 * --pw-color-{background,card,text,text-muted,primary,text-on-primary,border,error}
 * --pw-font-family, --pw-font-family-heading, --pw-font-size-base, --pw-font-size-sm
 * --pw-font-weight-heading, --pw-border-radius, --pw-border-radius-lg,
 * --pw-border-radius-full, --pw-shadow-lg, --pw-focus-ring-color.
 * --pw-bottom-bar-height is set on the document root by the bottom-bar block.
 */
const SHELL_CSS = `
#pwapp-sign-in-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;box-sizing:border-box;overflow:auto;text-align:center;background:var(--pw-color-background,#ffffff);color:var(--pw-color-text,#111111);font-family:var(--pw-font-family,system-ui,sans-serif);font-size:var(--pw-font-size-base,15px);line-height:1.5}
#pwapp-sign-in-gate *{box-sizing:border-box}
#pwapp-sign-in-gate .pwapp-gate-panel{position:relative;max-width:360px;width:100%;display:flex;flex-direction:column;gap:10px}
#pwapp-sign-in-gate .pwapp-gate-title{margin:0;font-family:var(--pw-font-family-heading,var(--pw-font-family,system-ui,sans-serif));font-weight:var(--pw-font-weight-heading,600);font-size:1.25em;line-height:1.3}
#pwapp-sign-in-gate .pwapp-gate-body{margin:0 0 10px;color:var(--pw-color-text-muted,#444444)}
#pwapp-sign-in-gate form{display:flex;flex-direction:column;gap:10px}
#pwapp-sign-in-gate input{padding:10px 12px;border:1px solid var(--pw-color-border,rgba(0,0,0,0.2));border-radius:var(--pw-border-radius,8px);background:var(--pw-color-background,#ffffff);color:var(--pw-color-text,#111111);font:inherit}
#pwapp-sign-in-gate button{font:inherit;cursor:pointer}
#pwapp-sign-in-gate button:disabled{cursor:not-allowed;opacity:.6}
#pwapp-sign-in-gate .pwapp-gate-primary{padding:10px 22px;border-radius:var(--pw-border-radius-full,999px);border:1px solid transparent;background:var(--pw-color-primary,#111111);color:var(--pw-color-text-on-primary,#ffffff);font-weight:500}
#pwapp-sign-in-gate .pwapp-gate-secondary{width:100%;padding:10px 22px;border-radius:var(--pw-border-radius-full,999px);border:1px solid var(--pw-color-border,rgba(0,0,0,0.15));background:var(--pw-color-card,#ffffff);color:var(--pw-color-text,#111111);font-weight:500}
#pwapp-sign-in-gate .pwapp-gate-link{margin-top:4px;border:0;background:transparent;color:inherit;text-decoration:underline}
#pwapp-sign-in-gate .pwapp-gate-or{margin:4px 0;font-size:var(--pw-font-size-sm,12px);color:var(--pw-color-text-muted,#9ca3af)}
#pwapp-sign-in-gate .pwapp-gate-error{margin:6px 0 0;min-height:1.5em;color:var(--pw-color-error,#b00020)}
#pwapp-sign-in-gate .pwapp-gate-close{position:absolute;top:-8px;right:-8px;width:36px;height:36px;border:0;border-radius:var(--pw-border-radius-full,999px);background:transparent;color:var(--pw-color-text-muted,#444444);font-size:22px;line-height:1}
#pwapp-sign-in-gate :focus-visible{outline:2px solid var(--pw-focus-ring-color,var(--pw-color-primary,#111111));outline-offset:2px}
#pwapp-session-pill{position:fixed;right:16px;bottom:calc(16px + var(--pw-bottom-bar-height, 0px));z-index:2147483000;display:flex;align-items:center;gap:10px;padding:10px 18px;border-radius:var(--pw-border-radius-full,999px);border:1px solid var(--pw-color-border,rgba(0,0,0,0.15));background:var(--pw-color-card,#ffffff);color:var(--pw-color-text,#111111);font-family:var(--pw-font-family,system-ui,sans-serif);font-size:var(--pw-font-size-sm,14px);font-weight:500;line-height:1;box-shadow:var(--pw-shadow-lg,0 2px 10px rgba(0,0,0,0.18))}
#pwapp-session-pill button{border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:pointer}
#pwapp-session-pill [data-session-signout]{text-decoration:underline}
#pwapp-session-pill :focus-visible{outline:2px solid var(--pw-focus-ring-color,var(--pw-color-primary,#111111));outline-offset:2px}
#pwapp-login-error{position:fixed;right:16px;bottom:calc(62px + var(--pw-bottom-bar-height, 0px));z-index:2147483000;max-width:min(320px,calc(100vw - 32px));padding:8px 12px;border-radius:var(--pw-border-radius-lg,10px);border:1px solid var(--pw-color-error,#f2b8b5);background:var(--pw-color-card,#fdecea);color:var(--pw-color-error,#8c1d18);font-family:var(--pw-font-family,system-ui,sans-serif);font-size:13px;line-height:1.4;box-shadow:var(--pw-shadow-lg,0 2px 10px rgba(0,0,0,0.18))}
`

/** Inject the shell stylesheet once per document. */
export function ensureShellStyles(doc: Document = document): void {
  if (doc.getElementById(SHEET_ID)) return
  const style = doc.createElement('style')
  style.id = SHEET_ID
  style.textContent = SHELL_CSS
  ;(doc.head ?? doc.documentElement).appendChild(style)
}
