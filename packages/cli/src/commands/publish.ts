/**
 * `pwf publish [dir]` — puts an app folder online on PhiWebs: `pwf pack`,
 * then the .pwpack into a studio project (a new one, or the one this folder
 * published to before), then the studio publishes it and pwf prints the
 * address. A pack folder goes to the PhiWebs marketplace instead, as the
 * workspace's publisher. Needs `pwf login`; every other command keeps
 * working without it.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { readIdentityFile } from './lib/identity.js'
import { printIssues } from './lib/issues.js'
import { PWF_DIR, resolveFrom } from './lib/project.js'
import { archiveName, packProject } from './pack.js'
import { SERVER_HELP, STUDIO_WEB_HELP } from './login.js'
import type { StoreOptions } from '../phiwebs/config.js'
import type { Fetch } from '../phiwebs/oauth.js'
import { publishPackFolder, packPublishedLines } from '../phiwebs/marketplace.js'
import { readSession, readStudioSession } from '../phiwebs/session.js'
import { importPack, publishProject, studioFailure, type StudioFinding } from '../phiwebs/studio.js'

/** Where a folder remembers the studio project it publishes to: the id only. */
export const REMEMBERED_PROJECT_FILE = `${PWF_DIR}/phiwebs.json`

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

/** What `pwf publish` reaches outside the process; tests replace each. */
export interface PublishDeps {
  readonly fetch?: Fetch
  readonly now?: () => number
  readonly platform?: NodeJS.Platform
  readonly home?: string
}

