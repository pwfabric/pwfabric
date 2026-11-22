/**
 * `llms.txt` and `llms-full.txt` (https://llmstxt.org; pwapp-format §2.4):
 * the app's pages for a language model, written next to `sitemap.xml` for a
 * path-routed build of an app that declares its public origin.
 *
 * `llms.txt` is the index: the app's name and description, then one link per
 * page. `llms-full.txt` is the pages themselves, as plain Markdown taken from
 * the very first frame each page's HTML shows (static-paint.ts) — so it says
 * exactly what a reader without scripts reads, never a template and never
 * data the build does not have.
 *
 * BANDS EVERY PAGE SHARES. A page's top-level blocks (its block wrappers that
 * sit in no other) are its bands. A band whose text is the same on every
 * page — a navbar, a footer, a language switch — is written once, at the end
 * under `## Site navigation`, not once per page.
 */
import { parseFrame, parseStyle, type Element } from './static-layout.js'

/** What is never read: code, styles, media, and what the frame hides. */
const SKIP = new Set(['script', 'style', 'template', 'noscript', 'svg', 'img', 'picture', 'video', 'audio', 'canvas', 'iframe', 'object', 'select', 'textarea', 'input'])

/** Elements that start and end a block of text. */
const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'header', 'hr', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'thead',
  'tfoot', 'ul', 'label',
])

function hidden(el: Element): boolean {
  if (SKIP.has(el.tag) || el.attrs.has('hidden') || el.attrs.get('aria-hidden') === 'true') return true
  const style = parseStyle(el.attrs.get('style'))
  return style.get('display') === 'none' || style.get('visibility') === 'hidden'
}

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim()

/** Resolves a link the frame writes to an absolute address; undefined drops the link and keeps its text. */
export type LinkResolver = (href: string) => string | undefined

/** An element's text on one line, its links as `[text](url)`. */
function inline(node: Element | string, link: LinkResolver): string {
  if (typeof node === 'string') return node
  if (hidden(node)) return ''
  if (node.tag === 'br') return ' '
  const text = node.content.map((c) => inline(c, link)).join('')
  if (node.tag === 'a') {
    const words = squash(text)
    const href = node.attrs.get('href')
    const url = href ? link(href) : undefined
    return words && url ? ` [${words}](${url}) ` : text
  }
  return BLOCK.has(node.tag) || /^h[1-6]$/.test(node.tag) || node.tag === 'li' || node.tag === 'tr' ? ` ${text} ` : text
}

/** An element as Markdown blocks: headings by level, paragraphs, `- ` list items, `| a | b |` table rows. */
export function markdownOf(root: Element, link: LinkResolver): string[] {
  const blocks: string[] = []
  let line = ''
  const flush = (): void => {
    const text = squash(line)
    if (text) blocks.push(text)
    line = ''
  }
  const walk = (node: Element | string): void => {
    if (typeof node === 'string') {
      line += node
      return
    }
    if (hidden(node)) return
    const heading = /^h([1-6])$/.exec(node.tag)
    if (heading) {
      flush()
      const text = squash(inline(node, link))
      if (text) blocks.push(`${'#'.repeat(Number(heading[1]))} ${text}`)
      return
    }
    if (node.tag === 'li') {
      flush()
      const text = squash(inline(node, link))
      if (text) blocks.push(`- ${text}`)
      return
    }
    if (node.tag === 'tr') {
      flush()
      const cells = node.children.filter((c) => (c.tag === 'td' || c.tag === 'th') && !hidden(c)).map((c) => squash(inline(c, link)).replace(/\|/g, '\\|'))
      if (cells.some((c) => c !== '')) blocks.push(`| ${cells.join(' | ')} |`)
      return
    }
    if (node.tag === 'a' || node.tag === 'br') {
      line += inline(node, link)
      return
    }
    const block = BLOCK.has(node.tag)
    if (block) flush()
    for (const c of node.content) walk(c)
    if (block) flush()
  }
  walk(root)
  flush()
  return blocks
}

