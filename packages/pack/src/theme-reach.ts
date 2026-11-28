/**
 * Whether the app's theme reaches its pages (appearance §3). Two ways it does not,
 * both found when an example app was worn in another theme and nothing changed:
 *
 * - THEME_APP_UNREACHED: the app names a theme, and every page names its own, so
 *   the app's is never drawn — changing it changes nothing.
 * - THEME_LITERAL_LOOK: a corner radius or a shadow written as a fixed value in a
 *   page (`borderRadius: "999px"`, `boxShadow: "0 8px 24px …"`). A theme cannot
 *   reach it; `var(--pw-border-radius-*)` / `var(--pw-shadow-*)` can be themed.
 *   A circle (`50%`), zero and `none` are shapes, not looks, and pass.
 *
 * Both are warnings: the page still draws.
 *
 * @module @pwfabric/pack/theme-reach
 */
import type { PackFolder, PackIssue } from './types.js'

export const THEME_APP_UNREACHED = 'THEME_APP_UNREACHED'
export const THEME_LITERAL_LOOK = 'THEME_LITERAL_LOOK'

const APPEARANCE = 'app/definitions/appearance.json'
const RECEIPT = /^app\/(?:surfaces\/[^/]+\.receipt\.json|layout\.receipt\.json)$/
const LOOK_KEYS = ['borderRadius', 'boxShadow'] as const

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function jsonAt(folder: PackFolder, path: string): unknown {
  const bytes = folder.files.get(path)
  if (!bytes) return undefined
  try {
    const text = new TextDecoder().decode(bytes)
    return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text) as unknown
  } catch {
    return undefined
  }
}

/** The theme an appearance document names (`use`), or undefined. */
function usedTheme(doc: unknown): string | undefined {
  if (!isRecord(doc)) return undefined
  const cfg = isRecord(doc['config']) ? doc['config'] : doc
  return typeof cfg['use'] === 'string' && cfg['use'] !== 'default' ? cfg['use'] : undefined
}

/**
 * A fixed corner radius or shadow: one that reads no theme value. A value that
 * names a `var()` anywhere (`calc(var(--pw-border-radius) - 2px)`, `0 0 0 1px
 * var(--pw-color-border)`), a CSS-wide keyword, a zero in any unit, `none` and a
 * circle (`50%`) pass.
 */
export function isLiteralLook(_key: (typeof LOOK_KEYS)[number], value: unknown): boolean {
  if (typeof value === 'number') return value !== 0
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (v === '' || /var\(/i.test(v) || /^(?:none|inherit|initial|unset|revert|50%)$/i.test(v)) return false
  // Zero in any unit, alone or as every part ("0", "0rem", "0 0").
  if (v.split(/\s+/).every((part) => /^0(?:\.0+)?[a-z%]*$/i.test(part))) return false
  return true
}

interface Found {
  block: string
  key: string
  value: string
}

function literalLooks(blocks: unknown): Found[] {
  const out: Found[] = []
  const visit = (b: unknown): void => {
    if (!isRecord(b)) return
    for (const where of [b['style'], b['props']]) {
      if (!isRecord(where)) continue
      for (const key of LOOK_KEYS) {
        const raw = where[key]
        // A responsive value ({ xs, md }) is judged per breakpoint.
        const values = isRecord(raw) ? Object.values(raw) : [raw]
        for (const value of values) if (isLiteralLook(key, value)) out.push({ block: String(b['id'] ?? b['type'] ?? '?'), key, value: String(value) })
      }
    }
    if (Array.isArray(b['children'])) b['children'].forEach(visit)
  }
  if (Array.isArray(blocks)) blocks.forEach(visit)
  return out
}

export function checkThemeReach(app: PackFolder): PackIssue[] {
  const issues: PackIssue[] = []
  const receipts = [...app.files.keys()].filter((p) => RECEIPT.test(p)).sort()
  const pages = receipts.filter((p) => p.startsWith('app/surfaces/'))
  // A page that only changes some tokens (`theme`) is drawn over the app's theme; one that
  // names another theme (`use`) replaces it. The app's is unreached when every page does that.
  const appTheme = usedTheme(jsonAt(app, APPEARANCE))
  const replaces = (p: string): boolean => {
    const own = usedTheme((jsonAt(app, p) as Record<string, unknown> | undefined)?.['appearance'])
    return own !== undefined && own !== appTheme
  }
  const appDoc = jsonAt(app, APPEARANCE)
  const appCfg = isRecord(appDoc) && isRecord(appDoc['config']) ? appDoc['config'] : appDoc
  const appHasTheme = appTheme !== undefined || (isRecord(appCfg) && isRecord(appCfg['theme']))
  if (appHasTheme && pages.length > 0 && pages.every(replaces)) {
    issues.push({
      severity: 'warning',
      code: THEME_APP_UNREACHED,
      path: APPEARANCE,
      message: `every page (${pages.length}) names its own theme in "appearance", so the app's theme is never drawn and changing it changes nothing. Remove the pages' "appearance" to wear the app's theme, or remove the app's`,
    })
  }
  for (const path of receipts) {
    const doc = jsonAt(app, path)
    const found = literalLooks(isRecord(doc) ? doc['blocks'] : undefined)
    if (!found.length) continue
    const first = found[0]!
    issues.push({
      severity: 'warning',
      code: THEME_LITERAL_LOOK,
      path,
      message: `${found.length} corner radius / shadow value(s) are fixed, so no theme can change them (first: ${first.key} ${JSON.stringify(first.value)} on "${first.block}"). Write var(--pw-border-radius-sm|…|-full) or var(--pw-shadow-sm|…|-xl) instead`,
    })
  }
  return issues
}
