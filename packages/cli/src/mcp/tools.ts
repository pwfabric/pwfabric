/**
 * The tools `pwf mcp` serves. Each wraps what a `pwf` command does — the same
 * functions, never a copy — and answers in a shape any MCP client can use:
 * a short text a model can act on, ending with the natural next step, plus
 * `structuredContent` for a client that reads data. A failure is a tool error
 * carrying the code (the engine's validation codes, or the command's own)
 * and how to fix it.
 */
import { readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  atomManifestPath,
  blockPropDescriptors,
  blockTypeNames,
  nearestName,
  UNKNOWN_BLOCK_TYPE,
  validatePack,
  type PackFolder,
  type PackIssue,
} from '@pwfabric/pack'
import { z } from 'zod'
import { addPackFrom } from '../commands/add.js'
import { buildProject, buildRouting, buildSummary, routingLine } from '../commands/build.js'
import { createApp } from '../commands/create.js'
import { packProject } from '../commands/pack.js'
import { CommandFailure } from '../commands/lib/failure.js'
import { UsageError } from '../commands/lib/flags.js'
import { pinsOf, readIdentityFile, stripBom, type PackPin } from '../commands/lib/identity.js'
import { cacheDir, cacheRelDir, readCachedPack, readProject } from '../commands/lib/project.js'
import { countLine, validateProject } from '../commands/lib/report.js'
import { addBlock, createPack } from '../commands/lib/scaffold.js'
import { catalogOf, type FoundationBlock } from '../commands/lib/starter.js'
import { projectDirOf, readSource, writeTarget } from './paths.js'
import type { PhiwebsToolsOptions } from './phiwebs.js'

/** The answer of one tool call, as the MCP `tools/call` result. */
export interface ToolAnswer {
  [key: string]: unknown
  content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

export interface ToolDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: z.ZodRawShape
  /** Only reads: no file is written. */
  readonly readOnly: boolean
  readonly run: (input: Record<string, unknown>) => Promise<ToolAnswer>
}

/** How to fix a failure, by its code; a validation code is fixed where its path points. */
const FIXES: Readonly<Record<string, string>> = {
  USAGE: 'Correct the argument the message names and call the tool again.',
  PATH_NOT_ABSOLUTE: 'Pass projectDir as an absolute path.',
  PATH_OUTSIDE_PROJECT: 'Give a path inside projectDir, or leave it out for the default.',
  NOT_A_PROJECT: 'projectDir must be a pwpack folder (it has pwpack.json). Create one with pwf_create_app or pwf_create_pack.',
  FOUNDATION_MISSING:
    'Pass foundation: the path of a foundation .pwpack (from https://github.com/pwfabric/packs/releases) or of its folder.',
  FOUNDATION_INVALID: 'The foundation has the errors listed. Use a released foundation .pwpack from https://github.com/pwfabric/packs/releases.',
  FOUNDATION_NO_STARTER_BLOCKS: 'This pack is not a foundation (it has no heading, text or button block). Pass a foundation pack.',
  FOLDER_NOT_EMPTY: 'Choose a new or empty projectDir, or pass force: true to write into it (generated files are overwritten, others kept).',
  PACK_INVALID: 'The pack has the errors listed. Fix them in its folder and pack it again, or use a released .pwpack.',
  PACK_IS_PROJECT: 'A folder cannot install itself. Pass another pack.',
  PROJECT_INVALID: 'Fix each error listed (its code and path say what and where), then call pwf_validate.',
  BUILD_FAILED: 'Fix each error listed (its code and path say what and where), then call pwf_build again.',
  OUTPUT_FOLDER_IN_USE: 'Pass an outDir that is new, empty, or holds a previous build.',
  [UNKNOWN_BLOCK_TYPE]:
    "Pass a type pwf_describe_project lists (the folder's own blocks and its pinned packs'), or install the pack that has it with pwf_add_pack.",
}

const MAX_LISTED = 40

