/**
 * A small static file server for a built pwapp, answering as a static host
 * does (pwapp-format §1): correct content types, no directory listings, no
 * path escapes; a path is its file or its folder's `index.html` (a page's
 * own document under path routing); a path no file answers is the folder's
 * `404.html` with status 404 — or, for a folder that has none (an app routed
 * by hash, or built before pages had documents of their own), `index.html`
 * for a page path, as an SPA fallback.
 */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { withBaseHref } from '../../dev/shell.js'
import { CONTENT_TYPES, contentTypeOf, isPagePath } from '../../dev/content-types.js'
import { applyCors, isCorsHeader, type CorsOrigins } from '../../dev/cors.js'

export { CONTENT_TYPES, contentTypeOf, isPagePath }

/** Where the files come from: a folder on disk, or files held in memory (an opened archive). */
export type StaticSource = { readonly dir: string } | { readonly files: ReadonlyMap<string, Uint8Array> }

/**
 * A host mounted beside the files (`pwf run` serves an app's records through
 * one): requests it claims are its own, and the envelope files it answers for
 * replace the built ones.
 */
export interface StaticHost {
  /** Handles a request; resolves false when the path is not the host's. */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>
  /**
   * The body to serve instead of a built file, or undefined to serve it as
   * built. Asked with `built` undefined for a path the build does not have —
   * the host may own it (`pwpack/auth.json`, which a build leaves to the
   * publisher) — and undefined then is a 404.
   */
  envelopeFile(rel: string, built: Uint8Array | undefined): Uint8Array | undefined
}

export interface StaticServerOptions {
  readonly source: StaticSource
  /** A host mounted beside the files. */
  readonly host?: StaticHost
  /**
   * Where a record host is addressed (`/_host`). A path under it is never
   * answered with the shell: what the host does not claim — every such path
   * when there is no host — is a 404 with a JSON error body, so a page reading
   * records gets an error it can show instead of `index.html` it cannot read.
   */
  readonly hostPrefix?: string
  /** 0 picks a free port. */
  readonly port: number
  /** Default 127.0.0.1. */
  readonly hostname?: string
  /**
   * The origins `--cors` names (see ../../dev/cors.ts): a request from one is
   * answered with its `Access-Control-Allow-Origin` and its preflight is
   * answered; the build's `_headers` then sets no `Access-Control-*` header.
   * Empty or absent: no CORS at all.
   */
  readonly cors?: CorsOrigins
}

export interface StaticServer {
  readonly url: string
  readonly port: number
  close(): Promise<void>
}

/** The request path as a safe relative POSIX path, or null when it is malformed or escapes the root. */
export function requestPath(rawUrl: string): string | null {
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname)
  } catch {
    return null
  }
  if (pathname.includes('\0') || pathname.includes('\\')) return null
  const parts: string[] = []
  for (const seg of pathname.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return null
    parts.push(seg)
  }
  return parts.join('/')
}

async function load(source: StaticSource, rel: string): Promise<Uint8Array | null> {
  if ('files' in source) return source.files.get(rel) ?? null
  const root = resolve(source.dir)
  const abs = resolve(join(root, ...rel.split('/')))
  if (abs !== root && !abs.startsWith(root + sep)) return null
  const st = await stat(abs).catch(() => null)
  if (!st?.isFile()) return null
  return new Uint8Array(await readFile(abs))
}

/** The folder's not-found document: a host serves it, with status 404, for a path no file answers. */
export const NOT_FOUND_FILE = '404.html'

/**
 * Resolves a request to a file: the path itself, `<path>/index.html`; for a
 * page path nothing answers, the folder's `404.html` (status 404), or
 * `index.html` when the folder has none.
 */
export async function resolveRequest(
  source: StaticSource,
  rel: string
): Promise<{ path: string; body: Uint8Array; status: 200 | 404 } | null> {
  const candidates = rel === '' ? ['index.html'] : [rel, `${rel}/index.html`]
  for (const path of candidates) {
    const body = await load(source, path)
    if (body) return { path, body, status: 200 }
  }
  if (rel === '' || !isPagePath(rel)) return null
  const notFound = await load(source, NOT_FOUND_FILE)
  if (notFound) return { path: NOT_FOUND_FILE, body: notFound, status: 404 }
  const shell = await load(source, 'index.html')
  return shell ? { path: 'index.html', body: shell, status: 200 } : null
}

const TEXT = { 'content-type': 'text/plain; charset=utf-8' }

