/**
 * An appearance document as the renderer's appearance REF (`{ config }`):
 * the app's (`pwpack/appearance.json`) and a page's own (its receipt's
 * `appearance`) are read the same way.
 *
 * @module @pwfabric/runner/appearance-ref
 */
import { THEME_PRESETS } from './theme-presets.js'

/**
 * `pwpack/appearance.json` holds the project's appearance CONFIG
 * (`{ theme, styleVariables, darkTheme, … }`) — that is what
 * `assembleWebApp` writes from `appearanceConfigSnapshot`. But embed's
 * `appearance` option is a surface appearance REF (`{ config }`), and it
 * OVERRIDES `surface.appearance` outright.
 *
 * Handing the config straight through would replace each surface's correct
 * ref with an object the resolver cannot read: it looks for
 * `appearance.config.theme`, finds nothing, and falls back to the default
 * baseline, so every exported app would paint indigo whatever theme it
 * shipped.
 *
 * Wrap it. Anything already ref-shaped passes through untouched, as does the
 * legacy `{ use: 'default' }` fallback.
 */
export function projectAppearanceRef(raw: unknown): { config: Record<string, unknown> } | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  if ('config' in o) return o as { config: Record<string, unknown> }
  // A THEME NAME. An app may carry only `{ "use": "theme-zinc" }` —
  // sometimes with brand colours pressed on top (`theme.colors`), nothing
  // else. The preset
  // is the base and anything the document states wins over it; an unknown name
  // (or `default`) leaves the document as it was.
  const preset = presetFor(o['use'])
  if (preset) {
    const { use: _use, ...rest } = o
    const own = (rest['theme'] ?? undefined) as Record<string, unknown> | undefined
    return { config: { ...rest, theme: mergeThemeGroups(preset, own) } }
  }
  // A bare config: it carries token groups, not a ref.
  if ('theme' in o || 'styleVariables' in o || 'darkTheme' in o || 'keyframes' in o) {
    return { config: o }
  }
  return undefined
}

/** The foundation preset a theme name points at: `theme-zinc`, or bare `zinc`. */
function presetFor(use: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof use !== 'string' || !use.trim()) return undefined
  const name = use.trim()
  return THEME_PRESETS[name] ?? THEME_PRESETS[`theme-${name.replace(/^(appearance|theme)-/, '')}`]
}

/** Per-group merge, `over` winning — the same shape the appearance cascade merges. */
function mergeThemeGroups(
  base: Readonly<Record<string, unknown>>,
  over: Record<string, unknown> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(base)) out[k] = v && typeof v === 'object' ? { ...v } : v
  for (const [k, v] of Object.entries(over ?? {})) {
    const prev = out[k]
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object'
        ? { ...(prev as Record<string, unknown>), ...(v as Record<string, unknown>) }
        : v
  }
  return out
}
