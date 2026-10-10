/**
 * The local host — the session protocol and the data protocol, in process,
 * for development.
 *
 * NOT A PRODUCTION SERVER. Records live in memory and vanish on restart; the
 * one development user signs in without a password; the issuer stand-in mints
 * unsigned ID tokens; there is no rate limit, no CORS, no TLS. It exists so an
 * app that declares data and sign-in runs on a laptop with no hosted service,
 * and so the runner's sign-in wall, account control, gate and data paths are
 * exercised against the same addresses and answers a session server gives.
 *
 * Everything is mounted under `prefix` (e.g. `/_host`); `<base>` below is
 * `<origin><prefix>`, which is also the app's own API base the runner derives
 * from `loginUrl` (session-protocol §2).
 *
 *   App door (session-protocol §4, §8)
 *     POST <base>/login, <base>/register   any credentials → the development user
 *     POST <base>/logout                   revokes the presented token
 *     GET  <base>/session                  the principal behind the token
 *     GET  <base>/_auth/start/<method>     provider sign-in, through the same redirects
 *     GET  <base>/_auth/callback/<method>  …ends here: HttpOnly cookie, back to returnTo
 *     GET  <base>/_auth/session            the cookie's session (needs x-pwapp-request: 1)
 *     POST <base>/_auth/logout             deletes the cookie (needs x-pwapp-request: 1)
 *   External issuer stand-in (session-protocol §3) — see ./oidc.ts
 *     GET  <base>/oidc/.well-known/openid-configuration, GET <base>/oidc/authorize,
 *     POST <base>/oidc/token
 *   Records (data-protocol §5) — see ./records.ts
 *     GET|POST <base>/records/<T>, GET <base>/records/<T>/count, GET <base>/records/<T>/aggregate,
 *     GET|PATCH|DELETE <base>/records/<T>/<id>
 *   Pages
 *     GET  <base>/surfaces/<key>.receipt.json   the receipt, entity sources rewritten to <base>,
 *                                               refused without a session when sign-in is required
 *
 * Every credential is accepted on `x-app-session` or `Authorization: Bearer`.
 * Tokens are opaque and random, kept only as hashes, and never logged.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  HostError,
  cookiesOf,
  credentialOf,
  readJsonObject,
  redirect,
  safeReturnTo,
  sendError,
  sendJson,
} from './http.js'
import {
  readAuth,
  readEntities,
  readReceipt,
  surfaceKeys,
  type AuthDeclaration,
  type EntityDeclaration,
} from './definitions.js'
import { RecordStore, type Target } from './records.js'
import { rewriteEntitySources } from './receipts.js'
import { DevIssuer, type Grant } from './oidc.js'
import { TokenStore, type Principal } from './tokens.js'
import type { CreateLocalHost, LocalHost, LocalHostOptions } from './types.js'

export const DEFAULT_DEV_USER = { id: 'dev-user', name: 'Developer', email: 'dev@localhost' } as const

/** The cookie the provider round trip leaves on the app's origin. */
export const SESSION_COOKIE = 'pwf_dev_session'

const SESSION_TTL_MS = 8 * 3600_000
const TRANSACTION_TTL_MS = 5 * 60_000

/** The provider buttons a session server can name (envelope `auth.json` `providers[].method`). */
const PROVIDER_METHODS = new Set(['phiwebs', 'google', 'github', 'microsoft'])

function normalisePrefix(prefix: string): string {
  const trimmed = prefix.replace(/^\/+|\/+$/g, '')
  if (!trimmed) throw new Error('createLocalHost: prefix must name a path, e.g. "/_host"')
  return `/${trimmed}`
}

function providersOf(auth: AuthDeclaration): string[] {
  return auth.methods.filter((m) => PROVIDER_METHODS.has(m))
}

/**
 * The envelope `auth.json` for this declaration, pointed at `base` — the
 * same shape a publisher writes (session-protocol §2), or `undefined` when the
 * app has no way in.
 *
 *  - `external`: `oauth2-pkce` against the local issuer stand-in, keeping the
 *    declared client id, scopes (plus `offline_access`, which is what makes a
 *    refresh token exist) and audience.
 *  - `app`: the password door when `password` is declared; the provider
 *    buttons and the start address for every declared provider method; the
 *    gateway's session and logout addresses for either; `methods` as declared.
 */
