/**
 * Appearance Resolver
 *
 * Bridges `surface.appearance` with the render path. ONE path: the in-process
 * cascade (`surfaceThemeToCSS`) over the platform baseline.
 *
 * There is no second path that delegates to an appearance atom's own
 * `resolve()`: an atom carrying its own baseline would never receive
 * `projectTheme`, so light and dark would come from different bases.
 *
 * @module @pwfabric/runtime/render/appearance-resolver
 */

import type { SurfaceAppearanceRef, SurfaceTheme } from '@pwfabric/contracts'
import {
  DEFAULT_APPEARANCE_THEME,
  mergeSurfaceThemes,
  resolveDarkTheme,
  resolveAppearanceMode,
} from '@pwfabric/contracts'
import { surfaceThemeToCSS } from './theme-utils.js'

/**
 * Resolve a surface.appearance reference to the CSS custom property map that the
 * renderer applies to `[data-pw-surface]`.
 *
 * `DEFAULT_APPEARANCE_THEME` is the baseline so an absent/empty surface config
 * still yields the full token set. The surface config overrides only the tokens
 * it sets; `projectTheme` sits as a middle layer between the platform baseline
 * and the surface override.
 */
export function resolveAppearanceVars(
  appearance: SurfaceAppearanceRef | undefined,
  projectTheme?: SurfaceTheme
): Record<string, string> {
  const cfg = appearance?.config
  const theme = cfg?.theme as SurfaceTheme | undefined
  // a config that promises high contrast gets its inks pushed to 7:1.
  const { contrast } = resolveAppearanceMode(cfg)
  const themeVars = surfaceThemeToCSS(theme, DEFAULT_APPEARANCE_THEME, projectTheme, { contrast })

  const customVars: Record<string, string> = {}
  if (cfg?.styleVariables) {
    for (const [key, value] of Object.entries(cfg.styleVariables)) {
      const varName = key.startsWith('--') ? key : `--${key}`
      customVars[varName] = value
    }
  }

  return { ...themeVars, ...customVars }
}

/**
 * Resolve the DARK theme variant CSS-variable map for a surface appearance.
 *
 * The dark mode is ALWAYS the derivation of the effective light theme
 * (platform baseline < project theme < surface theme), with the explicit dark
 * overrides on top: the project's `darkTheme`, then the surface's own
 * `appearance.config.darkTheme`.
 *
 * An explicit `darkTheme` does NOT replace the derivation: an authoring tool
 * may write it as sparse overrides — only the tokens the author changed — and
 * merged over the LIGHT default, one edited dark colour would produce a dark
 * mode with a white page and dark text. A fully baked dark variant still
 * renders as baked: every token it sets wins over the derivation.
 *
 * A surface with no appearance config and no project dark overrides gets NO
 * dark CSS (conservative: one that never opted into theming stays light-only).
 */
export function resolveAppearanceDarkVars(
  appearance: SurfaceAppearanceRef | undefined,
  projectTheme?: SurfaceTheme,
  projectDarkTheme?: SurfaceTheme
): Record<string, string> {
  const cfg = appearance?.config
  if (!cfg && !projectDarkTheme) return {}
  const light = mergeSurfaceThemes(
    DEFAULT_APPEARANCE_THEME,
    projectTheme,
    cfg?.theme as SurfaceTheme | undefined
  )
  const dark = resolveDarkTheme(light, projectDarkTheme, cfg?.darkTheme as SurfaceTheme | undefined)
  return surfaceThemeToCSS(dark, undefined, undefined, { contrast: resolveAppearanceMode(cfg).contrast })
}

/**
 * Resolve the surface-scoped custom `@keyframes` registry for an appearance.
 *
 * Reads `appearance.config.keyframes` (name → keyframe body). The renderer
 * feeds this map to `buildKeyframesCss`, which emits one
 * `@keyframes pw-kf-<name>{<body>}` per entry. Returns `{}` when no registry is
 * declared (no keyframe CSS emitted).
 */
export function resolveAppearanceKeyframes(
  appearance: SurfaceAppearanceRef | undefined
): Record<string, string> {
  const keyframes = appearance?.config?.keyframes
  if (!keyframes) return {}
  return { ...keyframes }
}
