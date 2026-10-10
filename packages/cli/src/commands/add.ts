/**
 * `pwf add <pack>` — install a pack build into the project cache and pin it.
 */
import { hashPack, packContent, validatePack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag, UsageError } from './lib/flags.js'
import { cacheDir, cacheRelDir, readPackSource, resolveFrom, writePackFolder } from './lib/project.js'
import { caretRange, readIdentityFile, upsertPin, upsertRequirement, writeIdentityFile } from './lib/identity.js'
import { printIssues } from './lib/report.js'

export async function runAdd(args: ParsedArgs, io: CommandIO): Promise<number> {
  const source = args.positionals[0]
  if (source === undefined) throw new UsageError('missing <path-to.pwpack|dir>')
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  const doc = await readIdentityFile(root)

  const sourceAbs = resolveFrom(io.cwd, source)
  const incoming = await readPackSource(sourceAbs)
  const checked = validatePack(incoming)
  if (!checked.ok || !checked.identity) {
    io.err(`pwf add: ${sourceAbs} is not a valid pack`)
    printIssues(io, checked.issues.filter((i) => i.severity === 'error'))
    return 1
  }
  const { id, version } = checked.identity
  if (id === doc.id) {
    io.err(`pwf add: ${id} is this project itself`)
    return 1
  }
  // Only the pack content is installed; the pin is the hash of exactly that.
  const content = packContent(incoming)
  const hash = hashPack(content)
  await writePackFolder(cacheDir(root, id, version), content)
  upsertPin(doc, { id, version, hash })
  upsertRequirement(doc, id, caretRange(version))
  await writeIdentityFile(root, doc)

  io.out(`Added ${id}@${version}`)
  io.out(`  cached in ${cacheRelDir(id, version)}`)
  io.out(`  pinned    ${hash}`)
  io.out(`  requires  ${caretRange(version)}`)
  return 0
}

export const add: Command = {
  name: 'add',
  summary: 'Install a pack (.pwpack or folder) into the project and pin it',
  usage: `pwf add <path-to.pwpack|dir> [--dir <project>]

  <path>         a .pwpack (or .tgz) archive, or a pwpack folder
  --dir <path>   the project folder (default: the current folder)

Validates the pack, copies its pack content (no tooling) to
.pwf/packs/<id>@<version>/, pins it in
pwpack.json packs[] by content hash and adds { id, range: ^<major>.0.0 } to
requires. Only local files and folders: resolving packs from npm or a pack
registry is not supported.`,
  run: (args, io) => guard('add', io, () => runAdd(args, io)),
}
