/**
 * The app's Content Security Policy, derived from what the app declares.
 *
 * A pwapp is static files; what it may load and reach is known at build time
 * from its own declarations, so `pwf build` writes a policy that allows that
 * and nothing else (pwapp-format §2.1):
 *
 *   default-src  'none'
 *   script-src   'self' blob: 'sha256-<import map>' [+ script origins]
 *                Blocks and compiled engines are verified and then imported
 *                from `blob:` URLs. The import map is the shell's only inline
 *                script (an import map cannot be an external file), so its
 *                hash is listed; the boot call is a file (`assets/boot.<hash>.js`),
 *                and the runner adds the renderer as one. The app's own
 *                third-party scripts (`plan.json` `scripts`) and the scripts a
 *                placed block declares (`definition.origins.script`) add their
 *                exact origins — never a wildcard.
 *   style-src    'self' 'unsafe-inline'
 *                The renderer draws `<style>` elements at run time (the
 *                surface base, visibility, state, responsive and dark-theme
 *                rules, computed per page), and blocks set `style`
 *                attributes. Neither can be hashed ahead of time.
 *   img-src      'self' data: blob: [+ media origins, the app icon's origin]
 *   media-src    'self' data: blob: [+ media origins]
 *   frame-src    [media origins + declared frame origins] — only when there are any;
 *                'self' when a page frames a document of the app's OWN media
 *                (a block prop holding `pwpack/media/<file>.pdf|.txt`),
 *                so a receipt or a report can be shown in place
 *   font-src     'self' — fonts are the app's own files (appearance §3.3)
 *   connect-src  'self' [+ every origin the app's data and sign-in reach]
 *   base-uri     'self'  — a host that serves the app under a sub-path
 *                injects `<base href>` (pwapp-format §2); 'none' would make
 *                the browser ignore it and break path routing.
 *   object-src   'none'
 *   frame-ancestors 'none'  — header only: browsers ignore it in a `<meta>`.
 *                The app's OWN MEDIA (`/pwpack/media/*`) is served with
 *                `'self'` instead (`mediaHeader`): a page of the app frames
 *                its own PDF in place, and nothing else may frame it. Under
 *                `'none'` everywhere the app's own embed was a blank box.
 *
 * Origins come from: absolute `rest` endpoints in the receipts; declared
 * engines' `host` templates filled from `connections.json` config;
 * the envelope `auth.json` addresses and an external issuer; `publish.json`
 * media and absolute media URLs in receipt props; and the `definition.origins`
 * of every block type a page places (block-manifest), each added to the
 * directive it names — the addresses a block's own code builds, which no
 * prop carries. A template that cannot be
 * resolved at build time, and a compiled engine (whose code may reach any
 * origin), is listed in `unresolved` instead of being guessed.
 *
 * @module @pwfabric/cli/dev/csp
 */
import { createHash } from 'node:crypto'
import type { BlockOrigins } from '@pwfabric/contracts'
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
  /** The policy the app's own media is served with: `header` with `frame-ancestors 'self'`. */
  readonly mediaHeader: string
  /** The policy for a `<meta http-equiv>` (without the directives a meta cannot carry). */
  readonly meta: string
  readonly unresolved: readonly CspUnresolved[]
}

