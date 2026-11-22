/**
 * THE STATIC FIRST PAINT AT EVERY WIDTH (pwapp-format §2.5).
 *
 * A page's first frame is drawn once, at the phone breakpoint, and the
 * browser hydrates exactly that markup. The renderer lays a page out per
 * breakpoint in inline styles (a block's span, a row that stacks on a phone,
 * the measure's column count), so the phone frame alone would show a desktop
 * visitor the phone layout until the renderer runs — or, read by a crawler
 * at desktop width, a page that does not look like the page.
 *
 * So the build draws the page at every breakpoint and writes what differs
 * as CSS: for each node whose inline style at a wider breakpoint is not the
 * phone's, a rule in a media query for that breakpoint's widths, scoped to
 * the node (`#pw-root [data-block-wrapper="hero"]>:nth-child(2)`) and marked
 * `!important` so it wins over the inline style. The markup stays the phone
 * frame, node for node, and the stylesheet makes it the page at the
 * visitor's width; once the renderer has brought the page to that width
 * (the update after hydration), the inline styles say the same and the
 * runner removes the stylesheet.
 *
 * A `<style>` element whose text differs at a wider breakpoint (a block that
 * writes its own rules for the width it is drawn at) is diffed the same way,
 * rule by rule: what the wider text declares differently becomes a rule for
 * that breakpoint's widths, under `#pw-root` and `!important` so it wins over
 * the phone text's rule; what only the phone text declares goes back to the
 * stylesheets' value.
 *
 * What CSS cannot say is left to the browser: a block whose MARKUP changes
 * with the width (a navbar that is a menu button on a phone and a row of
 * links on a desktop), or whose `class` or `data-*` attributes do (they are
 * what a stylesheet chose its look by), shows its phone form until the
 * renderer runs. Each such block is named, so the build can report it.
 *
 * The markup this reads is React's string renderer's: well formed, attribute
 * values double-quoted and escaped. Nothing here is a general HTML parser.
 */
import { BREAKPOINTS } from '@pwfabric/core'

/** An element of a rendered frame. */
export interface Element {
  readonly tag: string
  readonly attrs: ReadonlyMap<string, string>
  readonly children: Element[]
  /** Its element children and its text (decoded), in document order. */
  readonly content: (Element | string)[]
  /** The text of a `<style>` element. */
  text: string
  readonly parent: Element | null
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
const RAW = new Set(['style', 'script', 'textarea', 'title'])

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : all
    }
    return ENTITY[e.toLowerCase()] ?? all
  })
}

const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** The element tree of a frame's markup (its root holds the frame's top-level elements). */
export function parseFrame(html: string): Element {
  const root: Element = { tag: '#root', attrs: new Map(), children: [], content: [], text: '', parent: null }
  let open: Element = root
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    const textEnd = lt < 0 ? html.length : lt
    if (textEnd > i) open.content.push(decode(html.slice(i, textEnd)))
    if (lt < 0) break
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end < 0 ? html.length : end + 3
      continue
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt)
      const tag = html.slice(lt + 2, end).trim().toLowerCase()
      // Close up to the element this ends (lenient towards markup a block wrote).
      let at: Element | null = open
      while (at && at !== root && at.tag !== tag) at = at.parent
      if (at && at !== root) open = at.parent ?? root
      i = end < 0 ? html.length : end + 1
      continue
    }
    const m = /^<([a-zA-Z][^\s/>]*)/.exec(html.slice(lt, lt + 64))
    if (!m) {
      i = lt + 1
      continue
    }
    const tag = (m[1] as string).toLowerCase()
    // The tag's end: the first `>` outside a quoted attribute value.
    let j = lt + m[0].length
    let quote = ''
    for (; j < html.length; j++) {
      const c = html[j]
      if (quote) {
        if (c === quote) quote = ''
      } else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
    }
    const inside = html.slice(lt + m[0].length, j)
    const selfClosing = inside.trimEnd().endsWith('/')
    const attrs = new Map<string, string>()
    for (const a of inside.matchAll(ATTR)) {
      const name = (a[1] as string).toLowerCase()
      if (name === '/') continue
      attrs.set(name, decode(a[2] ?? a[3] ?? a[4] ?? ''))
    }
    const el: Element = { tag, attrs, children: [], content: [], text: '', parent: open }
    open.children.push(el)
    open.content.push(el)
    i = j + 1
    if (VOID.has(tag) || selfClosing) continue
    if (RAW.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i)
      const end = close < 0 ? html.length : close
      el.text = html.slice(i, end)
      i = close < 0 ? html.length : html.indexOf('>', close) + 1
      continue
    }
    open = el
  }
  return root
}

