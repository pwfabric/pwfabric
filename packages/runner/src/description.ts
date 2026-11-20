/**
 * A page's metadata in the document's head — what a search result or a link
 * preview says about it (receipt §1, envelope §2 and §4): its
 * `<meta name="description">` and its canonical address
 * (`<link rel="canonical">`). The build writes the same values into each
 * page's HTML (pwapp-format §2.4), from these functions.
 *
 * DESCRIPTION. The page's own `description` when it states one, else the
 * app's. A value that carries an expression (`{{dish.0.name}}`) is not
 * written as it stands: the visitor would read the template, so the app's
 * description is used. Neither: the element is removed, rather than left
 * saying the previous page.
 *
 * CANONICAL. The app's public `origin` joined with the page's address in
 * path routing (`https://example.com/pricing/`); under hash routing every
 * page is one document, whose address is the app's base. An app that names
 * no origin has none, and the not-found page never has one.
 *
 * @module @pwfabric/runner/description
 */

const usable = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && !value.includes('{{')

/** The description a page wears: its own, else the app's, else none. */
export function descriptionOf(page: unknown, app: unknown): string | undefined {
  if (usable(page)) return page.trim()
  if (usable(app)) return app.trim()
  return undefined
}

/** Writes (or removes) `<meta name="description">` in `doc`'s head. */
export function applyDescription(doc: Document, page: unknown, app: unknown): void {
  const text = descriptionOf(page, app)
  let meta = doc.head.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (text === undefined) {
    meta?.remove()
    return
  }
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = 'description'
    doc.head.appendChild(meta)
  }
  if (meta.content !== text) meta.content = text
}

/**
 * The app's public origin as declared (`project.json` `origin`), normalised
 * to `scheme://host[:port]`; undefined when it names none or is not an
 * `http(s)` origin.
 */
export function publicOriginOf(origin: unknown): string | undefined {
  if (typeof origin !== 'string' || origin.trim() === '') return undefined
  try {
    const url = new URL(origin.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
    return url.origin
  } catch {
    return undefined
  }
}

/**
 * A page's canonical address: `origin` with the page's address — the path
 * the router writes for it (`/pricing/`), or the app's base for a page of a
 * hash-routed app, whose one document every page shares.
 */
export function canonicalOf(origin: unknown, path: string): string | undefined {
  const own = publicOriginOf(origin)
  if (own === undefined || !path.startsWith('/')) return undefined
  return new URL(path, `${own}/`).href
}

/** Writes (or removes) `<link rel="canonical">` in `doc`'s head. */
export function applyCanonical(doc: Document, href: string | undefined): void {
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (href === undefined) {
    link?.remove()
    return
  }
  if (!link) {
    link = doc.createElement('link')
    link.rel = 'canonical'
    doc.head.appendChild(link)
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href)
}
