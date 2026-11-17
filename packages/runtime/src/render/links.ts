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
