/**
 * The skeletons the authoring commands write: a new pack folder
 * (`pwf create --pack`) and a new block inside a pack or app folder
 * (`pwf add block`). Plain functions over the file system, so a tool that
 * scaffolds packs calls them directly instead of keeping its own copy of the
 * format.
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { blockTypeNames, hashPack, packContent, packFromRecord, validatePack } from '@pwfabric/pack'
import { UsageError } from './flags.js'
import { cacheDir, readPackSource, readProject, writePackFolder } from './project.js'
import { caretRange, engineRange, engineVersion, formatIdentity, formatJson, readIdentityFile } from './identity.js'

/** A pack or block name: kebab-case, starting with a letter, 2–50 characters. */
export const SCAFFOLD_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/
const NAME_MIN = 2
const NAME_MAX = 50

/** Why `name` is not a scaffold name, or undefined when it is one. */
export function scaffoldNameProblem(name: string): string | undefined {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return `must be ${NAME_MIN}–${NAME_MAX} characters`
  if (!SCAFFOLD_NAME.test(name)) return 'use lower-case letters, digits and single hyphens, starting with a letter'
  return undefined
}

/**
 * A pack id: a scope and one or two names, each lower-case letters, digits and
 * hyphens (`@pwpack/cards`, `@pwpack/acme/cards`).
 */
export const PACK_ID = /^@[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){1,2}$/

function checkName(what: string, name: string): void {
  const problem = scaffoldNameProblem(name)
  if (problem) throw new UsageError(`"${name}" is not a valid ${what}: ${problem}`)
}

async function isNonEmptyDir(dir: string): Promise<boolean> {
  const entries = await readdir(dir).catch(() => null)
  return entries !== null && entries.length > 0
}

async function writeAll(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const abs = join(root, ...path.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, text)
  }
}

// ── pwf create --pack ───────────────────────────────────────────────────

export interface CreatePackOptions {
  /** The pack's name: kebab-case. Its id is `@pwpack/<name>` unless `id` is given. */
  readonly name: string
  /** The folder to write (absolute). */
  readonly dir: string
  /** The pack id, when it is not `@pwpack/<name>`. */
  readonly id?: string
  /** A pack (folder or `.pwpack`, absolute) this pack stands on: cached, pinned and required. */
  readonly requires?: string
  /** Write into a folder that is not empty. */
  readonly force?: boolean
  /** Engine version to declare a range for; defaults to the installed engine's. */
  readonly engineVersion?: string
}

export interface CreatedPack {
  readonly id: string
  readonly version: string
  readonly dir: string
  /** The files written, folder-relative, in write order (the requirement's cache not included). */
  readonly files: readonly string[]
  /** The pack it stands on, when `requires` was given. */
  readonly requires?: { readonly id: string; readonly version: string; readonly range: string; readonly hash: string }
}

export const PACK_ATOMS_README_TEXT = `# atoms/

This pack's reusable parts. Empty to start.

Add a block with \`pwf add block <category>/<type>\`: it writes
\`atoms/blocks/<category>/<type>/manifest.json\` and \`component.tsx\`. The pwpack
format and block manifest documents of the PWFabric specification describe
every atom family.

This README is documentation, not an atom: it travels with the pack and
validation notes it as such (DOC_FILE).
`

export const PACK_GITIGNORE_TEXT = `.pwf/\n*.pwpack\n`

function packReadme(id: string): string {
  return `# ${id}

A PWFabric pack. Its atoms are under \`atoms/\`; \`pwpack.json\` is its identity.

Next:

\`\`\`text
pwf add block <category>/<type>   # a new block in atoms/blocks/
pwf validate                      # check the folder
pwf pack                          # write the .pwpack
\`\`\`
`
}

/** Writes a new pack folder in the canonical layout. Throws a {@link UsageError} for a bad name. */
export async function createPack(options: CreatePackOptions): Promise<CreatedPack> {
  checkName('pack name', options.name)
  const id = options.id ?? `@pwpack/${options.name}`
  if (!PACK_ID.test(id)) throw new UsageError(`"${id}" is not a pack id: write @<scope>/<name> or @<scope>/<publisher>/<name> in lower-case letters, digits and hyphens`)
  if (!options.force && (await isNonEmptyDir(options.dir))) {
    throw new Error(`${options.dir} is not empty; choose another --dir or pass --force to write into it`)
  }

  let requirement: CreatedPack['requires']
  let requiredContent: ReturnType<typeof packContent> | undefined
  if (options.requires !== undefined) {
    const source = await readPackSource(options.requires)
    const checked = validatePack(source)
    if (!checked.ok || !checked.identity) {
      const first = checked.issues.find((i) => i.severity === 'error')
      throw new Error(`${options.requires} is not a valid pack${first ? ` (${first.code}: ${first.message})` : ''}`)
    }
    if (checked.identity.id === id) throw new Error(`${id} cannot require itself`)
    requiredContent = packContent(source)
    const { id: reqId, version: reqVersion } = checked.identity
    requirement = { id: reqId, version: reqVersion, range: caretRange(reqVersion), hash: hashPack(requiredContent) }
  }

  const identity: Record<string, unknown> = {
    id,
    version: '0.1.0',
    formatVersion: '1.1',
    engines: { pwfabric: engineRange(options.engineVersion ?? engineVersion()) },
    requires: requirement ? [{ id: requirement.id, range: requirement.range }] : [],
    ...(requirement ? { packs: [{ id: requirement.id, version: requirement.version, hash: requirement.hash }] } : {}),
  }
  const files: Record<string, string> = {
    'pwpack.json': formatIdentity(identity),
    'README.md': packReadme(id),
    'atoms/README.md': PACK_ATOMS_README_TEXT,
    '.gitignore': PACK_GITIGNORE_TEXT,
  }
  // Checked before anything is written: an --id the format refuses leaves no folder behind.
  const checked = validatePack(packFromRecord(files))
  if (!checked.ok) {
    const first = checked.issues.find((i) => i.severity === 'error')
    throw new UsageError(`"${id}" does not make a valid pack${first ? `: ${first.message}` : ''}`)
  }

  await writeAll(options.dir, files)
  if (requirement && requiredContent) await writePackFolder(cacheDir(options.dir, requirement.id, requirement.version), requiredContent)
  return { id, version: '0.1.0', dir: options.dir, files: Object.keys(files), ...(requirement ? { requires: requirement } : {}) }
}

