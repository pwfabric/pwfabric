/**
 * A development stand-in for an external OpenID Connect issuer.
 *
 * When `auth.json` declares `topology: "external"`, the app's real issuer
 * cannot be reached from a laptop without registering a redirect URI for
 * every port `pwf dev` picks. The local host therefore plays that issuer, at
 * `<prefix>/oidc`, with just enough of the protocol for the runner's PKCE
 * client (session-protocol §3):
 *
 *   GET  <prefix>/oidc/.well-known/openid-configuration   discovery
 *   GET  <prefix>/oidc/authorize                           code + PKCE (S256), no consent screen:
 *                                                          the development user is signed in at once
 *   POST <prefix>/oidc/token                               authorization_code, refresh_token
 *                                                          (and refresh_token + scope "<audience>/.default"
 *                                                          for the door token)
 *
 * The declared `clientId`, scopes and audience are kept; only the issuer
 * address changes. Tokens are opaque; the ID token is an UNSIGNED JWT
 * (`alg: none`), which the runner decodes and does not verify. No real
 * issuer's keys are ever involved, and nothing here is safe to expose beyond
 * the developer's own machine.
 */

import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readForm, redirect, sendJson, HostError } from './http.js'
import type { AuthDeclaration } from './definitions.js'
import { TokenStore, type Principal } from './tokens.js'

/** What a bearer credential stands for, whichever door minted it. */
export interface Grant {
  readonly principal: Principal
  readonly expiresAt: number
  readonly kind: 'session' | 'access' | 'door'
}

interface CodeGrant {
  readonly principal: Principal
  readonly clientId: string
  readonly redirectUri: string
  readonly challenge: string
  readonly scopes: readonly string[]
  readonly expiresAt: number
}

interface RefreshGrant {
  readonly principal: Principal
  readonly clientId: string
  readonly scopes: readonly string[]
  readonly expiresAt: number
}

export const ACCESS_TTL_S = 3600
const CODE_TTL_MS = 60_000
const REFRESH_TTL_MS = 24 * 3600_000

const b64url = (v: string | Buffer): string => Buffer.from(v).toString('base64url')

function oauthError(res: ServerResponse, status: number, error: string, description: string): void {
  sendJson(res, status, { error, error_description: description })
}

export class DevIssuer {
  private readonly codes = new TokenStore<CodeGrant>()
  private readonly refresh = new TokenStore<RefreshGrant>()

  constructor(
    private readonly bearer: TokenStore<Grant>,
    private readonly user: Principal
  ) {}

  reset(): void {
    this.codes.clear()
    this.refresh.clear()
  }

  /** `<origin><prefix>/oidc` — the `iss` this issuer speaks for. */
  static issuerUrl(origin: string, prefix: string): string {
    return `${origin.replace(/\/+$/, '')}${prefix}/oidc`
  }

  discovery(res: ServerResponse, issuer: string): void {
    sendJson(res, 200, {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['none'],
      token_endpoint_auth_methods_supported: ['none'],
    })
  }

  authorize(req: IncomingMessage, res: ServerResponse, url: URL, auth: AuthDeclaration): void {
    const q = url.searchParams
    const declared = auth.issuer
    if (!declared || q.get('client_id') !== declared.clientId) {
      throw new HostError(400, 'UNKNOWN_CLIENT', 'client_id does not match the app declaration.')
    }
    let redirectUri: URL
    try {
      redirectUri = new URL(q.get('redirect_uri') ?? '')
    } catch {
      throw new HostError(400, 'INVALID_REDIRECT_URI', 'redirect_uri must be an absolute URL.')
    }
    // The app is served by the same development server; anything else is not this app.
    if (!/^https?:$/.test(redirectUri.protocol) || redirectUri.host !== req.headers.host) {
      throw new HostError(400, 'INVALID_REDIRECT_URI', 'redirect_uri must be on this development server.')
    }
    const state = q.get('state')
    const back = (params: Record<string, string>): void => {
      const target = new URL(redirectUri)
      for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
      if (state !== null) target.searchParams.set('state', state)
      redirect(res, target.toString())
    }
    if (q.get('response_type') !== 'code') {
      back({ error: 'unsupported_response_type', error_description: 'Only response_type=code is supported.' })
      return
    }
    const challenge = q.get('code_challenge')
    if (!challenge || q.get('code_challenge_method') !== 'S256') {
      back({ error: 'invalid_request', error_description: 'PKCE with code_challenge_method=S256 is required.' })
      return
    }
    const code = this.codes.issue({
      principal: this.user,
      clientId: declared.clientId,
      redirectUri: redirectUri.toString(),
      challenge,
      scopes: (q.get('scope') ?? '').split(' ').filter(Boolean),
      expiresAt: Date.now() + CODE_TTL_MS,
    })
    back({ code })
  }

