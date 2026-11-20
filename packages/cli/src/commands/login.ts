/**
 * `pwf login`, `pwf logout`, `pwf whoami` — signing the CLI in to PhiWebs,
 * the platform PWFabric was built for. One sign-in covers two resources: the
 * PhiWebs API (who you are, which workspace) and the PhiWebs studio (`pwf
 * publish`, the PhiWebs tools of `pwf mcp`). Nothing else in `pwf` needs an
 * account: the account-free commands never read the session.
 */
import { spawn } from 'node:child_process'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import {
  DEFAULT_STUDIO_RESOURCE,
  DEFAULT_STUDIO_WEB,
  defaultStudioWeb,
  deleteTokens,
  namedStudioResource,
  namedStudioWeb,
  PHIWEBS_URL_ENV,
  readTokens,
  saveClient,
  saveTokens,
  serverUrl,
  STUDIO_RESOURCE_ENV,
  STUDIO_WEB_ENV,
  type StoreOptions,
} from '../phiwebs/config.js'
import {
  authorizationUrl,
  discover,
  exchangeCode,
  LOGIN_SCOPES,
  newState,
  pkcePair,
  refreshTokens,
  registerClient,
  revokeToken,
  serverError,
  startLoopback,
  type Fetch,
} from '../phiwebs/oauth.js'
import { readSession, readStudioSession, STUDIO_UPGRADE_HINT, studioTokenFrom, tokensFrom } from '../phiwebs/session.js'

/** What the account commands reach outside the process; tests replace each. */
export interface AccountDeps {
  readonly fetch?: Fetch
  /** Opens the sign-in address in the user's browser. */
  readonly openBrowser?: (url: string) => void | Promise<void>
  readonly now?: () => number
  readonly platform?: NodeJS.Platform
  readonly home?: string
  /** How long login waits for the browser; default five minutes. */
  readonly timeoutMs?: number
}

/** The PhiWebs API paths `pwf whoami` reads. */
export const WHOAMI_PATHS = {
  /** OpenID userinfo: the account (needs `openid`, `email`). */
  account: '/api/oauth/userinfo',
  /** The workspace the grant was made in (needs `world:read`). */
  workspace: '/api/worlds/me',
} as const

const LOGIN_TIMEOUT_MS = 5 * 60_000

/** Opens `url` with the operating system's handler; never throws (the address is printed too). */
export function openInBrowser(url: string, platform: NodeJS.Platform = process.platform): void {
  const [cmd, args] =
    platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // The address is on the terminal; the user opens it.
  }
}

function storeOf(io: CommandIO, deps: AccountDeps): StoreOptions {
  return { env: io.env, ...(deps.platform ? { platform: deps.platform } : {}), ...(deps.home ? { home: deps.home } : {}) }
}

function noPositionals(args: ParsedArgs): void {
  if (args.positionals.length > 0) throw new UsageError(`unexpected argument "${args.positionals[0]}"`)
}