/** `display:flex;gap:16px` → its declarations, in order. */
export function parseStyle(style: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!style) return out
  let depth = 0
  let quote = ''
  let start = 0
  const parts: string[] = []
  for (let i = 0; i < style.length; i++) {
    const c = style[i]
    if (quote) {
      if (c === quote) quote = ''
    } else if (c === '"' || c === "'") quote = c as string
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ';' && depth === 0) {
      parts.push(style.slice(start, i))
      start = i + 1
    }
  }
  parts.push(style.slice(start))
  for (const part of parts) {
    const colon = part.indexOf(':')
    if (colon <= 0) continue
    const name = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim()
    if (name && value) out.set(name, value)
  }
  return out
}

const cssString = (s: string): string => s.replace(/["\\]/g, '\\$&').replace(/\n/g, '\\a ')

/** The attributes that name a node to a selector, in the order they are tried: a block's wrapper, then an id. */
const ANCHORS = ['data-block-wrapper', 'id'] as const

/** Every `attr="value"` pair of {@link ANCHORS} that names exactly one element of the frame. */
function uniqueAnchors(root: Element): Set<string> {
  const seen = new Map<string, number>()
  const walk = (el: Element): void => {
    for (const attr of ANCHORS) {
      const value = el.attrs.get(attr)
      if (value !== undefined && value !== '') seen.set(`${attr}=${value}`, (seen.get(`${attr}=${value}`) ?? 0) + 1)
    }
    el.children.forEach(walk)
  }
  walk(root)
  return new Set([...seen].filter(([, n]) => n === 1).map(([k]) => k))
}

/** The anchor that names `el` alone, as a selector; undefined when none does. */
function anchorOf(el: Element, unique: ReadonlySet<string>): string | undefined {
  for (const attr of ANCHORS) {
    const value = el.attrs.get(attr)
    if (value !== undefined && unique.has(`${attr}=${value}`)) return `[${attr}="${cssString(value)}"]`
  }
  return undefined
}

/**
 * The selector of `el` in the document: from the nearest element (itself
 * included) that a block wrapper or an id names alone, else from the render
 * root, one `>:nth-child(n)` per step down.
 */
function selectorOf(el: Element, unique: ReadonlySet<string>): string {
  const steps: string[] = []
  let at: Element = el
  for (;;) {
    const anchor = anchorOf(at, unique)
    if (anchor !== undefined) {
      steps.unshift(anchor)
      return `#pw-root ${steps.join('>')}`
    }
    const parent = at.parent as Element
    steps.unshift(`:nth-child(${parent.children.indexOf(at) + 1})`)
    if (parent.tag === '#root') return `#pw-root>${steps.join('>')}`
    at = parent
  }
}

/** The block a node belongs to: its own or its nearest ancestor's `data-block-type`. */
function blockTypeOf(el: Element): string | undefined {
  for (let at: Element | null = el; at; at = at.parent) {
    const type = at.attrs.get('data-block-type')
    if (type !== undefined) return type
  }
  return undefined
}

/**
 * Attributes the renderer writes to say which breakpoint it drew, not how the
 * node looks: no stylesheet selects on them, so a difference changes nothing.
 */
const INFORMATIONAL = new Set(['data-viewport', 'data-pw-width-scope'])

/** The attributes a stylesheet can select a node by, and that CSS cannot change: `class` and `data-*`. */
function selectingAttrs(el: Element): string {
  const out: string[] = []
  for (const [name, value] of el.attrs) {
    if ((name === 'class' || name.startsWith('data-')) && !INFORMATIONAL.has(name)) out.push(`${name}=${value}`)
  }
  return out.sort().join('\u0000')
}

/** A rule of the frame's stylesheet, inside `context` (the at-rule preludes around it, outermost first). */
interface LayoutRule {
  readonly context: readonly string[]
  /** Empty for an at-rule written as it is (`decls` is then its whole text). */
  readonly selector: string
  readonly decls: string
}

/** The rules that turn the phone frame `base` into `wide`'s layout, and the blocks whose markup differs. */
function diffFrames(base: Element, wide: Element, unique: ReadonlySet<string>): { rules: LayoutRule[]; reshaped: Set<string> } {
  const rules: LayoutRule[] = []
  const reshaped = new Set<string>()
  const name = (el: Element): string => blockTypeOf(el) ?? el.tag
  const walk = (a: Element, b: Element): void => {
    if (a.tag !== '#root') {
      const sa = parseStyle(a.attrs.get('style'))
      const sb = parseStyle(b.attrs.get('style'))
      const decls: string[] = []
      for (const [prop, value] of sb) if (sa.get(prop) !== value) decls.push(`${prop}:${value}!important`)
      // A declaration the wider layout does not make goes back to the
      // stylesheets' value.
      for (const prop of sa.keys()) if (!sb.has(prop)) decls.push(`${prop}:revert!important`)
      if (decls.length > 0) rules.push({ context: [], selector: selectorOf(a, unique), decls: decls.join(';') })
      // A class or data attribute is what a stylesheet chose the node's look
      // by, and CSS cannot change it.
      if (selectingAttrs(a) !== selectingAttrs(b)) reshaped.add(name(a))
      // A block's own rules for the width it was drawn at: diffed rule by rule.
      if (a.tag === 'style' && a.text !== b.text) rules.push(...diffStyleText(a.text, b.text))
    }
    const same = a.children.length === b.children.length && a.children.every((c, i) => c.tag === (b.children[i] as Element).tag)
    if (!same) {
      reshaped.add(name(a))
      return
    }
    a.children.forEach((c, i) => walk(c, b.children[i] as Element))
  }
  walk(base, wide)
  return { rules, reshaped }
}

// ── a <style> element's text, rule by rule ───────────────────────────

/** One item of a stylesheet: a rule (`prelude{body}`), or a statement (`@import …;`). */
interface CssItem {
  readonly prelude: string
  /** The text between the braces; undefined for a statement. */
  readonly body?: string
}

function skipString(text: string, at: number): number {
  const quote = text[at]
  let j = at + 1
  while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1
  return j + 1
}

/** The top-level items of `css` (comments dropped; strings and nested braces respected). */
export function cssItems(css: string): CssItem[] {
  const items: CssItem[] = []
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  let i = 0
  let start = 0
  while (i < text.length) {
    const c = text[i]
    if (c === '"' || c === "'") {
      i = skipString(text, i)
      continue
    }
    if (c === ';') {
      const prelude = text.slice(start, i).trim()
      if (prelude) items.push({ prelude })
      start = ++i
      continue
    }
    if (c === '{') {
      let depth = 1
      let j = i + 1
      while (j < text.length && depth > 0) {
        const d = text[j]
        if (d === '"' || d === "'") {
          j = skipString(text, j)
          continue
        }
        if (d === '{') depth++
        else if (d === '}') depth--
        j++
      }
      items.push({ prelude: text.slice(start, i).trim(), body: text.slice(i + 1, depth === 0 ? j - 1 : j) })
      i = j
      start = j
      continue
    }
    i++
  }
  return items
}

/** At-rules whose body is rules, diffed rule by rule; any other at-rule (`@keyframes`, `@font-face`) is one item, as written. */
const GROUPING = /^@(media|supports|container|layer)\b/i
/** At-rules that apply their rules on a condition: a declaration inside one is not reverted (whether it applies is not known here). */
const CONDITIONAL = /^@(media|supports|container)\b/i

interface StyleRule {
  readonly context: readonly string[]
  readonly selector: string
  readonly decls: Map<string, string>
}

/** Every style rule of `css`, by context and selector, with its declarations; every other at-rule by its text. */
function cssRuleMap(css: string): { rules: Map<string, StyleRule>; opaque: Map<string, readonly string[]> } {
  const rules = new Map<string, StyleRule>()
  const opaque = new Map<string, readonly string[]>()
  const visit = (items: readonly CssItem[], context: readonly string[]): void => {
    for (const item of items) {
      if (item.body === undefined) continue
      if (item.prelude.startsWith('@')) {
        if (GROUPING.test(item.prelude) && item.body.includes('{')) visit(cssItems(item.body), [...context, item.prelude])
        else opaque.set(`${item.prelude}{${item.body}}`, context)
        continue
      }
      const key = `${context.join('\u0000')}\u0001${item.prelude}`
      const entry = rules.get(key) ?? { context, selector: item.prelude, decls: new Map<string, string>() }
      for (const [prop, value] of parseStyle(item.body)) entry.decls.set(prop, value.replace(/\s*!\s*important\s*$/i, ''))
      rules.set(key, entry)
    }
  }
  visit(cssItems(css), [])
  return { rules, opaque }
}

/**
 * `selector` raised over the phone text's own rule: each selector of the list
 * under `#pw-root`, so it outweighs the same selector there. A selector of the
 * document itself (`:root`, `html`, `body`) stays as it is.
 */
function underRoot(selector: string): string {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      parts.push(selector.slice(start, i))
      start = i + 1
    }
  }
  parts.push(selector.slice(start))
  return parts
    .map((p) => p.trim())
    .map((p) => (/^(:root|html|body|:host)\b/i.test(p) || p.startsWith('#pw-root') ? p : `#pw-root ${p}`))
    .join(',')
}

