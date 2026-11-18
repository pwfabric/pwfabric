/**
 * A small static file server for a built pwapp: correct content types, no
 * directory listings, no path escapes, and an SPA fallback to `index.html`
 * for page paths.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import { withBaseHref } from '../../dev/shell.js'
import { CONTENT_TYPES, contentTypeOf, isPagePath } from '../../dev/content-types.js'

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
  /** 0 picks a free port. */
  readonly port: number
  /** Default 127.0.0.1. */
  readonly hostname?: string
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

/** Resolves a request to a file: the path itself, `<path>/index.html`, then the SPA fallback for page paths. */
export async function resolveRequest(source: StaticSource, rel: string): Promise<{ path: string; body: Uint8Array } | null> {
  const candidates = rel === '' ? ['index.html'] : [rel, `${rel}/index.html`]
  // A page path is answered with the shell.
  if (rel !== '' && isPagePath(rel)) candidates.push('index.html')
  for (const path of candidates) {
    const body = await load(source, path)
    if (body) return { path, body }
  }
  return null
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

async function handle(source: StaticSource, req: IncomingMessage, res: ServerResponse, host: StaticHost | undefined): Promise<void> {
  if (host && (await host.handle(req, res))) return
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
  const body = host?.envelopeFile(found.path, built) ?? built
  res.writeHead(200, {
    ...(await extraHeaders(source, rel ?? '')),
    'content-type': contentTypeOf(found.path),
    'content-length': String(body.byteLength),
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') res.end()
  else res.end(body)
}

/** Starts the server; resolves once it is listening. */
export function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const server = createServer((req, res) => {
    handle(options.source, req, res, options.host).catch(() => {
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
