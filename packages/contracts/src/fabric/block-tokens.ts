/**
 * Block look tokens (block-manifest `definition.tokens`, appearance §3.4).
 *
 * A block declares the knobs of its look — a sidebar's row padding, a table of
 * contents' ink — each with a type and the default it draws. A theme sets them
 * by the block's name in a `blocks` group (`theme.blocks.sidebar.itemPaddingBlock`),
 * its dark values in `darkTheme.blocks`; the renderer emits each as
 * `--pw-<block>-<kebab-token>` and the block reads
 * `var(--pw-<block>-<kebab-token>, <default>)`. So an app's look lives in its
 * theme alone, and a pack carries no app's look.
 *
 * @module @pwfabric/contracts/fabric/block-tokens
 */

/** The types a block token takes (block-manifest `definition.tokens[].type`). */
export const BLOCK_TOKEN_TYPES = ['color', 'length', 'number', 'fontWeight', 'lineHeight'] as const
export type BlockTokenType = (typeof BLOCK_TOKEN_TYPES)[number]

/** One look knob a block declares. */
export interface BlockTokenDescriptor {
  /** camelCase, unique in the block: `itemPaddingBlock`. */
  readonly name: string
  readonly type: BlockTokenType
  /** The CSS value the block draws when no theme sets the token (it may name core tokens: `var(--pw-space-xs)`). */
  readonly default: string
  /** One line: what the token changes. */
  readonly description: string
}

/** A theme's `blocks` group: block name → token name → CSS value. */
export type SurfaceThemeBlocks = Readonly<Record<string, Readonly<Record<string, string>>>>

/** A token or block name the naming accepts: camelCase for a token, kebab-case for a block. */
export const BLOCK_TOKEN_NAME = /^[a-z][a-zA-Z0-9]*$/
export const BLOCK_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** `itemPaddingBlock` → `item-padding-block`. */
function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
}

/** The custom property a block token is emitted as: `--pw-<block>-<kebab-token>`. */
export function blockTokenProperty(block: string, token: string): string {
  return `--pw-${block}-${kebab(token)}`
}

const SAFE_CHARS = /^[^;{}<>\n\r\\]+$/

/**
 * A value that cannot leave its declaration: none of `;`, braces, angle brackets,
 * line breaks or a backslash (an escape), and its brackets and quotes balanced (an
 * open `(` or quote would carry the next declarations into this one).
 */
export function isContainedCssValue(value: string): boolean {
  if (!SAFE_CHARS.test(value)) return false
  let depth = 0
  let quote: string | null = null
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth < 0) return false
  }
  return depth === 0 && quote === null
}
/** A reference to another custom property, optionally with a fallback. */
const VAR = /^var\(--[a-z0-9-]+(?:\s*,[^;{}<>]*)?\)$/i
/** A CSS math function over lengths. */
const MATH = /^(?:calc|min|max|clamp)\([^;{}<>]+\)$/i
const LENGTH = /^(?:-?\d*\.?\d+(?:px|rem|em|%|vw|vh|vmin|vmax|ch|ex|lh|rlh|svh|dvh|lvh|svw|dvw|lvw|vi|vb|cqw|cqh|cqi|cqb))$/i
const NUMBER = /^-?\d*\.?\d+$/
const COLOR_FN = /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\([^;{}<>]+\)$/i
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const NAMED = /^(?:transparent|currentcolor|[a-z]+)$/i

/**
 * Why a value does not fit a token's type, or undefined when it does. Every type
 * also takes a `var(--…)` reference (a token may follow another token) and the
 * CSS-wide keywords (inherit, initial, unset, revert).
 */
