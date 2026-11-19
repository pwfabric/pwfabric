/**
 * `pwf login`, `pwf logout`, `pwf whoami` — signing the CLI in to PhiWebs,
 * the platform PWFabric was built for. Nothing else in `pwf` needs an
 * account: these commands are the only ones that talk to a hosted service,
 * and only to the server they are given.
 */
import { spawn } from 'node:child_process'
import type { Command, CommandIO, ParsedArgs } from './types.js'
import { boolFlag, guard, stringFlag, UsageError } from './lib/flags.js'
import { CommandFailure } from './lib/failure.js'
import {
  deleteTokens,
  PHIWEBS_URL_ENV,
  readClient,
  readTokens,
  saveClient,
  saveTokens,
  serverUrl,
  type StoreOptions,
} from '../phiwebs/config.js'
import {
  authorizationUrl,
  discover,
  exchangeCode,
  LOGIN_SCOPES,
  newState,
  pkcePair,
  registerClient,
  revokeToken,
  serverError,
  startLoopback,
  type Fetch,
} from '../phiwebs/oauth.js'
import { readSession, tokensFrom } from '../phiwebs/session.js'

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
  const meta = await discover(server, fetchImpl)

  // The server compares the redirect address exactly, port included, so a
  // saved client is reused only when its port is free again; otherwise a new
  // client is registered for the port that is.
  const saved = await readClient(server, store)
  const savedPort = saved && saved.registrationEndpoint === meta.registration_endpoint ? Number(new URL(saved.redirectUri).port) : undefined
  const loopback = await startLoopback(savedPort)
  try {
    let clientId: string
    if (saved && saved.redirectUri === loopback.redirectUri && saved.registrationEndpoint === meta.registration_endpoint) {
      clientId = saved.clientId
    } else {
      clientId = await registerClient(meta.registration_endpoint, loopback.redirectUri, fetchImpl)
      await saveClient(server, { clientId, redirectUri: loopback.redirectUri, registrationEndpoint: meta.registration_endpoint }, store)
    }

    const { verifier, challenge } = pkcePair()
    const state = newState()
    const url = authorizationUrl(meta, { clientId, redirectUri: loopback.redirectUri, state, challenge, scopes: LOGIN_SCOPES })
    io.out(`Signing in to ${server}.`)
    io.out('Open this address in your browser if it does not open by itself:')
    io.out(`  ${url}`)
    const waiting = loopback.waitForCode(state, deps.timeoutMs ?? LOGIN_TIMEOUT_MS)
    // Observed now, awaited below: the answer may arrive (or fail) while the browser is still opening.
    waiting.catch(() => {})
    if (!boolFlag(args, 'no-browser')) await (deps.openBrowser ?? ((u: string) => openInBrowser(u)))(url)
    const code = await waiting

    const tokens = await exchangeCode(meta.token_endpoint, { code, verifier, clientId, redirectUri: loopback.redirectUri }, fetchImpl)
    await saveTokens(
      server,
      tokensFrom(
        tokens,
        { clientId, tokenEndpoint: meta.token_endpoint, ...(meta.revocation_endpoint ? { revocationEndpoint: meta.revocation_endpoint } : {}) },
        now()
      ),
      store
    )
  } finally {
    await loopback.close()
  }

  const who = await whoIs(server, io, deps).catch(() => null)
  io.out(who ? `Signed in to ${server} as ${who.account}.` : `Signed in to ${server}.`)
  if (who?.workspace) io.out(`  workspace  ${who.workspace}`)
  return 0
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

const SERVER_HELP = `  --server <url>   the PhiWebs API (default https://api.phiwebs.com, or $${PHIWEBS_URL_ENV})`

export const loginCommand: Command = {
  name: 'login',
  summary: 'Sign in to PhiWebs (opens the browser); only PhiWebs commands need it',
  usage: `pwf login [--server <url>] [--no-browser]

${SERVER_HELP}
  --no-browser     print the sign-in address without opening a browser

Signs in with OAuth (authorization code and PKCE): pwf registers itself with
the server, opens the server's sign-in page, and receives the answer on
http://127.0.0.1:<port>/callback. The tokens are saved in your config folder
(%APPDATA%\\pwfabric on Windows, $XDG_CONFIG_HOME/pwfabric or
~/.config/pwfabric elsewhere), readable by you only, and refreshed when they
expire. Asks for: ${LOGIN_SCOPES.join(', ')}.`,
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

Asks the server who the saved session belongs to. Exit 1 when not signed in.`,
  run: (args, io) => guard('whoami', io, () => runWhoami(args, io)),
}