/** The project a folder published to before, or undefined. */
export async function rememberedProject(root: string): Promise<string | undefined> {
  const text = await readFile(join(root, ...REMEMBERED_PROJECT_FILE.split('/')), 'utf8').catch(() => null)
  if (text === null) return undefined
  try {
    const id = (JSON.parse(text) as { projectId?: unknown }).projectId
    return typeof id === 'string' && PROJECT_ID.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

async function rememberProject(root: string, projectId: string): Promise<void> {
  await mkdir(join(root, PWF_DIR), { recursive: true })
  await writeFile(join(root, ...REMEMBERED_PROJECT_FILE.split('/')), `${JSON.stringify({ projectId }, null, 2)}\n`)
}

function projectFlag(args: ParsedArgs): string | undefined {
  const id = stringFlag(args, 'project')
  if (id !== undefined && !PROJECT_ID.test(id)) throw new UsageError(`--project "${id}" is not a project id`)
  return id
}

export async function runPublish(args: ParsedArgs, io: CommandIO, deps: PublishDeps = {}): Promise<number> {
  if (args.positionals.length > 1) throw new UsageError(`unexpected argument "${args.positionals[1]}"`)
  const asNew = boolFlag(args, 'new')
  const named = projectFlag(args)
  if (asNew && named) throw new UsageError('--new and --project exclude each other')
  const root = resolveFrom(io.cwd, args.positionals[0])
  const store: StoreOptions = { env: io.env, ...(deps.platform ? { platform: deps.platform } : {}), ...(deps.home ? { home: deps.home } : {}) }
  const fetchImpl = deps.fetch ?? fetch
  const server = stringFlag(args, 'server')
  const studioUrl = stringFlag(args, 'studio-url')
  const sessionOptions = { ...store, ...(server ? { server } : {}), ...(studioUrl ? { studioUrl } : {}), fetch: fetchImpl, ...(deps.now ? { now: deps.now } : {}) }
  const identity = await readIdentityFile(root)

  // A pack goes to the marketplace, as the workspace's publisher.
  if (identity['app'] === undefined) {
    if (asNew || named) throw new UsageError('--new and --project are for apps; a pack is published to the marketplace')
    const api = await readSession(sessionOptions)
    if (!api) throw notSignedIn('the pack')
    const published = await publishPackFolder(root, { server: api.server, accessToken: api.accessToken, fetch: fetchImpl })
    printIssues(io, published.warnings)
    io.out(`Packed ${published.id}@${published.version} (${published.bytes} bytes)`)
    printIssues(io, published.reviewFindings)
    for (const line of packPublishedLines(published)) io.out(line)
    return 0
  }

  // Signed in first: no point packing for a studio pwf cannot reach.
  const session = await readStudioSession(sessionOptions)
  if (!session) throw notSignedIn('the app')

  const id = String(identity['id'])
  const version = String(identity['version'])
  const packed = await packProject(root, join(root, PWF_DIR, 'publish', archiveName(id, version)))
  printIssues(io, packed.warnings)
  io.out(`Packed ${packed.id}@${packed.version} (${packed.bytes} bytes, ${packed.files} files)`)

  const target = asNew ? undefined : (named ?? (await rememberedProject(root)))
  // `/s/*` goes to the studio's web origin; its resource is the token's audience only.
  const client = { studio: session.studio, url: session.url, accessToken: session.accessToken, fetch: fetchImpl }
  const bytes = new Uint8Array(await readFile(packed.file))
  const name = packed.id.split('/').pop() ?? packed.id
  const imported = await importPack(client, bytes, target ? { projectId: target } : { name })
  await rememberProject(root, imported.projectId)
  io.out(target ? `Imported into project ${imported.projectId}` : `Imported as the new project ${imported.projectId}`)
  printFindings(io, imported.findings)
  const errors = imported.findings.filter((f) => f.severity === 'error')
  if (errors.length > 0) {
    throw studioFailure('PROJECT_INVALID', `the studio found ${errors.length} error${errors.length === 1 ? '' : 's'} in the app; nothing was published`)
  }

  const published = await publishProject(client, imported.projectId)
  io.out(`Published ${published.app}@${published.version}`)
  io.out(`  url      ${published.url}`)
  io.out(`  project  ${imported.projectId} (remembered in ${REMEMBERED_PROJECT_FILE}; --new makes another)`)
  io.out(`Keep building it with the studio's AI at ${session.url}, or edit here and run \`pwf publish\` again.`)
  return 0
}

function notSignedIn(what: string): CommandFailure {
  return new CommandFailure('NOT_SIGNED_IN', 'not signed in to PhiWebs', {
    lines: [`NOT_SIGNED_IN: pwf publish puts ${what} on PhiWebs, which needs an account.`, 'fix: Run `pwf login`, then `pwf publish` again.'],
  })
}

function printFindings(io: CommandIO, findings: readonly StudioFinding[]): void {
  printIssues(
    io,
    findings.map((f) => ({ severity: f.severity, code: f.code, message: f.message, ...(f.path ? { path: f.path } : {}) }))
  )
}

export const publish: Command = {
  name: 'publish',
  summary: 'Publish an app on PhiWebs (prints its address), or a pack to its marketplace (needs pwf login)',
  usage: `pwf publish [dir] [--project <id>] [--new] [--server <url>] [--studio-url <url>]

  dir             the app or pack folder (default: the current folder)
  --project <id>  an app: the studio project to publish into
  --new           an app: make a new project, even when the folder has one
${SERVER_HELP}
${STUDIO_WEB_HELP}

An app: packs the folder (as pwf pack, refusing on errors), sends the
.pwpack to the PhiWebs studio, which validates it into a project, then
publishes the project and prints its address. The first publish makes a new
project and remembers its id in ${REMEMBERED_PROJECT_FILE}; later publishes
replace that project's app (its history keeps each import).

A pack: packs the folder and sends it to the PhiWebs marketplace as your
workspace's publisher (an approved publisher registration is needed), under
its own id, never rewritten; prints the listing and its review state.

Findings and refusals are printed with their codes and what to do. Needs
\`pwf login\`; exit 1 when not signed in or refused, 2 on a usage error.`,
  run: (args, io) => guard('publish', io, () => runPublish(args, io)),
}
