/**
 * `pwf publish --status [dir] [--project <id>]` — where the folder's studio
 * project stands: waiting for a person's approval (with the address to
 * approve it), online (with its address), or not published. It publishes
 * nothing; it reads the studio with the session `pwf publish` uses.
 */
import type { CommandIO, ParsedArgs } from './types.js'
import { boolFlag, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import { resolveFrom } from './lib/project.js'
import type { StoreOptions } from '../phiwebs/config.js'
import { readStudioSession } from '../phiwebs/session.js'
import { publishState } from '../phiwebs/studio.js'
import type { PublishDeps } from './publish.js'
import { REMEMBERED_PROJECT_FILE, rememberedProject } from './publish.js'

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

export async function runPublishStatus(args: ParsedArgs, io: CommandIO, deps: PublishDeps = {}): Promise<number> {
  if (args.positionals.length > 1) throw new UsageError(`unexpected argument "${args.positionals[1]}"`)
  if (boolFlag(args, 'new')) throw new UsageError('--status and --new exclude each other')
  const named = stringFlag(args, 'project')
  if (named !== undefined && !PROJECT_ID.test(named)) throw new UsageError(`--project "${named}" is not a project id`)
  const root = resolveFrom(io.cwd, args.positionals[0])
  const projectId = named ?? (await rememberedProject(root))
  if (!projectId) {
    io.out(`Not published from this folder: it remembers no studio project (${REMEMBERED_PROJECT_FILE}). \`pwf publish\` publishes it; --project <id> names another.`)
    return 0
  }
  const store: StoreOptions = { env: io.env, ...(deps.platform ? { platform: deps.platform } : {}), ...(deps.home ? { home: deps.home } : {}) }
  const server = stringFlag(args, 'server')
  const studioUrl = stringFlag(args, 'studio-url')
  const fetchImpl = deps.fetch ?? fetch
  const session = await readStudioSession({ ...store, ...(server ? { server } : {}), ...(studioUrl ? { studioUrl } : {}), fetch: fetchImpl, ...(deps.now ? { now: deps.now } : {}) })
  if (!session) {
    throw new CommandFailure('NOT_SIGNED_IN', 'not signed in to PhiWebs', {
      lines: ['NOT_SIGNED_IN: pwf publish --status reads the project on PhiWebs, which needs an account.', 'fix: Run `pwf login`, then `pwf publish --status` again.'],
    })
  }
  const state = await publishState({ studio: session.studio, url: session.url, accessToken: session.accessToken, fetch: fetchImpl }, projectId)
  if (boolFlag(args, 'json')) {
    io.out(JSON.stringify({ projectId, ...state }, null, 2))
    return 0
  }
  if (state.state === 'awaiting_approval') {
    io.out(`Waiting for approval: project ${projectId}${state.version ? ` at ${state.version}` : ''} is not online yet`)
    io.out(`  approve  ${state.approveUrl}`)
    if (state.url) io.out(`  url      ${state.url} (once approved)`)
    if (state.expiresAt) io.out(`  expires  ${state.expiresAt}`)
    if (state.live) io.out(`  online meanwhile: ${state.live.version ? `${state.live.version} at ` : ''}${state.live.url}`)
  } else if (state.state === 'live') {
    io.out(`Online: project ${projectId}${state.version ? ` at ${state.version}` : ''}`)
    io.out(`  url      ${state.url}`)
  } else {
    io.out(`Not published: project ${projectId} has nothing online and no publish waiting for approval.`)
  }
  return 0
}
