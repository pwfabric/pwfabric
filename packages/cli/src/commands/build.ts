/**
 * `pwf build [dir] [--out <dir>]` — assembles the app into a static pwapp on
 * disk (default `<dir>/.pwf/out/`), ready for any static host or `pwf run`.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { assemblePwapp, atomsLine, type AssembleResult } from '../dev/assemble.js'
import { formatDiagnostic } from '../dev/diagnostics.js'
import { OutputFolderError, writePwapp } from '../dev/output.js'
import { ROUTER_MODES, type RouterMode } from '../dev/shell.js'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { CommandFailure } from './lib/failure.js'
import { UsageError } from './lib/flags.js'

function shown(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

/** How a build routes: `runApp`'s router, and the app's base under path routing. */
export interface BuildRouting {
  readonly router: RouterMode
  /** The app's base path (`<base href>`), ending in `/`; only with `path` or `auto`. */
  readonly base?: string
}

/**
 * The routing a caller asked for (`--router`, `--base`; the MCP tool's
 * `router`, `base`), checked: a router that is not hash, path or auto, a base
 * that is not a path from `/`, or a base under hash routing is a
 * {@link UsageError}, worded with the caller's `names` for the two inputs.
 * Absent: hash routing.
 */
export function buildRouting(router: unknown, base: unknown, names: { readonly router: string; readonly base: string } = { router: '--router', base: '--base' }): BuildRouting {
  if (router !== undefined && !(typeof router === 'string' && (ROUTER_MODES as readonly string[]).includes(router))) {
    throw new UsageError(`${names.router} takes ${ROUTER_MODES.join(', ')}${typeof router === 'string' && router ? ` (not "${router}")` : ''}`)
  }
  const mode = (router ?? 'hash') as RouterMode
  if (base === undefined) return { router: mode }
  if (typeof base !== 'string' || !base.startsWith('/') || base.startsWith('//') || /[\s"<>]/.test(base)) {
    throw new UsageError(`${names.base} takes the path the app is served under, starting with / (e.g. /shop/)`)
  }
  if (mode === 'hash') throw new UsageError(`${names.base} is for path routing; set ${names.router} to path (or auto) with it`)
  return { router: mode, base: base.endsWith('/') ? base : `${base}/` }
}

export interface BuiltProject {
  /** The assembly: its diagnostics, stats and files. */
  readonly result: AssembleResult
  /** The output folder (absolute). */
  readonly out: string
  /** Whether the pwapp was written: false when the assembly has errors. */
  readonly written: boolean
  /** How the written app routes. */
  readonly routing: BuildRouting
}

/**
 * Assembles the app at `root` and, when it has no errors, writes the pwapp to
 * `out` (absolute; default `<root>/.pwf/out`), routing as `routing` says
 * (default hash). Throws a {@link CommandFailure} (OUTPUT_FOLDER_IN_USE) when
 * `out` holds something that is not a build.
 */
export async function buildProject(
  root: string,
  out: string = resolve(root, '.pwf', 'out'),
  routing: BuildRouting = { router: 'hash' }
): Promise<BuiltProject> {
  const result = await assemblePwapp(root, { router: routing.router, ...(routing.base !== undefined ? { base: routing.base } : {}) })
  if (!result.ok) return { result, out, written: false, routing }
  try {
    await writePwapp(result.files, out)
  } catch (e) {
    if (e instanceof OutputFolderError) throw new CommandFailure('OUTPUT_FOLDER_IN_USE', e.message)
    throw e
  }
  return { result, out, written: true, routing }
}

/** `built 1 page, 3 block types, 0 engines — 56/57 atoms compiled (…) in 120 ms` */
export function buildSummary(result: AssembleResult): string {
  const { stats } = result
  return `built ${stats.pages} page${stats.pages === 1 ? '' : 's'}, ${stats.blocks} block type${stats.blocks === 1 ? '' : 's'}, ${
    stats.engines
  } engine${stats.engines === 1 ? '' : 's'} — ${atomsLine(stats)} in ${result.ms} ms`
}

/** `router: path, base / — …`, for a build that does not route by hash; undefined for hash. */
export function routingLine(routing: BuildRouting): string | undefined {
  return routing.router === 'hash'
    ? undefined
    : `router: ${routing.router}, base ${routing.base ?? '/'} — one document per page (<page>/index.html) and 404.html, which a static host serves as they are`
}

export async function runBuild(args: ParsedArgs, io: CommandIO): Promise<number> {
  const root = resolve(io.cwd, args.positionals[0] ?? '.')
  const outFlag = args.flags['out']
  if (outFlag === true || outFlag === '') {
    io.err('pwf build: --out needs a folder')
    return 2
  }
  let routing: BuildRouting
  try {
    routing = buildRouting(args.flags['router'], args.flags['base'])
  } catch (e) {
    if (!(e instanceof UsageError)) throw e
    io.err(`pwf build: ${e.message}`)
    return 2
  }
  let built: BuiltProject
  try {
    built = await buildProject(root, typeof outFlag === 'string' ? resolve(io.cwd, outFlag) : undefined, routing)
  } catch (e) {
    if (e instanceof CommandFailure) {
      io.err(`pwf build: ${e.message}`)
      return 1
    }
    throw e
  }
  const { result } = built
  for (const d of result.diagnostics) {
    const line = formatDiagnostic(d)
    if (d.severity === 'error') io.err(line)
    else io.out(line)
  }
  if (!built.written) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length
    io.err(`pwf build: ${errors} error${errors === 1 ? '' : 's'}; nothing written`)
    return 1
  }
  io.out(buildSummary(result))
  const line = routingLine(routing)
  if (line) io.out(line)
  io.out(`wrote ${result.files.size} files to ${shown(io.cwd, built.out)}`)
  // What search engines and language models read, when the app declares its origin.
  const found = ['sitemap.xml', 'llms.txt', 'llms-full.txt'].filter((f) => result.files.has(f))
  if (found.length > 0) io.out(`for search engines and language models: ${found.join(', ')}`)
  return 0
}

export const buildCommand: Command = {
  name: 'build',
  summary: 'Assemble the app into a static pwapp folder',
  usage: `pwf build [dir] [--out <dir>] [--router <hash|path|auto>] [--base <path>]

  dir              the app folder (default: the current folder)
  --out <dir>      where to write the pwapp (default: <dir>/.pwf/out)
  --router <mode>  how the app routes, runApp's router (default hash):
                     hash  #/<page> addresses; works on every static host
                     path  /<page>/ addresses; every page is a document of its
                           own (index.html for the entry, <page>/index.html, and
                           404.html for an address that names no page), which a
                           static host serves with no configuration
                     auto  path where the browser can, else hash; the shell also
                           carries <meta name="pw-router" content="path">
  --base <path>    the path the app is served under, for path and auto
                   (default /; e.g. --base /shop/)

Each page's document carries its first frame as visible HTML, its title and
description, and — when app/plan.json declares the app's public "origin" — its
canonical address and Open Graph tags; sitemap.xml then lists every page and
robots.txt names it, and a path-routed build writes llms.txt (every page, with
its title and description) and llms-full.txt (every page's words as text).`,
  run: runBuild,
}
