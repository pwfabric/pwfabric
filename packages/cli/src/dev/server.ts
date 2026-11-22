/**
 * `pwf dev`: serves an app folder as a pwapp and keeps it current.
 *
 * One `node:http` server on 127.0.0.1 (port 4600 by default). It assembles
 * the app into memory (see ./assemble.ts), serves the files from there,
 * watches the folder, reassembles on change and, when what it serves changed,
 * tells the open page to reload through Server-Sent Events. While the last
 * build has errors the page is an overlay listing them; the terminal gets the
 * same list.
 *
 * When the app declares sign-in or records it needs a local host. A host
 * passed in `localHost` is mounted on the same server: requests it claims go
 * to `host.handle()`, and the envelope carries `host.envelopeEntries()`.
 * This module never constructs a host itself (it depends on the host's
 * interface only); a caller that can make one passes `createHost`.
 */
import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CreateLocalHost, LocalHost } from '../host/index.js'
import { assemblePwapp, atomsLine, type AssembleOptions, type AssembleResult } from './assemble.js'
import { createCompileCache } from './compile.js'
import { formatDiagnostic, type AssembleDiagnostic } from './diagnostics.js'
import { hostNeeds } from './needs-host.js'
import { EVENTS_PATH, overlayHtml, RELOAD_CLIENT, RELOAD_JS, RELOAD_PATH, STATUS_PATH } from './overlay.js'
import { withBaseHref } from './shell.js'
import { PWF_DIR, type PackMemo } from './sources.js'
import type { DevBuildResult, DevServer, DevServerOptions, StartDevServer } from './types.js'
import { watchFolder, type WatchOptions, type Watcher } from './watcher.js'
import { CONTENT_TYPES, contentTypeOf, isPagePath } from './content-types.js'
import { applyCors, corsOriginsOf } from './cors.js'

export { contentTypeOf, isPagePath }

export const DEFAULT_PORT = 4600
export const DEFAULT_HOSTNAME = '127.0.0.1'
/**
 * The files the local host seeds its records from (`readSeed`, `readEntities`):
 * the content, the sample data and the entity declarations.
 */
export function seedsRecords(path: string): boolean {
  return path.startsWith('app/content/') || path.startsWith('app/data/') || path === 'app/definitions/entities.json'
}

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

/**
 * A file of the app the local host could not read (the host's
 * `AppFileError`, known by its shape: this module knows the host's interface
 * only) as a diagnostic on that file: `JSON_INVALID` when it is not JSON,
 * `FILE_INVALID` otherwise. Undefined for any other error.
 */
