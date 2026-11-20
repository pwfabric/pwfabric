/**
 * A local OAuth server shaped like the PhiWebs API: RFC 8414 metadata,
 * RFC 7591 registration that requires an exact loopback redirect, an
 * authorization endpoint that approves at once and redirects with the code,
 * a token endpoint that checks PKCE (S256) and rotates refresh tokens, and the
 * two reads `pwf whoami` makes. Resources (RFC 8707) as the PhiWebs API binds
 * them: the grant remembers the resources named at authorize, each token is
 * for one (`aud`), and the API's own routes take API tokens only. Also the
 * marketplace routes pack publishing calls. Listens on 127.0.0.1 only.
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
  /** Name the studio in the metadata (`studio_resource`). */
  readonly advertiseStudio?: string
  /** Name the studio's web origin in the metadata (`studio_url`). */
  readonly advertiseStudioUrl?: string
}

/** The studio resource the fake knows when none is set: PhiWebs' default. */
export const FAKE_DEFAULT_STUDIO = 'https://mcp.phiwebs.com'

export interface FakeServer {
  readonly url: string
  readonly registrations: { redirect_uris: string[]; client_name: string }[]
  readonly tokenRequests: Record<string, string>[]
  readonly revoked: string[]
  /** Every PKCE check the token endpoint made, and whether it held. */
  readonly pkceChecks: boolean[]
  /** Make every refresh fail. */
  refuseRefresh: boolean
  /** Extra members of the metadata, read per request. */
  advertise: Record<string, string> | undefined
  /** Forget every registered client, as a server whose database was reset. */
  forgetClients(): void
  /** The token endpoint answers `invalid_client` this many times (then as usual). */
  tokenInvalidClient: number
  /** The studio resource this API issues tokens for (default {@link FAKE_DEFAULT_STUDIO}). */
  studio: string | undefined
  /** The resource a live access token is for, or undefined. */
  audOf(token: string): string | undefined
  /** The resources named at each authorize. */
  readonly authorizedResources: string[][]
  /** Answers for /api/marketplace/* (path → status and body); absent paths 404. */
  marketplace: Record<string, { status: number; body: unknown }>
  /** What the marketplace publish route received. */
  readonly marketplaceUploads: { fields: Record<string, string>; file?: { name: string; bytes: number; type: string } }[]
  close(): Promise<void>
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  let text = ''
  for await (const chunk of req) text += chunk
  return text
}

async function rawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

const token = (): string => randomBytes(12).toString('hex')