/** Where a finished app goes next on PhiWebs, the platform PWFabric was built for. */
export const PUBLISH_HINT =
  'To put it online, the user runs `pwf publish` in a terminal in the folder: PhiWebs publishes and hosts it at a public address (it needs `pwf login` once).'

function issueLine(i: { readonly severity: string; readonly code: string; readonly path?: string; readonly message: string }): string {
  return `- ${i.severity} ${i.code}${i.path ? ` ${i.path}` : ''}: ${i.message}`
}

function listed(issues: readonly PackIssue[]): string[] {
  const lines = issues.slice(0, MAX_LISTED).map(issueLine)
  if (issues.length > MAX_LISTED) lines.push(`- … and ${issues.length - MAX_LISTED} more (pwf_validate lists all of them)`)
  return lines
}

function ok(lines: readonly string[], next: string, data: Record<string, unknown>): ToolAnswer {
  return { content: [{ type: 'text', text: [...lines, '', `Next: ${next}`].join('\n') }], structuredContent: data }
}

/** A failure as a tool error: code, message, the findings and the fix. */
export function failureAnswer(e: unknown): ToolAnswer {
  const code = e instanceof CommandFailure ? e.code : e instanceof UsageError ? 'USAGE' : 'FAILED'
  const message = e instanceof Error ? e.message : String(e)
  const issues = e instanceof CommandFailure ? e.issues : []
  // A failure that prints its own fix (the PhiWebs ones) carries it in its lines.
  const ownFix = e instanceof CommandFailure ? e.lines?.find((l) => l.startsWith('fix: '))?.slice(5) : undefined
  const fix = FIXES[code] ?? ownFix ?? 'Read the message, correct the input or the folder, and call the tool again.'
  const text = [`${code}: ${message}`, ...listed(issues), '', `Fix: ${fix}`].join('\n')
  return {
    isError: true,
    content: [{ type: 'text', text }],
    structuredContent: { error: { code, message, fix, issues } },
  }
}

async function answer(body: () => Promise<ToolAnswer>): Promise<ToolAnswer> {
  try {
    return await body()
  } catch (e) {
    return failureAnswer(e)
  }
}

const projectDir = z.string().describe('The project folder, as an absolute path. Every write stays inside it.')

/** Blocks a pack offers, for the describe answer. */
interface CatalogEntry {
  readonly pack: string
  readonly blocks: readonly FoundationBlock[]
  readonly themes: readonly string[]
}

async function surfacesOf(root: string): Promise<string[]> {
  const entries = await readdir(join(root, 'app', 'surfaces')).catch(() => [] as string[])
  return entries
    .filter((f) => f.endsWith('.receipt.json'))
    .map((f) => f.slice(0, -'.receipt.json'.length))
    .sort()
}

async function pinnedCatalog(root: string, pin: PackPin): Promise<CatalogEntry | { readonly pack: string; readonly missing: true }> {
  const label = `${pin.id}@${pin.version}`
  const pack = await readCachedPack(cacheDir(root, pin.id, pin.version)).catch(() => null)
  if (!pack || pack.files.size === 0) return { pack: label, missing: true }
  const catalog = catalogOf(pack, validatePack(pack))
  return { pack: label, blocks: catalog.blocks, themes: catalog.themes }
}

function blockLine(b: FoundationBlock): string {
  return `  - ${b.type} (${b.id})${b.props.length ? ` props: ${b.props.join(', ')}` : ''}${b.purpose ? ` — ${b.purpose}` : ''}`
}

