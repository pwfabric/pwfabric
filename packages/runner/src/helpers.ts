/**
 * Pure helpers — router-independent envelope logic, faithfully ported from
 * the proven demo runner (runner.js) and generalized to any `toHref`
 * (hash OR path router).
 *
 * All exported functions are pure (no DOM, no fetch) so they unit-test in a
 * node environment.
 *
 * @module @pwfabric/runner/helpers
 */

import type { PwappFooterLink, PwappNavigation, PwappProject, SurfaceBlockNode, SurfaceReceipt } from './types.js'

/** Builds a page href for the active router ('#/x' in hash mode, '<base>/x' in path mode). */
export type ToHref = (key: string) => string

// ============================================================
// PAGE KEYS
// ============================================================

/** `'/x/' | '/x' | 'x/'` → `'x'` ; `'/' | ''` → `null` (entry). */
export function pageKeyOf(href: string): string | null {
  const trimmed = String(href).replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? null : trimmed
}

// ============================================================
// HREF REWRITING
// ============================================================

/**
 * Rewrites every internal `href` string prop in the tree to the active
 * router's href form. A href is internal when it is not absolute-scheme
 * (`https:`, `mailto:` …) and not a fragment (`#`, `#section` — those are the
 * document's anchors, left alone in both router modes).
 *
 * EVERY internal href is rewritten, including one naming a page the app does
 * not have. The router is the single authority on what resolves; a href it
 * cannot resolve lands on the not-found page INSIDE the app. Passing unknown
 * hrefs through untouched — the old behaviour — meant a wrong link left the
 * app entirely: in path mode it triggered a full document load that the SPA
 * fallback answered with the shell (rendering the entry page, the defect this
 * arc exists for), and in hash mode it walked off the app's origin root.
 *
 * The envelope's contract makes this safe: `href` addresses an app page.
 * Assets are addressed by `src` and never pass through here.
 *
 * Returns a NEW tree (non-mutating) — safe to run on the raw fetched receipt.
 */
/**
 * Which prop keys carry a link. `href` is the obvious one; the pack also
 * names links by role — a navbar's `ctaHref`, a card's `linkHref` — and those
 * are rewritten too, or a navbar "Contact" button would walk off the app to
 * `<origin>/contact`.
 * A key naming a FIELD that holds a link (`ctaHrefField`) is not a link.
 */
export function isHrefKey(key: string): boolean {
  return key === 'href' || /Href$/.test(key)
}

/**
 * A root-relative href that names one of this app's pages — `/session/`,
 * `/people` — arriving at click time from somewhere the rewriter never saw:
 * a data row's `href` rendered by a repeater, a value composed at runtime.
 * Returns the page key when the href is such a link, null for anything else
 * (absolute, fragment-only, nested paths, unknown pages), so the browser keeps
 * those. Query string and fragment are ignored: the page is the address.
 */
