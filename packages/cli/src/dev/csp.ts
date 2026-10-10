/**
 * The app's Content Security Policy, derived from what the app declares.
 *
 * A pwapp is static files; what it may load and reach is known at build time
 * from its own declarations, so `pwf build` writes a policy that allows that
 * and nothing else (pwapp-format §2.1):
 *
 *   default-src  'none'
 *   script-src   'self' blob: 'sha256-<import map>'
 *                Blocks and compiled engines are verified and then imported
 *                from `blob:` URLs. The import map is the shell's only inline
 *                script (an import map cannot be an external file), so its
 *                hash is listed; the renderer seeding and the boot call are
 *                files (`assets/seed.js`, `assets/boot.js`).
 *   style-src    'self' 'unsafe-inline' [+ the webfont stylesheet origin]
 *                The renderer draws `<style>` elements at run time (the
 *                surface base, visibility, state, responsive and dark-theme
 *                rules, computed per page), and blocks set `style`
 *                attributes. Neither can be hashed ahead of time.
 *   img-src      'self' data: blob: [+ media origins]
 *   media-src    'self' data: blob: [+ media origins]
 *   frame-src    [media origins] — only when there are any
 *   font-src     'self' [+ the webfont file origin]
 *   connect-src  'self' [+ every origin the app's data and sign-in reach]
 *   base-uri     'self'  — a host that serves the app under a sub-path
 *                injects `<base href>` (pwapp-format §2); 'none' would make
 *                the browser ignore it and break path routing.
 *   object-src   'none'
 *   frame-ancestors 'none'  — header only: browsers ignore it in a `<meta>`.
 *
 * Origins come from: absolute `rest` endpoints in the receipts; declared
 * engines' `host` templates filled from `connections.json` config;
 * the envelope `auth.json` addresses and an external issuer; `publish.json`
 * media and absolute media URLs in receipt props. A template that cannot be
 * resolved at build time, and a compiled engine (whose code may reach any
 * origin), is listed in `unresolved` instead of being guessed.
 *
 * @module @pwfabric/cli/dev/csp
 */
import { createHash } from 'node:crypto'
import { isRecord } from './sources.js'

/** Directive name → its sources, in the order they are written. */
export type CspDirectives = Record<string, string[]>

/** Something the policy could not resolve at build time. */
export interface CspUnresolved {
  /** What declared it: `connection:<name>`, `engine:<atomId>`, `page:<key>`, `auth`. */
  readonly source: string
  /** The template or address as written. */
  readonly value: string
  readonly reason: string
}

export interface AppCsp {
  readonly directives: CspDirectives
  /** The policy as a header value (every directive). */
  readonly header: string
  /** The policy for a `<meta http-equiv>` (without the directives a meta cannot carry). */
  readonly meta: string
  readonly unresolved: readonly CspUnresolved[]
}

export interface CspInputs {
  /** The exact text of the shell's inline import map. */
  readonly importMapText: string
  /** Served receipts by page key (after media slots are filled). */
  readonly receipts: ReadonlyMap<string, unknown>
  /** `pwpack/connections.json`. */
  readonly connections?: { readonly connections: readonly Record<string, unknown>[] } | undefined
  /** `engines/manifest.json` entries. */
  readonly engines: readonly { readonly connection: string; readonly atomId: string; readonly moduleUrl?: string; readonly engine?: unknown }[]
  /** The envelope `auth.json`, when the build has one. */
  readonly envelopeAuth?: unknown
  /** `app/definitions/auth.json` (the declaration). */
  readonly authDefinition?: unknown
  /** `publish.json` `media[]`. */
  readonly media: readonly { readonly url: string }[]
  /** The webfont stylesheet the shell links, when any. */
  readonly webfontHref?: string | null
}

/** Directives a `<meta http-equiv="Content-Security-Policy">` cannot carry (CSP3 §3.3). */
const HEADER_ONLY = new Set(['frame-ancestors', 'report-uri', 'report-to', 'sandbox'])

/** The CSP source for an inline script: `'sha256-<base64>'` of its exact text. */
export function scriptHash(text: string): string {
  return `'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`
}

