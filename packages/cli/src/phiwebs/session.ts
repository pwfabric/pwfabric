/**
 * The signed-in session, for whatever talks to PhiWebs on the user's behalf:
 * the API's access token (`pwf whoami`) and the studio's (`pwf publish`, the
 * PhiWebs tools of `pwf mcp`), each refreshed when it has expired. One grant
 * covers both: the refresh token is shared, and each refresh names the
 * resource its new access token is for.
 */
import { CommandFailure } from '../commands/lib/failure.js'
import {
  defaultStudioWeb,
  deleteClient,
  deleteTokens,
  namedStudioWeb,
  readTokens,
  saveTokens,
  serverUrl,
  type SavedStudioToken,
  type SavedTokens,
  type StoreOptions,
} from './config.js'
import { CLIENT_UNKNOWN, refreshTokens, type Fetch, type TokenResponse } from './oauth.js'

/** A token this close to expiry is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000

export interface SessionOptions extends StoreOptions {
  /** The `--server` flag, when given; else `PWF_PHIWEBS_URL`, else the default. */
  readonly server?: string
  /** The `--studio-url` flag, when given; else `PWF_PHIWEBS_STUDIO_WEB`, else the session's. */
  readonly studioUrl?: string
  readonly fetch?: Fetch
  readonly now?: () => number
}

export interface Session {
  readonly server: string
  readonly accessToken: string
  readonly scope?: string
}

/** The studio part of a session: where the studio is and the token it accepts. */
export interface StudioSession {
  /** The API the session was made with. */
  readonly server: string
  /** The studio resource: the token's audience and the host of `<studio>/mcp`. */
  readonly studio: string
  /** The studio's web origin: every `/s/*` call, and the address a person opens. */
  readonly url: string
  readonly accessToken: string
  readonly scope?: string
}

/** What a token endpoint answered, as saved tokens (keeping what it did not repeat). */
export function tokensFrom(
  res: TokenResponse,
  previous: Pick<SavedTokens, 'clientId' | 'tokenEndpoint' | 'revocationEndpoint' | 'refreshToken' | 'scope' | 'studio'>,
  now: number
): SavedTokens {
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
    ...(previous.studio ? { studio: previous.studio } : {}),
  }
}

/** A studio token from a token endpoint's answer. */
export function studioTokenFrom(res: TokenResponse, resource: string, now: number, url?: string): SavedStudioToken {
  return {
    resource,
    ...(url ? { url } : {}),
    accessToken: res.access_token,
    ...(typeof res.expires_in === 'number' ? { expiresAt: now + res.expires_in * 1000 } : {}),
  }
}

const isFresh = (expiresAt: number | undefined, now: number): boolean => expiresAt === undefined || expiresAt - EXPIRY_MARGIN_MS > now

/**
 * Refreshes the grant for `resource` (undefined: the grant's first, the API).
 * A refresh the server refuses forgets the session and fails with SESSION_EXPIRED.
 */
async function refresh(server: string, saved: SavedTokens, resource: string | undefined, options: SessionOptions): Promise<TokenResponse> {
  if (!saved.refreshToken) {
    await deleteTokens(server, options)
    throw new CommandFailure('SESSION_EXPIRED', `the session with ${server} has expired; run \`pwf login\``)
  }
  try {
    return await refreshTokens(
      saved.tokenEndpoint,
      { refreshToken: saved.refreshToken, clientId: saved.clientId, ...(resource ? { resource } : {}) },
      options.fetch ?? fetch
    )
  } catch (e) {
    if (e instanceof CommandFailure) {
      await deleteTokens(server, options)
      // The client is gone too: the next `pwf login` registers a new one.
      if (e.code === CLIENT_UNKNOWN) await deleteClient(server, options)
      throw new CommandFailure('SESSION_EXPIRED', `the session with ${server} has ended (${e.message}); run \`pwf login\``)
    }
    throw e
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
  if (isFresh(saved.expiresAt, now)) {
    return { server, accessToken: saved.accessToken, ...(saved.scope ? { scope: saved.scope } : {}) }
  }
  return refreshedSession(server, saved, now, options)
}

/** Refreshes the API's access token of `saved`, saves the rotated tokens, and answers the session. */
async function refreshedSession(server: string, saved: SavedTokens, now: number, options: SessionOptions): Promise<Session> {
  const tokens = tokensFrom(await refresh(server, saved, undefined, options), saved, now)
  await saveTokens(server, tokens, options)
  return { server, accessToken: tokens.accessToken, ...(tokens.scope ? { scope: tokens.scope } : {}) }
}

/**
 * {@link readSession}, the API's access token refreshed even when it has not
 * expired yet: for a call the API refused with 401 although the token looked
 * fresh. Null when not signed in; a refresh the server refuses forgets the
 * session and fails with SESSION_EXPIRED.
 */
export async function refreshSession(options: SessionOptions): Promise<Session | null> {
  const server = serverUrl(options.server, options.env)
  const saved = await readTokens(server, options)
  if (!saved) return null
  return refreshedSession(server, saved, (options.now ?? Date.now)(), options)
}

/** What to do with a session saved before pwf signed in to the studio. */
export const STUDIO_UPGRADE_HINT =
  'run `pwf login` again: this session was made before pwf signed in to the PhiWebs studio, and signing in again adds it'

/**
 * The studio part of the session, or null when not signed in. Fails with
 * STUDIO_NOT_SIGNED_IN for a session without it (made by an earlier pwf).
 * An expired studio token is refreshed for the studio's resource; the
 * rotated refresh token is saved for both.
 */
export async function readStudioSession(options: SessionOptions): Promise<StudioSession | null> {
  const server = serverUrl(options.server, options.env)
  const saved = await readTokens(server, options)
  if (!saved) return null
  if (!saved.studio) {
    const message = `signed in to ${server}, but not to its studio`
    throw new CommandFailure('STUDIO_NOT_SIGNED_IN', `${message}; ${STUDIO_UPGRADE_HINT}`, {
      lines: [`STUDIO_NOT_SIGNED_IN: ${message}.`, `fix: ${STUDIO_UPGRADE_HINT.charAt(0).toUpperCase()}${STUDIO_UPGRADE_HINT.slice(1)}.`],
    })
  }
  const studio = saved.studio.resource
  const url = namedStudioWeb(options.studioUrl, options.env) ?? saved.studio.url ?? defaultStudioWeb(studio)
  const now = (options.now ?? Date.now)()
  if (isFresh(saved.studio.expiresAt, now)) {
    return { server, studio, url, accessToken: saved.studio.accessToken, ...(saved.scope ? { scope: saved.scope } : {}) }
  }
  const res = await refresh(server, saved, studio, options)
  const token = studioTokenFrom(res, studio, now, saved.studio.url)
  // The API's own access token stays as it was; only the shared refresh token moves on.
  const refreshToken = res.refresh_token ?? saved.refreshToken
  const scope = res.scope ?? saved.scope
  await saveTokens(server, { ...saved, ...(refreshToken ? { refreshToken } : {}), ...(scope ? { scope } : {}), studio: token }, options)
  return { server, studio, url, accessToken: token.accessToken, ...(scope ? { scope } : {}) }
}
