/**
 * OAuth 2.1 for a command-line client: authorization code with PKCE (S256),
 * the code delivered to a loopback address on this machine, the client
 * registered dynamically (RFC 7591), the endpoints discovered from the
 * server's metadata (RFC 8414). Public client: no secret anywhere.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { CommandFailure } from '../commands/lib/failure.js'
import { isLoopback } from './config.js'

export type Fetch = typeof fetch

/**
 * The scopes `pwf login` asks for: who you are (`openid`, `email`) and which
 * workspace (`world:read`) — what `pwf whoami` shows. Every later PhiWebs
 * command adds its scope here, in this one place.
 */
export const LOGIN_SCOPES: readonly string[] = ['openid', 'email', 'world:read']

/** The name the server shows on its consent screen. */
export const CLIENT_NAME = 'PWFabric CLI'

const HTTP_TIMEOUT_MS = 30_000

/** The members of RFC 8414 metadata `pwf login` uses. */
export interface ServerMetadata {
  readonly authorization_endpoint: string
  readonly token_endpoint: string
  readonly registration_endpoint: string
  readonly revocation_endpoint?: string
  readonly code_challenge_methods_supported?: readonly string[]
}

/** A token endpoint's answer (RFC 6749 §5.1). */
export interface TokenResponse {
  readonly access_token: string
  readonly token_type?: string
  readonly expires_in?: number
  readonly refresh_token?: string
  readonly scope?: string
}

/** The error a server sent, in either shape: RFC 6749 (`error`, `error_description`) or `{ error: { code, message } }`. */
export function serverError(body: unknown, status: number): string {
  const b = body as { error?: unknown; error_description?: unknown; message?: unknown } | null
  if (b && typeof b.error === 'string') return typeof b.error_description === 'string' ? `${b.error}: ${b.error_description}` : b.error
  if (b && b.error && typeof b.error === 'object') {
    const e = b.error as { code?: unknown; message?: unknown }
    return [e.code, e.message].filter((x) => typeof x === 'string').join(': ') || `HTTP ${status}`
  }
  return typeof b?.message === 'string' ? b.message : `HTTP ${status}`
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

function safeEndpoint(value: unknown, member: string, server: string): string {
  if (typeof value !== 'string') throw new CommandFailure('SERVER_UNSUPPORTED', `${server} publishes no ${member}`)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CommandFailure('SERVER_UNSUPPORTED', `${server}: ${member} "${value}" is not a URL`)
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
    throw new CommandFailure('SERVER_UNSUPPORTED', `${server}: ${member} ${value} is not https`)
  }
  return value
}

/** Reads `<server>/.well-known/oauth-authorization-server` and checks it offers what login needs. */
export async function discover(server: string, fetchImpl: Fetch): Promise<ServerMetadata> {
  const url = `${server}/.well-known/oauth-authorization-server`
  let res: Response
  try {
    res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
  } catch (e) {
    throw new CommandFailure('SERVER_UNREACHABLE', `cannot reach ${server}: ${(e as Error).message}`)
  }
  const body = (await bodyOf(res)) as Record<string, unknown>
  if (!res.ok || typeof body !== 'object' || body === null) {
    throw new CommandFailure('SERVER_UNSUPPORTED', `${url} answered ${res.status}; is ${server} a PhiWebs API?`)
  }
  const methods = body['code_challenge_methods_supported']
  if (Array.isArray(methods) && !methods.includes('S256')) {
    throw new CommandFailure('SERVER_UNSUPPORTED', `${server} does not support PKCE with S256`)
  }
  return {
    authorization_endpoint: safeEndpoint(body['authorization_endpoint'], 'authorization_endpoint', server),
    token_endpoint: safeEndpoint(body['token_endpoint'], 'token_endpoint', server),
    registration_endpoint: safeEndpoint(body['registration_endpoint'], 'registration_endpoint (dynamic client registration)', server),
    ...(typeof body['revocation_endpoint'] === 'string'
      ? { revocation_endpoint: safeEndpoint(body['revocation_endpoint'], 'revocation_endpoint', server) }
      : {}),
    ...(Array.isArray(methods) ? { code_challenge_methods_supported: methods as string[] } : {}),
  }
}

/** Registers a public client for one redirect address; returns its client_id. */
export async function registerClient(endpoint: string, redirectUri: string, fetchImpl: Fetch): Promise<string> {
  const res = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: LOGIN_SCOPES.join(' '),
    }),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  const body = (await bodyOf(res)) as { client_id?: unknown }
  if (!res.ok || typeof body?.client_id !== 'string') {
    throw new CommandFailure('REGISTRATION_REFUSED', `the server refused to register this client: ${serverError(body, res.status)}`)
  }
  return body.client_id
}

const base64url = (bytes: Buffer): string => bytes.toString('base64url')

/** A PKCE verifier and its S256 challenge (RFC 7636). */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) }
}

/** A random `state`. */
export function newState(): string {
  return base64url(randomBytes(16))
}