export function authAddresses(auth: AuthDeclaration | undefined, base: string): Record<string, unknown> | undefined {
  if (!auth) return undefined
  if (auth.topology === 'external') {
    if (!auth.issuer) return undefined
    const scopes = auth.issuer.scopes.includes('offline_access')
      ? [...auth.issuer.scopes]
      : [...auth.issuer.scopes, 'offline_access']
    return {
      provider: 'oauth2-pkce',
      issuer: `${base}/oidc`,
      clientId: auth.issuer.clientId,
      scopes,
      ...(auth.issuer.audience ? { audience: auth.issuer.audience } : {}),
    }
  }
  const door: Record<string, unknown> = {}
  if (auth.methods.includes('password')) {
    door.provider = 'password'
    door.loginUrl = `${base}/login`
    door.registerUrl = `${base}/register`
    door.logoutUrl = `${base}/logout`
    door.sessionUrl = `${base}/session`
  }
  const providers = providersOf(auth)
  if (providers.length > 0) {
    door.provider = door.provider ?? 'platform'
    door.providers = providers.map((method) => ({ method }))
    door.startUrl = `${base}/_auth/start`
    door.gatewaySessionUrl = `${base}/_auth/session`
    door.gatewayLogoutUrl = `${base}/_auth/logout`
  }
  if (Object.keys(door).length === 0) return undefined
  // The runner asks the gateway on every app door, not only a provider one:
  // for a stored-nothing session on boot, and on every sign-out (it falls back
  // to `/_auth/session` and `/_auth/logout` at the page's origin, which on
  // `pwf dev` are not the host's). The host answers both under its base.
  door.gatewaySessionUrl ??= `${base}/_auth/session`
  door.gatewayLogoutUrl ??= `${base}/_auth/logout`
  door.methods = [...auth.methods]
  return door
}

function segments(rest: string): string[] {
  try {
    return rest.split('/').filter(Boolean).map((s) => decodeURIComponent(s))
  } catch {
    throw new HostError(400, 'INVALID_PATH', 'The path is not valid percent-encoding.')
  }
}

function methodNotAllowed(): never {
  throw new HostError(405, 'METHOD_NOT_ALLOWED', 'This route does not take that method.')
}

function notFound(): never {
  throw new HostError(404, 'NOT_FOUND', 'No such route on the local host.')
}

