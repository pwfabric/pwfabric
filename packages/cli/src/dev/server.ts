/**
 * `pwf dev`: serves an app folder as a pwapp and keeps it current.
 *
 * One `node:http` server on 127.0.0.1 (port 4600 by default). It assembles
 * the app into memory (see ./assemble.ts), serves the files from there,
 * watches the folder, reassembles on change and tells the open page to reload
 * through Server-Sent Events. While the last build has errors the page is an
 * overlay listing them; the terminal gets the same list.
 *
 * When the app declares sign-in or records it needs a local host. A host
 * passed in `localHost` is mounted on the same server: requests it claims go
 * to `host.handle()`, and the envelope carries `host.envelopeEntries()`.
 * This module never constructs a host itself (it depends on the host's
 * interface only); a caller that can make one passes `createHost`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, resolve } from 'node:path'
import type { CreateLocalHost, LocalHost } from '../host/types.js'
import { assemblePwapp, type AssembleOptions, type AssembleResult } from './assemble.js'
import { createCompileCache } from './compile.js'
import { formatDiagnostic, type AssembleDiagnostic } from './diagnostics.js'
import { hostNeeds } from './needs-host.js'
import { EVENTS_PATH, overlayHtml, RELOAD_CLIENT, RELOAD_JS, RELOAD_PATH, STATUS_PATH } from './overlay.js'
import { withBaseHref } from './shell.js'
import { PWF_DIR, type PackMemo } from './sources.js'
import type { DevBuildResult, DevServer, DevServerOptions, StartDevServer } from './types.js'
import { watchFolder, type WatchOptions, type Watcher } from './watcher.js'

export const DEFAULT_PORT = 4600
export const DEFAULT_HOSTNAME = '127.0.0.1'
/** Where a host this server creates is mounted. */
export const HOST_PREFIX = '/_host'

/** Seams for the `dev` command and for tests; not part of the public contract. */
export interface DevServerInternals {
  /** Watching; `false` turns it off. */
  readonly watch?: WatchOptions | false
  /** Makes a host when the app needs one and none was passed. */
  readonly createHost?: CreateLocalHost
  /** Assembly options (runtime bundles, cache folder). */
  readonly assemble?: Pick<AssembleOptions, 'runtime' | 'cacheDir' | 'publishedAt'>
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export function contentTypeOf(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function isLocalHost(value: unknown): value is LocalHost {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as LocalHost).handle === 'function' &&
    typeof (value as LocalHost).envelopeEntries === 'function'
  )
}

/** The address a browser should open for a bound interface. */
export function urlFor(hostname: string, port: number): string {
  const h = hostname === '0.0.0.0' || hostname === '::' || hostname === '' ? 'localhost' : hostname
  return `http://${h.includes(':') ? `[${h}]` : h}:${port}/`
}

function send(res: ServerResponse, status: number, type: string, body: string | Uint8Array, head = false): void {
  res.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-length': typeof body === 'string' ? Buffer.byteLength(body) : body.byteLength,
  })
  res.end(head ? undefined : body)
}

/** Lines for the terminal: everything that is the app's own, and a count of what pinned packs say. */
export function logLines(diagnostics: readonly AssembleDiagnostic[]): string[] {
  const own: string[] = []
  let packWarnings = 0
  for (const d of diagnostics) {
    if (d.severity !== 'error' && d.path?.startsWith(`${PWF_DIR}/`)) {
      packWarnings++
      continue
    }
    if (d.severity === 'info') continue
    own.push(formatDiagnostic(d))
  }
  if (packWarnings > 0) own.push(`${packWarnings} finding${packWarnings === 1 ? '' : 's'} in pinned packs (\`pwf build\` lists them)`)
  return own
}