/** The static-host headers file a build writes beside `index.html`. */
export const HEADERS_FILE = '_headers'

/** One rule of a `_headers` file: a path pattern and the headers it adds. */
export interface HeaderRule {
  readonly pattern: string
  readonly headers: readonly (readonly [string, string])[]
}

/**
 * Parses the `_headers` convention of static hosts: a line that starts at
 * column 0 is a path pattern (`/*`, `/assets/*`, `/about`), the indented
 * `Name: value` lines under it are the headers it adds. `#` lines are
 * comments.
 */
export function parseHeadersFile(text: string): HeaderRule[] {
  const rules: { pattern: string; headers: [string, string][] }[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      rules.push({ pattern: raw.trim(), headers: [] })
      continue
    }
    const at = raw.indexOf(':')
    const rule = rules[rules.length - 1]
    if (rule && raw.trim().startsWith('!')) rule.headers.push([raw.trim(), ''])
    else if (at > 0 && rule) rule.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()])
  }
  return rules
}

/**
 * Whether a `_headers` pattern matches a request path (`/` + the relative
 * path). One `*` (a splat) may stand anywhere and matches any characters:
 * `/assets/*`, `/blocks/*.mjs`.
 */
export function headerPatternMatches(pattern: string, path: string): boolean {
  const star = pattern.indexOf('*')
  if (star < 0) return pattern === path
  const head = pattern.slice(0, star)
  const tail = pattern.slice(star + 1)
  return path.length >= head.length + tail.length && path.startsWith(head) && path.endsWith(tail)
}

/** The headers the `_headers` file adds for a relative path. */
async function extraHeaders(source: StaticSource, rel: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const file = await load(source, HEADERS_FILE)
  if (!file) return out
  for (const rule of parseHeadersFile(new TextDecoder().decode(file))) {
    if (!headerPatternMatches(rule.pattern, `/${rel}`)) continue
    for (const [name, value] of rule.headers) {
      // `! Name` takes back what an earlier rule set (the static-host convention).
      if (name.startsWith('!')) delete out[name.slice(1).trim().toLowerCase()]
      else out[name.toLowerCase()] = value
    }
  }
  return out
}

/** Whether a relative request path is under the host prefix (`/_host` → `_host`, `_host/…`). */
export function isUnderPrefix(rel: string | null, prefix: string | undefined): boolean {
  const own = (prefix ?? '').replace(/^\/+|\/+$/g, '')
  return own !== '' && rel !== null && (rel === own || rel.startsWith(`${own}/`))
}

/**
 * The answer to a host address nothing serves: a 404 whose JSON body
 * (`{ error: { code, message } }`, the host's own error shape) says why.
 */
function noHostAnswer(res: ServerResponse, rel: string, host: StaticHost | undefined): void {
  const error = host
    ? { code: 'NOT_FOUND', message: `the record host serves nothing at /${rel}` }
    : {
        code: 'NO_RECORD_HOST',
        message:
          `no record host is mounted, so /${rel} has nothing behind it: this pwapp was served without its app folder ` +
          '(a copied build or a .pwapp archive), and a static folder has no records. ' +
          'Serve the app folder instead (pwf run <app>, read-only records), or use pwf dev.',
      }
  const body = JSON.stringify({ error })
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(Buffer.byteLength(body)) })
  res.end(body)
}