export const createLocalHost: CreateLocalHost = (options: LocalHostOptions): LocalHost => {
  const root = options.root
  const prefix = normalisePrefix(options.prefix)
  const user: Principal = {
    id: options.user?.id ?? DEFAULT_DEV_USER.id,
    email: options.user?.email ?? DEFAULT_DEV_USER.email,
    displayName: options.user?.name ?? DEFAULT_DEV_USER.name,
  }

  const bearer = new TokenStore<Grant>()
  const transactions = new TokenStore<{ readonly returnTo: string; readonly method: string; readonly expiresAt: number }>()
  const records = new RecordStore(root, user)
  const issuer = new DevIssuer(bearer, user)

  const originOf = (req: IncomingMessage): string => `http://${req.headers.host ?? 'localhost'}`

  const principalOf = (req: IncomingMessage): Principal | undefined => bearer.get(credentialOf(req))?.principal

  function startSession(): { token: string; expiresAt: string; principal: Principal } {
    const expiresAt = Date.now() + SESSION_TTL_MS
    const token = bearer.issue({ principal: user, kind: 'session', expiresAt })
    return { token, expiresAt: new Date(expiresAt).toISOString(), principal: user }
  }

  const sessionCookie = (token: string, maxAgeS: number): string =>
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=${prefix}/_auth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}`

  function requireRunnerRequest(req: IncomingMessage): void {
    if (req.headers['x-pwapp-request'] !== '1') {
      throw new HostError(403, 'RUNNER_REQUEST_REQUIRED', 'This address answers only the runner (x-pwapp-request: 1).')
    }
  }

  // ---------------------------------------------------------------- app door

  async function door(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    const auth = readAuth(root)
    if (action === 'session') {
      if (req.method !== 'GET') methodNotAllowed()
      const presented = credentialOf(req)
      const grant = bearer.get(presented)
      if (grant) {
        sendJson(res, 200, { data: { principal: grant.principal } })
        return
      }
      if (presented !== undefined || auth?.required) {
        throw new HostError(401, 'SIGN_IN_REQUIRED', 'No live session.')
      }
      sendJson(res, 200, { data: { principal: null } })
      return
    }
    if (req.method !== 'POST') methodNotAllowed()
    if (action === 'logout') {
      bearer.revoke(credentialOf(req))
      sendJson(res, 200, { data: { signedOut: true } })
      return
    }
    // login / register: the credentials are read (and must be JSON) but not
    // checked — the development user has no password.
    await readJsonObject(req)
    if (!auth || auth.topology !== 'app' || !auth.methods.includes('password')) {
      throw new HostError(404, 'NO_PASSWORD_DOOR', 'This app declares no password sign-in.')
    }
    sendJson(res, action === 'register' ? 201 : 200, { data: startSession() })
  }

  function gateway(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[]): void {
    const [action, method] = parts
    if (action === 'start' || action === 'callback') {
      if (req.method !== 'GET') methodNotAllowed()
      if (parts.length !== 2 || !method) notFound()
      if (action === 'start') {
        const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
        const auth = readAuth(root)
        if (!auth || auth.topology !== 'app' || !providersOf(auth).includes(method)) {
          redirect(res, withAuthError(returnTo, 'provider_unavailable'))
          return
        }
        // The provider's own leg is played by the callback below: the browser
        // still leaves the app, comes back to the callback, and lands on returnTo.
        const tx = transactions.issue({ returnTo, method, expiresAt: Date.now() + TRANSACTION_TTL_MS })
        redirect(res, `${prefix}/_auth/callback/${encodeURIComponent(method)}?tx=${encodeURIComponent(tx)}`)
        return
      }
      const tx = transactions.take(url.searchParams.get('tx') ?? undefined)
      if (!tx || tx.method !== method) {
        redirect(res, withAuthError('/', 'invalid_transaction'))
        return
      }
      const session = startSession()
      redirect(res, tx.returnTo, [sessionCookie(session.token, SESSION_TTL_MS / 1000)])
      return
    }
    if (parts.length !== 1) notFound()
    if (action === 'session') {
      if (req.method !== 'GET') methodNotAllowed()
      requireRunnerRequest(req)
      const token = cookiesOf(req)[SESSION_COOKIE]
      const grant = bearer.get(token)
      if (!token || !grant || grant.kind !== 'session') {
        throw new HostError(401, 'SIGN_IN_REQUIRED', 'No session cookie.')
      }
      sendJson(res, 200, {
        data: { token, expiresAt: new Date(grant.expiresAt).toISOString(), principal: grant.principal },
      })
      return
    }
    if (action === 'logout') {
      if (req.method !== 'POST') methodNotAllowed()
      requireRunnerRequest(req)
      bearer.revoke(cookiesOf(req)[SESSION_COOKIE])
      sendJson(res, 200, { data: { signedOut: true } }, { 'set-cookie': sessionCookie('', 0) })
      return
    }
    notFound()
  }

  // ------------------------------------------------------------------ issuer

  async function oidc(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[]): Promise<void> {
    const auth = readAuth(root)
    if (!auth || auth.topology !== 'external' || !auth.issuer) {
      throw new HostError(404, 'NO_ISSUER', 'This app declares no external issuer.')
    }
    const iss = DevIssuer.issuerUrl(originOf(req), prefix)
    const route = parts.join('/')
    if (route === '.well-known/openid-configuration') {
      if (req.method !== 'GET') methodNotAllowed()
      issuer.discovery(res, iss)
      return
    }
    if (route === 'authorize') {
      if (req.method !== 'GET') methodNotAllowed()
      issuer.authorize(req, res, url, auth)
      return
    }
    if (route === 'token') {
      if (req.method !== 'POST') methodNotAllowed()
      await issuer.token(req, res, iss, auth)
      return
    }
    notFound()
  }

  // ----------------------------------------------------------------- records

  function entityOf(typeId: string): EntityDeclaration {
    const entity = readEntities(root).find((e) => e.typeId === typeId)
    if (!entity) throw new HostError(404, 'UNKNOWN_ENTITY_TYPE', `The app declares no entity type "${typeId}".`)
    return entity
  }

  async function data(req: IncomingMessage, res: ServerResponse, url: URL, parts: string[]): Promise<void> {
    const [typeId, second] = parts
    if (!typeId || parts.length > 2) notFound()
    const target: Target = { entity: entityOf(typeId), auth: readAuth(root), caller: { principal: principalOf(req) } }
    const params = url.searchParams
    if (second === undefined) {
      if (req.method === 'GET') {
        sendJson(res, 200, records.list(target, params))
        return
      }
      if (req.method === 'POST') {
        const record = records.create(target, await readJsonObject(req))
        sendJson(res, 201, { id: record.id, data: record })
        return
      }
      methodNotAllowed()
    }
    if (second === 'count' || second === 'aggregate') {
      if (req.method !== 'GET') methodNotAllowed()
      sendJson(res, 200, records.aggregate(target, params, second === 'count'))
      return
    }
    if (req.method === 'GET') {
      const record = records.read(target, second)
      sendJson(res, 200, { id: record.id, data: record })
      return
    }
    if (req.method === 'PATCH') {
      const record = records.update(target, second, await readJsonObject(req))
      sendJson(res, 200, { id: record.id, data: record })
      return
    }
    if (req.method === 'DELETE') {
      records.remove(target, second)
      sendJson(res, 200, { data: { id: second, deleted: true } })
      return
    }
    methodNotAllowed()
  }

  // ------------------------------------------------------------------- pages

  function receiptFor(key: string, base: string): Record<string, unknown> | undefined {
    const receipt = readReceipt(root, key)
    if (!receipt) return undefined
    return rewriteEntitySources(receipt, base, new Set(readEntities(root).map((e) => e.typeId)))
  }

  function surface(req: IncomingMessage, res: ServerResponse, parts: string[]): void {
    if (req.method !== 'GET') methodNotAllowed()
    const file = parts.length === 1 ? parts[0] : undefined
    if (!file || !file.endsWith('.receipt.json')) notFound()
    if (readAuth(root)?.required && !principalOf(req)) {
      throw new HostError(401, 'SIGN_IN_REQUIRED', 'Sign in to open this page.')
    }
    const receipt = receiptFor(file.slice(0, -'.receipt.json'.length), originOf(req) + prefix)
    if (!receipt) notFound()
    sendJson(res, 200, receipt)
  }

  // ------------------------------------------------------------------ router

  async function route(req: IncomingMessage, res: ServerResponse, url: URL, rest: string): Promise<void> {
    const [head, ...tail] = segments(rest)
    switch (head) {
      case 'login':
      case 'register':
      case 'logout':
      case 'session':
        if (tail.length > 0) notFound()
        return door(req, res, head)
      case '_auth':
        return gateway(req, res, url, tail)
      case 'oidc':
        return oidc(req, res, url, tail)
      case 'records':
        return data(req, res, url, tail)
      case 'surfaces':
        return surface(req, res, tail)
      default:
        notFound()
    }
  }

  return {
    envelopeEntries(origin: string): Readonly<Record<string, unknown>> {
      const base = origin.replace(/\/+$/, '') + prefix
      const out: Record<string, unknown> = {}
      const auth = authAddresses(readAuth(root), base)
      if (auth) out['auth.json'] = auth
      for (const key of surfaceKeys(root)) {
        const receipt = receiptFor(key, base)
        if (receipt) out[`surfaces/${key}.receipt.json`] = receipt
      }
      return out
    },

    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      let url: URL
      try {
        url = new URL(req.url ?? '/', 'http://localhost')
      } catch {
        return false
      }
      const path = url.pathname
      if (path !== prefix && !path.startsWith(`${prefix}/`)) return false
      try {
        await route(req, res, url, path.slice(prefix.length))
      } catch (err) {
        if (res.headersSent) {
          res.end()
        } else if (err instanceof HostError) {
          sendError(res, err)
        } else {
          // A broken definition file is the developer's to fix; say which.
          sendError(res, new HostError(500, 'HOST_ERROR', err instanceof Error ? err.message : String(err)))
        }
      }
      return true
    },

    reset(): void {
      records.reset()
      bearer.clear()
      transactions.clear()
      issuer.reset()
    },
  }
}

function withAuthError(returnTo: string, code: string): string {
  const [path, hash] = splitHash(returnTo)
  return `${path}${path.includes('?') ? '&' : '?'}auth_error=${encodeURIComponent(code)}${hash}`
}

function splitHash(value: string): [string, string] {
  const at = value.indexOf('#')
  return at === -1 ? [value, ''] : [value.slice(0, at), value.slice(at)]
}
