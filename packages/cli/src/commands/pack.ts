/**
 * `pwf pack [dir]` — the deterministic `.pwpack` archive of a valid folder.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hashPack, packContent, writePwpack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag } from './lib/flags.js'
import { readProject, resolveFrom } from './lib/project.js'
import { countLine, printIssues, validateProject } from './lib/report.js'

/** `<name>-<version>.pwpack`, where name is the last segment of the pack id. */
export function archiveName(id: string, version: string): string {
  const name = id.split('/').pop()?.replace(/^@/, '') || 'pack'
  return `${name}-${version}.pwpack`
}

export async function runPack(args: ParsedArgs, io: CommandIO): Promise<number> {
  const root = resolveFrom(io.cwd, args.positionals[0])
  const pack = await readProject(root)
  const result = await validateProject(root, pack)
  if (!result.ok || !result.identity) {
    printIssues(io, result.issues)
    io.err(`pwf pack: ${root} is not valid (${countLine(result.issues)}); nothing written`)
    return 1
  }
  printIssues(
    io,
    result.issues.filter((i) => i.severity === 'warning')
  )
  const { id, version } = result.identity
  const outFlag = stringFlag(args, 'out')
  const out = outFlag ? resolveFrom(io.cwd, outFlag) : join(root, archiveName(id, version))
  // The archive carries the pack content only: an author's tooling never
  // ships, and the archive hashes the same as the folder it came from.
  const content = packContent(pack)
  const bytes = await writePwpack(content)
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, bytes)
  const left = pack.files.size - content.files.size
  io.out(`Packed ${id}@${version}`)
  io.out(`  file  ${out}`)
  io.out(`  size  ${bytes.byteLength} bytes, ${content.files.size} files${left > 0 ? ` (${left} outside the pack content left out)` : ''}`)
  io.out(`  hash  ${hashPack(content)}`)
  return 0
}

export const pack: Command = {
  name: 'pack',
  summary: 'Write the deterministic .pwpack archive of a folder',
  usage: `pwf pack [dir] [--out <file>]

  dir           the pwpack folder (default: the current folder)
  --out <file>  where to write (default <dir>/<name>-<version>.pwpack)

Validates first and refuses on errors. The archive holds the pack content
only — pwpack.json, LICENSE, NOTICE, README.md, app/, atoms/ and media/ —
never .pwf/, .gitignore or the author's tooling (package.json, scripts/, …).
The same folder always gives the same bytes; the printed hash is the
content hash pins use.`,
  run: (args, io) => guard('pack', io, () => runPack(args, io)),
}
