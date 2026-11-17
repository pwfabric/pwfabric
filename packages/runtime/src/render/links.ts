/**
 * Which values in a page are links to the app's pages.
 *
 * A host turns an authored page path (`/about`, `/session?id={{item.id}}`)
 * into its router's form (`#/about`, `<base>/about`) before the page renders.
 * It cannot do that for a link whose value starts with an expression —
 * `{{item.url}}` — because which page it names is only known once the data is
 * in: rewritten as written it became `#/{{item.url}}`, and then
 * `#//session?id=…`, a page that does not exist. Such a link is left as
 * written for the host and rewritten by the renderer when its value is known
 * (`linkHref`, see resolve-expressions).
 *
 * One rule for both sides, so the host and the renderer cannot disagree on
 * which value is a link.
 *
 * @module @pwfabric/runtime/render/links
 */

/** Turns a resolved in-app path into the active router's href. */
export type LinkHref = (href: string) => string

/**
 * Which prop keys carry a link. `href` is the obvious one; the pack also
 * names links by role — a navbar's `ctaHref`, a card's `linkHref`. A key
 * naming a FIELD that holds a link (`ctaHrefField`) is not a link.
 */
export function isHrefKey(key: string): boolean {
  return key === 'href' || /Href$/.test(key)
}

/**
 * A member of `owner` that goes to a page: a `…Href` prop, a form binding's
 * `successRedirect`, a `navigate` action's `url`.
 */
export function isLinkMember(key: string, owner: Readonly<Record<string, unknown>>): boolean {
  return isHrefKey(key) || key === 'successRedirect' || (key === 'url' && owner['type'] === 'navigate')
}

/** A link whose page is an expression: known only when the data is. */
export function isExpressionLink(value: string): boolean {
  return value.startsWith('{{')
}

/**
 * The scheme a browser will read from `url`, lower-cased, or null when it has
 * none. A browser's URL parser DELETES tabs, newlines and other control
 * characters before it reads the scheme, so `java\tscript:` is a `javascript:`
 * URL; the scheme is judged on the string with them removed (`readableUrl`).
 */
export function urlSchemeOf(url: string): string | null {
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(readableUrl(url))
  return scheme ? (scheme[1] ?? '').toLowerCase() : null
}

/** `url` as the browser parses it: without whitespace and control characters. */
export function readableUrl(url: string): string {
  return url.replace(/[^!-~]/g, '')
}

/** The schemes a link resolved from data may carry. */
const LINK_SCHEMES: ReadonlySet<string> = new Set(['http', 'https', 'mailto', 'tel'])

/**
 * What a link whose value came from data may be: a root-relative path (`/x`,
 * which the host then writes for its router), a fragment (`#x`), or an
 * absolute URL with an allowed scheme. Anything else — `javascript:`,
 * `data:`, a protocol-relative `//host` or `/\host`, a bare relative path — is
 * `undefined`, and the link gets no href. Data is not the author: an author's
 * literal link is checked when the page is validated; a row's value never is.
 */
export function safeDataLink(href: string): string | undefined {
  // Judged on what the browser reads; the value itself is kept (a path may
  // carry characters `readableUrl` removes, such as `/café`).
  const url = readableUrl(href)
  if (url === '') return undefined
  const kept = href.trim()
  const scheme = urlSchemeOf(url)
  if (scheme !== null) return LINK_SCHEMES.has(scheme) ? kept : undefined
  if (url.startsWith('#')) return kept
  // `//host` and `/\host` (browsers read `\` as `/`) leave the origin.
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return kept
  return undefined
}
