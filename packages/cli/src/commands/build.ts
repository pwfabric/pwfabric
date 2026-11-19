/**
 * `pwf build [dir] [--out <dir>]` — assembles the app into a static pwapp on
 * disk (default `<dir>/.pwf/out/`), ready for any static host or `pwf run`.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { assemblePwapp, type AssembleResult } from '../dev/assemble.js'
import { formatDiagnostic } from '../dev/diagnostics.js'
import { OutputFolderError, writePwapp } from '../dev/output.js'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { CommandFailure } from './lib/failure.js'

function shown(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

export interface BuiltProject {
  /** The assembly: its diagnostics, stats and files. */
  readonly result: AssembleResult
  /** The output folder (absolute). */
  readonly out: string
  /** Whether the pwapp was written: false when the assembly has errors. */
  readonly written: boolean
}

/**
 * Assembles the app at `root` and, when it has no errors, writes the pwapp to
 * `out` (absolute; default `<root>/.pwf/out`). Throws a {@link CommandFailure}
 * (OUTPUT_FOLDER_IN_USE) when `out` holds something that is not a build.
 */
export async function buildProject(root: string, out: string = resolve(root, '.pwf', 'out')): Promise<BuiltProject> {
  const result = await assemblePwapp(root)
  if (!result.ok) return { result, out, written: false }
  try {
    await writePwapp(result.files, out)
  } catch (e) {
    if (e instanceof OutputFolderError) throw new CommandFailure('OUTPUT_FOLDER_IN_USE', e.message)
    throw e
  }
  return { result, out, written: true }
}

/** `built 1 page, 3 block types, … in 120 ms` */
export function buildSummary(result: AssembleResult): string {
  const { stats } = result
  return `built ${stats.pages} page${stats.pages === 1 ? '' : 's'}, ${stats.blocks} block type${stats.blocks === 1 ? '' : 's'}, ${
    stats.engines
  } engine${stats.engines === 1 ? '' : 's'} — ${stats.compiled}/${stats.atoms} atoms compiled (${stats.fromCache} from cache${
    stats.failed ? `, ${stats.failed} failed` : ''
  }) in ${result.ms} ms`
}

export async function runBuild(args: ParsedArgs, io: CommandIO): Promise<number> {
  const root = resolve(io.cwd, args.positionals[0] ?? '.')
  const outFlag = args.flags['out']
  if (outFlag === true || outFlag === '') {
    io.err('pwf build: --out needs a folder')
    return 2
  }
  let built: BuiltProject
  try {
    built = await buildProject(root, typeof outFlag === 'string' ? resolve(io.cwd, outFlag) : undefined)
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
  io.out(`wrote ${result.files.size} files to ${shown(io.cwd, built.out)}`)
  return 0
}

export const buildCommand: Command = {
  name: 'build',
  summary: 'Assemble the app into a static pwapp folder',
  usage: 'pwf build [dir] [--out <dir>]',
  run: runBuild,
}
