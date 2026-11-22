/**
 * SVG screening: whether an SVG file is a plain picture, by a strict parse
 * and an allowlist, never by searching its text. An SVG is markup a browser
 * runs when it is opened as a document (a link to it, a new tab), so the
 * screen refuses everything that can carry script or reach out of the file,
 * however it is spelled:
 *
 * - a DOCTYPE (and with it every ENTITY), a processing instruction other
 *   than the leading `<?xml …?>` declaration, a character or entity
 *   reference other than the five XML ones and numeric ones (which are
 *   decoded before any check);
 * - an element outside the allowlist ({@link SVG_ELEMENTS}): `script`,
 *   `foreignObject`, `image`, `feImage`, `iframe`, … and any element with a
 *   namespace prefix (`<x:script xmlns:x="…">` is a script in whatever
 *   namespace `x` names);
 * - a namespace declaration other than the SVG namespace as the default and
 *   the XLink namespace as `xmlns:xlink`;
 * - an attribute whose name starts with `on`, a prefixed attribute other
 *   than `xlink:href`, `xml:space`, `xml:lang`, and an attribute name that
 *   is not plain letters, digits and `-`;
 * - an `href` / `xlink:href` that is not a fragment of this document
 *   (`#id`), and a `url(…)` anywhere (an attribute, a `style`) that is not
 *   `url(#id)`;
 * - an `animate`, `set`, `animateTransform` or `animateMotion` whose
 *   `attributeName` is an `href` or an `on…` attribute;
 * - CSS (a `style` attribute or element) holding `expression(`, `@import`,
 *   `-moz-binding`, `behavior`, `javascript:` or a backslash (a CSS escape
 *   can spell any of them);
 * - anything that does not parse: an unclosed tag, a stray `<`, mismatched
 *   tags, a duplicate attribute, a root that is not `<svg>`.
 *
 * A file an editor wrote with its own namespaces (Inkscape, Illustrator) is
 * refused too; an SVG optimiser writes the plain picture this accepts.
 *
 * @module @pwfabric/pack/svg
 */

export const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
export const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

/** The elements a plain SVG picture is made of, in lower case. */
export const SVG_ELEMENTS: ReadonlySet<string> = new Set(
  [
    'svg', 'g', 'defs', 'symbol', 'use', 'a', 'switch', 'title', 'desc', 'metadata', 'style',
    'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
    'text', 'tspan', 'textPath',
    'linearGradient', 'radialGradient', 'stop', 'pattern', 'clipPath', 'mask', 'marker',
    'filter', 'feBlend', 'feColorMatrix', 'feComponentTransfer', 'feComposite', 'feConvolveMatrix',
    'feDiffuseLighting', 'feDisplacementMap', 'feDistantLight', 'feDropShadow', 'feFlood', 'feFuncA',
    'feFuncB', 'feFuncG', 'feFuncR', 'feGaussianBlur', 'feMerge', 'feMergeNode', 'feMorphology',
    'feOffset', 'fePointLight', 'feSpecularLighting', 'feSpotLight', 'feTile', 'feTurbulence',
    'animate', 'animateTransform', 'animateMotion', 'set', 'mpath',
  ].map((e) => e.toLowerCase())
)

const ANIMATION = new Set(['animate', 'animatetransform', 'animatemotion', 'set'])
const PREFIXED_ATTRIBUTES = new Set(['xlink:href', 'xml:space', 'xml:lang'])
const NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/
const PLAIN_ATTRIBUTE = /^[A-Za-z][A-Za-z0-9-]*$/

class Unsafe extends Error {}

/** The text with its references decoded; an unknown or malformed reference is refused. */
function decode(text: string): string {
  return text.replace(/&([^;&\s]*);?/g, (whole, ref: string) => {
    if (!whole.endsWith(';')) throw new Unsafe('a "&" that is not a reference')
    const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
    if (named[ref] !== undefined) return named[ref] as string
    const num = /^#x([0-9a-f]{1,6})$/i.exec(ref) ?? /^#([0-9]{1,7})$/.exec(ref)
    if (num) {
      const code = parseInt(num[1] as string, ref[1] === 'x' || ref[1] === 'X' ? 16 : 10)
      if (code === 0 || code > 0x10ffff) throw new Unsafe(`the reference &${ref}; names no character`)
      return String.fromCodePoint(code)
    }
    throw new Unsafe(`the entity reference &${ref}; (only &amp; &lt; &gt; &quot; &apos; and numeric references are read)`)
  })
}