export async function runLogin(args: ParsedArgs, io: CommandIO, deps: AccountDeps = {}): Promise<number> {
  noPositionals(args)
  const fetchImpl = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const store = storeOf(io, deps)
  const server = serverUrl(stringFlag(args, 'server'), io.env)
  const named = namedStudioResource(stringFlag(args, 'studio'), io.env)
  const namedWeb = namedStudioWeb(stringFlag(args, 'studio-url'), io.env)
  const meta = await discover(server, fetchImpl)
  // The API's own tokens are for its issuer; the studio resource is the one
  // named, else the one the API names, else PhiWebs' own. Its web origin (the
  // `/s/*` routes, the address a person opens) likewise, else PhiWebs' own
  // for PhiWebs' resource, else the resource's host.
  const apiResource = (meta.issuer ?? server).replace(/\/+$/, '')
  const studio = named ?? meta.studio_resource ?? DEFAULT_STUDIO_RESOURCE
  const studioWeb = namedWeb ?? meta.studio_url ?? defaultStudioWeb(studio)
  let studioRefused: string | undefined

  // A fresh client for every interactive login, on whatever loopback port is
  // free: login is rare, and the server compares the redirect exactly, so a
  // saved client would only be usable on its own port. Registering anew also
  // means a client the server has forgotten (a reset database, a removed
  // client) never reaches the authorize page. The one saved for this server
  // before is replaced.
  const loopback = await startLoopback()
  try {
    const clientId = await registerClient(meta.registration_endpoint, loopback.redirectUri, fetchImpl)
    await saveClient(server, { clientId, redirectUri: loopback.redirectUri, registrationEndpoint: meta.registration_endpoint }, store)

    const { verifier, challenge } = pkcePair()
    const state = newState()
    const url = authorizationUrl(meta, {
      clientId,
      redirectUri: loopback.redirectUri,
      state,
      challenge,
      scopes: LOGIN_SCOPES,
      resources: [apiResource, studio],
    })
    io.out(`Signing in to ${server} and its studio ${studio}.`)
    io.out('Open this address in your browser if it does not open by itself:')
    io.out(`  ${url}`)
    const waiting = loopback.waitForCode(state, deps.timeoutMs ?? LOGIN_TIMEOUT_MS)
    // Observed now, awaited below: the answer may arrive (or fail) while the browser is still opening.
    waiting.catch(() => {})
    if (!boolFlag(args, 'no-browser')) await (deps.openBrowser ?? ((u: string) => openInBrowser(u)))(url)
    const code = await waiting

    const tokens = await exchangeCode(
      meta.token_endpoint,
      { code, verifier, clientId, redirectUri: loopback.redirectUri, resource: apiResource },
      fetchImpl
    )
    let session = tokensFrom(
      tokens,
      { clientId, tokenEndpoint: meta.token_endpoint, ...(meta.revocation_endpoint ? { revocationEndpoint: meta.revocation_endpoint } : {}) },
      now()
    )
    // The same grant, refreshed for the studio: its own access token, the refresh token shared.
    if (session.refreshToken) {
      try {
        const forStudio = await refreshTokens(meta.token_endpoint, { refreshToken: session.refreshToken, clientId, resource: studio }, fetchImpl)
        session = { ...session, refreshToken: forStudio.refresh_token ?? session.refreshToken, studio: studioTokenFrom(forStudio, studio, now(), studioWeb) }
      } catch (e) {
        if (!(e instanceof CommandFailure)) throw e
        studioRefused = e.message
      }
    } else {
      studioRefused = 'the server gave no refresh token'
    }
    await saveTokens(server, session, store)
  } finally {
    await loopback.close()
  }

  const who = await whoIs(server, io, deps).catch(() => null)
  io.out(who ? `Signed in to ${server} as ${who.account}.` : `Signed in to ${server}.`)
  if (who?.workspace) io.out(`  workspace  ${who.workspace}`)
  if (studioRefused === undefined) {
    io.out(`  studio     ${studioDescription(studioWeb, studio)}`)
  } else {
    io.err(
      `The studio ${studio} gave no token (${studioRefused}): \`pwf publish\` and the PhiWebs tools of \`pwf mcp\` will not work. Check --studio, then run \`pwf login\` again.`
    )
  }
  return 0
}

/** The studio as `pwf login` and `pwf whoami` print it: its address, and its resource when that is elsewhere. */
function studioDescription(url: string, resource: string): string {
  return url === resource ? url : `${url} (tokens for ${resource})`
}

interface Who {
  readonly account: string
  readonly workspace?: string
}

async function getJson(url: string, token: string, fetchImpl: Fetch): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // keep the text
  }
  return { status: res.status, body }
}

/** The account and workspace the saved session acts as, read from the server; null when not signed in. */
async function whoIs(server: string, io: CommandIO, deps: AccountDeps): Promise<Who | null> {
  const fetchImpl = deps.fetch ?? fetch
  const session = await readSession({ ...storeOf(io, deps), server, fetch: fetchImpl, ...(deps.now ? { now: deps.now } : {}) })
  if (!session) return null
  const account = await getJson(`${server}${WHOAMI_PATHS.account}`, session.accessToken, fetchImpl)
  if (account.status === 401) throw new CommandFailure('SESSION_REFUSED', `${server} no longer accepts the saved session; run \`pwf login\``)
  if (account.status !== 200) throw new CommandFailure('WHOAMI_FAILED', `${server}${WHOAMI_PATHS.account}: ${serverError(account.body, account.status)}`)
  const claims = account.body as { email?: unknown; name?: unknown; sub?: unknown }
  const email = typeof claims.email === 'string' ? claims.email : typeof claims.sub === 'string' ? claims.sub : 'an unnamed account'
  const name = typeof claims.name === 'string' ? ` (${claims.name})` : ''
  const world = await getJson(`${server}${WHOAMI_PATHS.workspace}`, session.accessToken, fetchImpl)
  const data = (world.body as { data?: { name?: unknown; role?: unknown } } | null)?.data
  const workspace =
    world.status === 200 && typeof data?.name === 'string' ? `${data.name}${typeof data.role === 'string' ? ` (${data.role})` : ''}` : undefined
  return { account: `${email}${name}`, ...(workspace ? { workspace } : {}) }
}

