/**
 * `pwf dev [dir] [--port <n>] [--host <name>] [--local-host | --no-host]` —
 * serves the app locally, rebuilds on every change and reloads the page. Runs
 * until interrupted.
 *
 * This is where the dev server and the local host meet (ARCHITECTURE.md:
 * `dev/` knows the host's interface only). The host is mounted under
 * `/_host` when the app declares sign-in or records, or when `--local-host`
 * asks for it; `--no-host` serves the pages alone.
 */
import { resolve } from 'node:path'
import { createDevServer, DEFAULT_HOSTNAME, DEFAULT_PORT, HOST_PREFIX, type DevServerInternals } from '../dev/server.js'
import { createLocalHost } from '../host/local-host.js'
import type { Command, CommandIO, ParsedArgs } from './types.js'

/** Resolves when the process is asked to stop (Ctrl+C or a termination signal). */
export function untilInterrupted(): Promise<void> {
  return new Promise((done) => {
    const stop = (): void => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      done()
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

export interface DevCommandOptions {
  /** What keeps the server running; default {@link untilInterrupted}. */
  readonly until?: () => Promise<void>
  /** Passed through to the server (tests turn watching off). */
  readonly internals?: DevServerInternals
}

export async function runDev(args: ParsedArgs, io: CommandIO, options: DevCommandOptions = {}): Promise<number> {
  const portFlag = args.flags['port']
  let port = DEFAULT_PORT
  if (portFlag !== undefined) {
    const n = typeof portFlag === 'string' ? Number(portFlag) : NaN
    if (!Number.isInteger(n) || n < 0 || n > 65535) {
      io.err('pwf dev: --port needs a number from 0 to 65535')
      return 2
    }
    port = n
  }
  const hostFlag = args.flags['host']
  if (hostFlag === true || hostFlag === '') {
    io.err('pwf dev: --host needs an interface name or address')
    return 2
  }
  const hostname = typeof hostFlag === 'string' ? hostFlag : DEFAULT_HOSTNAME

  // A switch followed by the folder (`pwf dev --no-host ./app`) is read by the
  // argument parser as the switch's value; take it back as the folder.
  let dirArg = args.positionals[0]
  const extra: string[] = []
  const switchOn = (name: string): boolean => {
    const v = args.flags[name]
    if (v === undefined || v === false || v === 'false') return false
    if (typeof v === 'string' && v !== 'true') {
      if (dirArg === undefined) dirArg = v
      else extra.push(v)
    }
    return true
  }
  const forceHost = switchOn('local-host')
  const noHost = switchOn('no-host')
  if (extra.length > 0) {
    io.err(`pwf dev: unexpected argument ${extra.map((e) => `"${e}"`).join(', ')}; pwf dev serves one folder`)
    return 2
  }
  if (forceHost && noHost) {
    io.err('pwf dev: --local-host and --no-host contradict each other; pass one')
    return 2
  }
  const root = resolve(io.cwd, dirArg ?? '.')

  // Undefined lets the server decide from the app's declarations.
  const localHost = noHost ? false : forceHost ? true : undefined
  const internals: DevServerInternals = { createHost: createLocalHost, ...options.internals }

  let server
  try {
    server = await createDevServer(
      { root, port, hostname, log: io.out, ...(localHost !== undefined ? { localHost } : {}) },
      internals
    )
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    io.err(
      err.code === 'EADDRINUSE'
        ? `pwf dev: port ${port} is in use; pass --port <n> (or --port 0 for any free port)`
        : `pwf dev: ${err.message}`
    )
    return 1
  }
  io.out(`pwf dev: serving ${root} at ${server.url}`)
  io.out('press Ctrl+C to stop')
  await (options.until ?? untilInterrupted)()
  await server.close()
  io.out('pwf dev: stopped')
  return 0
}

export const devCommand: Command = {
  name: 'dev',
  summary: 'Serve the app locally and reload it on every change',
  usage: `pwf dev [dir] [--port <n>] [--host <name>] [--local-host | --no-host]

  dir            the app folder (default: the current folder)
  --port <n>     port to listen on (default ${DEFAULT_PORT}; 0 picks a free one)
  --host <name>  interface to bind (default ${DEFAULT_HOSTNAME})
  --local-host   mount the local host for sign-in and data even when the app declares neither
  --no-host      do not mount the local host, even when the app declares sign-in or records

The local host (under ${HOST_PREFIX}) is for development only: records live in
memory and are seeded from app/content/ then app/data/, no password is checked, and nothing
survives a restart. The access rules of auth.json apply: dev@localhost signs in with every
declared role, any other e-mail as a plain member.`,
  run: (args, io) => runDev(args, io),
}