const LOOPBACK = /^(?:localhost|127\.0\.0\.1|\[::1\]|[^/:]+\.localhost)(?::\d+)?$/i

/**
 * The origin of an absolute http(s) URL, or null. Expressions (`{{…}}`) or
 * templates (`{…}`) in the scheme or host make it unresolvable (`undefined`).
 */
export function originOf(value: string): string | null | undefined {
  const m = /^(https?):\/\/([^/?#]*)/i.exec(value.trim())
  if (!m) return null
  const host = m[2] as string
  if (!host || /[{}]/.test(host)) return undefined
  try {
    return new URL(`${(m[1] as string).toLowerCase()}://${host}`).origin
  } catch {
    return undefined
  }
}

/**
 * The origin a declared engine's `host` reaches (connector-manifest §3.1):
 * `{name}` filled from the connection's string config, the scheme dropped and
 * `https://` prepended, except an explicit `http://` on a loopback host.
 * `undefined` when a placeholder stays unfilled.
 */
export function engineHostOrigin(host: string, config: Record<string, unknown> | undefined): string | undefined {
  const filled = host.replace(/\{([A-Za-z0-9_.-]+)\}/g, (whole, name: string) => {
    const v = config?.[name]
    return typeof v === 'string' ? v : whole
  })
  if (/[{}]/.test(filled)) return undefined
  const explicitHttp = /^http:\/\//i.test(filled.trim())
  const bare = filled.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const hostPart = bare.split(/[/?#]/)[0] ?? ''
  if (!hostPart) return undefined
  const scheme = explicitHttp && LOOPBACK.test(hostPart) ? 'http' : 'https'
  try {
    return new URL(`${scheme}://${hostPart}`).origin
  } catch {
    return undefined
  }
}

/** A prop that names where a link goes (navigation is not governed by CSP). */
const LINK_PROP = /^(?:href|to|link|url|.*Href|.*Link)$/

/** Every absolute URL a receipt's block props carry, except links. */
function mediaUrlsOf(blocks: unknown, out: string[]): void {
  if (!Array.isArray(blocks)) return
  for (const block of blocks) {
    if (!isRecord(block)) continue
    const props = block['props']
    if (isRecord(props)) collectUrls(props, out)
    mediaUrlsOf(block['children'], out)
  }
}

function collectUrls(value: Record<string, unknown> | unknown[], out: string[]): void {
  const entries: [string, unknown][] = Array.isArray(value) ? value.map((v, i) => [String(i), v]) : Object.entries(value)
  for (const [key, v] of entries) {
    if (typeof v === 'string') {
      if (!LINK_PROP.test(key) && /^https?:\/\//i.test(v.trim())) out.push(v.trim())
    } else if (Array.isArray(v) || isRecord(v)) {
      collectUrls(v, out)
    }
  }
}

/** `rest` data sources of a receipt's persistence capability. */
function restEndpointsOf(receipt: unknown): string[] {
  if (!isRecord(receipt) || !Array.isArray(receipt['capabilities'])) return []
  const out: string[] = []
  for (const cap of receipt['capabilities']) {
    if (!isRecord(cap) || !isRecord(cap['config'])) continue
    const sources = cap['config']['dataSources']
    if (!Array.isArray(sources)) continue
    for (const s of sources) {
      if (isRecord(s) && s['kind'] === 'rest' && typeof s['endpoint'] === 'string') out.push(s['endpoint'])
    }
  }
  return out
}

const AUTH_ADDRESS_KEYS = ['loginUrl', 'registerUrl', 'logoutUrl', 'sessionUrl', 'tokenUrl', 'issuer', 'startUrl', 'gatewaySessionUrl', 'gatewayLogoutUrl']

/** Writes the directives as a policy string. */
export function serializeCsp(directives: CspDirectives, options: { meta?: boolean } = {}): string {
  return Object.entries(directives)
    .filter(([name, values]) => values.length > 0 && !(options.meta && HEADER_ONLY.has(name)))
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ')
}

/** Derives the app's policy from what it declares. */
export function deriveCsp(input: CspInputs): AppCsp {
  const unresolved: CspUnresolved[] = []
  const connect = new Set<string>()
  const media = new Set<string>()
  const style = new Set<string>()
  const font = new Set<string>()

  const addConnect = (value: string, source: string): void => {
    const o = originOf(value)
    if (o === undefined) unresolved.push({ source, value, reason: 'the address is a template or expression; its origin is known only at run time' })
    else if (o) connect.add(o)
  }

  // Data: absolute `rest` endpoints in the receipts. Relative ones are 'self'.
  for (const [key, receipt] of input.receipts) {
    for (const endpoint of restEndpointsOf(receipt)) addConnect(endpoint, `page:${key}`)
    const urls: string[] = []
    if (isRecord(receipt)) mediaUrlsOf(receipt['blocks'], urls)
    for (const url of urls) {
      const o = originOf(url)
      if (o) media.add(o)
      else if (o === undefined) unresolved.push({ source: `page:${key}`, value: url, reason: 'a media address with an expression in its origin' })
    }
  }

  // Connections: declared engines resolve their host; compiled ones cannot be read.
  const configOf = new Map<string, Record<string, unknown>>()
  for (const c of input.connections?.connections ?? []) {
    if (typeof c['name'] === 'string') configOf.set(c['name'], isRecord(c['config']) ? c['config'] : {})
  }
  for (const e of input.engines) {
    const host = isRecord(e.engine) && typeof e.engine['host'] === 'string' ? e.engine['host'] : undefined
    if (host !== undefined) {
      const o = engineHostOrigin(host, configOf.get(e.connection))
      if (o) connect.add(o)
      else unresolved.push({ source: `connection:${e.connection}`, value: host, reason: 'the engine host names config the connection does not provide' })
    } else if (e.moduleUrl) {
      unresolved.push({
        source: `engine:${e.atomId}`,
        value: e.moduleUrl,
        reason: `compiled engine for connection "${e.connection}"; the origins its code reaches are not declared`,
      })
    }
  }

  // Sign-in: the envelope's addresses, and an external issuer's.
  if (isRecord(input.envelopeAuth)) {
    for (const k of AUTH_ADDRESS_KEYS) {
      const v = input.envelopeAuth[k]
      if (typeof v === 'string') addConnect(v, 'auth')
    }
  }
  const issuer = isRecord(input.authDefinition) && isRecord(input.authDefinition['issuer']) ? input.authDefinition['issuer'] : undefined
  if (issuer) {
    for (const k of ['issuer', 'tokenUrl']) {
      const v = issuer[k]
      if (typeof v === 'string') addConnect(v, 'auth')
    }
    if (typeof issuer['tokenUrl'] !== 'string' && typeof issuer['issuer'] === 'string') {
      unresolved.push({
        source: 'auth',
        value: issuer['issuer'],
        reason: "the token endpoint is discovered at run time; the policy allows the issuer's own origin only",
      })
    }
  }

  // Media the app declares.
  for (const m of input.media) {
    const o = originOf(m.url)
    if (o) media.add(o)
  }

  // Webfonts: the stylesheet and the files it points at.
  if (input.webfontHref) {
    const o = originOf(input.webfontHref)
    if (o) style.add(o)
    if (o === 'https://fonts.googleapis.com') font.add('https://fonts.gstatic.com')
  }

  const sorted = (s: Set<string>): string[] => [...s].sort()
  const directives: CspDirectives = {
    'default-src': ["'none'"],
    'script-src': ["'self'", 'blob:', scriptHash(input.importMapText)],
    'style-src': ["'self'", "'unsafe-inline'", ...sorted(style)],
    'img-src': ["'self'", 'data:', 'blob:', ...sorted(media)],
    'media-src': ["'self'", 'data:', 'blob:', ...sorted(media)],
    ...(media.size > 0 ? { 'frame-src': sorted(media) } : {}),
    'font-src': ["'self'", ...sorted(font)],
    'connect-src': ["'self'", ...sorted(connect)],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
  }
  return {
    directives,
    header: serializeCsp(directives),
    meta: serializeCsp(directives, { meta: true }),
    unresolved,
  }
}

/** The static-host `_headers` file (`/*` and the policy). */
export function headersFile(policy: string): string {
  return `/*\n  Content-Security-Policy: ${policy}\n`
}