/** Where a block was found: the folder itself or one of its pinned packs, as `<id>@<version>`. */
interface FoundBlock {
  readonly pack: string
  readonly own: boolean
  readonly atomId: string
  readonly manifestPath: string
  readonly manifest: Record<string, unknown>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function manifestAt(folder: PackFolder, path: string): Record<string, unknown> | undefined {
  const bytes = folder.files.get(path)
  if (!bytes) return undefined
  try {
    const value: unknown = JSON.parse(stripBom(new TextDecoder().decode(bytes)))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * The block a receipt's `type` resolves to, as `pwf dev` and `pwf build`
 * resolve it: the folder's own blocks first, then its pinned packs in pin
 * order; the first that answers to the name wins. Also every name the
 * sources answer to, for "did you mean", and the pins not in the cache.
 */
async function findBlock(
  root: string,
  identity: Record<string, unknown>,
  type: string
): Promise<{ found?: FoundBlock; names: string[]; missing: string[] }> {
  const sources: { pack: string; own: boolean; folder: PackFolder }[] = [
    { pack: `${String(identity['id'])}@${String(identity['version'])}`, own: true, folder: await readProject(root) },
  ]
  const missing: string[] = []
  for (const pin of pinsOf(identity as { packs?: readonly PackPin[] })) {
    const folder = await readCachedPack(cacheDir(root, pin.id, pin.version)).catch(() => null)
    if (!folder || folder.files.size === 0) missing.push(`${pin.id}@${pin.version}`)
    else sources.push({ pack: `${pin.id}@${pin.version}`, own: false, folder })
  }
  const names = new Set<string>()
  let found: FoundBlock | undefined
  for (const source of sources) {
    for (const atom of validatePack(source.folder).atoms) {
      if (atom.kind !== 'block') continue
      const manifestPath = atomManifestPath(atom)
      const manifest = manifestAt(source.folder, manifestPath)
      const answers = blockTypeNames(atom.id, manifest)
      answers.forEach((n) => names.add(n))
      if (!found && manifest && answers.includes(type)) found = { pack: source.pack, own: source.own, atomId: atom.id, manifestPath, manifest }
    }
  }
  return { ...(found ? { found } : {}), names: [...names].sort(), missing }
}

/** Names close to `type`: the nearest spelling and the names that contain it or that it contains. */
function nearMatches(type: string, names: readonly string[]): string[] {
  const lower = type.toLowerCase()
  const near = nearestName(type, names)
  const containing = names.filter((n) => n.toLowerCase().includes(lower) || (n.length > 2 && lower.includes(n.toLowerCase())))
  return [...new Set([...(near ? [near] : []), ...containing])].slice(0, 5)
}

const json = (v: unknown): string => JSON.stringify(v) ?? String(v)

/** One prop of a block, as the describe answer prints it. */
function propLines(p: Record<string, unknown>): string[] {
  const schema = isRecord(p['jsonSchema']) ? p['jsonSchema'] : undefined
  const shown = typeof p['type'] === 'string' ? p['type'] : schema?.['type'] !== undefined ? json(schema['type']) : 'any'
  const flags = [shown, ...(p['required'] === true ? ['required'] : []), ...(p['copy'] === true ? ['copy'] : []), ...(p['bindable'] === false ? ['literal only'] : [])]
  const head = `  - ${String(p['name'])} (${flags.join(', ')})${'default' in p ? ` default ${json(p['default'])}` : ''}${typeof p['description'] === 'string' ? ` — ${p['description']}` : ''}`
  return schema ? [head, `      jsonSchema ${json(schema)}`] : [head]
}

/** The manifest's `knowledge`, member by member, as written. */
function knowledgeLines(knowledge: Record<string, unknown>): string[] {
  return Object.entries(knowledge).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`  ${key}: ${value}`]
      : Array.isArray(value)
        ? [`  ${key}:${value.length ? '' : ' none'}`, ...value.map((v) => `    - ${typeof v === 'string' ? v : json(v)}`)]
        : [`  ${key}: ${json(value)}`]
  )
}

/**
 * pwf_add_pack. `phiwebs` is where the PhiWebs session lives, for a pack named
 * by its id; without it (a server made with no PhiWebs options) a pack id
 * finds no session, as when the user is not signed in.
 */
export const ADD_PACK_TOOL = 'pwf_add_pack'

export function addPackTool(phiwebs?: PhiwebsToolsOptions): ToolDefinition {
  return {
    name: ADD_PACK_TOOL,
    title: 'Add a pack to a project',
    description:
      'Install a pack into an app or pack folder: its content is copied to .pwf/packs/<id>@<version>/, pinned in pwpack.json by content hash and required at ^<major>.0.0. The pack is a local .pwpack or pack folder (released open packs: https://github.com/pwfabric/packs/releases), or the id @pwpack/<handle>/<name>[@<version>] of a pack installed in the signed-in PhiWebs workspace (needs `pwf login`): downloaded, checked against its sha256, and installed the same way.',
    inputSchema: {
      projectDir,
      pack: z
        .string()
        .describe('A .pwpack file or a pack folder (absolute, or relative to projectDir), or a PhiWebs pack id @pwpack/<handle>/<name>[@<version>].'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const added = await addPackFrom(root, root, input['pack'] as string, phiwebs)
        return ok(
          [`Added ${added.id}@${added.version}`, `Cached in ${added.cachedIn}, pinned ${added.hash}, requires ${added.range}`],
          'call pwf_describe_project to see the blocks it offers and pwf_describe_block for one in full, place them in a receipt, then pwf_validate.',
          { ...added }
        )
      }),
  }
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: 'pwf_create_app',
    title: 'Create an app',
    description:
      'Create a new PWFabric app folder standing on a foundation pack: pwpack.json, a plan, appearance and navigation, and a home page placing a heading, a text and a button from the foundation. The foundation is copied into the folder and pinned by content hash, so everything after works offline. Get a foundation .pwpack from https://github.com/pwfabric/packs/releases.',
    inputSchema: {
      projectDir: projectDir.describe('The new app folder, as an absolute path (created if missing).'),
      foundation: z.string().describe('The foundation pack: a .pwpack file or a pack folder (absolute, or relative to projectDir).'),
      name: z
        .string()
        .optional()
        .describe('Lower-case letters, digits and hyphens; the app id becomes @pwpack/local/<name>. Default: the folder name.'),
      force: z.boolean().optional().describe('Write into a folder that is not empty.'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const dir = projectDirOf(input['projectDir'] as string)
        const created = await createApp({
          name: (input['name'] as string | undefined) ?? basename(dir),
          dir,
          foundation: readSource(dir, input['foundation'] as string),
          force: input['force'] === true,
        })
        return ok(
          [
            `Created ${created.id} in ${created.dir}`,
            `Foundation ${created.foundation.id}@${created.foundation.version}, pinned ${created.foundation.hash}`,
            `Home page (app/surfaces/home.receipt.json): ${created.homeBlocks.join(', ')}${created.theme ? `; theme ${created.theme}` : ''}`,
          ],
          'call pwf_describe_project to see the blocks the foundation offers, write the pages in app/surfaces/ and the messages in app/plan.json (the app writes every word), then pwf_validate. To preview, the user runs `pwf dev` in a terminal in the folder.',
          { ...created }
        )
      }),
  },
  {
    name: 'pwf_create_pack',
    title: 'Create a pack',
    description:
      'Create a new, empty pack folder for authoring blocks: pwpack.json (id @pwpack/<name> unless id is given, version 0.1.0), README.md, atoms/README.md and .gitignore. Add blocks with pwf_add_block.',
    inputSchema: {
      projectDir: projectDir.describe('The new pack folder, as an absolute path (created if missing).'),
      name: z.string().describe('kebab-case, 2–50 characters, starting with a letter.'),
      id: z.string().optional().describe('The pack id when it is not @pwpack/<name>, e.g. @pwpack/acme/cards.'),
      requires: z.string().optional().describe('A pack this one stands on (.pwpack or folder): cached, pinned and required.'),
      force: z.boolean().optional().describe('Write into a folder that is not empty.'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const dir = projectDirOf(input['projectDir'] as string)
        const requires = input['requires'] as string | undefined
        const id = input['id'] as string | undefined
        const created = await createPack({
          name: input['name'] as string,
          dir,
          ...(id !== undefined ? { id } : {}),
          ...(requires !== undefined ? { requires: readSource(dir, requires) } : {}),
          force: input['force'] === true,
        })
        const lines = [`Created ${created.id}@${created.version} in ${created.dir}`, `Wrote ${created.files.join(', ')}`]
        if (created.requires) lines.push(`Requires ${created.requires.id} ${created.requires.range} (pinned ${created.requires.hash})`)
        return ok(lines, 'call pwf_add_block to add a block, then pwf_validate.', { ...created })
      }),
  },
  addPackTool(),
  {
    name: 'pwf_add_block',
    title: 'Add a block',
    description:
      "Write a new block into an app or pack folder: atoms/blocks/<category>/<type>/manifest.json (id <category>.<type>, no props yet, a knowledge skeleton) and component.tsx (renders only its props; a block holds no words of its own). A type the folder or its packs already answer to is refused.",
    inputSchema: {
      projectDir,
      block: z.string().describe('<category>/<type>, both kebab-case, e.g. content/price-tag.'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const added = await addBlock({ root, block: input['block'] as string })
        return ok(
          [`Added block ${added.id}`, ...added.files.map((f) => `Wrote ${f}`)],
          `declare its props in ${added.dir}/manifest.json (definition.props: name, jsonSchema, default), render them in component.tsx, answer the knowledge questions in the manifest, then pwf_validate.`,
          { ...added }
        )
      }),
  },
  {
    name: 'pwf_describe_project',
    title: 'Describe a project',
    description:
      'Read an app or pack folder without changing it: its id and version, whether it is an app or a pack, its pages, the packs it pins, and the blocks (type, prop names and purpose) and themes those packs and the folder itself offer. Call it before writing a page; pwf_describe_block gives one block in full.',
    inputSchema: { projectDir },
    readOnly: true,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const identity = await readIdentityFile(root)
        const kind = identity['app'] !== undefined ? 'app' : 'pack'
        const own = await readProject(root)
        const ownCatalog = catalogOf(own, validatePack(own))
        const pins = pinsOf(identity as { packs?: readonly PackPin[] })
        const packs = await Promise.all(pins.map((p) => pinnedCatalog(root, p)))
        const surfaces = await surfacesOf(root)
        const lines = [`${String(identity['id'])}@${String(identity['version'])} — ${kind} in ${root}`]
        if (kind === 'app') lines.push(`Pages (app/surfaces/): ${surfaces.length ? surfaces.join(', ') : 'none'}`)
        lines.push('Blocks are listed by type; pwf_describe_block with a type gives its props (schema, default, description) and its knowledge.')
        if (ownCatalog.blocks.length) {
          lines.push('Its own blocks:', ...ownCatalog.blocks.map(blockLine))
        }
        for (const p of packs) {
          if ('missing' in p) {
            lines.push(`Pinned ${p.pack}: not in ${cacheRelDir(...splitLabel(p.pack))}; install it with pwf_add_pack`)
            continue
          }
          lines.push(`Pinned ${p.pack}: ${p.blocks.length} blocks${p.themes.length ? `, themes ${p.themes.join(', ')}` : ''}`)
          lines.push(...p.blocks.map(blockLine))
        }
        const next =
          kind === 'app'
            ? 'call pwf_describe_block for each block you will place, place them by type in app/surfaces/<page>.receipt.json with every text set as a prop, then pwf_validate.'
            : 'call pwf_describe_block to read a block in full, pwf_add_block for a new block, or pwf_validate.'
        return ok(lines, next, {
          id: identity['id'],
          version: identity['version'],
          kind,
          dir: root,
          surfaces,
          blocks: ownCatalog.blocks,
          themes: ownCatalog.themes,
          packs,
        })
      }),
  },
  {
    name: 'pwf_describe_block',
    title: 'Describe a block',
    description:
      "Read one block an app or pack folder can place, without changing anything: the pack it comes from (the folder's own blocks first, then its pinned packs, as pwf dev and pwf build resolve a type), its id and type, every prop with its JSON schema (type, enum, required), default and description, whether it takes children, and its full knowledge (purpose, use cases, what it composes with, anti-patterns). Call it before placing a block whose props you have not read.",
    inputSchema: {
      projectDir,
      type: z.string().min(1).describe('The block type as a receipt names it (e.g. button, or its atom id control.button); pwf_describe_project lists them.'),
    },
    readOnly: true,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const type = input['type'] as string
        const identity = await readIdentityFile(root)
        const { found, names, missing } = await findBlock(root, identity, type)
        if (!found) {
          const near = nearMatches(type, names)
          const notCached = missing.length ? `; not in the cache, so not searched: ${missing.join(', ')} (install with pwf_add_pack)` : ''
          throw new CommandFailure(
            UNKNOWN_BLOCK_TYPE,
            `no block answers to "${type}" in this folder or its pinned packs${near.length ? `; did you mean ${near.join(', ')}?` : ''}${notCached}`
          )
        }
        const m = found.manifest
        const definition = isRecord(m['definition']) ? m['definition'] : {}
        const props = (blockPropDescriptors(m) ?? []) as unknown as Record<string, unknown>[]
        const knowledge = isRecord(m['knowledge']) ? m['knowledge'] : {}
        const canHaveChildren = definition['canHaveChildren'] === true
        const blockType = typeof m['name'] === 'string' ? m['name'] : (found.atomId.split('.').pop() as string)
        const extra = (['allowedParents', 'allowedChildTraits', 'traits'] as const).filter((k) => Array.isArray(definition[k]) && (definition[k] as unknown[]).length)
        const lines = [
          `${blockType} (${found.atomId}) from ${found.pack}${found.own ? ' (this folder)' : ''}, ${found.manifestPath}`,
          ...[
            typeof m['state'] === 'string' ? `State: ${m['state']}` : '',
            typeof m['description'] === 'string' ? `Description: ${m['description']}` : '',
          ].filter(Boolean),
          props.length ? `Props (${props.length}):` : 'Props: none',
          ...props.flatMap(propLines),
          `Children: ${canHaveChildren ? 'yes, it is a container' : 'no, it is a leaf'}`,
          ...extra.map((k) => `${k}: ${(definition[k] as unknown[]).map((v) => String(v)).join(', ')}`),
          'Knowledge:',
          ...knowledgeLines(knowledge),
        ]
        return ok(
          lines,
          `place it as { "type": "${blockType}", "props": { … } } in a receipt, with every text the visitor reads set as a prop, then pwf_validate.`,
          {
            pack: found.pack,
            own: found.own,
            id: found.atomId,
            type: blockType,
            manifest: found.manifestPath,
            ...(typeof m['state'] === 'string' ? { state: m['state'] } : {}),
            ...(typeof m['description'] === 'string' ? { description: m['description'] } : {}),
            props,
            ...(isRecord(definition['defaultProps']) ? { defaultProps: definition['defaultProps'] } : {}),
            canHaveChildren,
            ...Object.fromEntries(extra.map((k) => [k, definition[k]])),
            knowledge,
          }
        )
      }),
  },
  {
    name: 'pwf_validate',
    title: 'Validate a project',
    description:
      'Check an app or pack folder the way `pwf validate` does: the pack format, the pinned packs against their cached builds, every placed block against its manifest, and the words the app must write. Lists errors, warnings and notes, each with a code and the file it is about.',
    inputSchema: { projectDir },
    readOnly: true,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const result = await validateProject(root, await readProject(root))
        const who = result.identity ? `${result.identity.id}@${result.identity.version}` : root
        const isApp = (await readIdentityFile(root).catch(() => ({}) as Record<string, unknown>))['app'] !== undefined
        const head = `${who}: ${result.ok ? 'valid' : 'invalid'} (${countLine(result.issues)}; ${result.atoms.length} atoms)`
        const next = !result.ok
          ? 'fix each error above by its code and path, then call pwf_validate again.'
          : isApp
            ? 'call pwf_build to write the static site, or pwf_pack for the .pwpack. To preview, the user runs `pwf dev` in a terminal.'
            : 'call pwf_pack to write the .pwpack.'
        // An invalid folder is an answer, not a failed call: the findings are the result.
        return ok([head, ...listed(result.issues)], next, {
          ok: result.ok,
          id: result.identity?.id ?? null,
          version: result.identity?.version ?? null,
          issues: result.issues,
        })
      }),
  },
  {
    name: 'pwf_build',
    title: 'Build an app',
    description:
      'Assemble an app folder into a static pwapp (HTML, the engine and the compiled blocks) the way `pwf build` does, ready for any static host or `pwf run`. Writes nothing when the app has errors.',
    inputSchema: {
      projectDir,
      outDir: z.string().optional().describe('Where to write, inside projectDir (default .pwf/out). Replaces a previous build there.'),
      router: z
        .enum(['hash', 'path', 'auto'])
        .optional()
        .describe(
          "How the built app routes, as `pwf build --router`. hash (default): #/<page> addresses, works on every static host. path: clean /<page> addresses; the host must answer every page path with index.html. auto: path where the browser can, else hash."
        ),
      base: z
        .string()
        .optional()
        .describe('With router path or auto: the path the app is served under, as `pwf build --base` (default /; e.g. /shop/).'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const out = writeTarget(root, input['outDir'] as string | undefined, 'outDir')
        const routing = buildRouting(input['router'], input['base'], { router: 'router', base: 'base' })
        const built = await buildProject(root, out, routing)
        const issues = built.result.diagnostics.map((d) => ({
          severity: d.severity,
          code: d.code,
          message: d.message,
          ...(d.path ? { path: d.line !== undefined ? `${d.path}:${d.line}` : d.path } : {}),
        })) as PackIssue[]
        if (!built.written) {
          const errors = issues.filter((i) => i.severity === 'error').length
          throw new CommandFailure('BUILD_FAILED', `${errors} error${errors === 1 ? '' : 's'}; nothing written`, { issues })
        }
        return ok(
          [buildSummary(built.result), ...(routingLine(routing) ? [routingLine(routing) as string] : []), `Wrote ${built.result.files.size} files to ${built.out}`, ...listed(issues)],
          `the user can serve it with \`pwf run ${built.out}\` (or \`pwf dev\` while editing) in a terminal; pwf_pack writes the .pwpack. ${PUBLISH_HINT}`,
          { out: built.out, files: built.result.files.size, router: routing.router, ...(routing.router !== 'hash' ? { base: routing.base ?? '/' } : {}), stats: { ...built.result.stats }, diagnostics: issues }
        )
      }),
  },
  {
    name: 'pwf_pack',
    title: 'Pack a project',
    description:
      'Validate an app or pack folder and write its deterministic .pwpack archive (pack content only: pwpack.json, LICENSE, NOTICE, README.md, app/, atoms/, media/). The same folder always gives the same bytes; the content hash is the one pins use. Refuses on errors.',
    inputSchema: {
      projectDir,
      out: z.string().optional().describe('The archive to write, inside projectDir (default <name>-<version>.pwpack in it).'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const out = writeTarget(root, input['out'] as string | undefined, 'out')
        const packed = await packProject(root, out)
        const isApp = (await readIdentityFile(root))['app'] !== undefined
        return ok(
          [
            `Packed ${packed.id}@${packed.version}`,
            `File ${packed.file} (${packed.bytes} bytes, ${packed.files} files)`,
            `Content hash ${packed.hash}`,
            ...listed(packed.warnings),
          ],
          isApp ? `share the .pwpack, or ${PUBLISH_HINT.charAt(0).toLowerCase()}${PUBLISH_HINT.slice(1)}` : 'install it into an app with pwf_add_pack, or share the .pwpack.',
          { ...packed }
        )
      }),
  },
]

/** `@scope/name@1.2.3` → [`@scope/name`, `1.2.3`]. */
function splitLabel(label: string): [string, string] {
  const at = label.lastIndexOf('@')
  return [label.slice(0, at), label.slice(at + 1)]
}
