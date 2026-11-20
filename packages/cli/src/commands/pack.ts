/**
 * `pwf pack [dir]` — the deterministic `.pwpack` archive of a valid folder.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { hashPack, packContent, writePwpack, type PackIssue } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag } from './lib/flags.js'
import { readProject, resolveFrom } from './lib/project.js'
import { countLine, printIssues, validateProject } from './lib/report.js'
import { CommandFailure } from './lib/failure.js'

/** `<name>-<version>.pwpack`, where name is the last segment of the pack id. */
export function archiveName(id: string, version: string): string {
  const name = id.split('/').pop()?.replace(/^@/, '') || 'pack'
  return `${name}-${version}.pwpack`
}

export interface PackedProject {
  readonly id: string
  readonly version: string
  /** The archive written (absolute). */
  readonly file: string
  readonly bytes: number
  /** Files in the archive. */
  readonly files: number
  /** Files in the folder outside the pack content, left out. */
  readonly leftOut: number
  /** The content hash pins use. */
  readonly hash: string
  /** Validation warnings, which do not stop the pack. */
  readonly warnings: readonly PackIssue[]
}

/**
 * Validates the folder at `root` and writes its deterministic archive to
 * `out` (absolute; default `<root>/<name>-<version>.pwpack`). Throws a
 * {@link CommandFailure} (PROJECT_INVALID) and writes nothing when the folder
 * has errors.
 */
export async function packProject(root: string, out?: string): Promise<PackedProject> {
  const pack = await readProject(root)
  const result = await validateProject(root, pack)
  if (!result.ok || !result.identity) {
    throw new CommandFailure('PROJECT_INVALID', `${root} is not valid (${countLine(result.issues)}); nothing written`, {
      issues: result.issues,
      issuesFirst: true,
    })
  }
  const { id, version } = result.identity
  const file = out ?? join(root, archiveName(id, version))
  // The archive carries the pack content only: an author's tooling never
  // ships, and the archive hashes the same as the folder it came from.
  const content = packContent(pack)
  const bytes = await writePwpack(content)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, bytes)
  return {
    id,
    version,
    file,
    bytes: bytes.byteLength,
    files: content.files.size,
    leftOut: pack.files.size - content.files.size,
    hash: hashPack(content),
    warnings: result.issues.filter((i) => i.severity === 'warning'),
  }
}

export async function runPack(args: ParsedArgs, io: CommandIO): Promise<number> {
  const root = resolveFrom(io.cwd, args.positionals[0])
  const outFlag = stringFlag(args, 'out')
  const packed = await packProject(root, outFlag ? resolveFrom(io.cwd, outFlag) : undefined)
  printIssues(io, packed.warnings)
  io.out(`Packed ${packed.id}@${packed.version}`)
  io.out(`  file  ${packed.file}`)
  io.out(`  size  ${packed.bytes} bytes, ${packed.files} files${packed.leftOut > 0 ? ` (${packed.leftOut} outside the pack content left out)` : ''}`)
  io.out(`  hash  ${packed.hash}`)
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
