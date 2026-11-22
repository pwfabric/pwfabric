/**
 * THE APP'S DOCUMENTS (pwapp-format §1, §2.4): which HTML file each page is
 * served from, what its head says about it, and the files a search engine
 * reads — `sitemap.xml` and `robots.txt`.
 *
 * Under hash routing an app is one document, `index.html`: every address is
 * that file with a fragment. Under path routing (`path`, `auto`) every page
 * has its own: the entry page `index.html`, every other route
 * `<key>/index.html` — the file every static host serves at `<base><key>/`
 * with no configuration (a host that answers `<base><key>` sends the reader
 * on to the folder, or serves it in place) — and `404.html`, the app's
 * not-found page, which static hosts serve, with status 404, for a path no
 * file answers.
 *
 * Each document's head is its page's: its title, description and canonical
 * address (from the runner's own functions, so the head the build writes is
 * the head the runner keeps), and the Open Graph tags a link preview reads.
 */
import { canonicalOf, composeTitle, descriptionOf, publicOriginOf } from '@pwfabric/runner'

/** One HTML document of the served folder. */
export interface PageDocument {
  /** The file, relative to the folder: `index.html`, `<key>/index.html`, `404.html`. */
  readonly file: string
  /** The page whose first frame the document holds; undefined for a `404.html` of an app with no not-found page. */
  readonly key?: string
  /** The document answers an address that names no page. */
  readonly notFound: boolean
  /** The path it is served at under the app's base (`/`, `/pricing/`); undefined for `404.html`. */
  readonly path?: string
  /** In an app with locales: the locale the document is drawn in (envelope §2.3). */
  readonly locale?: string
}

/** The folders of the served folder (§1): a page key named like one has no document of its own under path routing. */
export const SERVED_FOLDERS: readonly string[] = ['assets', 'blocks', 'engines', 'shims', 'pwpack']

/**
 * Every document a build writes. `toHref` is the router's (runner router.ts):
 * under path routing the address of each page, from which its file follows.
 */
export function pageDocuments(input: {
  readonly byPath: boolean
  readonly entry: string
  readonly routes: readonly string[]
  readonly notFound?: string
  readonly base: string
  readonly toHref: (key: string) => string
}): PageDocument[] {
  if (!input.byPath) return [{ file: 'index.html', key: input.entry, notFound: false, path: '/' }]
  const root = input.base.replace(/\/+$/, '')
  const docs: PageDocument[] = []
  for (const key of input.routes) {
    const href = input.toHref(key)
    const below = href.startsWith(`${root}/`) ? href.slice(root.length + 1) : href.replace(/^\//, '')
    docs.push({ file: below === '' ? 'index.html' : `${below.replace(/\/$/, '')}/index.html`, key, notFound: false, path: href })
  }
  docs.push({ file: '404.html', ...(input.notFound !== undefined ? { key: input.notFound } : {}), notFound: true })
  return docs
}

/** A receipt member that is text as it stands — not empty, no expression. */
function literal(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('{{') ? value.trim() : undefined
}

/** What a document's head says about its page. */
export interface DocumentHead {
  readonly title: string
  readonly description?: string
  readonly canonical?: string
  readonly image?: string
  readonly noindex?: boolean
}

/**
 * The head of `doc`: the page's title composed with the app's (receipt §1) —
 * a title that is an expression is known only in the browser, so the app's
 * stands — its description, else the app's; its canonical address on the
 * app's public origin (never for the not-found page); the app's preview
 * picture. An app that requires sign-in says nothing of a page's own to a
 * visitor who has not signed in: every document carries the app's.
 */
export function documentHead(input: {
  readonly doc: PageDocument
  readonly receipt: unknown
  readonly appTitle: string
  /** The app's title template (`plan.json` `titleTemplate`, receipt §1.1). */
  readonly titleTemplate?: string
  readonly appDescription?: string
  readonly origin?: string
  readonly image?: string
  readonly gated: boolean
  readonly base: string
}): DocumentHead {
  const receipt = !input.gated && input.receipt && typeof input.receipt === 'object' ? (input.receipt as Record<string, unknown>) : {}
  const title = composeTitle(input.appTitle || undefined, literal(receipt['title']), { template: input.titleTemplate, own: receipt['titleTemplate'] === false }) ?? ''
  const description = descriptionOf(receipt['description'], input.appDescription)
  const canonical = input.doc.path !== undefined ? canonicalOf(input.origin, input.doc.path) : undefined
  const image = previewImageOf(input.image, input.origin, input.base)
  return {
    title,
    ...(description !== undefined ? { description } : {}),
    ...(canonical !== undefined ? { canonical } : {}),
    ...(image !== undefined ? { image } : {}),
    ...(input.doc.notFound ? { noindex: true } : {}),
  }
}

/**
 * The app's preview picture (`plan.json` `image`) as an absolute address: an
 * `http(s)` address as written; the app's own file (`media/<file>`, served
 * at `pwpack/media/<file>`) on the app's public origin — none without one, a
 * link preview takes only an absolute address.
 */
export function previewImageOf(image: string | undefined, origin: string | undefined, base: string): string | undefined {
  if (image === undefined) return undefined
  if (/^https?:\/\//i.test(image)) return image
  const file = image.replace(/^\.?\//, '').replace(/^pwpack\//, '')
  if (!file.startsWith('media/')) return undefined
  const root = base.endsWith('/') ? base : `${base}/`
  return canonicalOf(origin, `${root}pwpack/${file}`)
}

/** Whether a page is a record page: one of its sources is its record (`notFoundWhenEmpty`). It names no page without its record. */
export function isRecordPage(receipt: unknown): boolean {
  let found = false
  const walk = (node: unknown): void => {
    if (found || !node || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(walk)
    const rec = node as Record<string, unknown>
    if (rec['notFoundWhenEmpty'] === true) {
      found = true
      return
    }
    for (const v of Object.values(rec)) walk(v)
  }
  if (receipt && typeof receipt === 'object') walk((receipt as Record<string, unknown>)['capabilities'])
  return found
}

const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** `sitemap.xml`: one `<url>` per address (the sitemaps.org protocol). */
export function sitemapXml(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${xml(u)}</loc></url>\n`).join('')}</urlset>
`
}

/**
 * `sitemap.xml` of an app with locales (pwapp-format §2.4): one `<url>` per
 * page per locale, each with an `xhtml:link` alternate per locale and one
 * for `x-default`.
 */
export function sitemapXmlLocales(entries: readonly { readonly url: string; readonly alternates: readonly { readonly hreflang: string; readonly href: string }[] }[]): string {
  const url = (e: (typeof entries)[number]): string =>
    `  <url><loc>${xml(e.url)}</loc>${e.alternates.map((a) => `<xhtml:link rel="alternate" hreflang="${xml(a.hreflang)}" href="${xml(a.href)}"/>`).join('')}</url>\n`
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.map(url).join('')}</urlset>
`
}

/**
 * `robots.txt`: a published app is meant to be found, so every crawler may
 * read every path (a host that serves an app privately answers with its
 * own); with a sitemap, where it is.
 */
export function robotsTxt(sitemap?: string): string {
  return `User-agent: *\nAllow: /\n${sitemap ? `Sitemap: ${sitemap}\n` : ''}`
}

/** The app's public origin as `plan.json` declares it, normalised; undefined when it declares none (or none that is one). */
export { publicOriginOf }
