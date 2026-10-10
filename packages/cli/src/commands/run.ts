/**
 * `pwf run <dir|file.pwapp>` — serve a built pwapp locally.
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readPwpack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag, UsageError } from './lib/flags.js'
import { resolveFrom } from './lib/project.js'
import { startStaticServer, type StaticServer, type StaticSource } from './lib/static-server.js'

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

/** The source to serve: a folder with an `index.html`, or a `.pwapp` archive opened in memory. */
export async function openRunSource(path: string): Promise<StaticSource> {
  const st = await stat(path).catch(() => null)
  if (!st) throw new Error(`no such file or folder: ${path}`)
  if (st.isDirectory()) {
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
  const source = await openRunSource(resolveFrom(io.cwd, target))
  const server = await startStaticServer({ source, port, hostname })
  io.out(`Serving ${target} at ${server.url}`)
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
  usage: `pwf run <dir|file.pwapp> [--port <n>] [--host <name>]

  <dir>          a built pwapp folder with an index.html (see pwf build)
  <file.pwapp>   a packaged pwapp (gzipped tar, read like a .pwpack), served from memory
  --port <n>     port to listen on (default ${DEFAULT_RUN_PORT}; 0 picks a free one)
  --host <name>  interface to bind (default 127.0.0.1)

Page paths without a file extension are answered with index.html, so
path-routed apps work; a missing asset is a 404.`,
  run: (args, io) => guard('run', io, () => runRun(args, io)),
}