/** Starts the dev server with the internal seams. {@link startDevServer} is the public entry. */
export async function createDevServer(options: DevServerOptions, internals: DevServerInternals = {}): Promise<DevServer> {
  const root = resolve(options.root)
  const log = options.log ?? ((): void => undefined)
  const hostname = options.hostname ?? DEFAULT_HOSTNAME
  const cache = createCompileCache(
    internals.assemble?.cacheDir === undefined ? join(root, PWF_DIR, 'build-cache') : internals.assemble.cacheDir
  )

  // ── the local host ───────────────────────────────────────────────
  let host: LocalHost | null = null
  if (isLocalHost(options.localHost)) {
    host = options.localHost
  } else if (options.localHost !== false) {
    const needs = await hostNeeds(root)
    const wanted = options.localHost === true || needs.length > 0
    if (wanted && internals.createHost) {
      host = internals.createHost({ root, prefix: HOST_PREFIX })
    } else if (wanted) {
      log(
        `note: this app declares ${needs.join(' and ') || 'a host'}, but no local host is mounted — pages render, ${
          needs.includes('sign-in') ? 'sign-in cannot complete and ' : ''
        }data stays empty`
      )
    }
  }

  // ── state ────────────────────────────────────────────────────────
  let state: AssembleResult | null = null
  const packMemo: PackMemo = new Map()
  const clients = new Set<ServerResponse>()
  let origin = ''

  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(frame)
  }

  const build = async (): Promise<DevBuildResult> => {
    let result: AssembleResult
    try {
      result = await assemblePwapp(root, {
        ...internals.assemble,
        cache,
        packMemo,
        shellExtra: RELOAD_CLIENT,
        ...(host ? { envelopeEntries: host.envelopeEntries(origin) } : {}),
      })
    } catch (e) {
      const diagnostics: AssembleDiagnostic[] = [
        { severity: 'error', code: 'INTERNAL', message: e instanceof Error ? (e.stack ?? e.message) : String(e) },
      ]
      result = {
        ok: false,
        files: state?.files ?? new Map(),
        diagnostics,
        stats: { pages: 0, blocks: 0, engines: 0, atoms: 0, compiled: 0, fromCache: 0, failed: 0 },
        ms: 0,
      }
    }
    state = result
    const { stats } = result
    log(
      `${result.ok ? 'built' : 'build failed'} in ${result.ms} ms — ${stats.pages} page${stats.pages === 1 ? '' : 's'}, ${
        stats.blocks
      } block type${stats.blocks === 1 ? '' : 's'}, ${stats.compiled}/${stats.atoms} atoms compiled (${stats.fromCache} from cache${
        stats.failed ? `, ${stats.failed} failed` : ''
      })`
    )
    for (const line of logLines(result.diagnostics)) log(`  ${line}`)
    broadcast('reload', { ok: result.ok })
    return { ok: result.ok, compiled: stats.compiled, diagnostics: result.diagnostics.map(formatDiagnostic), ms: result.ms }
  }

  let chain: Promise<unknown> = Promise.resolve()
  const rebuild = (): Promise<DevBuildResult> => {
    const next = chain.then(build, build)
    chain = next.catch(() => undefined)
    return next
  }

  // ── HTTP ─────────────────────────────────────────────────────────
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname === EVENTS_PATH) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      res.write(': connected\n\n')
      clients.add(res)
      req.on('close', () => clients.delete(res))
      return
    }
    if (url.pathname === RELOAD_PATH) {
      send(res, 200, CONTENT_TYPES['.js'] as string, RELOAD_JS, req.method === 'HEAD')
      return
    }
    if (url.pathname === STATUS_PATH) {
      send(res, 200, CONTENT_TYPES['.json'] as string, JSON.stringify({ ok: state?.ok ?? false, diagnostics: state?.diagnostics ?? [] }))
      return
    }
    if (host && (await host.handle(req, res))) return
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, CONTENT_TYPES['.txt'] as string, 'method not allowed')
      return
    }
    const head = req.method === 'HEAD'
    let path: string
    try {
      path = decodeURIComponent(url.pathname)
    } catch {
      send(res, 400, CONTENT_TYPES['.txt'] as string, 'bad path', head)
      return
    }
    let rel = path.replace(/^\/+/, '')
    if (rel === '' || rel.endsWith('/')) rel += 'index.html'
    if (rel.split('/').some((s) => s === '..' || s === '.') || rel.includes('\\') || rel.includes('\0')) {
      send(res, 400, CONTENT_TYPES['.txt'] as string, 'bad path', head)
      return
    }
    const current = state
    const isPage = rel === 'index.html' || extname(rel) === ''
    if (isPage && current && !current.ok) {
      send(res, 200, CONTENT_TYPES['.html'] as string, overlayHtml(current.diagnostics), head)
      return
    }
    // `_headers` configures a static host; it is not part of the site.
    const file =
      rel === '_headers'
        ? undefined
        : (current?.files.get(rel) ?? (extname(rel) === '' ? current?.files.get('index.html') : undefined))
    if (!file) {
      send(res, 404, CONTENT_TYPES['.txt'] as string, `not found: /${rel}`, head)
      return
    }
    // A nested page path answered with the shell needs the app's base, or the
    // shell's relative script addresses resolve under the page's folder.
    const body = isPage && rel !== 'index.html' ? withBaseHref(file) : file
    send(res, 200, contentTypeOf(isPage ? 'index.html' : rel), body, head)
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) send(res, 500, CONTENT_TYPES['.txt'] as string, e instanceof Error ? e.message : String(e))
      else res.end()
    })
  })
  await new Promise<void>((ok, fail) => {
    server.once('error', fail)
    server.listen(options.port ?? DEFAULT_PORT, hostname, () => {
      server.off('error', fail)
      ok()
    })
  })
  const port = (server.address() as AddressInfo).port
  const url = urlFor(hostname, port)
  origin = url.replace(/\/$/, '')
  if (host) {
    log(`local host mounted at ${origin}${HOST_PREFIX} — development only: records in memory, one user, any password`)
  }

  await rebuild()

  let watcher: Watcher | null = null
  if (internals.watch !== false) {
    watcher = watchFolder(
      root,
      (paths) => {
        // A pack build changed (or the platform could not say what did): read it again.
        if (paths === null || paths.some((p) => p.startsWith(`${PWF_DIR}/packs`))) packMemo.clear()
        void rebuild()
      },
      internals.watch ?? {}
    )
    log(`watching ${root} (${watcher.mode === 'native' ? 'file events' : 'polling'})`)
  }

  let closed: Promise<void> | null = null
  return {
    url,
    rebuild,
    close() {
      closed ??= (async () => {
        watcher?.close()
        for (const c of clients) c.end()
        clients.clear()
        await new Promise<void>((ok) => {
          server.close(() => ok())
          server.closeAllConnections()
        })
        await chain
      })()
      return closed
    },
  }
}

/** Implements the `pwf dev` contract (see ./types.ts). */
export const startDevServer: StartDevServer = (options) => createDevServer(options)