/** A page's top-level bands: each block wrapper in no other, with its Markdown. Text outside any wrapper is a band of its own. */
export function bandsOf(html: string, link: LinkResolver): { readonly id: string; readonly text: string }[] {
  const root = parseFrame(html)
  const bands: { id: string; text: string }[] = []
  const loose: (Element | string)[] = []
  const walk = (el: Element): void => {
    for (const c of el.content) {
      if (typeof c === 'string') {
        loose.push(c)
        continue
      }
      if (hidden(c)) continue
      if (c.attrs.has('data-block-wrapper')) {
        if (loose.length > 0) {
          bands.push({ id: '', text: markdownOf({ ...root, content: loose.splice(0) } as Element, link).join('\n\n') })
        }
        bands.push({ id: c.attrs.get('data-block-wrapper') as string, text: markdownOf(c, link).join('\n\n') })
      } else walk(c)
    }
  }
  walk(root)
  if (loose.length > 0) bands.push({ id: '', text: markdownOf({ ...root, content: loose } as Element, link).join('\n\n') })
  return bands.filter((b) => b.text !== '')
}

/** One page the files list. */
export interface LlmsPage {
  readonly title: string
  readonly url: string
  readonly description?: string
  /** The page's first frame (the inner HTML of `#pw-root`); undefined when it was not painted. */
  readonly html?: string
}

/** `llms.txt`: the app, then one link per page. */
export function llmsTxt(app: { readonly name: string; readonly description?: string }, pages: readonly LlmsPage[]): string {
  const head = [`# ${app.name}`, ...(app.description ? ['', `> ${app.description}`] : [])]
  const links = pages.map((p) => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`)
  return `${[...head, '', '## Pages', '', ...links].join('\n')}\n`
}

/**
 * `llms.txt` of an app with locales (pwapp-format §2.4.1): the app, then a
 * section per locale (the default first), `## Pages (<lang>)`.
 */
export function llmsTxtLocales(
  app: { readonly name: string; readonly description?: string },
  sections: readonly { readonly lang: string; readonly pages: readonly LlmsPage[] }[]
): string {
  const head = [`# ${app.name}`, ...(app.description ? ['', `> ${app.description}`] : [])]
  const body = sections.flatMap((s) => ['', `## Pages (${s.lang})`, '', ...s.pages.map((p) => `- [${p.title}](${p.url})${p.description ? `: ${p.description}` : ''}`)])
  return `${[...head, ...body].join('\n')}\n`
}

/**
 * `llms-full.txt` of an app with locales: each locale's pages under a
 * `# <lang>` heading, in the same order, after the app's title.
 */
export function llmsFullTxtLocales(
  app: { readonly name: string; readonly description?: string },
  sections: readonly { readonly lang: string; readonly pages: readonly LlmsPage[] }[],
  link: (page: LlmsPage) => LinkResolver
): string {
  const head = [`# ${app.name}`, ...(app.description ? ['', `> ${app.description}`] : [])]
  const parts = sections.map((s) => {
    // The locale's pages as llmsFullTxt writes them, without its title lines.
    const own = llmsFullTxt({ name: '' }, s.pages, link).split('\n').slice(1)
    return [`# ${s.lang}`, ...own].join('\n').trimEnd()
  })
  return `${[...head, '', parts.join('\n\n')].join('\n')}\n`
}

/** `llms-full.txt`: every page's words, a band every page shares once at the end. */
export function llmsFullTxt(
  app: { readonly name: string; readonly description?: string },
  pages: readonly LlmsPage[],
  link: (page: LlmsPage) => LinkResolver
): string {
  const banded = pages.map((p) => (p.html === undefined ? [] : bandsOf(p.html, link(p))))
  const key = (b: { id: string; text: string }): string => `${b.id}\u0000${b.text}`
  const shared =
    banded.length > 1 && banded.every((b) => b.length > 0)
      ? new Set((banded[0] ?? []).map(key).filter((k) => banded.every((bands) => bands.some((b) => key(b) === k))))
      : new Set<string>()
  const out = [`# ${app.name}`, ...(app.description ? ['', `> ${app.description}`] : [])]
  pages.forEach((p, i) => {
    out.push('', `## ${p.title}`, '', `Source: ${p.url}`)
    const text = (banded[i] ?? []).filter((b) => !shared.has(key(b))).map((b) => b.text)
    if (text.length > 0) out.push('', text.join('\n\n'))
  })
  const common = (banded[0] ?? []).filter((b) => shared.has(key(b))).map((b) => b.text)
  if (common.length > 0) out.push('', '## Site navigation', '', common.join('\n\n'))
  return `${out.join('\n')}\n`
}