/** The rules that turn the phone frame's `<style>` text `phone` into the wider frame's `wide`. */
function diffStyleText(phone: string, wide: string): LayoutRule[] {
  const a = cssRuleMap(phone)
  const b = cssRuleMap(wide)
  const out: LayoutRule[] = []
  for (const [key, rule] of b.rules) {
    const before = a.rules.get(key)?.decls
    const decls: string[] = []
    for (const [prop, value] of rule.decls) if (before?.get(prop) !== value) decls.push(`${prop}:${value}!important`)
    if (decls.length > 0) out.push({ context: rule.context, selector: underRoot(rule.selector), decls: decls.join(';') })
  }
  for (const [key, rule] of a.rules) {
    if (rule.context.some((c) => CONDITIONAL.test(c))) continue
    const after = b.rules.get(key)?.decls
    const decls: string[] = []
    for (const prop of rule.decls.keys()) if (!after?.has(prop)) decls.push(`${prop}:revert!important`)
    if (decls.length > 0) out.push({ context: rule.context, selector: underRoot(rule.selector), decls: decls.join(';') })
  }
  // A keyframes or font face only the wider text has: as it is written.
  for (const [text, context] of b.opaque) if (!a.opaque.has(text)) out.push({ context, selector: '', decls: text })
  return out
}

