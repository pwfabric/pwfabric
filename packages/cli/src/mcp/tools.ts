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
import { validatePack, type PackIssue } from '@pwfabric/pack'
import { z } from 'zod'
import { addPack } from '../commands/add.js'
import { buildProject, buildSummary } from '../commands/build.js'
import { createApp } from '../commands/create.js'
import { packProject } from '../commands/pack.js'
import { CommandFailure } from '../commands/lib/failure.js'
import { UsageError } from '../commands/lib/flags.js'
import { pinsOf, readIdentityFile, type PackPin } from '../commands/lib/identity.js'
import { cacheDir, cacheRelDir, readCachedPack, readProject } from '../commands/lib/project.js'
import { countLine, validateProject } from '../commands/lib/report.js'
import { addBlock, createPack } from '../commands/lib/scaffold.js'
import { catalogOf, type FoundationBlock } from '../commands/lib/starter.js'
import { projectDirOf, readSource, writeTarget } from './paths.js'

/** The answer of one tool call, as the MCP `tools/call` result. */
export interface ToolAnswer {
  [key: string]: unknown
  content: { type: 'text'; text: string }[]
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
}

const MAX_LISTED = 40

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
  const fix = FIXES[code] ?? 'Read the message, correct the input or the folder, and call the tool again.'
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
  {
    name: 'pwf_add_pack',
    title: 'Add a pack to a project',
    description:
      'Install a pack build (.pwpack or pack folder) into an app or pack folder: its content is copied to .pwf/packs/<id>@<version>/, pinned in pwpack.json by content hash and required at ^<major>.0.0. Only local files: download released packs from https://github.com/pwfabric/packs/releases first.',
    inputSchema: {
      projectDir,
      pack: z.string().describe('The pack to install: a .pwpack file or a pack folder (absolute, or relative to projectDir).'),
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const added = await addPack(root, readSource(root, input['pack'] as string))
        return ok(
          [`Added ${added.id}@${added.version}`, `Cached in ${added.cachedIn}, pinned ${added.hash}, requires ${added.range}`],
          'call pwf_describe_project to see the blocks it offers, place them in a receipt, then pwf_validate.',
          { ...added }
        )
      }),
  },
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
      'Read an app or pack folder without changing it: its id and version, whether it is an app or a pack, its pages, the packs it pins, and the blocks (with their props and purpose) and themes those packs and the folder itself offer. Call it before writing a page.',
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
            ? 'place blocks by type in app/surfaces/<page>.receipt.json with every text set as a prop, then pwf_validate.'
            : 'call pwf_add_block for a new block, or pwf_validate.'
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
    },
    readOnly: false,
    run: (input) =>
      answer(async () => {
        const root = projectDirOf(input['projectDir'] as string)
        const out = writeTarget(root, input['outDir'] as string | undefined, 'outDir')
        const built = await buildProject(root, out)
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
          [buildSummary(built.result), `Wrote ${built.result.files.size} files to ${built.out}`, ...listed(issues)],
          `the user can serve it with \`pwf run ${built.out}\` (or \`pwf dev\` while editing) in a terminal; pwf_pack writes the .pwpack.`,
          { out: built.out, files: built.result.files.size, stats: { ...built.result.stats }, diagnostics: issues }
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
        return ok(
          [
            `Packed ${packed.id}@${packed.version}`,
            `File ${packed.file} (${packed.bytes} bytes, ${packed.files} files)`,
            `Content hash ${packed.hash}`,
            ...listed(packed.warnings),
          ],
          'install it into an app with pwf_add_pack, or share the .pwpack.',
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
