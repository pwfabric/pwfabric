/**
 * `pwf run <dir|file.pwapp>` — serve a built pwapp locally.
 *
 * THE APP'S RECORDS, READ-ONLY. A static serve has no record host, so every
 * entity source drew its `fallback` and `pwf run` showed a different app from
 * `pwf dev`: no filter, no pager, the same row behind every `?id=`. When the
 * app folder is known — `pwf run <app>` or `pwf run <app>/.pwf/out`, the
 * default build output — the local host is mounted beside the files in
 * read-only mode: the app's `app/content` records are listed, read, counted
 * and aggregated through the same store and query path as under `pwf dev`, and
 * a write is refused with `403 READ_ONLY`. A `.pwapp` archive or a build
 * written elsewhere has no app folder beside it and is served as built; an
 * address under the host prefix then answers `404 NO_RECORD_HOST` (JSON),
 * never the shell.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { readPwpack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { corsFlags, guard, stringFlag, UsageError } from './lib/flags.js'
import { resolveFrom } from './lib/project.js'
import { startStaticServer, type StaticHost, type StaticServer, type StaticSource } from './lib/static-server.js'
import { createLocalHost, readEntities, rewriteEntitySources } from '../host/index.js'
import { hostNeeds } from '../dev/needs-host.js'
import { HOST_PREFIX } from '../dev/server.js'
import { PWF_DIR } from '../dev/sources.js'

export const DEFAULT_RUN_PORT = 4700

/** Resolves when the process is asked to stop (Ctrl-C or SIGTERM). */
export function untilSignal(): Promise<void> {
  return new Promise((done) => {
    const stop = (): void => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      done()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}

export function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_RUN_PORT
  const port = Number(value)
  if (!/^\d+$/.test(value) || port > 65535) throw new UsageError(`--port "${value}" is not a port number`)
  return port
}

export async function isAppFolder(dir: string): Promise<boolean> {
  try {
    const identity = JSON.parse(await readFile(join(dir, 'pwpack.json'), 'utf8')) as { app?: unknown }
    return identity.app !== undefined && identity.app !== null
  } catch {
    return false
  }
}

/**
 * The app folder a served path belongs to: the path itself when it is an app
 * folder (its default build output is then what is served), or `<app>` for
 * `<app>/.pwf/out`. Null for anything else.
 */
export async function appFolderOf(path: string): Promise<string | null> {
  if (await isAppFolder(path)) return path
  if (basename(path) === 'out' && basename(dirname(path)) === PWF_DIR) {
    const app = dirname(dirname(path))
    if (await isAppFolder(app)) return app
  }
  return null
}

/**
 * The read-only host for an app folder, when the app declares records or
 * sign-in: mounted at the same prefix as under `pwf dev`, with the built
 * envelope's `auth.json` and receipts pointed at it.
 */
export async function readOnlyHostFor(app: string): Promise<StaticHost | undefined> {
  if ((await hostNeeds(app)).length === 0) return undefined
  const host = createLocalHost({ root: app, prefix: HOST_PREFIX, readOnly: true })
  const entries = host.envelopeEntries('')
  const declared = new Set(readEntities(app).map((e) => e.typeId))
  const enc = new TextEncoder()
  return {
    handle: (req, res) => host.handle(req, res),
    envelopeFile(rel, built) {
      // THE DOOR. `pwf build` writes no `auth.json` (the publisher's addresses
      // go there), so this host's is served in its place — the same
      // development user as under pwf dev: a sign-in app's build is run, and
      // measured, signed in.
      if (rel === 'pwpack/auth.json' && entries['auth.json'] !== undefined) {
        return enc.encode(JSON.stringify(entries['auth.json']))
      }
      // …and the build said it ships none (`identity.door: false`), which
      // makes the runner ask for none. With this host it has one.
      if (built && rel === 'pwpack/project.json' && entries['auth.json'] !== undefined) {
        const project = JSON.parse(new TextDecoder().decode(built)) as { identity?: Record<string, unknown> }
        if (!project.identity || project.identity['door'] !== false) return undefined
        const { door: _door, ...identity } = project.identity
        return enc.encode(JSON.stringify({ ...project, identity }))
      }
      // The BUILT receipt — what `pwf run` serves — with its entity sources
      // reading from the host, exactly as `pwf dev` rewrites them.
      if (built && rel.startsWith('pwpack/') && rel.endsWith('.receipt.json')) {
        const receipt = JSON.parse(new TextDecoder().decode(built)) as Record<string, unknown>
        return enc.encode(JSON.stringify(rewriteEntitySources(receipt, HOST_PREFIX, declared)))
      }
      return undefined
    },
  }
}

/** The source to serve: a folder with an `index.html`, or a `.pwapp` archive opened in memory. */
export async function openRunSource(path: string): Promise<StaticSource> {
  const st = await stat(path).catch(() => null)
  if (!st) throw new Error(`no such file or folder: ${path}`)
  if (st.isDirectory()) {
    // An app folder is served from its default build output.
    if (await isAppFolder(path)) path = join(path, PWF_DIR, 'out')
    const index = await stat(join(path, 'index.html')).catch(() => null)
    if (!index?.isFile()) throw new Error(`${path} has no index.html; build the app first (pwf build)`)
    return { dir: path }
  }
  const { files } = await readPwpack(new Uint8Array(await readFile(path)))
  if (!files.has('index.html')) throw new Error(`${path} has no index.html at its root; it is not a built pwapp`)
  return { files }
}

export interface RunOptions {
  /** Resolves when the server should stop. Default: SIGINT or SIGTERM. */
  readonly until?: (server: StaticServer) => Promise<void>
}

export async function runRun(args: ParsedArgs, io: CommandIO, options: RunOptions = {}): Promise<number> {
  const target = args.positionals[0]
  if (target === undefined) throw new UsageError('missing <dir|file.pwapp>')
  const port = parsePort(stringFlag(args, 'port'))
  const hostname = stringFlag(args, 'host') ?? '127.0.0.1'
  const cors = corsFlags(args)
  const path = resolveFrom(io.cwd, target)
  const source = await openRunSource(path)
  const app = await appFolderOf(path)
  const host = app ? await readOnlyHostFor(app) : undefined
  const server = await startStaticServer({ source, port, hostname, hostPrefix: HOST_PREFIX, cors, ...(host ? { host } : {}) })
  io.out(`Serving ${target} at ${server.url}`)
  if (cors.size > 0) io.out(`Cross-origin requests are answered for ${[...cors].join(', ')} (no credentials).`)
  if (host) io.out(`The app's records are served read-only at ${server.url}${HOST_PREFIX.slice(1)} (pwf dev changes them).`)
  io.out('Press Ctrl-C to stop.')
  try {
    await (options.until ?? untilSignal)(server)
  } finally {
    await server.close()
  }
  return 0
}

export const run: Command = {
  name: 'run',
  summary: 'Serve a built pwapp (folder or .pwapp) on a local port',
  usage: `pwf run <dir|file.pwapp> [--port <n>] [--host <name>] [--cors <origin>]...

  <dir>          a built pwapp folder with an index.html (see pwf build), or an
                 app folder (its .pwf/out is served). For an app folder or its
                 .pwf/out the app's records are served read-only.
  <file.pwapp>   a packaged pwapp (gzipped tar, read like a .pwpack), served from memory
  --port <n>     port to listen on (default ${DEFAULT_RUN_PORT}; 0 picks a free one)
  --host <name>  interface to bind (default 127.0.0.1)
  --cors <origin>
                 let pages on this origin (scheme://host[:port], exact; repeat
                 for more) read the app's files and records across origins.
                 Default: none. "*" and "null" are refused.

Served as a static host serves it: a path is its file, or its folder's
index.html (a page's own document); a page path no file answers is the
folder's 404.html with status 404 — or, for a folder without one (hash
routing, or a build that predates page documents), index.html with a
<base href="/">. A missing asset is a 404.
Paths under ${HOST_PREFIX} are never answered with index.html: without the app
folder there is no record host, and they are a 404 with a JSON error
(NO_RECORD_HOST) saying so.

With --cors, a request whose Origin is one of the named origins gets
Access-Control-Allow-Origin with that origin (and every answer Vary: Origin);
its preflight is answered: GET and HEAD for the files, the record host's own
methods and headers under ${HOST_PREFIX}. Credentials are never allowed, so the
host's sign-in cookie does not cross origins; a page there signs in with a
token. The build's _headers then sets no Access-Control-* header. Any other
origin is answered as without --cors.`,
  run: (args, io) => guard('run', io, () => runRun(args, io)),
}
