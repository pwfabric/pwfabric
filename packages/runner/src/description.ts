/**
 * The page's `<meta name="description">` — what a search result or a link
 * preview says about it (receipt §1, envelope §2).
 *
 * The page's own `description` when it states one, else the app's. A value
 * that carries an expression (`{{dish.0.name}}`) is not written as it stands:
 * the visitor would read the template, so the app's description is used.
 * Neither: the element is removed, rather than left saying the previous page.
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
