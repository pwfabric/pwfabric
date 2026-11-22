/**
 * The brace-balanced reading of ICU message patterns, shared by the i18n
 * capability's translator and the app's messages (render/messages.ts).
 *
 * Pure: no React, no DOM.
 *
 * @module @pwfabric/runtime/i18n/icu
 */

/**
 * The brace-balanced block that opens at `start` (`message[start] === '{'`):
 * the text between its outer braces and the index of its closing brace, or
 * null when it is not closed.
 */
export function extractBraceBlock(message: string, start: number): { content: string; end: number } | null {
  if (message[start] !== '{') return null
  let depth = 0
  for (let i = start; i < message.length; i++) {
    if (message[i] === '{') depth++
    else if (message[i] === '}') {
      depth--
      if (depth === 0) return { content: message.slice(start + 1, i), end: i }
    }
  }
  return null
}

/** One option of an ICU plural or select body: its selector and its text. */
export interface IcuOption {
  readonly key: string
  readonly text: string
}

/**
 * The options of an ICU body (`one {# item} other {# items}`), in order, and
 * whether the whole body was read as options (`complete`): a body that ends
 * in something that is not `<selector> {text}` is not.
 */
export function readIcuOptions(body: string): { options: IcuOption[]; complete: boolean } {
  const options: IcuOption[] = []
  let i = 0
  const space = (c: string | undefined): boolean => c !== undefined && /\s/.test(c)
  for (;;) {
    while (space(body[i])) i++
    if (i >= body.length) return { options, complete: true }
    let key = ''
    while (i < body.length && body[i] !== '{' && !space(body[i])) key += body[i++]
    while (space(body[i])) i++
    if (!key || body[i] !== '{') return { options, complete: false }
    const block = extractBraceBlock(body, i)
    if (block === null) return { options, complete: false }
    options.push({ key, text: block.content })
    i = block.end + 1
  }
}

/**
 * The options of an ICU body as a map from selector to text (a repeated
 * selector: the last wins). What the translator reads.
 */
export function parseIcuOptions(body: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const option of readIcuOptions(body).options) map.set(option.key, option.text)
  return map
}
