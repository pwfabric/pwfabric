/**
 * `pwf build [dir] [--out <dir>]` — assembles the app into a static pwapp on
 * disk (default `<dir>/.pwf/out/`), ready for any static host or `pwf run`.
 */
import { isAbsolute, relative, resolve } from 'node:path'
import { assemblePwapp } from '../dev/assemble.js'
import { formatDiagnostic } from '../dev/diagnostics.js'
import { OutputFolderError, writePwapp } from '../dev/output.js'
import type { Command, CommandIO, ParsedArgs } from './types.js'

function shown(cwd: string, path: string): string {
  const rel = relative(cwd, path)
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path
}

export async function runBuild(args: ParsedArgs, io: CommandIO): Promise<number> {
  const root = resolve(io.cwd, args.positionals[0] ?? '.')
  const outFlag = args.flags['out']
  if (outFlag === true || outFlag === '') {
    io.err('pwf build: --out needs a folder')
    return 2
  }
  const out = typeof outFlag === 'string' ? resolve(io.cwd, outFlag) : resolve(root, '.pwf', 'out')

  const result = await assemblePwapp(root)
  for (const d of result.diagnostics) {
    const line = formatDiagnostic(d)
    if (d.severity === 'error') io.err(line)
    else io.out(line)
  }
  const { stats } = result
  if (!result.ok) {
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length
    io.err(`pwf build: ${errors} error${errors === 1 ? '' : 's'}; nothing written`)
    return 1
  }
  try {
    await writePwapp(result.files, out)
  } catch (e) {
    if (e instanceof OutputFolderError) {
      io.err(`pwf build: ${e.message}`)
      return 1
    }
    throw e
  }
  io.out(
    `built ${stats.pages} page${stats.pages === 1 ? '' : 's'}, ${stats.blocks} block type${stats.blocks === 1 ? '' : 's'}, ${
      stats.engines
    } engine${stats.engines === 1 ? '' : 's'} — ${stats.compiled}/${stats.atoms} atoms compiled (${stats.fromCache} from cache${
      stats.failed ? `, ${stats.failed} failed` : ''
    }) in ${result.ms} ms`
  )
  io.out(`wrote ${result.files.size} files to ${shown(io.cwd, out)}`)
  return 0
}

export const buildCommand: Command = {
  name: 'build',
  summary: 'Assemble the app into a static pwapp folder',
  usage: 'pwf build [dir] [--out <dir>]',
  run: runBuild,
}
