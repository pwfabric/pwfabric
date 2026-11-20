/**
 * `--cors <origin>` for `pwf run` and `pwf dev`: which other origins may read
 * what the local server answers, and the preflights it answers for them.
 *
 * WITHOUT `--cors` NOTHING HERE RUNS: no `Access-Control-*` header is sent and
 * an `OPTIONS` request is answered as before (405). With it, a request whose
 * `Origin` is exactly one of the named origins is let in; any other origin —
 * and a request with no `Origin` — is answered as if `--cors` were not given.
 *
 * Two kinds of address, two answers:
 *
 *  - THE APP'S FILES (shell, blocks, engines, manifest, receipts, media):
 *    `Access-Control-Allow-Origin: <that origin>`, and a preflight for `GET`
 *    and `HEAD` only.
 *  - THE RECORD HOST (every address under its prefix, `/_host`): the same
 *    header, and a preflight for the methods and headers the host reads.
 *
 * WHY THE RECORD HOST MAY BE OPENED THIS FAR, AND NO FURTHER. The host is
 * development-only and trusting by design (../host/local-host.ts): `/login`
 * and `/register` mint a token for whoever asks and return it in the body,
 * and any token reads (under `pwf dev`, writes) the app's records. That is why
 * it never answers another origin by default, and why:
 *
 *  1. No wildcard, ever. `*` would let every page the developer visits sign
 *     in and read the records; `null` is the origin of sandboxed frames and
 *     `file:` pages, which could be anyone's. Only an origin the developer
 *     names on the command line is answered, and it can do exactly what a
 *     page on the server's own origin can — which is what naming it asks for.
 *  2. Never `Access-Control-Allow-Credentials`. Without it the browser lets a
 *     cross-origin page read an answer only to a request sent WITHOUT cookies
 *     (and refuses the preflight of a credentialed one, so that request is
 *     never sent). The host's cookie (`pwf_dev_session`, HttpOnly, the
 *     provider round trip's) therefore never reaches it from another origin:
 *     `/_auth/session` answers such a page `{ signedIn: false }` and
 *     `/_auth/logout` has nothing to delete, and a `Set-Cookie` on a
 *     non-credentialed answer is dropped by the browser. A listed origin's
 *     page signs in the way a token door works — with the token it holds and
 *     sends itself (`x-app-session` / `Authorization`).
 *  3. The `x-pwapp-request: 1` check stays where it is. It makes the cookie
 *     addresses unreachable by a plain form post or script tag (requests a
 *     browser sends without asking); allowing the header in a preflight only
 *     lets a listed origin send it on a request that, by 2., carries no
 *     cookie.
 *
 * Every answer under `--cors` says `Vary: Origin`: the same address answers
 * different origins differently, and a cache must not hand one's to another.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

/** The origins `--cors` names, as a browser writes them in `Origin`. */
export type CorsOrigins = ReadonlySet<string>

/** Which answer an address gets: the app's files, or the record host's. */
export type CorsKind = 'files' | 'host'

/** Thrown for a `--cors` value that is not one exact origin. */
export class CorsOriginError extends Error {}

/**
 * One `--cors` value as the origin a browser sends: `scheme://host[:port]`,
 * scheme and host in lower case, the default port of http and https left out
 * (a browser never writes it). Refuses `*`, `null`, and anything with a path,
 * query, fragment or user name.
 */
