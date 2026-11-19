/**
 * The signed-in session, for whatever talks to PhiWebs on the user's behalf
 * (`pwf whoami` today; the PhiWebs tools of `pwf mcp` and `pwf publish`
 * later): the saved access token, refreshed when it has expired.
 */
import { CommandFailure } from '../commands/lib/failure.js'
import { deleteTokens, readTokens, saveTokens, serverUrl, type SavedTokens, type StoreOptions } from './config.js'
import { refreshTokens, type Fetch, type TokenResponse } from './oauth.js'

/** A token this close to expiry is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000

export interface SessionOptions extends StoreOptions {
  /** The `--server` flag, when given; else `PWF_PHIWEBS_URL`, else the default. */
  readonly server?: string
  readonly fetch?: Fetch
  readonly now?: () => number
}

export interface Session {
  readonly server: string
  readonly accessToken: string
  readonly scope?: string
}

/** What a token endpoint answered, as saved tokens (keeping what it did not repeat). */
export function tokensFrom(res: TokenResponse, previous: Pick<SavedTokens, 'clientId' | 'tokenEndpoint' | 'revocationEndpoint' | 'refreshToken' | 'scope'>, now: number): SavedTokens {
  const refreshToken = res.refresh_token ?? previous.refreshToken
  const scope = res.scope ?? previous.scope
  return {
    accessToken: res.access_token,
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof res.expires_in === 'number' ? { expiresAt: now + res.expires_in * 1000 } : {}),
    ...(scope ? { scope } : {}),
    clientId: previous.clientId,
    tokenEndpoint: previous.tokenEndpoint,
    ...(previous.revocationEndpoint ? { revocationEndpoint: previous.revocationEndpoint } : {}),
  }
}

/**
 * The session with the server, or null when not signed in. An expired access
 * token is refreshed (and the rotated tokens saved); a refresh the server
 * refuses forgets the session and fails with SESSION_EXPIRED.
 */
export async function readSession(options: SessionOptions): Promise<Session | null> {
  const server = serverUrl(options.server, options.env)
  const saved = await readTokens(server, options)
  if (!saved) return null
  const now = (options.now ?? Date.now)()
  if (saved.expiresAt === undefined || saved.expiresAt - EXPIRY_MARGIN_MS > now) {
    return { server, accessToken: saved.accessToken, ...(saved.scope ? { scope: saved.scope } : {}) }
  }
  if (!saved.refreshToken) {
    await deleteTokens(server, options)
    throw new CommandFailure('SESSION_EXPIRED', `the session with ${server} has expired; run \`pwf login\``)
  }
  let fresh: TokenResponse
  try {
    fresh = await refreshTokens(saved.tokenEndpoint, { refreshToken: saved.refreshToken, clientId: saved.clientId }, options.fetch ?? fetch)
  } catch (e) {
    if (e instanceof CommandFailure) {
      await deleteTokens(server, options)
      throw new CommandFailure('SESSION_EXPIRED', `the session with ${server} has ended (${e.message}); run \`pwf login\``)
    }
    throw e
  }
  const tokens = tokensFrom(fresh, saved, now)
  await saveTokens(server, tokens, options)
  return { server, accessToken: tokens.accessToken, ...(tokens.scope ? { scope: tokens.scope } : {}) }
}
