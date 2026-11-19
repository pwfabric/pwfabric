/**
 * A local OAuth server shaped like the PhiWebs API: RFC 8414 metadata,
 * RFC 7591 registration that requires an exact loopback redirect, an
 * authorization endpoint that approves at once and redirects with the code,
 * a token endpoint that checks PKCE (S256) and rotates refresh tokens, and the
 * two reads `pwf whoami` makes. Listens on 127.0.0.1 only.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface FakeServerOptions {
  /** Publish a revocation endpoint. */
  readonly revocation?: boolean
  /** Leave the registration endpoint out of the metadata. */
  readonly noRegistration?: boolean
  /** The authorization endpoint redirects with this error instead of a code. */
  readonly deny?: string
  /** Seconds an access token lives. */
  readonly expiresIn?: number
}

export interface FakeServer {
  readonly url: string
  readonly registrations: { redirect_uris: string[]; client_name: string }[]
  readonly tokenRequests: Record<string, string>[]
  readonly revoked: string[]
  /** Every PKCE check the token endpoint made, and whether it held. */
  readonly pkceChecks: boolean[]
  /** Make every refresh fail. */
  refuseRefresh: boolean
  close(): Promise<void>
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text
}

const token = (): string => randomBytes(12).toString('hex')

export async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const clients = new Map<string, string[]>()
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; scope: string }>()
  const access = new Set<string>()
  const refresh = new Map<string, string>()
  const state: FakeServer = {
    url: '',
    registrations: [],
    tokenRequests: [],
    revoked: [],
    pkceChecks: [],
    refuseRefresh: false,
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }

  const issue = (clientId: string, scope: string): Record<string, unknown> => {
    const a = token()
    const r = token()
    access.add(a)
    refresh.set(r, clientId)
    return { access_token: a, token_type: 'Bearer', expires_in: options.expiresIn ?? 3600, refresh_token: r, scope }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', state.url)
    const json = (status: number, value: unknown): void => {
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(value))
    }
    const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '')

    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: state.url,
        authorization_endpoint: `${state.url}/oauth/authorize`,
        token_endpoint: `${state.url}/api/oauth/token`,
        ...(options.noRegistration ? {} : { registration_endpoint: `${state.url}/api/oauth/register` }),
        ...(options.revocation ? { revocation_endpoint: `${state.url}/api/oauth/revoke` } : {}),
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      })
    }
    if (url.pathname === '/api/oauth/register' && req.method === 'POST') {
      const body = JSON.parse(await bodyOf(req)) as { redirect_uris?: string[]; client_name: string }
      const uris = body.redirect_uris ?? []
      if (uris.length === 0 || uris.some((u) => !u.startsWith('http://127.0.0.1:'))) {
        return json(400, { error: { code: 'INVALID_REDIRECT_URI', message: 'redirect_uris must be https, or http on localhost.' } })
      }
      state.registrations.push({ redirect_uris: uris, client_name: body.client_name })
      const id = `client_${state.registrations.length}`
      clients.set(id, uris)
      return json(201, { client_id: id, redirect_uris: uris, token_endpoint_auth_method: 'none' })
    }
    if (url.pathname === '/oauth/authorize') {
      const q = url.searchParams
      const redirect = q.get('redirect_uri') ?? ''
      const registered = clients.get(q.get('client_id') ?? '')
      if (!registered?.includes(redirect)) return json(400, { error: { code: 'INVALID_REDIRECT_URI', message: 'not registered' } })
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || q.get('response_type') !== 'code') {
        return json(400, { error: { code: 'INVALID_REQUEST', message: 'PKCE S256 required' } })
      }
      const back = new URL(redirect)
      if (options.deny) {
        back.searchParams.set('error', options.deny)
        back.searchParams.set('error_description', 'User denied authorization')
      } else {
        const code = token()
        codes.set(code, {
          clientId: q.get('client_id') as string,
          redirectUri: redirect,
          challenge: q.get('code_challenge') as string,
          scope: q.get('scope') ?? '',
        })
        back.searchParams.set('code', code)
      }
      back.searchParams.set('state', q.get('state') ?? '')
      res.writeHead(302, { location: back.toString() }).end()
      return
    }
    if (url.pathname === '/api/oauth/token' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await bodyOf(req)))
      state.tokenRequests.push(form)
      if (form['grant_type'] === 'authorization_code') {
        const grant = codes.get(form['code'] ?? '')
        codes.delete(form['code'] ?? '')
        if (!grant || grant.clientId !== form['client_id'] || grant.redirectUri !== form['redirect_uri']) {
          return json(400, { error: { code: 'INVALID_GRANT', message: 'Invalid authorization code' } })
        }
        const held = createHash('sha256').update(form['code_verifier'] ?? '').digest('base64url') === grant.challenge
        state.pkceChecks.push(held)
        if (!held) return json(400, { error: { code: 'INVALID_GRANT', message: 'PKCE verification failed' } })
        return json(200, issue(grant.clientId, grant.scope))
      }
      if (form['grant_type'] === 'refresh_token') {
        const owner = refresh.get(form['refresh_token'] ?? '')
        if (state.refuseRefresh || !owner || owner !== form['client_id']) {
          return json(400, { error: { code: 'INVALID_GRANT', message: 'Refresh token already used' } })
        }
        refresh.delete(form['refresh_token'] as string)
        return json(200, issue(owner, 'openid email world:read'))
      }
      return json(400, { error: 'unsupported_grant_type' })
    }
    if (url.pathname === '/api/oauth/revoke' && req.method === 'POST') {
      const form = Object.fromEntries(new URLSearchParams(await bodyOf(req)))
      state.revoked.push(form['token'] ?? '')
      refresh.delete(form['token'] ?? '')
      res.writeHead(200).end()
      return
    }
    if (url.pathname === '/api/oauth/userinfo') {
      if (!access.has(bearer)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return json(200, { sub: 'user-1', email: 'ada@example.com', email_verified: true })
    }
    if (url.pathname === '/api/worlds/me') {
      if (!access.has(bearer)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return json(200, { data: { id: 'w-1', name: 'Ada Studio', role: 'owner' } })
    }
    json(404, { error: { code: 'NOT_FOUND', message: url.pathname } })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  ;(state as { url: string }).url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return state
}
