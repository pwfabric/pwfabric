/**
 * A theme's `blocks` group checked against the blocks' manifests (appearance §3.4):
 * a block the app and its packs do not carry, a token its block does not
 * declare, a value that is not of the token's type, and a colour token set for
 * light only while the app can be drawn dark. All warnings: a theme that names
 * a knob wrongly draws the block's default, never a broken page.
 *
 * What is judged is the app's own: `app/definitions/appearance.json` (its
 * `theme`, `darkTheme`, or the `config` of a reference) and the app's own theme
 * atoms. A pack's theme is the pack's to validate.
 *
 * @module @pwfabric/pack/theme-blocks
 */
import { blockTokenDescriptors, blockTokenValueProblem, type BlockTokenDescriptor } from '@pwfabric/contracts'
import { blockTypeNames, namedBlocksOf, nearestName, type BlockSource } from './block-props.js'
import type { PackFolder, PackIssue } from './types.js'

export const THEME_BLOCK_UNKNOWN = 'THEME_BLOCK_UNKNOWN'
export const THEME_BLOCK_TOKEN_UNKNOWN = 'THEME_BLOCK_TOKEN_UNKNOWN'
export const THEME_BLOCK_TOKEN_TYPE = 'THEME_BLOCK_TOKEN_TYPE'
export const THEME_BLOCK_TOKEN_NO_DARK = 'THEME_BLOCK_TOKEN_NO_DARK'

const APPEARANCE = 'app/definitions/appearance.json'

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

/** Each block name a receipt (and so a theme) may use → the tokens its block declares. */
export function blockTokensCatalog(sources: readonly BlockSource[]): Map<string, BlockTokenDescriptor[]> {
  const out = new Map<string, BlockTokenDescriptor[]>()
  for (const block of namedBlocksOf(sources)) {
    const tokens = blockTokenDescriptors(block.manifest)
    for (const name of blockTypeNames(block.id, block.manifest)) if (!out.has(name)) out.set(name, tokens)
  }
  return out
}

/** The theme documents the app itself writes: its appearance and its own theme atoms. */
function ownThemeDocs(app: PackFolder): { path: string; doc: Record<string, unknown> }[] {
  const out: { path: string; doc: Record<string, unknown> }[] = []
  const appearance = jsonAt(app, APPEARANCE)
  if (isRecord(appearance)) out.push({ path: APPEARANCE, doc: isRecord(appearance['config']) ? appearance['config'] : appearance })
  for (const path of [...app.files.keys()].filter((p) => /^atoms\/appearance\/[^/]+\/manifest\.json$/.test(p)).sort()) {
    const doc = jsonAt(app, path)
    if (isRecord(doc)) out.push({ path, doc })
  }
  return out
}

/** Whether the app may be drawn dark: its mode policy, when it names one, is not `light`. */
function mayBeDark(app: PackFolder): boolean {
  const appearance = jsonAt(app, APPEARANCE)
  const config = isRecord(appearance) && isRecord(appearance['config']) ? appearance['config'] : appearance
  const mode = isRecord(config) ? config['mode'] : undefined
  return !(isRecord(mode) && mode['policy'] === 'light')
}

/**
 * The findings for the app's theme `blocks` groups. `sources` are the app and its
 * pinned packs in resolution order (as `pwf validate` loads them).
 */
export function checkThemeBlocks(app: PackFolder, sources: readonly BlockSource[]): PackIssue[] {
  const catalog = blockTokensCatalog(sources)
  const issues: PackIssue[] = []
  const dark = mayBeDark(app)
  // A colour set in some theme's light blocks and in none of the dark ones.
  const lightColours = new Map<string, string>()
  const darkSet = new Set<string>()
  for (const { path, doc } of ownThemeDocs(app)) {
    for (const scheme of ['theme', 'darkTheme'] as const) {
      const set = doc[scheme]
      const blocks = isRecord(set) ? set['blocks'] : undefined
      if (blocks === undefined) continue
      const at = `${scheme}.blocks`
      if (!isRecord(blocks)) {
        issues.push({ severity: 'warning', code: THEME_BLOCK_UNKNOWN, path, message: `${at} is not an object of block names` })
        continue
      }
      for (const [block, tokens] of Object.entries(blocks)) {
        const declared = catalog.get(block)
        if (!declared) {
          const near = nearestName(block, [...catalog.keys()])
          issues.push({ severity: 'warning', code: THEME_BLOCK_UNKNOWN, path, message: `${at}.${block}: no block the app or its packs carry is named "${block}"${near ? `; did you mean "${near}"?` : ''}` })
          continue
        }
        if (!isRecord(tokens)) {
          issues.push({ severity: 'warning', code: THEME_BLOCK_TOKEN_TYPE, path, message: `${at}.${block} is not an object of token values` })
          continue
        }
        for (const [token, value] of Object.entries(tokens)) {
          const d = declared.find((t) => t.name === token)
          if (!d) {
            const names = declared.map((t) => t.name)
            const near = nearestName(token, names)
            issues.push({
              severity: 'warning',
              code: THEME_BLOCK_TOKEN_UNKNOWN,
              path,
              message: `${at}.${block}.${token}: the ${block} block declares no token "${token}"${near ? `; did you mean "${near}"?` : names.length ? ` (it declares ${names.join(', ')})` : ' (it declares none)'}`,
            })
            continue
          }
          const problem = blockTokenValueProblem(d.type, value)
          if (problem) {
            issues.push({ severity: 'warning', code: THEME_BLOCK_TOKEN_TYPE, path, message: `${at}.${block}.${token}: ${JSON.stringify(value)} ${problem}; it is a ${d.type} (the block draws ${d.default} instead)` })
            continue
          }
          // A var() reference follows the scheme by itself; only a literal colour needs a dark twin.
          if (d.type === 'color' && !/^var\(/.test(String(value).trim())) {
            const key = `${block}.${token}`
            if (scheme === 'theme') lightColours.set(key, path)
            else darkSet.add(key)
          }
        }
      }
    }
  }
  if (dark) {
    for (const [key, path] of lightColours) {
      if (darkSet.has(key)) continue
      issues.push({
        severity: 'warning',
        code: THEME_BLOCK_TOKEN_NO_DARK,
        path,
        message: `theme.blocks.${key} is a colour set for light only: the dark scheme draws the same value. Set darkTheme.blocks.${key} too (or the app's mode policy to "light")`,
      })
    }
  }
  return issues
}