export interface CspInputs {
  /** The exact text of the shell's inline import map. */
  readonly importMapText: string
  /** The shell's other inline scripts (the first-paint script), allowed by hash. */
  readonly inlineScripts?: readonly string[]
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
  /** The block types the pages place, with their manifest's validated `definition.origins`. */
  readonly blocks?: readonly { readonly atomId: string; readonly origins?: BlockOrigins }[]
  /**
   * The app's own scripts (`plan.json` `scripts`, checked by plan-site.ts):
   * each one's declared origins by directive — where it loads from (`script`)
   * and what it reaches.
   */
  readonly scripts?: readonly { readonly origins: BlockOrigins }[]
  /** The app's icon as the documents link it (`appearance` `brand.favicon`): an absolute address adds its origin to img-src. */
  readonly favicon?: string
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

/**
 * A document of the app's own media that a frame can show: `pwpack/media/…`
 * (as a block's `src` is written, `./` or `/` before it naming the same file)
 * ending in a document type a frame shows inertly: `.pdf` or `.txt`. An
 * image, a sound or a video is not framed — it has its own element and
 * directive. An `.html` file is not either: same-origin HTML in a frame runs
 * with the app's origin (an XSS door), and packs refuse to frame it, so the
 * policy does not open `frame-src 'self'` for one.
 */
const OWN_FRAMED_DOCUMENT = /^(?:\.?\/)?pwpack\/media\/(?!.*\.\.)[^?#]+\.(?:pdf|txt)(?:[?#].*)?$/i

/** Whether any non-link prop of the receipt's blocks holds a document of the app's own media. */
function framesOwnMedia(blocks: unknown): boolean {
  if (!Array.isArray(blocks)) return false
  const inValue = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(inValue)
    if (!isRecord(value)) return false
    return Object.entries(value).some(([key, v]) =>
      typeof v === 'string' ? !LINK_PROP.test(key) && OWN_FRAMED_DOCUMENT.test(v.trim()) : inValue(v)
    )
  }
  return blocks.some((block) => isRecord(block) && (inValue(block['props']) || framesOwnMedia(block['children'])))
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

const AUTH_ADDRESS_KEYS = ['loginUrl', 'registerUrl', 'logoutUrl', 'sessionUrl', 'tokenUrl', 'issuer', 'startUrl', 'gatewaySessionUrl', 'gatewayLogoutUrl', 'apiBase']

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
  const img = new Set<string>()
  const mediaOnly = new Set<string>()
  const frame = new Set<string>()
  const script = new Set<string>()
  let ownFrames = false

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
    if (isRecord(receipt) && framesOwnMedia(receipt['blocks'])) ownFrames = true
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

  // Placed blocks: what their own code reaches, by the directive it names.
  // There is no font directive: a font is never another origin's.
  const byDirective: Record<string, Set<string>> = { connect, frame, img, media: mediaOnly, style, script }
  // The app's own scripts, the same way: where each loads from, and what it reaches.
  for (const declared of [...(input.blocks ?? []), ...(input.scripts ?? [])]) {
    for (const [directive, origins] of Object.entries(declared.origins ?? {})) {
      for (const o of origins ?? []) byDirective[directive]?.add(o)
    }
  }

  // The app's icon, when it is another origin's.
  if (input.favicon) {
    const o = originOf(input.favicon)
    if (o) img.add(o)
  }

  const sorted = (...sets: Set<string>[]): string[] => [...new Set(sets.flatMap((s) => [...s]))].sort()
  const frames = [...(ownFrames ? ["'self'"] : []), ...sorted(media, frame)]
  const directives: CspDirectives = {
    'default-src': ["'none'"],
    'script-src': ["'self'", 'blob:', scriptHash(input.importMapText), ...(input.inlineScripts ?? []).map(scriptHash), ...sorted(script)],
    'style-src': ["'self'", "'unsafe-inline'", ...sorted(style)],
    'img-src': ["'self'", 'data:', 'blob:', ...sorted(media, img)],
    'media-src': ["'self'", 'data:', 'blob:', ...sorted(media, mediaOnly)],
    ...(frames.length > 0 ? { 'frame-src': frames } : {}),
    'font-src': ["'self'"],
    'connect-src': ["'self'", ...sorted(connect)],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
  }
  return {
    directives,
    header: serializeCsp(directives),
    mediaHeader: serializeCsp({ ...directives, 'frame-ancestors': ["'self'"] }),
    meta: serializeCsp(directives, { meta: true }),
    unresolved,
  }
}

/** What a content-hashed file is served with: its name changes when its bytes do. */
export const IMMUTABLE = 'public, max-age=31536000, immutable'
/** What a file whose name never changes is served with: always asked again (a 304 when unchanged). */
export const REVALIDATE = 'no-cache'
/** The app's own media: names are kept across publishes, so an hour, then asked again. */
export const MEDIA = 'public, max-age=3600'

/**
 * The static-host `_headers` file: the policy on every path — the app's own
 * media with its own policy (`mediaPolicy`, `frame-ancestors 'self'`), the
 * page's taken back first so a host sends one — then how long each part of
 * the folder may be kept (pwapp-format §2.1, §2.2).
 *
 * A host applies EVERY rule that matches a path and joins a header two rules
 * set, so the caching rules match disjoint paths: the documents (the shell,
 * and under path routing each page's and `404.html`), the hashed
 * runtime files (`assets/`), the hashed block and engine modules, and the
 * files under fixed names — the shims, the two manifests, the envelope —
 * which are revalidated. Media comes last and replaces the envelope's rule
 * (`! Cache-Control`), since it lives under `pwpack/` too. The app's own
 * rules (`extra`, from `plan.json` `headers`) follow; they cannot set the
 * policy, and take back nothing the build set.
 */
export function headersFile(
  policy: string,
  mediaPolicy: string,
  documents: readonly string[] = [],
  extra: readonly { readonly path: string; readonly headers: readonly (readonly [string, string])[] }[] = []
): string {
  const rule = (path: string, ...lines: string[]): string => `${path}\n${lines.map((l) => `  ${l}\n`).join('')}`
  // A page's document is served at its folder (`/pricing/`) and as the file.
  const pages = documents
    .filter((f) => f !== 'index.html')
    .flatMap((f) => (f.endsWith('/index.html') ? [`/${f.slice(0, -'index.html'.length)}`, `/${f}`] : [`/${f}`]))
  return [
    rule('/*', `Content-Security-Policy: ${policy}`),
    rule('/pwpack/media/*', '! Content-Security-Policy', `Content-Security-Policy: ${mediaPolicy}`),
    rule('/', `Cache-Control: ${REVALIDATE}`),
    rule('/index.html', `Cache-Control: ${REVALIDATE}`),
    ...pages.map((p) => rule(p, `Cache-Control: ${REVALIDATE}`)),
    rule('/assets/*', `Cache-Control: ${IMMUTABLE}`),
    rule('/blocks/*.mjs', `Cache-Control: ${IMMUTABLE}`),
    rule('/engines/*.mjs', `Cache-Control: ${IMMUTABLE}`),
    rule('/blocks/manifest.json', `Cache-Control: ${REVALIDATE}`),
    rule('/engines/manifest.json', `Cache-Control: ${REVALIDATE}`),
    rule('/shims/*', `Cache-Control: ${REVALIDATE}`),
    rule('/pwpack/*', `Cache-Control: ${REVALIDATE}`),
    rule('/pwpack/media/*', '! Cache-Control', `Cache-Control: ${MEDIA}`),
    // The app's own (`plan.json` `headers`), last. They add headers; none of
    // them is the policy (plan-site.ts refuses it), so the policy stays the build's.
    ...extra.map((r) => rule(r.path, ...r.headers.map(([name, value]) => `${name}: ${value}`))),
  ].join('')
}