export function strayPageKeyOf(href: string, pages: readonly string[]): string | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null
  const key = pageKeyOf(href.replace(/[?#].*$/, ''))
  return key !== null && pages.includes(key) ? key : null
}

export function rewriteHrefs<T>(node: T, entry: string, toHref: ToHref): T {
  if (Array.isArray(node)) {
    return node.map((n) => rewriteHrefs(n, entry, toHref)) as unknown as T
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      // `//host/x` is a PROTOCOL-RELATIVE EXTERNAL address, not an in-app route.
      // `strayPageKeyOf` excludes it too (`href.startsWith('//')`); otherwise
      // `//cdn.example.com/x` would be reduced to a page key, turned into an
      // in-app route, and the external link would land on not-found.
      if (isHrefKey(k) && typeof v === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(v) && !v.startsWith('#') && !v.startsWith('//')) {
        // THE PAGE IS THE ADDRESS; the query and fragment ride along. Keying
        // the whole href would make `/api-reference#authentication` into the
        // page key `api-reference#authentication`, which names no page — so in
        // hash mode every in-page link would render the not-found page.
        // `strayPageKeyOf` below splits them the same way.
        //
        // The query rides along in BOTH modes: `/product?id={{item.id}}`
        // becomes `<base>/product?id=…` in path mode and `#/product?id=…` in
        // hash mode, where the router reads it back.
        // Authors write the PAGE as a literal path: a whole `{{item.href}}`
        // value is still a string here and is taken for a page key.
        const cut = /[?#]/.exec(v)
        const path = cut ? v.slice(0, cut.index) : v
        out[k] = toHref(pageKeyOf(path) ?? entry) + (cut ? v.slice(cut.index) : '')
      } else {
        out[k] = rewriteHrefs(v, entry, toHref)
      }
    }
    return out as T
  }
  return node
}

// ============================================================
// MONTAJ (navbar assembly)
// ============================================================

/**
 * The generated envelope leaves navbar `props.links` EMPTY — the
 * runner fills them from `navigation.json` (`navigation.navbar.links`,
 * rewritten for the active router). Navbars that already carry links are
 * left exactly as authored. Mutates and returns `blocks` (call it on the
 * already-cloned output of `rewriteHrefs`).
 */
export function assembleNav(
  blocks: SurfaceBlockNode[],
  navigation: PwappNavigation | null | undefined,
  entry: string,
  toHref: ToHref
): SurfaceBlockNode[] {
  const navLinks = rewriteHrefs(navigation?.navbar?.links ?? [], entry, toHref)
  const walk = (node: SurfaceBlockNode | SurfaceBlockNode[] | undefined): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node && typeof node === 'object') {
      // A navbar WITHOUT `props` is filled too. A node may carry no `props` key
      // at all (`{id, type}` is valid), and a truthiness gate would skip it
      // silently: the navigation stays empty, nothing crashes, nobody notices.
      // Generators do write nodes without props.
      if (node.type === 'navbar') {
        node.props ??= {}
        if (!((node.props.links as unknown[] | undefined) ?? []).length) node.props.links = navLinks
        // THE WORDMARK IS THE WAY HOME. The navbar block has carried `logoHref`
        // and renders the brand as a link whenever it is set — without this the
        // site name would be inert on every page. It belongs here and not in
        // the receipt for the same reason the links do: which page is entry, and
        // what an href looks like in the active router, are facts the surface
        // cannot know. An authored value wins; this only fills a hole.
        if (!node.props.logoHref) node.props.logoHref = toHref(entry)
      }
      if (node.children) walk(node.children)
    }
  }
  walk(blocks)
  return blocks
}

// ============================================================
// MONTAJ (footer band)
// ============================================================

/** Id of the band the runner draws — also what makes the assembly idempotent. */
export const FOOTER_BAND_ID = 'pwapp-footer'

function findBlock(node: SurfaceBlockNode | SurfaceBlockNode[] | undefined, test: (n: SurfaceBlockNode) => boolean): SurfaceBlockNode | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findBlock(n, test)
      if (hit) return hit
    }
    return null
  }
  if (!node || typeof node !== 'object') return null
  if (test(node)) return node
  return findBlock(node.children, test)
}

/** The words a block id uses to say it is a footer (the packs' and generators', incl. Turkish `altbilgi`). */
const FOOTER_ID_WORDS = new Set(['footer', 'foot', 'altbilgi'])