export async function runWhoami(args: ParsedArgs, io: CommandIO, deps: AccountDeps = {}): Promise<number> {
  noPositionals(args)
  const server = serverUrl(stringFlag(args, 'server'), io.env)
  const who = await whoIs(server, io, deps)
  if (!who) {
    io.out(`Not signed in to ${server}. Run \`pwf login\` to sign in.`)
    return 1
  }
  io.out(`Signed in to ${server}`)
  io.out(`  account    ${who.account}`)
  io.out(`  workspace  ${who.workspace ?? 'none'}`)
  const studio = await readStudioSession({ ...storeOf(io, deps), server, fetch: deps.fetch ?? fetch, ...(deps.now ? { now: deps.now } : {}) }).then(
    (s) => (s ? studioDescription(s.url, s.studio) : 'none'),
    (e: unknown) =>
      e instanceof CommandFailure && e.code === 'STUDIO_NOT_SIGNED_IN' ? `not signed in; ${STUDIO_UPGRADE_HINT}` : `unavailable (${(e as Error).message})`
  )
  io.out(`  studio     ${studio}`)
  return 0
}

export async function runLogout(args: ParsedArgs, io: CommandIO, deps: AccountDeps = {}): Promise<number> {
  noPositionals(args)
  const store = storeOf(io, deps)
  const server = serverUrl(stringFlag(args, 'server'), io.env)
  const saved = await readTokens(server, store)
  if (!saved) {
    io.out(`Not signed in to ${server}.`)
    return 0
  }
  let revoked = false
  if (saved.revocationEndpoint) {
    const fetchImpl = deps.fetch ?? fetch
    const token = saved.refreshToken ?? saved.accessToken
    const hint = saved.refreshToken ? 'refresh_token' : 'access_token'
    revoked = await revokeToken(saved.revocationEndpoint, { token, hint, clientId: saved.clientId }, fetchImpl)
  }
  await deleteTokens(server, store)
  io.out(`Signed out of ${server}; the saved session is deleted.`)
  if (!revoked) {
    io.out(
      saved.revocationEndpoint
        ? 'The server did not confirm the revocation: the grant may stay valid until it expires.'
        : 'The server offers no revocation endpoint: the grant stays valid until it expires. Remove the "PWFabric CLI" connected app in your PhiWebs account to end it now.'
    )
  }
  return 0
}

export const SERVER_HELP = `  --server <url>   the PhiWebs API (default https://api.phiwebs.com, or $${PHIWEBS_URL_ENV})`
const STUDIO_HELP = `  --studio <url>   the PhiWebs studio resource: its tokens' audience and <url>/mcp (default: the one the API names, else ${DEFAULT_STUDIO_RESOURCE}; or $${STUDIO_RESOURCE_ENV})`
export const STUDIO_WEB_HELP = `  --studio-url <url>  the PhiWebs studio's web address, where pwf publish imports and publishes (default: the one the API names, else ${DEFAULT_STUDIO_WEB} for PhiWebs' resource, else the resource; or $${STUDIO_WEB_ENV})`

export const loginCommand: Command = {
  name: 'login',
  summary: 'Sign in to PhiWebs (opens the browser); only PhiWebs commands need it',
  usage: `pwf login [--server <url>] [--studio <url>] [--studio-url <url>] [--no-browser]

${SERVER_HELP}
${STUDIO_HELP}
${STUDIO_WEB_HELP}
  --no-browser     print the sign-in address without opening a browser

Signs in with OAuth (authorization code and PKCE): pwf registers itself with
the server (anew at every login), opens the server's sign-in page, and receives the answer on
http://127.0.0.1:<port>/callback. One sign-in is for two resources, each with
its own token refreshed when it expires: the API (who you are, which
workspace) and the studio (pwf publish, the PhiWebs tools of pwf mcp). A
session made by an earlier pwf has no studio token: run pwf login again to
add it. The tokens are saved in your config folder (%APPDATA%\\pwfabric on
Windows, $XDG_CONFIG_HOME/pwfabric or ~/.config/pwfabric elsewhere),
readable by you only. Asks for: ${LOGIN_SCOPES.join(', ')}.`,
  run: (args, io) => guard('login', io, () => runLogin(args, io)),
}

export const logoutCommand: Command = {
  name: 'logout',
  summary: 'Sign out of PhiWebs and delete the saved session',
  usage: `pwf logout [--server <url>]

${SERVER_HELP}

Revokes the session when the server offers revocation, then deletes it.`,
  run: (args, io) => guard('logout', io, () => runLogout(args, io)),
}

export const whoamiCommand: Command = {
  name: 'whoami',
  summary: 'Show the PhiWebs account and workspace pwf is signed in as',
  usage: `pwf whoami [--server <url>]

${SERVER_HELP}

Asks the server who the saved session belongs to, and names the studio it is
signed in to. Exit 1 when not signed in.`,
  run: (args, io) => guard('whoami', io, () => runWhoami(args, io)),
}