export async function startFakeServer(options: FakeServerOptions = {}): Promise<FakeServer> {
  const clients = new Map<string, string[]>()
  const codes = new Map<string, { clientId: string; redirectUri: string; challenge: string; scope: string; resources: string[] }>()
  const access = new Map<string, string>()
  const refresh = new Map<string, { clientId: string; resources: string[]; scope: string }>()
  const state: FakeServer = {
    url: '',
    registrations: [],
    tokenRequests: [],
    revoked: [],
    pkceChecks: [],
    refuseRefresh: false,
    advertise: undefined,
    forgetClients: () => clients.clear(),
    tokenInvalidClient: 0,
    studio: undefined,
    audOf: (t) => access.get(t),
    authorizedResources: [],
    marketplace: {},
    marketplaceUploads: [],
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    },
  }

  const known = (): string[] => [state.url, state.studio ?? FAKE_DEFAULT_STUDIO]
  const issue = (clientId: string, scope: string, resources: string[], aud: string): Record<string, unknown> => {
    const a = token()
    const r = token()
    access.set(a, aud)
    refresh.set(r, { clientId, resources, scope })
    return { access_token: a, token_type: 'Bearer', expires_in: options.expiresIn ?? 3600, refresh_token: r, scope }
  }
  const apiToken = (t: string): boolean => access.get(t) === state.url

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
        ...(options.advertiseStudio ? { studio_resource: options.advertiseStudio } : {}),
        ...(options.advertiseStudioUrl ? { studio_url: options.advertiseStudioUrl } : {}),
        ...(state.advertise ?? {}),
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
      // An unknown client with a loopback redirect is sent back with
      // invalid_client (no code), so a CLI learns its registration is gone.
      if (!registered && redirect.startsWith('http://127.0.0.1:')) {
        const back = new URL(redirect)
        back.searchParams.set('error', 'invalid_client')
        back.searchParams.set('error_description', 'OAuth client not found or revoked')
        back.searchParams.set('state', q.get('state') ?? '')
        res.writeHead(302, { location: back.toString() }).end()
        return
      }
      if (!registered?.includes(redirect)) return json(400, { error: { code: 'INVALID_REDIRECT_URI', message: 'not registered' } })
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || q.get('response_type') !== 'code') {
        return json(400, { error: { code: 'INVALID_REQUEST', message: 'PKCE S256 required' } })
      }
      const back = new URL(redirect)
      const resources = q.getAll('resource')
      state.authorizedResources.push(resources)
      if (resources.some((r) => !known().includes(r))) {
        back.searchParams.set('error', 'invalid_target')
        back.searchParams.set('error_description', 'unknown resource')
      } else if (options.deny) {
        back.searchParams.set('error', options.deny)
        back.searchParams.set('error_description', 'User denied authorization')
      } else {
        const code = token()
        codes.set(code, {
          clientId: q.get('client_id') as string,
          redirectUri: redirect,
          challenge: q.get('code_challenge') as string,
          scope: q.get('scope') ?? '',
          resources: resources.length ? resources : [state.url],
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
      if (state.tokenInvalidClient > 0) {
        state.tokenInvalidClient -= 1
        return json(401, { error: 'invalid_client', error_description: 'client not found' })
      }
      if (form['grant_type'] === 'authorization_code') {
        const grant = codes.get(form['code'] ?? '')
        codes.delete(form['code'] ?? '')
        if (!grant || grant.clientId !== form['client_id'] || grant.redirectUri !== form['redirect_uri']) {
          return json(400, { error: { code: 'INVALID_GRANT', message: 'Invalid authorization code' } })
        }
        const held = createHash('sha256').update(form['code_verifier'] ?? '').digest('base64url') === grant.challenge
        state.pkceChecks.push(held)
        if (!held) return json(400, { error: { code: 'INVALID_GRANT', message: 'PKCE verification failed' } })
        const aud = form['resource'] ?? (grant.resources[0] as string)
        if (!grant.resources.includes(aud)) return json(400, { error: 'invalid_target', error_description: 'resource not granted' })
        return json(200, issue(grant.clientId, grant.scope, grant.resources, aud))
      }
      if (form['grant_type'] === 'refresh_token') {
        const family = refresh.get(form['refresh_token'] ?? '')
        if (state.refuseRefresh || !family || family.clientId !== form['client_id']) {
          return json(400, { error: { code: 'INVALID_GRANT', message: 'Refresh token already used' } })
        }
        const aud = form['resource'] ?? (family.resources[0] as string)
        if (!family.resources.includes(aud)) return json(400, { error: 'invalid_target', error_description: 'resource not granted' })
        refresh.delete(form['refresh_token'] as string)
        return json(200, issue(family.clientId, family.scope, family.resources, aud))
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
    if (url.pathname.startsWith('/api/marketplace/')) {
      if (!apiToken(bearer)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      if (url.pathname === '/api/marketplace/artifacts/publish' && req.method === 'POST') {
        const form = await new Request('http://fake.invalid/', {
          method: 'POST',
          headers: { 'content-type': req.headers['content-type'] ?? '' },
          body: await rawBody(req),
        }).formData()
        const fields: Record<string, string> = {}
        let file: { name: string; bytes: number; type: string } | undefined
        for (const [k, v] of form.entries()) {
          if (typeof v === 'string') fields[k] = v
          else file = { name: v.name, bytes: v.size, type: v.type }
        }
        state.marketplaceUploads.push({ fields, ...(file ? { file } : {}) })
      }
      const answer = state.marketplace[url.pathname]
      return answer ? json(answer.status, answer.body) : json(404, { error: { code: 'NOT_FOUND', message: url.pathname } })
    }
    if (url.pathname === '/api/oauth/userinfo') {
      if (!apiToken(bearer)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return json(200, { sub: 'user-1', email: 'ada@example.com', email_verified: true })
    }
    if (url.pathname === '/api/worlds/me') {
      if (!apiToken(bearer)) return json(401, { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
      return json(200, { data: { id: 'w-1', name: 'Ada Studio', role: 'owner' } })
    }
    json(404, { error: { code: 'NOT_FOUND', message: url.pathname } })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  ;(state as { url: string }).url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return state
}