/** The address the browser opens. */
export function authorizationUrl(
  meta: ServerMetadata,
  params: { clientId: string; redirectUri: string; state: string; challenge: string; scopes: readonly string[] }
): string {
  const url = new URL(meta.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('state', params.state)
  url.searchParams.set('code_challenge', params.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

async function postForm(endpoint: string, form: Record<string, string>, fetchImpl: Fetch): Promise<Response> {
  return fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
}

async function tokenRequest(endpoint: string, form: Record<string, string>, fetchImpl: Fetch, code: string): Promise<TokenResponse> {
  const res = await postForm(endpoint, form, fetchImpl)
  const body = (await bodyOf(res)) as Partial<TokenResponse>
  if (!res.ok || typeof body?.access_token !== 'string') {
    throw new CommandFailure(code, serverError(body, res.status))
  }
  return body as TokenResponse
}

/** Redeems an authorization code. */
export function exchangeCode(
  endpoint: string,
  params: { code: string; verifier: string; clientId: string; redirectUri: string },
  fetchImpl: Fetch
): Promise<TokenResponse> {
  return tokenRequest(
    endpoint,
    {
      grant_type: 'authorization_code',
      code: params.code,
      code_verifier: params.verifier,
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
    },
    fetchImpl,
    'TOKEN_REFUSED'
  )
}

/** Trades a refresh token for new tokens (the server may rotate the refresh token). */
export function refreshTokens(endpoint: string, params: { refreshToken: string; clientId: string }, fetchImpl: Fetch): Promise<TokenResponse> {
  return tokenRequest(
    endpoint,
    { grant_type: 'refresh_token', refresh_token: params.refreshToken, client_id: params.clientId },
    fetchImpl,
    'REFRESH_REFUSED'
  )
}

/** Revokes a token (RFC 7009). Resolves to whether the server accepted it. */
export async function revokeToken(
  endpoint: string,
  params: { token: string; hint: 'refresh_token' | 'access_token'; clientId: string },
  fetchImpl: Fetch
): Promise<boolean> {
  try {
    const res = await postForm(endpoint, { token: params.token, token_type_hint: params.hint, client_id: params.clientId }, fetchImpl)
    return res.ok
  } catch {
    return false
  }
}

/** The loopback listener the browser hands the code to. */
export interface Loopback {
  readonly port: number
  readonly redirectUri: string
  /** Resolves with the code once a callback with the expected `state` arrives. */
  waitForCode(state: string, timeoutMs: number): Promise<string>
  close(): Promise<void>
}

const PAGE = (title: string, text: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${text}</p></body></html>`

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error): void => reject(e)
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

/**
 * Listens on 127.0.0.1 for `/callback`. Tries `preferredPort` first (the port
 * the saved client was registered with, so the registration can be reused)
 * and falls back to a free port.
 */
export async function startLoopback(preferredPort?: number): Promise<Loopback> {
  type Waiter = { state: string; resolve: (code: string) => void; reject: (e: Error) => void }
  type Callback = { readonly code: string | undefined; readonly state: string | undefined; readonly error: string | undefined }
  let waiter: Waiter | null = null
  const early: Callback[] = []

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/callback') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found')
      return
    }
    const error = url.searchParams.get('error')
    const description = url.searchParams.get('error_description')
    const state = url.searchParams.get('state') ?? undefined
    const code = url.searchParams.get('code') ?? undefined
    const result: Callback = error ? { error: description ? `${error}: ${description}` : error, state, code: undefined } : { code, state, error: undefined }
    if (waiter && result.state !== waiter.state) {
      res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE('Sign-in failed', 'This answer does not belong to the sign-in pwf started. Run pwf login again.'))
      return
    }
    const failed = result.error !== undefined || !result.code
    res
      .writeHead(failed ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' })
      .end(
        failed
          ? PAGE('Sign-in failed', escapeHtml(result.error ?? 'No authorization code was given.'))
          : PAGE('Signed in', 'pwf is signed in. You can close this tab and return to the terminal.')
      )
    if (waiter) settle(waiter, result)
    else early.push(result)
  })

  function settle(w: Waiter, r: Callback): void {
    if (r.error !== undefined) w.reject(new CommandFailure('AUTHORIZATION_DENIED', `the server did not authorize pwf: ${r.error}`))
    else if (!r.code) w.reject(new CommandFailure('AUTHORIZATION_DENIED', 'the callback carried no authorization code'))
    else w.resolve(r.code)
  }

  let port: number
  try {
    port = await listen(server, preferredPort ?? 0)
  } catch {
    port = await listen(server, 0)
  }

  return {
    port,
    redirectUri: `http://127.0.0.1:${port}/callback`,
    waitForCode(state, timeoutMs) {
      return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null
          reject(new CommandFailure('LOGIN_TIMEOUT', `no answer from the browser within ${Math.round(timeoutMs / 1000)} s`))
        }, timeoutMs)
        timer.unref()
        const done = <T>(f: (v: T) => void) => (v: T): void => {
          clearTimeout(timer)
          waiter = null
          f(v)
        }
        const w: Waiter = { state, resolve: done(resolve), reject: done(reject) }
        const pending = early.find((r) => r.state === state)
        if (pending) settle(w, pending)
        else waiter = w
      })
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}