// ── pwf add block ───────────────────────────────────────────────────────

export interface AddBlockOptions {
  /** The pack or app folder (absolute); it must have a `pwpack.json`. */
  readonly root: string
  /** `<category>/<type>`, e.g. `content/price-tag`. */
  readonly block: string
}

export interface AddedBlock {
  /** The atom id, `<category>.<type>`. */
  readonly id: string
  readonly category: string
  readonly type: string
  /** The block's folder, root-relative: `atoms/blocks/<category>/<type>`. */
  readonly dir: string
  /** The files written, root-relative. */
  readonly files: readonly string[]
}

/** `price-tag` → `PriceTag`. */
export function pascalOf(name: string): string {
  return name
    .split('-')
    .map((w) => (w[0] as string).toUpperCase() + w.slice(1))
    .join('')
}

/**
 * The block's manifest: a valid atom manifest with no props yet. The
 * knowledge members are the questions the author answers; the composer reads
 * them to choose the block, so they are filled in before the pack is
 * published.
 */
export function blockManifest(category: string, type: string): Record<string, unknown> {
  return {
    id: `${category}.${type}`,
    kind: 'block',
    version: '0.1.0',
    category,
    name: type,
    state: 'experimental',
    knowledge: {
      purpose: `What ${type} does, in one sentence.`,
      useCases: [`A situation that should reach for ${type}.`],
      composesWith: [],
      antiPatterns: [`A situation where ${type} is the wrong choice.`],
    },
    definition: {
      props: [],
      defaultProps: {},
      canHaveChildren: false,
    },
  }
}

/**
 * The block's component. It renders only what its props carry: the app
 * writes every word, so the block holds no text of its own.
 */
export function blockComponent(category: string, type: string): string {
  const pascal = pascalOf(type)
  return `import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { Block } from '@pwfabric/contracts'

/**
 * The props of ${category}.${type}. Declare each one in manifest.json
 * (definition.props: name, jsonSchema, default) and read it here; the
 * runtime applies the declared defaults before the block renders.
 */
export interface ${pascal}Props {}

export interface ${pascal}BlockProps {
  readonly block: Block
  readonly props: ${pascal}Props
  readonly children?: ReactNode
}

export default function ${pascal}Block({ block }: ${pascal}BlockProps): ReactElement {
  return <div id={block.id} data-block-id={block.id} data-block-type="${type}" style={block.style as CSSProperties | undefined} />
}
`
}

/** Writes a new block into a pack or app folder. Throws a {@link UsageError} for a bad name. */
export async function addBlock(options: AddBlockOptions): Promise<AddedBlock> {
  const parts = options.block.split('/')
  if (parts.length !== 2) throw new UsageError(`"${options.block}" is not <category>/<type>`)
  const [category, type] = parts as [string, string]
  checkName('block category', category)
  checkName('block type', type)
  await readIdentityFile(options.root)

  const dir = `atoms/blocks/${category}/${type}`
  const existing = await stat(join(options.root, ...dir.split('/'))).catch(() => null)
  if (existing) throw new Error(`${dir} already exists; choose another type`)
  // A receipt names a block by its id or its last segment, so a type another
  // category already has would be two blocks answering to one name.
  const taken = validatePack(await readProject(options.root)).atoms.find(
    (a) => a.kind === 'block' && blockTypeNames(a.id).includes(type)
  )
  if (taken) throw new Error(`the block ${taken.id} already answers to "${type}"; choose another type`)
  const files: Record<string, string> = {
    [`${dir}/manifest.json`]: formatJson(blockManifest(category, type)),
    [`${dir}/component.tsx`]: blockComponent(category, type),
  }
  await writeAll(options.root, files)
  return { id: `${category}.${type}`, category, type, dir, files: Object.keys(files) }
}