/** A breakpoint's rules as stylesheet text: rules that take the same declarations in the same context share one. */
function rulesText(rules: readonly LayoutRule[]): string {
  const bySame = new Map<string, { context: readonly string[]; decls: string; selectors: string[] }>()
  for (const r of rules) {
    const key = `${r.context.join('\u0000')}\u0001${r.selector === '' ? '\u0002' : ''}${r.decls}`
    const entry = bySame.get(key) ?? { context: r.context, decls: r.decls, selectors: [] }
    if (r.selector !== '' && !entry.selectors.includes(r.selector)) entry.selectors.push(r.selector)
    bySame.set(key, entry)
  }
  return [...bySame.values()]
    .map(({ context, decls, selectors }) => {
      const rule = selectors.length === 0 ? decls : `${selectors.join(',')}{${decls}}`
      return context.reduceRight((inner, at) => `${at}{${inner}}`, rule)
    })
    .join('')
}

/** The breakpoints a first frame is drawn at besides the phone's, with the widths each covers. */
export const WIDE_BREAKPOINTS: readonly { readonly name: string; readonly min: number; readonly max?: number }[] = BREAKPOINTS.slice(1).map(
  (bp, i, all) => ({ name: bp.name, min: bp.minWidth, ...(all[i + 1] ? { max: (all[i + 1] as { minWidth: number }).minWidth - 0.02 } : {}) })
)

export interface StaticLayout {
  /** The stylesheet that lays the phone frame out at every wider breakpoint; empty when nothing differs. */
  readonly css: string
  /** The block types whose markup (not only their layout) differs at a wider breakpoint. */
  readonly reshaped: readonly string[]
}

/**
 * The responsive stylesheet of a frame: `phone` is the frame at the phone
 * breakpoint (the markup that ships), `wide` the same page drawn at each of
 * {@link WIDE_BREAKPOINTS}, by name. Breakpoints that need the same rules
 * share one media query.
 */
export function staticLayoutOf(phone: string, wide: Readonly<Record<string, string>>): StaticLayout {
  const base = parseFrame(phone)
  const unique = uniqueAnchors(base)
  const reshaped = new Set<string>()
  const ranges: { min: number; max?: number; body: string }[] = []
  for (const bp of WIDE_BREAKPOINTS) {
    const html = wide[bp.name]
    if (html === undefined) continue
    const diff = html === phone ? { rules: [] as LayoutRule[], reshaped: new Set<string>() } : diffFrames(base, parseFrame(html), unique)
    for (const r of diff.reshaped) reshaped.add(r)
    // Nodes that take the same declarations share one rule.
    const body = rulesText(diff.rules)
    const last = ranges[ranges.length - 1]
    if (last && last.body === body && last.max !== undefined && Math.abs(last.max + 0.02 - bp.min) < 0.001) {
      if (bp.max === undefined) delete last.max
      else last.max = bp.max
    } else ranges.push({ min: bp.min, ...(bp.max !== undefined ? { max: bp.max } : {}), body })
  }
  const css = ranges
    .filter((r) => r.body !== '')
    .map((r) => `@media (min-width:${r.min}px)${r.max !== undefined ? ` and (max-width:${r.max}px)` : ''}{${r.body}}`)
    .join('\n')
  return { css, reshaped: [...reshaped].sort() }
}

/** The visible words of a frame's markup: what a reader without scripts, or a crawler, reads. */
export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(style|script|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim()
}
