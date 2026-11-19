/**
 * `pwf add <pack>` — install a pack build into the project cache and pin it.
 * `pwf add block <category>/<type>` — write a new block into the folder.
 */
import { hashPack, packContent, validatePack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag, UsageError } from './lib/flags.js'
import { cacheDir, cacheRelDir, readPackSource, resolveFrom, writePackFolder } from './lib/project.js'
import { caretRange, readIdentityFile, upsertPin, upsertRequirement, writeIdentityFile } from './lib/identity.js'
import { printIssues } from './lib/report.js'
import { addBlock } from './lib/scaffold.js'

/** The word that turns `pwf add` into `pwf add block`. A pack folder named so is given as `./block`. */
export const ADD_BLOCK = 'block'

/** `pwf add block <category>/<type>`: the block's manifest and component. */
export async function runAddBlock(args: ParsedArgs, io: CommandIO): Promise<number> {
  const spec = args.positionals[1]
  if (spec === undefined) throw new UsageError('missing <category>/<type> after "block"')
  if (args.positionals.length > 2) throw new UsageError(`unexpected argument "${args.positionals[2]}"`)
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  const added = await addBlock({ root, block: spec })
  io.out(`Added block ${added.id}`)
  for (const file of added.files) io.out(`  wrote ${file}`)
  io.out('')
  io.out('Next: declare its props in manifest.json, fill in its knowledge, then')
  io.out('  pwf validate')
  return 0
}

export async function runAdd(args: ParsedArgs, io: CommandIO): Promise<number> {
  if (args.positionals[0] === ADD_BLOCK) return runAddBlock(args, io)
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
  summary: 'Install a pack (.pwpack or folder) into the project and pin it, or add a new block',
  usage: `pwf add <path-to.pwpack|dir> [--dir <project>]
pwf add block <category>/<type> [--dir <project>]

  <path>         a .pwpack (or .tgz) archive, or a pwpack folder
  --dir <path>   the project folder (default: the current folder)

Validates the pack, copies its pack content (no tooling) to
.pwf/packs/<id>@<version>/, pins it in
pwpack.json packs[] by content hash and adds { id, range: ^<major>.0.0 } to
requires. Only local files and folders: resolving packs from npm or a pack
registry is not supported.

\`pwf add block <category>/<type>\` writes a new block into the pack or app
folder instead: atoms/blocks/<category>/<type>/manifest.json (id
<category>.<type>, no props yet, a knowledge skeleton to fill in) and
component.tsx (renders from its props, holds no words of its own). Both names
are kebab-case, 2–50 characters, starting with a letter. A type the folder
already has is refused. A pack folder named "block" is given as ./block.`,
  run: (args, io) => guard('add', io, () => runAdd(args, io)),
}
