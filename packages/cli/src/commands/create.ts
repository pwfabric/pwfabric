/**
 * `pwf create <name>` — a new app folder standing on a foundation pack.
 * `pwf create --pack <name>` — a new, empty pack folder.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { hashPack, packContent, validatePack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { cacheDir, cacheRelDir, readPackSource, resolveFrom, writePackFolder, ATOMS_README } from './lib/project.js'
import { caretRange, engineRange, engineVersion, formatIdentity, formatJson } from './lib/identity.js'
import { CommandFailure } from './lib/failure.js'
import { createPack } from './lib/scaffold.js'
import {
  ATOMS_README_TEXT,
  catalogOf,
  GITIGNORE_TEXT,
  starterAppearance,
  starterBlocks,
  starterNavigation,
  starterPlan,
  starterReceipt,
  starterTheme,
  titleOf,
} from './lib/starter.js'

/** Environment variable naming the foundation pack when `--foundation` is not given. */
export const FOUNDATION_ENV = 'PWF_FOUNDATION'

const NAME = /^[a-z0-9][a-z0-9-]*$/

const NO_FOUNDATION = [
  'pwf create: no foundation pack given.',
  'Every app stands on a foundation pack (its blocks, themes and shells). The',
  'foundation pack is not published to a registry yet, so point pwf at a copy:',
  '  pwf create <name> --foundation <folder or .pwpack>',
  `or set ${FOUNDATION_ENV} to that path once for every create.`,
]

async function isNonEmptyDir(dir: string): Promise<boolean> {
  const entries = await readdir(dir).catch(() => null)
  return entries !== null && entries.length > 0
}

export interface CreateOptions {
  /** Engine version to declare a range for; defaults to the installed contracts version. */
  readonly engineVersion?: string
}

function shownPath(cwd: string, target: string): string {
  const rel = relative(cwd, target)
  return rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? target : rel
}

/** `pwf create --pack <name>`: the pack folder, its README and an empty atoms/. */
export async function runCreatePack(args: ParsedArgs, io: CommandIO, options: CreateOptions = {}): Promise<number> {
  const flag = args.flags['pack']
  const name = typeof flag === 'string' && flag !== '' ? flag : args.positionals[0]
  if (name === undefined) throw new UsageError('missing <name> after --pack')
  if (typeof flag === 'string' && args.positionals.length > 0) throw new UsageError(`unexpected argument "${args.positionals[0]}"`)
  if (args.flags['foundation'] !== undefined) throw new UsageError('--foundation is for an app; a pack names what it stands on with --requires')
  const target = resolveFrom(io.cwd, stringFlag(args, 'dir') ?? name)
  const id = stringFlag(args, 'id')
  const requires = stringFlag(args, 'requires')
  const created = await createPack({
    name,
    dir: target,
    ...(id !== undefined ? { id } : {}),
    ...(requires !== undefined ? { requires: resolveFrom(io.cwd, requires) } : {}),
    force: boolFlag(args, 'force'),
    ...(options.engineVersion !== undefined ? { engineVersion: options.engineVersion } : {}),
  })
  io.out(`Created ${created.id} in ${target}`)
  if (created.requires) {
    const r = created.requires
    io.out(`  requires  ${r.id} ${r.range} (${r.hash})`)
    io.out(`  cached in ${cacheRelDir(r.id, r.version)}`)
  }
  io.out('')
  io.out('Next:')
  io.out(`  cd ${shownPath(io.cwd, target)}`)
  io.out('  pwf add block <category>/<type>   # a new block')
  io.out('  pwf validate                      # check the folder')
  io.out('  pwf pack                          # write the .pwpack')
  return 0
}

export interface CreateAppOptions {
  /** Lower-case letters, digits and hyphens; the app id is `@pwpack/local/<name>`. */
  readonly name: string
  /** The folder to write (absolute). */
  readonly dir: string
  /** The foundation pack, a folder or `.pwpack` (absolute); undefined fails with FOUNDATION_MISSING. */
  readonly foundation: string | undefined
  /** Write into a folder that is not empty. */
  readonly force?: boolean
  /** Engine version to declare a range for; defaults to the installed contracts version. */
  readonly engineVersion?: string
}

export interface CreatedApp {
  readonly id: string
  readonly version: string
  readonly dir: string
  readonly foundation: { readonly id: string; readonly version: string; readonly hash: string; readonly cachedIn: string }
  /** The block types the starter home page places, in order. */
  readonly homeBlocks: readonly string[]
  readonly theme?: string
  /** The files written, folder-relative (the foundation's cache not included). */
  readonly files: readonly string[]
}

/**
 * Writes a new app folder standing on a foundation pack. Throws a
 * {@link UsageError} for a bad name and a {@link CommandFailure} for a
 * missing or invalid foundation or a folder that is not empty.
 */
