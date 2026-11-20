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
 * What CSS cannot say is left to the browser: a block whose MARKUP changes
 * with the width (a navbar that is a menu button on a phone and a row of
 * links on a desktop) shows its phone form until the renderer runs. Each
 * such block is named, so the build can report it.
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

/** The rules that turn the phone frame `base` into `wide`'s layout, and the blocks whose markup differs. */
function diffFrames(base: Element, wide: Element, unique: ReadonlySet<string>): { rules: [string, string][]; reshaped: Set<string> } {
  const rules: [string, string][] = []
  const reshaped = new Set<string>()
  const walk = (a: Element, b: Element): void => {
    if (a.tag !== '#root') {
      const sa = parseStyle(a.attrs.get('style'))
      const sb = parseStyle(b.attrs.get('style'))
      const decls: string[] = []
      for (const [name, value] of sb) if (sa.get(name) !== value) decls.push(`${name}:${value}!important`)
      // A declaration the wider layout does not make goes back to the
      // stylesheets' value.
      for (const name of sa.keys()) if (!sb.has(name)) decls.push(`${name}:revert!important`)
      if (decls.length > 0) rules.push([selectorOf(a, unique), decls.join(';')])
    }
    const same =
      a.children.length === b.children.length &&
      a.children.every((c, i) => c.tag === (b.children[i] as Element).tag && (c.tag !== 'style' || c.text === (b.children[i] as Element).text))
    if (!same) {
      const type = blockTypeOf(a)
      reshaped.add(type ?? a.tag)
      return
    }
    a.children.forEach((c, i) => walk(c, b.children[i] as Element))
  }
  walk(base, wide)
  return { rules, reshaped }
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
    const diff = html === phone ? { rules: [] as [string, string][], reshaped: new Set<string>() } : diffFrames(base, parseFrame(html), unique)
    for (const r of diff.reshaped) reshaped.add(r)
    // Nodes that take the same declarations share one rule.
    const bySame = new Map<string, string[]>()
    for (const [selector, decls] of diff.rules) bySame.set(decls, [...(bySame.get(decls) ?? []), selector])
    const body = [...bySame].map(([decls, selectors]) => `${selectors.join(',')}{${decls}}`).join('')
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
