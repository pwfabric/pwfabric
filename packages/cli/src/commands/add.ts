/**
 * `pwf add <pack>` — install a pack build into the project cache and pin it:
 * a local `.pwpack` or folder, or a pack of the signed-in PhiWebs workspace by id.
 * `pwf add block <category>/<type>` — write a new block into the folder.
 */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { hashPack, packContent, readPwpack, validatePack, type PackFolder } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { guard, stringFlag, UsageError } from './lib/flags.js'
import { cacheDir, cacheRelDir, readPackSource, resolveFrom, writePackFolder } from './lib/project.js'
import { caretRange, readIdentityFile, type IdentityJson, upsertPin, upsertRequirement, writeIdentityFile } from './lib/identity.js'
import { CommandFailure } from './lib/failure.js'
import { addBlock } from './lib/scaffold.js'
import type { StoreOptions } from '../phiwebs/config.js'
import type { Fetch } from '../phiwebs/oauth.js'
import { downloadPackSource, packSourceFailure, parsePackRef } from '../phiwebs/pack-sources.js'
import { readSession } from '../phiwebs/session.js'
import { SERVER_HELP } from './login.js'

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

export interface AddedPack {
  readonly id: string
  readonly version: string
  readonly hash: string
  /** The cache folder, project-relative: `.pwf/packs/<id>@<version>`. */
  readonly cachedIn: string
  /** The range added to `requires`: `^<major>.0.0`. */
  readonly range: string
}

/**
 * Installs a pack build (a `.pwpack` or folder, absolute) into the project at
 * `root`: its pack content into the cache, a pin by content hash and a
 * requirement in `pwpack.json`. Throws a {@link CommandFailure} for an
 * invalid pack or the project itself.
 */
export async function addPack(root: string, sourceAbs: string): Promise<AddedPack> {
  const doc = await readIdentityFile(root)
  return installPack(root, doc, await readPackSource(sourceAbs), sourceAbs)
}

/**
 * {@link addPack} for a pack already read, into the project `doc`; `named` is
 * what the failures call it. With `expected`, a pack that is another id or
 * version is refused before anything is written.
 */
async function installPack(root: string, doc: IdentityJson, incoming: PackFolder, named: string, expected?: { id: string; version: string }): Promise<AddedPack> {
  const checked = validatePack(incoming)
  if (!checked.ok || !checked.identity) {
    throw new CommandFailure('PACK_INVALID', `${named} is not a valid pack`, {
      issues: checked.issues.filter((i) => i.severity === 'error'),
    })
  }
  const { id, version } = checked.identity
  if (expected && (id !== expected.id || version !== expected.version)) {
    throw new CommandFailure('PACK_INVALID', `${named} holds ${id}@${version}`)
  }
  if (id === doc.id) throw new CommandFailure('PACK_IS_PROJECT', `${id} is this project itself`)
  // Only the pack content is installed; the pin is the hash of exactly that.
  const content = packContent(incoming)
  const hash = hashPack(content)
  await writePackFolder(cacheDir(root, id, version), content)
  upsertPin(doc, { id, version, hash })
  upsertRequirement(doc, id, caretRange(version))
  await writeIdentityFile(root, doc)
  return { id, version, hash, cachedIn: cacheRelDir(id, version), range: caretRange(version) }
}

/** Where the PhiWebs session lives, for a pack named by its id; tests replace each. */
export interface AddPackDeps extends StoreOptions {
  /** The `--server` flag, when given; else `PWF_PHIWEBS_URL`, else PhiWebs' own. */
  readonly server?: string
  readonly fetch?: Fetch
  readonly now?: () => number
}

/**
 * Installs the pack `arg` names into the project at `root`. A path (absolute,
 * or relative to `base`) that exists is a local `.pwpack` or folder; else
 * `@pwpack/<handle>/<name>[@<version>]` is a pack of the signed-in PhiWebs
 * workspace, downloaded, checked against its sha256 and installed the same way.
 * Without `deps` there is no session to read: a pack id fails as signed out.
 */
export async function addPackFrom(root: string, base: string, arg: string, deps?: AddPackDeps): Promise<AddedPack> {
  const local = resolve(base, arg)
  const ref = existsSync(local) ? null : parsePackRef(arg)
  if (!ref) return addPack(root, local)
  const doc = await readIdentityFile(root)
  const session = deps ? await readSession(deps) : null
  if (!session) throw packSourceFailure('NOT_SIGNED_IN', `${arg} is a PhiWebs pack id, and pwf is not signed in to PhiWebs`)
  const source = await downloadPackSource(ref, { server: session.server, accessToken: session.accessToken, ...(deps?.fetch ? { fetch: deps.fetch } : {}) })
  const name = `${source.id}@${source.version}`
  const incoming = await readPwpack(source.bytes).catch((e: unknown) => {
    throw new CommandFailure('PACK_INVALID', `${name} from PhiWebs is not a readable .pwpack: ${(e as Error).message}`)
  })
  return installPack(root, doc, incoming, `${name} from PhiWebs`, source)
}

/** What `pwf add` reaches outside the process for a PhiWebs pack; tests replace each. */
export type AddDeps = Omit<AddPackDeps, 'env' | 'server'>

export async function runAdd(args: ParsedArgs, io: CommandIO, deps: AddDeps = {}): Promise<number> {
  if (args.positionals[0] === ADD_BLOCK) return runAddBlock(args, io)
  const source = args.positionals[0]
  if (source === undefined) throw new UsageError('missing <path-to.pwpack|dir|pack id>')
  const root = resolveFrom(io.cwd, stringFlag(args, 'dir'))
  const server = stringFlag(args, 'server')
  const added = await addPackFrom(root, io.cwd, source, { ...deps, env: io.env, ...(server ? { server } : {}) })
  io.out(`Added ${added.id}@${added.version}`)
  io.out(`  cached in ${added.cachedIn}`)
  io.out(`  pinned    ${added.hash}`)
  io.out(`  requires  ${added.range}`)
  return 0
}

export const add: Command = {
  name: 'add',
  summary: 'Install a pack (.pwpack, folder, or PhiWebs pack id) into the project and pin it, or add a new block',
  usage: `pwf add <path-to.pwpack|dir> [--dir <project>]
pwf add @pwpack/<handle>/<name>[@<version>] [--dir <project>] [--server <url>]
pwf add block <category>/<type> [--dir <project>]

  <path>         a .pwpack (or .tgz) archive, or a pwpack folder
  <pack id>      a pack installed in your PhiWebs workspace (needs pwf login)
  --dir <path>   the project folder (default: the current folder)
${SERVER_HELP}

Validates the pack, copies its pack content (no tooling) to
.pwf/packs/<id>@<version>/, pins it in
pwpack.json packs[] by content hash and adds { id, range: ^<major>.0.0 } to
requires.

A pack id that is not an existing path is fetched from PhiWebs: the packs
your signed-in workspace may use locally (its marketplace installs whose
source it may read), at the version given or the one installed. pwf checks
the download against its sha256, then installs it as a local file. A pack
PhiWebs keeps to the studio (a pattern pack, a licence without the source)
is refused with the reason. Resolving packs from npm is not supported.

\`pwf add block <category>/<type>\` writes a new block into the pack or app
folder instead: atoms/blocks/<category>/<type>/manifest.json (id
<category>.<type>, no props yet, a knowledge skeleton to fill in) and
component.tsx (renders from its props, holds no words of its own). Both names
are kebab-case, 2–50 characters, starting with a letter. A type the folder
already has is refused. A pack folder named "block" is given as ./block.`,
  run: (args, io) => guard('add', io, () => runAdd(args, io)),
}