  async token(req: IncomingMessage, res: ServerResponse, issuer: string, auth: AuthDeclaration): Promise<void> {
    const form = await readForm(req)
    const clientId = auth.issuer?.clientId
    if (!clientId || form.get('client_id') !== clientId) {
      oauthError(res, 401, 'invalid_client', 'client_id does not match the app declaration.')
      return
    }
    const grantType = form.get('grant_type')
    if (grantType === 'authorization_code') {
      const code = this.codes.take(form.get('code') ?? undefined)
      if (!code || code.clientId !== clientId) {
        oauthError(res, 400, 'invalid_grant', 'The code is unknown, used or expired.')
        return
      }
      if (form.get('redirect_uri') !== code.redirectUri) {
        oauthError(res, 400, 'invalid_grant', 'redirect_uri differs from the one the code was issued for.')
        return
      }
      const verifier = form.get('code_verifier') ?? ''
      if (b64url(createHash('sha256').update(verifier).digest()) !== code.challenge) {
        oauthError(res, 400, 'invalid_grant', 'code_verifier does not match the code_challenge.')
        return
      }
      sendJson(res, 200, this.mint(issuer, clientId, code.principal, code.scopes, true))
      return
    }
    if (grantType === 'refresh_token') {
      const old = this.refresh.take(form.get('refresh_token') ?? undefined)
      if (!old || old.clientId !== clientId) {
        oauthError(res, 400, 'invalid_grant', 'The refresh token is unknown, used or expired.')
        return
      }
      const scope = form.get('scope')
      if (scope) {
        const audience = auth.issuer?.audience?.replace(/\/+$/, '')
        if (!audience || scope !== `${audience}/.default`) {
          oauthError(res, 400, 'invalid_scope', 'Only the app audience scope "<audience>/.default" can be redeemed.')
          return
        }
        sendJson(res, 200, this.mint(issuer, clientId, old.principal, [scope], false, 'door', old.scopes))
        return
      }
      sendJson(res, 200, this.mint(issuer, clientId, old.principal, old.scopes, true))
      return
    }
    oauthError(res, 400, 'unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.')
  }

  private mint(
    issuer: string,
    clientId: string,
    principal: Principal,
    scopes: readonly string[],
    withIdToken: boolean,
    kind: Grant['kind'] = 'access',
    /** What the next refresh grants: a door redemption keeps the data scopes. */
    refreshScopes: readonly string[] = scopes
  ): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000)
    const accessToken = this.bearer.issue({ principal, kind, expiresAt: Date.now() + ACCESS_TTL_S * 1000 })
    // Refresh tokens rotate on every use, as a single-page-app issuer's do.
    const refreshToken = this.refresh.issue({
      principal,
      clientId,
      scopes: refreshScopes,
      expiresAt: Date.now() + REFRESH_TTL_MS,
    })
    const idToken = withIdToken
      ? [
          b64url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
          b64url(
            JSON.stringify({
              iss: issuer,
              sub: principal.id,
              aud: clientId,
              name: principal.displayName,
              email: principal.email,
              iat: now,
              exp: now + ACCESS_TTL_S,
            })
          ),
          '',
        ].join('.')
      : undefined
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: refreshToken,
      scope: scopes.join(' '),
      ...(idToken ? { id_token: idToken } : {}),
    }
  }
}