async function handle(
  source: StaticSource,
  req: IncomingMessage,
  res: ServerResponse,
  host: StaticHost | undefined,
  hostPrefix: string | undefined,
  cors: CorsOrigins
): Promise<void> {
  const under = requestPath(req.url ?? '/')
  // CORS first, so every answer below carries it — the host's own included.
  if (applyCors(req, res, cors, isUnderPrefix(under, hostPrefix) ? 'host' : 'files')) return
  if (host && (await host.handle(req, res))) return
  // A record address is the host's or nobody's: never the shell (a page would
  // read index.html as its records and silently show none).
  if (under !== null && isUnderPrefix(under, hostPrefix)) {
    noHostAnswer(res, under, host)
    return
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...TEXT, allow: 'GET, HEAD' }).end('method not allowed\n')
    return
  }
  const rel = requestPath(req.url ?? '/')
  // The headers file configures the server; it is not part of the site.
  const found = rel === null || rel === HEADERS_FILE ? null : await resolveRequest(source, rel)
  if (!found) {
    const own = rel !== null && rel !== HEADERS_FILE ? host?.envelopeFile(rel, undefined) : undefined
    if (own) {
      res.writeHead(200, { 'content-type': contentTypeOf(rel as string), 'content-length': String(own.byteLength), 'cache-control': 'no-cache' })
      if (req.method === 'HEAD') res.end()
      else res.end(own)
      return
    }
    res.writeHead(404, TEXT).end('not found\n')
    return
  }
  // A page path answered with the shell gets the app's base (see withBaseHref).
  const built = found.path === 'index.html' && rel !== '' && rel !== 'index.html' ? withBaseHref(found.body) : found.body
  const plain = host?.envelopeFile(found.path, built) ?? built
  const type = contentTypeOf(found.path)
  // AS A PRODUCTION HOST SERVES IT: the build's `_headers` (its cache rules
  // included — a fixed `no-cache` used to overwrite them) and a compressed
  // body, so one `pwf run` is a measurement with records, not a static copy
  // without them.
  const encoding =
    COMPRESSIBLE.test(type) && plain.byteLength >= MIN_COMPRESSED ? acceptedEncoding(req.headers['accept-encoding']) : undefined
  const body = encoding ? compressed(plain, encoding) : plain
  const declared = await extraHeaders(source, rel ?? '')
  // Under --cors the command line decides who may read across origins, not
  // the build's `_headers` (a `*` there would undo the exact list).
  if (cors.size > 0) for (const name of Object.keys(declared)) if (isCorsHeader(name)) delete declared[name]
  const headers: Record<string, string> = {
    'cache-control': 'no-cache',
    ...declared,
    'content-type': type,
    'content-length': String(body.byteLength),
  }
  if (encoding) {
    headers['content-encoding'] = encoding
    headers['vary'] = 'Accept-Encoding'
  }
  // `Vary: Origin` set under --cors is kept beside the build's own.
  const varyOrigin = res.getHeader('vary')
  if (varyOrigin !== undefined) headers['vary'] = headers['vary'] ? `${String(varyOrigin)}, ${headers['vary']}` : String(varyOrigin)
  res.writeHead(found.status, headers)
  if (req.method === 'HEAD') res.end()
  else res.end(body)
}

/** Below this a host sends the bytes as they are (a compressed tiny file is no smaller). */
const MIN_COMPRESSED = 1024

/** Text a host compresses: markup, scripts, styles, JSON, SVG. */
const COMPRESSIBLE = /^(?:text\/|application\/(?:json|javascript|xml|manifest\+json)|image\/svg\+xml)/

/** `br` when the client takes it, else `gzip`, else none. */
function acceptedEncoding(header: string | string[] | undefined): 'br' | 'gzip' | undefined {
  const value = (Array.isArray(header) ? header.join(',') : (header ?? '')).toLowerCase()
  const takes = (name: string): boolean =>
    value.split(',').some((part) => {
      const [token, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return token?.trim() === name && (q === undefined || Number(q.trim().slice(2)) > 0)
    })
  if (takes('br')) return 'br'
  if (takes('gzip')) return 'gzip'
  return undefined
}

/** Compressed bodies by content, so a file is compressed once per run. */
const compressedCache = new Map<string, Uint8Array>()

function compressed(body: Uint8Array, encoding: 'br' | 'gzip'): Uint8Array {
  const key = `${encoding}:${createHash('sha256').update(body).digest('hex')}`
  let out = compressedCache.get(key)
  if (!out) {
    out =
      encoding === 'br'
        ? brotliCompressSync(body, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11, [zlibConstants.BROTLI_PARAM_SIZE_HINT]: body.byteLength } })
        : gzipSync(body, { level: 9 })
    compressedCache.set(key, out)
  }
  return out
}

/** Starts the server; resolves once it is listening. */
export function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const server = createServer((req, res) => {
    handle(options.source, req, res, options.host, options.hostPrefix, options.cors ?? new Set()).catch(() => {
      if (!res.headersSent) res.writeHead(500, TEXT)
      res.end('internal error\n')
    })
  })
  return new Promise((resolveStart, reject) => {
    server.once('error', reject)
    server.listen(options.port, hostname, () => {
      server.off('error', reject)
      const { port } = server.address() as AddressInfo
      const host = hostname.includes(':') ? `[${hostname}]` : hostname
      resolveStart({
        url: `http://${host}:${port}/`,
        port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.closeAllConnections()
            server.close((err) => (err ? fail(err) : done()))
          }),
      })
    })
  })
}