/** Every `url(…)` in `value` names a fragment of this document. */
function checkUrls(value: string, where: string): void {
  const squeezed = value.replace(/\s+/g, '')
  for (const m of squeezed.matchAll(/url\(([^)]*)\)?/gi)) {
    const target = (m[1] ?? '').replace(/^['"]|['"]$/g, '')
    if (!target.startsWith('#')) throw new Unsafe(`${where} has url(${target}), which reaches outside the file (only url(#id) is allowed)`)
  }
}

/** CSS of a `style` attribute or element. */
function checkCss(css: string, where: string): void {
  if (css.includes('\\')) throw new Unsafe(`${where} holds a CSS escape (a backslash)`)
  const lower = css.toLowerCase().replace(/\s+/g, '')
  for (const bad of ['expression(', '@import', '-moz-binding', 'behavior:', 'javascript:']) {
    if (lower.includes(bad)) throw new Unsafe(`${where} holds ${bad}`)
  }
  checkUrls(css, where)
}

function checkAttribute(element: string, name: string, value: string): void {
  const lower = name.toLowerCase()
  if (lower === 'xmlns') {
    if (value !== SVG_NAMESPACE) throw new Unsafe(`<${element}> declares the namespace ${value}; only ${SVG_NAMESPACE} is allowed`)
    return
  }
  if (lower.startsWith('xmlns:')) {
    if (lower === 'xmlns:xlink' && value === XLINK_NAMESPACE) return
    throw new Unsafe(`<${element}> declares the namespace prefix ${name.slice(6)}; only xmlns:xlink="${XLINK_NAMESPACE}" is allowed`)
  }
  if (lower.includes(':') ? !PREFIXED_ATTRIBUTES.has(lower) : !PLAIN_ATTRIBUTE.test(name)) {
    throw new Unsafe(`<${element}> has the attribute ${name}, which is not a plain SVG attribute`)
  }
  if (lower.startsWith('on')) throw new Unsafe(`<${element}> has the event attribute ${name}`)
  if (lower === 'href' || lower === 'xlink:href') {
    if (!value.trim().startsWith('#')) throw new Unsafe(`<${element}> links to ${value.trim() || '""'}; only a fragment of this file (#id) is allowed`)
    return
  }
  if (lower === 'style') checkCss(value, `<${element}> style`)
  else checkUrls(value, `<${element}> ${name}`)
  if (ANIMATION.has(element.toLowerCase()) && lower === 'attributename') {
    const target = value.trim().toLowerCase().replace(/^xlink:/, '')
    if (target === 'href' || target.startsWith('on')) throw new Unsafe(`<${element}> animates ${value.trim()}`)
  }
  if (/javascript\s*:/i.test(value.replace(/[\s\0]/g, ''))) throw new Unsafe(`<${element}> ${name} holds a javascript: URL`)
}

/** Parses `text` and throws {@link Unsafe} at the first thing a plain picture does not hold. */
function screen(text: string): void {
  let i = 0
  const stack: string[] = []
  let rootSeen = false
  let rootClosed = false
  let styleText: string | null = null
  const n = text.length
  const leading = /^\s*<\?xml\s[^?<>]*\?>/.exec(text)
  if (leading) i = leading[0].length
  while (i < n) {
    const lt = text.indexOf('<', i)
    const chunk = text.slice(i, lt < 0 ? n : lt)
    if (chunk) {
      if (stack.length === 0 && chunk.trim()) throw new Unsafe('text outside the <svg> element')
      const decoded = decode(chunk)
      if (styleText !== null) styleText += decoded
    }
    if (lt < 0) break
    i = lt
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4)
      if (end < 0) throw new Unsafe('an unclosed comment')
      i = end + 3
      continue
    }
    if (text.startsWith('<![CDATA[', i)) {
      if (stack.length === 0) throw new Unsafe('a CDATA section outside the <svg> element')
      const end = text.indexOf(']]>', i + 9)
      if (end < 0) throw new Unsafe('an unclosed CDATA section')
      if (styleText !== null) styleText += text.slice(i + 9, end)
      i = end + 3
      continue
    }
    if (text.startsWith('<!', i)) throw new Unsafe(`a ${/^<!doctype/i.test(text.slice(i, i + 9)) ? 'DOCTYPE' : 'markup declaration'} (DOCTYPE and ENTITY declarations are not allowed)`)
    if (text.startsWith('<?', i)) throw new Unsafe('a processing instruction')
    const close = text.startsWith('</', i)
    const gt = findTagEnd(text, i)
    const body = text.slice(i + (close ? 2 : 1), gt)
    i = gt + 1
    if (close) {
      const name = body.trim()
      const open = stack.pop()
      if (open === undefined || open !== name) throw new Unsafe(`</${name}> closes ${open ? `<${open}>` : 'nothing'}`)
      if (name.toLowerCase() === 'style' && styleText !== null) {
        checkCss(styleText, '<style>')
        styleText = null
      }
      if (stack.length === 0) rootClosed = true
      continue
    }
    const selfClosing = body.endsWith('/')
    const inner = selfClosing ? body.slice(0, -1) : body
    const m = /^([^\s/>]+)/.exec(inner)
    const name = m?.[1] ?? ''
    if (!NAME.test(name)) throw new Unsafe(`a tag that does not parse ("<${inner.slice(0, 20)}")`)
    if (name.includes(':')) throw new Unsafe(`the element <${name}> has a namespace prefix`)
    if (!SVG_ELEMENTS.has(name.toLowerCase())) throw new Unsafe(`the element <${name}> is not part of a plain SVG picture`)
    if (stack.length === 0) {
      if (rootSeen || rootClosed) throw new Unsafe('more than one root element')
      if (name !== 'svg') throw new Unsafe(`the root element is <${name}>, not <svg>`)
      rootSeen = true
    }
    const seen = new Set<string>()
    let rest = inner.slice(name.length)
    for (;;) {
      const space = /^\s*/.exec(rest)?.[0] ?? ''
      rest = rest.slice(space.length)
      if (!rest) break
      if (!space) throw new Unsafe(`<${name}> has attributes that do not parse`)
      const a = /^([^\s=/>]+)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/.exec(rest)
      if (!a) throw new Unsafe(`<${name}> has attributes that do not parse`)
      const attr = a[1] as string
      if (seen.has(attr)) throw new Unsafe(`<${name}> has the attribute ${attr} twice`)
      seen.add(attr)
      checkAttribute(name, attr, decode(a[2] ?? a[3] ?? ''))
      rest = rest.slice(a[0].length)
    }
    if (!selfClosing) {
      stack.push(name)
      if (name.toLowerCase() === 'style') styleText = ''
    } else if (stack.length === 0) rootClosed = true
  }
  if (stack.length > 0) throw new Unsafe(`<${stack[stack.length - 1]}> is not closed`)
  if (!rootSeen) throw new Unsafe('no <svg> element')
}

/** The index of the `>` that ends the tag starting at `from`, skipping quoted values. */
function findTagEnd(text: string, from: number): number {
  let quote: string | null = null
  for (let j = from + 1; j < text.length; j++) {
    const c = text[j]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === '<') throw new Unsafe('a "<" inside a tag')
    else if (c === '>') return j
  }
  throw new Unsafe('an unclosed tag')
}

/**
 * Why an SVG file is not a plain picture (see the module header), as a
 * phrase that follows the file's name (`holds …`, `is …`); `undefined` when
 * it is one.
 */
export function svgUnsafeReason(bytes: Uint8Array): string | undefined {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return 'is not UTF-8 text'
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  try {
    screen(text)
    return undefined
  } catch (e) {
    if (e instanceof Unsafe) return `is not a plain SVG picture: ${e.message}`
    throw e
  }
}