export async function createApp(options: CreateAppOptions): Promise<CreatedApp> {
  const { name, dir: target } = options
  if (!NAME.test(name)) throw new UsageError(`"${name}" is not a valid name: use lower-case letters, digits and hyphens`)
  if (!options.foundation) {
    throw new CommandFailure('FOUNDATION_MISSING', 'no foundation pack given', { lines: NO_FOUNDATION })
  }
  if (!options.force && (await isNonEmptyDir(target))) {
    throw new CommandFailure('FOLDER_NOT_EMPTY', `${target} is not empty; choose another --dir or pass --force to write into it`)
  }

  const foundationAbs = options.foundation
  const foundation = await readPackSource(foundationAbs)
  const checked = validatePack(foundation)
  if (!checked.ok || !checked.identity) {
    throw new CommandFailure('FOUNDATION_INVALID', `the foundation pack at ${foundationAbs} is not valid`, {
      issues: checked.issues.filter((i) => i.severity === 'error'),
    })
  }
  const { id: foundationId, version: foundationVersion } = checked.identity
  const catalog = catalogOf(foundation, checked)
  const title = titleOf(name)
  const blocks = starterBlocks(catalog, title)
  if (blocks.length === 0) {
    throw new CommandFailure(
      'FOUNDATION_NO_STARTER_BLOCKS',
      `${foundationId}@${foundationVersion} has no heading, text or button block to start a page with`
    )
  }
  const theme = starterTheme(catalog)
  // What is cached and pinned is the pack content: a foundation read from its
  // source folder brings its package.json, scripts and tests, none of which
  // the app stands on.
  const foundationContent = packContent(foundation)
  const foundationHash = hashPack(foundationContent)

  const identity = {
    id: `@pwpack/local/${name}`,
    version: '0.1.0',
    formatVersion: '1.1',
    engines: { pwfabric: engineRange(options.engineVersion ?? engineVersion()) },
    requires: [{ id: foundationId, range: caretRange(foundationVersion) }],
    license: { fork: true, redistribute: true },
    app: { entry: 'home', surfaceOrder: ['home'] },
    packs: [{ id: foundationId, version: foundationVersion, hash: foundationHash }],
  }

  const files: Record<string, string> = {
    'pwpack.json': formatIdentity(identity),
    'app/plan.json': formatJson(starterPlan(name, title, blocks, foundationId, theme)),
    'app/definitions/appearance.json': formatJson(starterAppearance(theme)),
    'app/definitions/navigation.json': formatJson(starterNavigation()),
    'app/surfaces/home.receipt.json': formatJson(starterReceipt(blocks)),
    [ATOMS_README]: ATOMS_README_TEXT,
    '.gitignore': GITIGNORE_TEXT,
  }
  for (const [path, text] of Object.entries(files)) {
    const abs = join(target, ...path.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text)
  }
  await writePackFolder(cacheDir(target, foundationId, foundationVersion), foundationContent)

  return {
    id: identity.id,
    version: identity.version,
    dir: target,
    foundation: { id: foundationId, version: foundationVersion, hash: foundationHash, cachedIn: cacheRelDir(foundationId, foundationVersion) },
    homeBlocks: blocks.map((b) => b.type),
    ...(theme ? { theme } : {}),
    files: Object.keys(files),
  }
}

export async function runCreate(args: ParsedArgs, io: CommandIO, options: CreateOptions = {}): Promise<number> {
  if (args.flags['pack'] !== undefined) return runCreatePack(args, io, options)
  const name = args.positionals[0]
  if (name === undefined) throw new UsageError('missing <name>')
  if (!NAME.test(name)) throw new UsageError(`"${name}" is not a valid name: use lower-case letters, digits and hyphens`)
  const target = resolveFrom(io.cwd, stringFlag(args, 'dir') ?? name)
  const foundationPath = stringFlag(args, 'foundation') ?? io.env[FOUNDATION_ENV]
  const created = await createApp({
    name,
    dir: target,
    foundation: foundationPath ? resolveFrom(io.cwd, foundationPath) : undefined,
    force: boolFlag(args, 'force'),
    ...(options.engineVersion !== undefined ? { engineVersion: options.engineVersion } : {}),
  })

  const shown = shownPath(io.cwd, target)
  io.out(`Created ${created.id} in ${target}`)
  io.out(`  foundation ${created.foundation.id}@${created.foundation.version} (${created.foundation.hash})`)
  io.out(`  cached in  ${created.foundation.cachedIn}`)
  io.out(`  home page  ${created.homeBlocks.join(', ')}${created.theme ? `; theme ${created.theme}` : ''}`)
  io.out('')
  io.out('Next:')
  io.out(`  cd ${shown}`)
  io.out('  pwf dev        # serve it and rebuild on change')
  io.out('  pwf validate   # check the folder')
  io.out('  pwf pack       # write the .pwpack')
  return 0
}

export const create: Command = {
  name: 'create',
  summary: 'Create a new app folder standing on a foundation pack, or a new pack folder',
  usage: `pwf create <name> [--dir <path>] [--foundation <folder|.pwpack>] [--force]
pwf create --pack <name> [--dir <path>] [--id <pack id>] [--requires <folder|.pwpack>] [--force]

  <name>          lower-case letters, digits and hyphens; the app id is @pwpack/local/<name>
  --dir <path>    where to write it (default ./<name>)
  --foundation    the foundation pack to stand on (default: $${FOUNDATION_ENV})
  --force         write into a folder that is not empty

The foundation is copied into .pwf/packs/<id>@<version>/ and pinned in
pwpack.json by content hash, so dev and run work offline.

With --pack, writes an empty pack instead: pwpack.json (id @pwpack/<name>
unless --id is given, version 0.1.0, engines.pwfabric this engine's major),
README.md, atoms/README.md and .gitignore. --requires names a pack it stands
on: copied into .pwf/packs/, pinned by content hash and required at
^<major>.0.0, as \`pwf add\` does. Add blocks with \`pwf add block\`.`,
  run: (args, io) => guard('create', io, () => runCreate(args, io)),
}