export function parseCorsOrigin(value: string): string {
  const v = value.trim()
  if (v === '*') {
    throw new CorsOriginError(
      '--cors takes an exact origin, not "*": any page could then sign in to the local host and read its records. Name each origin, e.g. --cors http://localhost:3000'
    )
  }
  if (v.toLowerCase() === 'null') {
    throw new CorsOriginError(
      '--cors does not take "null": that origin is sent by sandboxed frames and local files, which could be any page. Serve the page from an origin and name that'
    )
  }
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):\/\/([^/?#\s]*)([\s\S]*)$/.exec(v)
  if (!m) throw new CorsOriginError(`--cors "${value}" is not an origin; write it as scheme://host[:port], e.g. http://localhost:3000`)
  const scheme = (m[1] as string).toLowerCase()
  const authority = m[2] as string
  const rest = m[3] as string
  if (rest !== '') {
    throw new CorsOriginError(
      `--cors "${value}" has a path, query or fragment; an origin is scheme://host[:port] only (${scheme}://${authority})`
    )
  }
  if (authority === '' || authority.includes('@')) {
    throw new CorsOriginError(`--cors "${value}" is not an origin; write it as scheme://host[:port], e.g. http://localhost:3000`)
  }
  if (scheme !== 'http' && scheme !== 'https') return `${scheme}://${authority.toLowerCase()}`
  let url: URL
  try {
    url = new URL(`${scheme}://${authority}`)
  } catch {
    throw new CorsOriginError(`--cors "${value}" is not an origin: its host or port is malformed`)
  }
  return url.origin
}

/** Every `--cors` value, parsed; an empty set when none was given. */
export function corsOriginsOf(values: readonly string[]): CorsOrigins {
  return new Set(values.map(parseCorsOrigin))
}

/** The request's `Origin` when it is exactly one of `origins`, else undefined. */
export function listedOrigin(req: IncomingMessage, origins: CorsOrigins): string | undefined {
  const origin = req.headers.origin
  return typeof origin === 'string' && origins.has(origin) ? origin : undefined
}

/** The methods a preflight grants, per kind: the files are read only; the host takes what its routes take. */
const METHODS: Readonly<Record<CorsKind, string>> = {
  files: 'GET, HEAD',
  // The routes of ../host/local-host.ts: reads, sign-in/out and record
  // creation (POST), record edits (PATCH) and deletion (DELETE).
  host: 'GET, POST, PATCH, DELETE',
}

/**
 * The request headers a preflight may grant, per kind. A preflight grants
 * the headers it is asked for that are on this list and no others.
 *
 *  - files: a file is the same bytes whatever comes with the request and is
 *    never behind a credential, so the only headers a page has reason to add
 *    are cache and range requests. A credential header is not granted: no
 *    file needs one, and saying otherwise would invite a page to send a
 *    visitor's token where nothing reads it.
 *  - host: exactly the headers the host reads — the JSON body's type, the
 *    credential (`x-app-session` or `Authorization: Bearer`) and the
 *    runner's mark on the cookie addresses (`x-pwapp-request`; see 3. above).
 */
const HEADERS: Readonly<Record<CorsKind, ReadonlySet<string>>> = {
  files: new Set(['cache-control', 'pragma', 'if-none-match', 'if-modified-since', 'range']),
  host: new Set(['content-type', 'authorization', 'x-app-session', 'x-pwapp-request']),
}

/** How long a browser may keep a preflight's answer, in seconds. */
const PREFLIGHT_MAX_AGE_S = 600

/** Adds `value` to the response's `Vary` header. */
function addVary(res: ServerResponse, value: string): void {
  const now = res.getHeader('vary')
  const list = now === undefined ? [] : String(now).split(',').map((s) => s.trim()).filter(Boolean)
  if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value)
  res.setHeader('vary', list.join(', '))
}

/**
 * Answers a CORS preflight from a listed origin (`204`, the grant for this
 * kind of address) and resolves true; anything else — not a preflight, or an
 * origin not listed — is left alone (false) and answered as without `--cors`.
 */
export function answerPreflight(req: IncomingMessage, res: ServerResponse, origins: CorsOrigins, kind: CorsKind): boolean {
  if (origins.size === 0 || req.method !== 'OPTIONS') return false
  if (typeof req.headers['access-control-request-method'] !== 'string') return false
  const origin = listedOrigin(req, origins)
  if (!origin) return false
  const asked = String(req.headers['access-control-request-headers'] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
  const granted = asked.filter((h) => HEADERS[kind].has(h))
  res.writeHead(204, {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': METHODS[kind],
    ...(granted.length > 0 ? { 'access-control-allow-headers': granted.join(', ') } : {}),
    'access-control-max-age': String(PREFLIGHT_MAX_AGE_S),
    vary: 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers',
    'cache-control': 'no-store',
    'content-length': '0',
  })
  res.end()
  return true
}

/**
 * Marks the answer about to be written for a listed origin: its
 * `Access-Control-Allow-Origin`, and `Vary: Origin` whenever `--cors` is on.
 * Set on the response before it is written, so whatever writes it — a file,
 * a host route, an error — carries it.
 */
export function allowListedOrigin(req: IncomingMessage, res: ServerResponse, origins: CorsOrigins): void {
  if (origins.size === 0) return
  addVary(res, 'Origin')
  const origin = listedOrigin(req, origins)
  if (origin) res.setHeader('access-control-allow-origin', origin)
}

/**
 * Handles CORS for one request: answers a listed origin's preflight (true:
 * the request is answered), or marks the answer to come and resolves false.
 */
export function applyCors(req: IncomingMessage, res: ServerResponse, origins: CorsOrigins, kind: CorsKind): boolean {
  if (answerPreflight(req, res, origins, kind)) return true
  allowListedOrigin(req, res, origins)
  return false
}

/** Whether a header a build's `_headers` file sets is one `--cors` decides instead. */
export function isCorsHeader(name: string): boolean {
  return name.toLowerCase().startsWith('access-control-')
}
