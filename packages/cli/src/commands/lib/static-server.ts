/**
 * A small static file server for a built pwapp: correct content types, no
 * directory listings, no path escapes, and an SPA fallback to `index.html`
 * for page paths.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
}

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** Where the files come from: a folder on disk, or files held in memory (an opened archive). */
export type StaticSource = { readonly dir: string } | { readonly files: ReadonlyMap<string, Uint8Array> }

export interface StaticServerOptions {
  readonly source: StaticSource
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
  // A path whose last segment has no extension is a page path: answer it with the shell.
  if (rel !== '' && extname(rel) === '') candidates.push('index.html')
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
    if (at > 0 && rule) rule.headers.push([raw.slice(0, at).trim(), raw.slice(at + 1).trim()])
  }
  return rules
}

/** Whether a `_headers` pattern matches a request path (`/` + the relative path). */
export function headerPatternMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1))
  return pattern === path
}

/** The headers the `_headers` file adds for a relative path. */
async function extraHeaders(source: StaticSource, rel: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const file = await load(source, HEADERS_FILE)
  if (!file) return out
  for (const rule of parseHeadersFile(new TextDecoder().decode(file))) {
    if (!headerPatternMatches(rule.pattern, `/${rel}`)) continue
    for (const [name, value] of rule.headers) out[name.toLowerCase()] = value
  }
  return out
}

async function handle(source: StaticSource, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...TEXT, allow: 'GET, HEAD' }).end('method not allowed\n')
    return
  }
  const rel = requestPath(req.url ?? '/')
  // The headers file configures the server; it is not part of the site.
  const found = rel === null || rel === HEADERS_FILE ? null : await resolveRequest(source, rel)
  if (!found) {
    res.writeHead(404, TEXT).end('not found\n')
    return
  }
  res.writeHead(200, {
    ...(await extraHeaders(source, rel ?? '')),
    'content-type': contentTypeOf(found.path),
    'content-length': String(found.body.byteLength),
    'cache-control': 'no-cache',
  })
  if (req.method === 'HEAD') res.end()
  else res.end(found.body)
}

/** Starts the server; resolves once it is listening. */
export function startStaticServer(options: StaticServerOptions): Promise<StaticServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  const server = createServer((req, res) => {
    handle(options.source, req, res).catch(() => {
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
