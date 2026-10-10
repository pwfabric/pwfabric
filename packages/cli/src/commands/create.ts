/**
 * `pwf create <name>` — a new app folder standing on a foundation pack.
 */
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { hashPack, packContent, validatePack } from '@pwfabric/pack'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { cacheDir, cacheRelDir, readPackSource, resolveFrom, writePackFolder, ATOMS_README } from './lib/project.js'
import { caretRange, engineRange, engineVersion, formatIdentity, formatJson } from './lib/identity.js'
import { printIssues } from './lib/report.js'
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

export async function runCreate(args: ParsedArgs, io: CommandIO, options: CreateOptions = {}): Promise<number> {
  const name = args.positionals[0]
  if (name === undefined) throw new UsageError('missing <name>')
  if (!NAME.test(name)) throw new UsageError(`"${name}" is not a valid name: use lower-case letters, digits and hyphens`)
  const target = resolveFrom(io.cwd, stringFlag(args, 'dir') ?? name)
  const force = boolFlag(args, 'force')

  const foundationPath = stringFlag(args, 'foundation') ?? io.env[FOUNDATION_ENV]
  if (!foundationPath) {
    for (const line of NO_FOUNDATION) io.err(line)
    return 1
  }
  if (!force && (await isNonEmptyDir(target))) {
    io.err(`pwf create: ${target} is not empty; choose another --dir or pass --force to write into it`)
    return 1
  }

  const foundationAbs = resolveFrom(io.cwd, foundationPath)
  const foundation = await readPackSource(foundationAbs)
  const checked = validatePack(foundation)
  if (!checked.ok || !checked.identity) {
    io.err(`pwf create: the foundation pack at ${foundationAbs} is not valid`)
    printIssues(io, checked.issues.filter((i) => i.severity === 'error'))
    return 1
  }
  const { id: foundationId, version: foundationVersion } = checked.identity
  const catalog = catalogOf(foundation, checked)
  const title = titleOf(name)
  const blocks = starterBlocks(catalog, title)
  if (blocks.length === 0) {
    io.err(`pwf create: ${foundationId}@${foundationVersion} has no heading, text or button block to start a page with`)
    return 1
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
    formatVersion: '1.0',
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

  const rel = relative(io.cwd, target)
  const shown = rel === '' ? '.' : rel.startsWith('..') || isAbsolute(rel) ? target : rel
  io.out(`Created ${identity.id} in ${target}`)
  io.out(`  foundation ${foundationId}@${foundationVersion} (${foundationHash})`)
  io.out(`  cached in  ${cacheRelDir(foundationId, foundationVersion)}`)
  io.out(`  home page  ${blocks.map((b) => b.type).join(', ')}${theme ? `; theme ${theme}` : ''}`)
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
  summary: 'Create a new app folder standing on a foundation pack',
  usage: `pwf create <name> [--dir <path>] [--foundation <folder|.pwpack>] [--force]

  <name>          lower-case letters, digits and hyphens; the app id is @pwpack/local/<name>
  --dir <path>    where to write it (default ./<name>)
  --foundation    the foundation pack to stand on (default: $${FOUNDATION_ENV})
  --force         write into a folder that is not empty

The foundation is copied into .pwf/packs/<id>@<version>/ and pinned in
pwpack.json by content hash, so dev and run work offline.`,
  run: (args, io) => guard('create', io, () => runCreate(args, io)),
}