export function appFileDiagnostic(root: string, e: unknown): AssembleDiagnostic | undefined {
  if (!(e instanceof Error) || e.name !== 'AppFileError') return undefined
  const file = (e as Error & { file?: unknown }).file
  if (typeof file !== 'string') return undefined
  const rel = relative(root, file).split(sep).join('/')
  const path = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : file
  return {
    severity: 'error',
    code: /is not valid JSON/.test(e.message) ? 'JSON_INVALID' : 'FILE_INVALID',
    message: e.message.split(file).join(path),
    path,
  }
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

/**
 * What the open page would get: every served file, and the findings the
 * overlay shows. Two builds with the same signature serve the same app.
 */
export function servedSignature(result: Pick<AssembleResult, 'ok' | 'files' | 'diagnostics'>): string {
  const h = createHash('sha256')
  h.update(JSON.stringify({ ok: result.ok, diagnostics: result.diagnostics.map(formatDiagnostic) }))
  for (const path of [...result.files.keys()].sort()) {
    h.update(`\n${path}\n`)
    h.update(result.files.get(path) ?? new Uint8Array())
  }
  return h.digest('hex')
}

/** Starts the dev server with the internal seams. {@link startDevServer} is the public entry. */
export async function createDevServer(options: DevServerOptions, internals: DevServerInternals = {}): Promise<DevServer> {
  const root = resolve(options.root)
  const log = options.log ?? ((): void => undefined)
  const hostname = options.hostname ?? DEFAULT_HOSTNAME
  const cors = corsOriginsOf(options.cors ?? [])
  const cache = createCompileCache(
    internals.assemble?.cacheDir === undefined ? join(root, PWF_DIR, 'build-cache') : internals.assemble.cacheDir
  )

  // ── the local host ───────────────────────────────────────────────
  let origin = ''
  let host: LocalHost | null = isLocalHost(options.localHost) ? options.localHost : null
  let hostNoted = false
  /**
   * Mounts the host the first time the app needs one. Asked again on every
   * build, not only at start: an app that starts as a bare page and gains its
   * first entity or sign-in while the server runs needs the host from that
   * build on, or its pages bind no data and its forms send nothing.
   */
  const ensureHost = async (): Promise<void> => {
    if (host || options.localHost === false) return
    const needs = await hostNeeds(root)
    const wanted = options.localHost === true || needs.length > 0
    if (wanted && internals.createHost) {
      host = internals.createHost({ root, prefix: HOST_PREFIX })
      if (origin) log(`local host mounted at ${origin}${HOST_PREFIX} — development only: records in memory, no password checked`)
    } else if (wanted && !hostNoted) {
      hostNoted = true
      log(
        `note: this app declares ${needs.join(' and ') || 'a host'}, but no local host is mounted — pages render, ${
          needs.includes('sign-in') ? 'sign-in cannot complete and ' : ''
        }data stays empty`
      )
    }
  }
  await ensureHost()

  // ── state ────────────────────────────────────────────────────────
  let state: AssembleResult | null = null
  const packMemo: PackMemo = new Map()
  const clients = new Set<ServerResponse>()
  /**
   * RELOAD ONLY WHEN THE SERVED APP CHANGED. The watcher sees every file in
   * the folder — a screenshot, a log, a scratch script — and rebuilding for
   * one is cheap. Reloading for one is not: a reload remounts the page and
   * every piece of page state goes back to `initialState`. So a build tells
   * the page to reload only when what it serves differs from the last build.
   * `publishedAt` is pinned for the session, the one clock in the output.
   */
  const publishedAt = internals.assemble?.publishedAt ?? new Date().toISOString()
  let servedSig: string | null = null
  /** The records were seeded again: the open page reloads to read them, whatever the build serves. */
  let reseeded = false

  const broadcast = (event: string, data: unknown): void => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of clients) c.write(frame)
  }

  const build = async (): Promise<DevBuildResult> => {
    let result: AssembleResult
    await ensureHost()
    try {
      // The host reads the app's files too (auth.json, entities.json, the
      // receipts): one it cannot read is the app's mistake, reported as the
      // build reports it — a code and the file — not as an engine failure.
      let entries: Readonly<Record<string, unknown>> | undefined
      let unreadable: AssembleDiagnostic | undefined
      if (host) {
        try {
          // Host addresses go out relative ('/_host/…'), so a page reaches its host at whatever
          // address it was opened on — localhost, 127.0.0.1, a LAN name, a preview proxy. An
          // origin fixed at start-up made every other address a cross-origin write the browser blocks.
          entries = host.envelopeEntries('')
        } catch (e) {
          unreadable = appFileDiagnostic(root, e)
          if (!unreadable) throw e
        }
      }
      result = await assemblePwapp(root, {
        ...internals.assemble,
        publishedAt,
        cache,
        packMemo,
        shellExtra: RELOAD_CLIENT,
        ...(entries ? { envelopeEntries: entries } : {}),
      })
      if (unreadable) {
        // The build names the same file itself when it reads it (JSON_INVALID); say it once.
        const named = result.diagnostics.some((d) => d.severity === 'error' && d.path === unreadable.path)
        result = { ...result, ok: false, diagnostics: named ? result.diagnostics : [unreadable, ...result.diagnostics] }
      }
    } catch (e) {
      // An engine failure: its message, and the stack only when asked (pwf dev --debug).
      const message = e instanceof Error ? (options.debug ? (e.stack ?? e.message) : e.message) : String(e)
      const diagnostics: AssembleDiagnostic[] = [
        {
          severity: 'error',
          code: 'INTERNAL',
          message: options.debug ? message : `${message} (an engine error; pwf dev --debug prints its stack)`,
        },
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
      } block type${stats.blocks === 1 ? '' : 's'}, ${atomsLine(stats)}`
    )
    for (const line of logLines(result.diagnostics)) log(`  ${line}`)
    const sig = servedSignature(result)
    if (sig !== servedSig || reseeded) {
      servedSig = sig
      reseeded = false
      broadcast('reload', { ok: result.ok })
    }
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
    // CORS for the app's files and the host (./cors.ts); the reload channel
    // and the build status above are this server's own and stay same-origin.
    const underHost = url.pathname === HOST_PREFIX || url.pathname.startsWith(`${HOST_PREFIX}/`)
    if (applyCors(req, res, cors, underHost ? 'host' : 'files')) return
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
    const isPage = rel === 'index.html' || isPagePath(rel)
    if (isPage && current && !current.ok) {
      send(res, 200, CONTENT_TYPES['.html'] as string, overlayHtml(current.diagnostics), head)
      return
    }
    // `_headers` and `_redirects` configure a static host; they are not part of the site.
    const file =
      rel === '_headers' || rel === '_redirects'
        ? undefined
        : (current?.files.get(rel) ?? (isPagePath(rel) ? current?.files.get('index.html') : undefined))
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
    log(`local host mounted at ${origin}${HOST_PREFIX} — development only: records in memory, no password checked`)
  }

  await rebuild()

  let watcher: Watcher | null = null
  if (internals.watch !== false) {
    watcher = watchFolder(
      root,
      (paths) => {
        // A pack build changed (or the platform could not say what did): read it again.
        if (paths === null || paths.some((p) => p.startsWith(`${PWF_DIR}/packs`))) packMemo.clear()
        // The records are seeded from the app folder: an edit there is seen on
        // the next read, as an edit to a page is.
        if (host && (paths === null || paths.some(seedsRecords))) {
          host.reseed()
          reseeded = true
        }
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