function idWords(id: unknown): string[] {
  if (typeof id !== 'string') return []
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function holdsLink(node: SurfaceBlockNode): boolean {
  return findBlock(node, (n) => typeof n.props?.href === 'string') !== null
}

/**
 * Does the page already draw a footer of its own?
 *
 * By IDENTITY, not by content. No pack block carries a landmark role and the
 * contracts expose none, so a footer's identity is what the packs and
 * generators name it: a `footer` block, or a block whose id says footer
 * (`footer`, `site-footer`, `altbilgi`, `menu-foot` …). ONE exception: a
 * shell's own copyright strip — a `*-foot` child of the top-level shell, the
 * `{{FOOTER}}` slot of shell-topbar-flow — is not a footer band while it holds
 * no link. That strip is exactly where an undrawn declaration left a page with
 * nothing.
 */
function pageHasOwnFooter(blocks: SurfaceBlockNode[], shell: SurfaceBlockNode | undefined): boolean {
  const isFooter = (n: SurfaceBlockNode): boolean =>
    n.type === 'footer' || idWords(n.id).some((w) => FOOTER_ID_WORDS.has(w))
  const isCopyrightStrip = (n: SurfaceBlockNode): boolean => {
    const words = idWords(n.id)
    return (
      shell !== undefined &&
      (shell.children ?? []).includes(n) &&
      n.type !== 'footer' &&
      words.includes('foot') &&
      !words.includes('footer') &&
      !words.includes('altbilgi') &&
      !holdsLink(n)
    )
  }
  const walk = (nodes: readonly SurfaceBlockNode[] | undefined): boolean => {
    for (const n of nodes ?? []) {
      if (!n || typeof n !== 'object') continue
      // The strip and what it holds (`*-foot-div`, `*-foot-c`) are the shell's slot.
      if (isCopyrightStrip(n)) continue
      if (isFooter(n) || walk(n.children)) return true
    }
    return false
  }
  return walk(blocks)
}

/**
 * A footer link to another site opens in a new tab, like the `link` block's own
 * `external` rule.
 * An explicit `target` wins.
 */
function opensInNewTab(link: PwappFooterLink): boolean {
  if (link.target) return link.target === '_blank'
  return /^https?:\/\//i.test(link.href) || link.href.startsWith('//')
}

/**
 * `navigation.footer` is drawn as the page's FOOTER BAND.
 *
 * The declaration was accepted, stored and exported, and no runner drew it
 * (an address column and a social column declared, the page
 * ended on an empty copyright strip). The band is the first-party `footer`
 * pattern's composition, built from core blocks only — `section` > `grid` >
 * one `container` column per declared column, each a `heading` and its `link`s
 * (hrefs rewritten for the active router, like the navbar's).
 *
 * Where it goes: inside the top-level block whose children hold the page's
 * navbar (the shell), as its last child — or right before a trailing `section` (the shell's
 * copyright strip), so the columns sit above the copyright line. A page with
 * no navbar gets it as its last top-level block.
 *
 * Not drawn: on a page named in `excludeSurfaces`, when no column has a link,
 * or when the page already draws ANY footer of its own (see
 * `pageHasOwnFooter`) — its links may differ from the declaration, and two
 * footers is worse than the declared one missing. Mutates and returns `blocks`.
 */
export function assembleFooter(
  blocks: SurfaceBlockNode[],
  navigation: PwappNavigation | null | undefined,
  pageKey: string,
  entry: string,
  toHref: ToHref
): SurfaceBlockNode[] {
  const footer = navigation?.footer
  if (!footer || footer.excludeSurfaces?.includes(pageKey)) return blocks
  const columns = (footer.columns ?? [])
    .map((c) => ({
      heading: typeof c.heading === 'string' ? c.heading.trim() : '',
      links: rewriteHrefs(
        (c.links ?? []).filter((l) => typeof l?.label === 'string' && l.label !== '' && typeof l.href === 'string' && l.href !== ''),
        entry,
        toHref
      ),
    }))
    .filter((c) => c.links.length > 0)
  if (columns.length === 0) return blocks
  // The shell: a TOP-LEVEL block whose own children hold the navbar. A navbar
  // nested deeper sits in a header, and the band does not belong in a header.
  const shell = blocks.find((n) => Array.isArray(n?.children) && n.children.some((c) => c?.type === 'navbar'))
  // Our own band is `pwapp-footer` — a footer by the same rule, so this is
  // also what makes the assembly idempotent.
  if (pageHasOwnFooter(blocks, shell)) return blocks

  const band: SurfaceBlockNode = {
    id: FOOTER_BAND_ID,
    type: 'section',
    props: { paddingY: 40, gap: 18 },
    children: [
      {
        id: `${FOOTER_BAND_ID}-cols`,
        type: 'grid',
        props: { columns: Math.min(columns.length, 4), gap: 24 },
        children: columns.map((c, i) => ({
          id: `${FOOTER_BAND_ID}-c${i + 1}`,
          type: 'container',
          props: { direction: 'column', gap: 6, padding: 0 },
          children: [
            ...(c.heading
              ? [{ id: `${FOOTER_BAND_ID}-c${i + 1}t`, type: 'heading', props: { text: c.heading, level: 'h5' } }]
              : []),
            ...c.links.map((l, j) => ({
              id: `${FOOTER_BAND_ID}-c${i + 1}l${j + 1}`,
              type: 'link',
              props: {
                text: l.label,
                href: l.href,
                color: 'var(--pw-color-text-muted)',
                ...(opensInNewTab(l) ? { external: true } : {}),
              },
            })),
          ],
        })),
      },
    ],
  }

  const host = shell?.children ?? blocks
  const last = host[host.length - 1]
  const beforeStrip = host !== blocks && host.length > 1 && last?.type === 'section'
  host.splice(beforeStrip ? host.length - 1 : host.length, 0, band)
  return blocks
}

// ============================================================
// RECEIPT FILE MAP (ideal + legacy project.json)
// ============================================================

/**
 * Ideal `project.json` ships `surfaceReceiptFiles` (key → file). Legacy
 * envelopes omit it — fall back to the naming convention
 * `surfaces/<key>.receipt.json` for every key in `surfaceOrder`.
 */
export function receiptFilesOf(project: PwappProject): Readonly<Record<string, string>> {
  if (project.surfaceReceiptFiles) return project.surfaceReceiptFiles
  return Object.fromEntries(project.surfaceOrder.map((key) => [key, `surfaces/${key}.receipt.json`]))
}

// ============================================================
// DOCUMENT TITLE
// ============================================================

/**
 * Page title composition — avoids duplicating the project title when the
 * receipt's own title already starts with it (demo-runner semantics).
 */
export function composeTitle(projectTitle: string | undefined, receiptTitle: string | undefined): string | undefined {
  if (!receiptTitle) return projectTitle
  if (!projectTitle) return receiptTitle
  return receiptTitle.startsWith(projectTitle) ? receiptTitle : `${projectTitle} — ${receiptTitle}`
}

// ============================================================
// FETCH
// ============================================================

/**
 * Fetch + parse JSON; throws with the URL and status on any non-OK response.
 *
 * `token` carries the app session to the session server, which refuses a
 * receipt without one when the app declares sign-in. A header, not a cookie:
 * the runner fetches receipts with `fetch()` so it can send one, while the
 * browser fetching `<script src>` cannot — which is exactly why the server
 * gates the receipts and leaves the shell and runtime open.
 */
/**
 * The credential a receipt request carries — ONE, in the header its door
 * reads it from.
 *
 * A platform session travels as `x-app-session`; an issuer's door token is an
 * OAuth access token and travels as a bearer, which is what the gateway and
 * the API both accept. When both exist the platform session wins: it is the
 * door this deployment issued and can revoke.
 */
export function doorHeaders(credential: {
  readonly appSession: string | undefined
  readonly doorToken: string | undefined
}): Record<string, string> {
  if (credential.appSession) return { 'x-app-session': credential.appSession }
  if (credential.doorToken) return { authorization: `Bearer ${credential.doorToken}` }
  return {}
}

/**
 * `url` with `v=<version>` appended to its query (`?` or `&`), or `url`
 * unchanged when there is no version. A fragment stays last.
 *
 * WHY. A host that republishes an app serves the new envelope under the same
 * names; with a short cache on them a browser can read the old `project.json`
 * beside the new `auth.json` and draw nothing. A version the host puts on
 * every envelope address makes each publish a distinct set of URLs, so one
 * page load reads one publish.
 */
export function withVersion(url: string, version: string | number | undefined): string {
  if (version === undefined || version === '') return url
  const hashAt = url.indexOf('#')
  const base = hashAt === -1 ? url : url.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : url.slice(hashAt)
  return `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(String(version))}${hash}`
}

export async function fetchJson<T>(url: string, headers?: Record<string, string> | undefined): Promise<T> {
  const res = await fetch(url, headers && Object.keys(headers).length > 0 ? { headers } : undefined)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return (await res.json()) as T
}

// ============================================================
// URL STATE — the address seeds page state
// ============================================================

/**
 * Query keys that are never page state, whatever the page reads: the OAuth /
 * IdP redirect vocabulary (a sign-in callback lands on the app with `code`,
 * `state`, `error`, `iss`, `session_state` …) and the runner's own
 * `returnTo` / `auth_error`. Seeding them would let an IdP redirect — or
 * anyone crafting a link — write into state a page trusts.
 */
export const RESERVED_QUERY_KEYS: ReadonlySet<string> = new Set([
  'auth_error',
  'code',
  'state',
  'error',
  'error_description',
  'error_uri',
  'session_state',
  'iss',
  'returnTo',
])

/** A seeded value is cut here — an address is not a place to carry a document. */
export const MAX_SEED_LENGTH = 512

const STATE_READ = /state\.([A-Za-z_][\w-]*)/g
const WHOLE_EXPRESSION = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/

const isCapabilityNamed = (entry: { capability?: string } | undefined, short: string): boolean => {
  const c = typeof entry?.capability === 'string' ? entry.capability.trim() : ''
  return c === short || c === `platform/${short}`
}

function persistenceConfigOf(receipt: SurfaceReceipt): Record<string, unknown> | undefined {
  return receipt.capabilities?.find((c) => isCapabilityNamed(c, 'persistence'))?.config
}

/**
 * Every `state.<key>` the page reads — anywhere in the receipt text. The same
 * scan the authoring data-binding gate uses (`unwrittenStateReads`), so what
 * the gate calls "read" and what the runner lets the address seed agree.
 */
export function stateKeysRead(receipt: SurfaceReceipt): Set<string> {
  const text = JSON.stringify(receipt ?? {})
  return new Set([...text.matchAll(STATE_READ)].map((m) => m[1] as string))
}

/** The scheme/host part of an endpoint: `https://{{…}}` in `https://{{…}}/x`, `{{…}}` in `{{…}}/x`. */
function authorityPart(endpoint: string): string {
  const abs = /^([a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i.exec(endpoint)
  if (abs) return abs[0]
  const cut = endpoint.search(/[/?#]/)
  return cut === -1 ? endpoint : endpoint.slice(0, cut)
}

/**
 * Keys the page reads that the address must NOT seed (plan decision 3):
 *  - split-view selection keys (default `sec`) — the block owns that query key;
 *  - formBinding statusKeys — a success/error banner must not be faked by a link;
 *  - keys read in a single-expression REST endpoint (`"{{state.url}}"`, placed
 *    unencoded) or in an endpoint's scheme/host part — encoding does not
 *    protect a host.
 */
export function unseedableStateKeys(receipt: SurfaceReceipt): Set<string> {
  const out = new Set<string>()
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as { type?: unknown; props?: Record<string, unknown>; children?: unknown }
    const sel = n.props?.selectionKey
    if (typeof sel === 'string' && sel) out.add(sel)
    else if (typeof n.type === 'string' && /(^|\/)split-view$/.test(n.type)) out.add('sec')
    walk(n.children)
  }
  walk(receipt.blocks)

  const entities = receipt.capabilities?.find((c) => isCapabilityNamed(c, 'entities'))?.config
  for (const fb of (entities?.formBindings as { statusKeys?: Record<string, unknown> }[] | undefined) ?? []) {
    for (const v of Object.values(fb?.statusKeys ?? {})) if (typeof v === 'string' && v) out.add(v)
  }

  const sources = (persistenceConfigOf(receipt)?.dataSources as { kind?: string; endpoint?: unknown }[] | undefined) ?? []
  for (const s of sources) {
    if (s?.kind !== 'rest' || typeof s.endpoint !== 'string' || !s.endpoint.includes('{{')) continue
    const risky = WHOLE_EXPRESSION.test(s.endpoint) ? s.endpoint : authorityPart(s.endpoint)
    for (const m of risky.matchAll(STATE_READ)) out.add(m[1] as string)
  }
  return out
}

/**
 * What the address seeds on this page: `{ key: rawString }` for every key the
 * page READS (allow-list), minus reserved, `__`-prefixed, prototype and
 * unseedable keys. Values stay strings (`"12"`), the first of a repeated key
 * wins, cut at MAX_SEED_LENGTH, and a value that is exactly `.` or `..` becomes
 * `''`. An unread parameter (`utm_source`) seeds nothing.
 */
export function queryStateSeed(receipt: SurfaceReceipt, params: URLSearchParams): Record<string, string> {
  const blocked = unseedableStateKeys(receipt)
  const seed: Record<string, string> = {}
  for (const key of stateKeysRead(receipt)) {
    if (RESERVED_QUERY_KEYS.has(key) || blocked.has(key)) continue
    if (key.startsWith('__') || key === 'constructor' || key === 'prototype') continue
    const raw = params.get(key)
    if (raw === null) continue
    const value = raw.slice(0, MAX_SEED_LENGTH)
    seed[key] = value === '.' || value === '..' ? '' : value
  }
  return seed
}

/**
 * The receipt with the address's seed merged into its `platform/persistence`
 * `initialState` — the one seed path the renderer has (plan decision 2). The
 * receipt's own `initialState` is the base; the address writes over it. A
 * receipt without the capability gets one. Non-mutating; returns the receipt
 * itself when there is nothing to seed.
 */
export function seedStateFromQuery<T extends SurfaceReceipt>(receipt: T, params: URLSearchParams): T {
  const seed = queryStateSeed(receipt, params)
  if (Object.keys(seed).length === 0) return receipt
  const caps = [...(receipt.capabilities ?? [])]
  const at = caps.findIndex((c) => isCapabilityNamed(c, 'persistence'))
  if (at >= 0) {
    const cap = caps[at]!
    const cfg = cap.config ?? {}
    const base = (cfg.initialState as Record<string, unknown> | undefined) ?? {}
    caps[at] = { ...cap, config: { ...cfg, initialState: { ...base, ...seed } } }
  } else {
    caps.push({ capability: 'platform/persistence', config: { initialState: seed } })
  }
  return { ...receipt, capabilities: caps }
}
