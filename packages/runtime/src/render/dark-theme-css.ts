/**
 * Dark theme variant CSS generation (the "both strategies" dark mode).
 *
 * Light theme tokens stay INLINE on the surface root (`[data-pw-surface]`); this
 * module emits the scoped rules that override them under TWO conditions:
 *
 *   1. Manual force-dark — `[data-pw-surface="<sid>"][data-pw-theme="dark"]{…}`
 *      (host toggles `data-pw-theme="dark"` on the root regardless of OS).
 *   2. Auto (OS preference) — `@media (prefers-color-scheme:dark){
 *      [data-pw-surface="<sid>"]:not([data-pw-theme="light"]){…}}` (applies
 *      unless the host has force-toggled light).
 *
 * The selector carries the surface ID by VALUE. It used to match on the mere
 * PRESENCE of `[data-pw-surface]`, which was a real bug: the embed autoloader
 * hydrates every `[data-pw-surface]` element in a document, so a host page can
 * hold several surfaces with different palettes. Each emitted its own `<style>`
 * with the same value-less selector and `!important`, so equal specificity made
 * DOCUMENT ORDER decide — the last surface's dark palette repainted all of them.
 * Reproduced in Chromium: a blue-themed surface rendered the amber surface's
 * dark background. The light theme was never affected because its values are
 * inline per element and custom properties inherit.
 *
 * @module @pwfabric/runtime/render/dark-theme-css
 */

import type { AppearanceModePolicy } from '@pwfabric/contracts'
import { surfaceScope } from './scoped-css.js'

/**
 * Serialize a `--pw-*` CSS-var map to `--pw-…:val !important;…`.
 * `!important`: the LIGHT theme vars are applied INLINE on the surface root
 * (`rootStyle`), and an inline declaration beats any stylesheet/@media rule — so
 * without `!important` the dark overrides would never take effect. `!important`
 * on a custom-property declaration is honoured by the cascade and lets the
 * stylesheet dark vars override the inline light vars.
 */
function varsToCss(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value} !important`)
    .join(';')
}

/**
 * Build the dark theme CSS from a resolved dark CSS-variable map (the output of
 * `resolveAppearanceDarkVars`). Emits BOTH the manual force-dark rule and the
 * `prefers-color-scheme:dark` auto rule. Returns '' when there are no dark vars.
 *
 * @param darkVars - resolved `--pw-*` map for the dark variant
 * @param surfaceId - scopes the rules to ONE surface. Omit only when rendering a
 *   single surface in isolation (unit tests); the renderer always supplies it,
 *   because two surfaces sharing a document must not share a dark palette.
 */
export function buildDarkThemeCss(
  darkVars: Record<string, string>,
  surfaceId?: string,
  policy: AppearanceModePolicy = 'system'
): string {
  // The app says which modes it wears. A light-only app emits no
  // dark rule at all, so a dark device keeps it light; a dark-only app wears the
  // dark palette unconditionally. `system` follows the device.
  if (policy === 'light') return ''
  const body = varsToCss(darkVars)
  if (!body) return ''
  const scope = surfaceScope(surfaceId)
  if (policy === 'dark') return `${scope}{${body}}`
  // 1. Manual force-dark (host sets data-pw-theme="dark").
  const manual = `${scope}[data-pw-theme="dark"]{${body}}`
  // 2. Auto via OS preference, unless force-light (data-pw-theme="light").
  const auto = `@media (prefers-color-scheme:dark){${scope}:not([data-pw-theme="light"]){${body}}}`
  return manual + auto
}