export function blockTokenValueProblem(type: BlockTokenType, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return 'is not a non-empty string'
  const v = value.trim()
  if (!isContainedCssValue(v)) return 'holds what a CSS value cannot (; { } < > a backslash or a line break, or an unbalanced bracket or quote)'
  if (VAR.test(v)) return undefined
  // The CSS-wide keywords fit every property, so every type takes them.
  if (/^(?:inherit|initial|unset|revert)$/i.test(v)) return undefined
  switch (type) {
    case 'color':
      return HEX.test(v) || COLOR_FN.test(v) || NAMED.test(v) ? undefined : 'is not a colour (#hex, rgb(), hsl(), oklch(), color-mix(), a colour name or var())'
    case 'length':
      return LENGTH.test(v) || MATH.test(v) ? undefined : 'is not a length (a number with a unit such as 0px, 16px or 1.5rem, calc() or var()); a bare 0 breaks inside calc()'
    case 'number':
      return NUMBER.test(v) || MATH.test(v) ? undefined : 'is not a number (a unitless number such as 1.5, or var())'
    case 'lineHeight':
      return NUMBER.test(v) || LENGTH.test(v) || MATH.test(v) || /^normal$/i.test(v)
        ? undefined
        : 'is not a line height (a number such as 1.5, a length such as 24px, normal or var())'
    case 'fontWeight':
      return (NUMBER.test(v) && Number(v) >= 1 && Number(v) <= 1000) || /^(?:normal|bold|bolder|lighter)$/i.test(v)
        ? undefined
        : 'is not a font weight (1–1000, normal, bold, bolder, lighter or var())'
  }
}

/** The token descriptors a block manifest declares (`definition.tokens`), malformed entries left out. */
export function blockTokenDescriptors(manifest: unknown): BlockTokenDescriptor[] {
  const def = isRecord(manifest) ? manifest['definition'] : undefined
  const list = isRecord(def) && Array.isArray(def['tokens']) ? def['tokens'] : []
  return list.filter(
    (t): t is BlockTokenDescriptor =>
      isRecord(t) &&
      typeof t['name'] === 'string' &&
      BLOCK_TOKEN_NAME.test(t['name']) &&
      (BLOCK_TOKEN_TYPES as readonly string[]).includes(t['type'] as string) &&
      typeof t['default'] === 'string' &&
      typeof t['description'] === 'string',
  )
}

/**
 * Merge `blocks` groups, later layers winning — per block, per token (a later
 * layer that sets one sidebar token keeps the earlier layer's other ones).
 */
export function mergeThemeBlocks(...layers: ReadonlyArray<unknown>): SurfaceThemeBlocks | undefined {
  let out: Record<string, Record<string, string>> | undefined
  for (const layer of layers) {
    if (!isRecord(layer)) continue
    for (const [block, tokens] of Object.entries(layer)) {
      // Only well-formed names, into null-prototype objects: a theme naming a block
      // or token "__proto__" can never reach Object.prototype.
      if (!BLOCK_NAME.test(block) || !isRecord(tokens)) continue
      out ??= Object.create(null) as Record<string, Record<string, string>>
      const into = (out[block] ??= Object.create(null) as Record<string, string>)
      for (const [token, value] of Object.entries(tokens)) if (BLOCK_TOKEN_NAME.test(token) && typeof value === 'string') into[token] = value
    }
  }
  return out
}

/**
 * The custom properties a `blocks` group emits. Only well-formed names and
 * values that cannot leave their declaration are emitted; whether a value fits
 * its token's type is the validator's to say (THEME_BLOCK_TOKEN_TYPE), since the
 * renderer does not know the block's manifest.
 */
export function blockTokenVars(blocks: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isRecord(blocks)) return out
  for (const [block, tokens] of Object.entries(blocks)) {
    if (!BLOCK_NAME.test(block) || !isRecord(tokens)) continue
    for (const [token, value] of Object.entries(tokens)) {
      if (!BLOCK_TOKEN_NAME.test(token) || typeof value !== 'string' || !isContainedCssValue(value.trim()) || value.trim() === '') continue
      out[blockTokenProperty(block, token)] = value.trim()
    }
  }
  return out
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
