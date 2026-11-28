/**
 * An appearance document as the renderer's appearance REF (`{ config }`):
 * the app's (`pwpack/appearance.json`) and a page's own (its receipt's
 * `appearance`) are read the same way.
 *
 * @module @pwfabric/runner/appearance-ref
 */
import { THEME_PRESETS } from './theme-presets.js'

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * `blocks` groups merged per block, per token, `over` winning (appearance §3.4).
 * The same merge as contracts' `mergeThemeBlocks`, written here because runner.js
 * imports nothing the renderer seeds. Block and token names are checked by shape
 * and held in null-prototype objects, so a `"__proto__"` name reaches nothing.
 */
function mergeBlocks(prev: unknown, over: unknown): Record<string, Record<string, string>> | undefined {
  let out: Record<string, Record<string, string>> | undefined
  for (const layer of [prev, over]) {
    if (!isRecord(layer)) continue
    for (const [block, tokens] of Object.entries(layer)) {
      if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(block) || !isRecord(tokens)) continue
      out ??= Object.create(null) as Record<string, Record<string, string>>
      const into = (out[block] ??= Object.create(null) as Record<string, string>)
      for (const [token, value] of Object.entries(tokens)) if (/^[a-z][a-zA-Z0-9]*$/.test(token) && typeof value === 'string') into[token] = value
    }
  }
  return out
}

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
    // blocks merge per block, per token (appearance §3.4).
    if (k === 'blocks') {
      out[k] = mergeBlocks(prev, v)
      continue
    }
    // colors: a document that states its own ground drops the preset's extra colours
    // (heading, link, …), chosen for the preset's ground — contracts' mergeColorLayers.
    if (k === 'colors' && isRecord(v) && isRecord(prev) && typeof v['background'] === 'string') {
      const named = new Set(['primary', 'secondary', 'accent', 'background', 'card', 'text', 'textMuted', 'border', 'error', 'success', 'warning', 'info', 'textOnPrimary'])
      out[k] = { ...Object.fromEntries(Object.entries(prev).filter(([name]) => named.has(name))), ...v }
      continue
    }
    out[k] =
      v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object'
        ? { ...(prev as Record<string, unknown>), ...(v as Record<string, unknown>) }
        : v
  }
  return out
}
