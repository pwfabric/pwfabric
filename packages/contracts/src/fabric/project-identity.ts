/**
 * Project Identity — who the visitor is, declared the way a connection is.
 *
 * WHY THIS EXISTS. A project could already declare where its DATA lives, in
 * full: address, engine, auth scheme, scopes, collections. Identity had one
 * boolean — `authRequired` — which was asked in the plan, stored on the
 * project, shown on the card, and enforced nowhere. Everything past that
 * boolean was hardcoded: the runner built its authorize URL by concatenating
 * `login.microsoftonline.com`, so the only identity a generated app could have
 * was one Entra tenant, and "let people sign in with GitHub" had no answer at
 * any layer.
 *
 * THE DISTINCTION THIS CONTRACT KEEPS. Identity says WHO THE VISITOR IS. A
 * connection's credential says WHAT THE APP MAY REACH. Today one Entra token
 * does both jobs, which is why they were never separable: signing in and
 * getting read access to a calendar were the same act. They are declared apart
 * here on purpose — a project can require sign-in and reach nothing, or reach
 * three APIs and ask nobody to sign in.
 *
 * TWO TOPOLOGIES, AND THE PROJECT PICKS ONE.
 *
 *  - `app` — the app keeps its own accounts, and the host brokers the sign-in.
 *    `methods` is the list of login buttons the visitor sees: an email and a
 *    password, a PhiWebs account (`phiwebs`, membership on the PhiWebs
 *    platform), or a social provider.
 *    The code exchange always happens on the server; the browser never spends
 *    a code. Each social method may name a `connection` — the host's shared
 *    registration (the default) or the project's own OAuth client, whose
 *    secret is stored encrypted on the server and never enters this contract.
 *
 *  - `external` — the project names its own OIDC issuer, and the host is not in
 *    the login path at all. The API validates the presented token against the
 *    issuer's JWKS. This is what makes an app portable: an enterprise pointing
 *    at its own Entra tenant or Auth0 does not depend on the host to authenticate,
 *    only to store.
 *
 * NO PROVIDER HOSTNAME APPEARS IN THIS FILE. An issuer is an address the
 * project supplies; endpoints are either stated or discovered at
 * `{issuer}/.well-known/openid-configuration`. That rule is the whole reason
 * the Entra string concatenation could exist for as long as it did — there was
 * no shape that could hold anyone else's address.
 *
 * @module @pwfabric/contracts/fabric/project-identity
 */

import { z } from 'zod'

// ============================================================
// TOPOLOGY
// ============================================================

export const IDENTITY_TOPOLOGIES = ['app', 'external'] as const

/** Who runs the login: the host, or an issuer the project names. */
export type IdentityTopology = (typeof IDENTITY_TOPOLOGIES)[number]

export const IdentityTopologySchema = z.enum(IDENTITY_TOPOLOGIES)

// ============================================================
// LOGIN METHODS (app topology only)
// ============================================================

/**
 * What the visitor clicks at the HOST's door.
 *
 * These are values, not engines — the closed set the platform's authorization
 * server actually implements, which is why the set is closed rather than free
 * text. The host's sign-in routes once declared the same three social names
 * inline in three places; a project declaring `methods` and the route
 * validating a callback now read one list.
 */
export const IDENTITY_METHODS = ['password', 'phiwebs', 'google', 'github', 'microsoft'] as const

export type IdentityMethod = (typeof IDENTITY_METHODS)[number]

export const IdentityMethodSchema = z.enum(IDENTITY_METHODS)

/**
 * The methods that run at a third-party provider — the ones a CONNECTION can
 * be declared for. `password` has no provider and `phiwebs` is PhiWebs' own
 * authorization server, so neither ever takes one.
 */
export const SOCIAL_METHODS = ['google', 'github', 'microsoft'] as const

export type SocialMethod = (typeof SOCIAL_METHODS)[number]

export const SocialMethodSchema = z.enum(SOCIAL_METHODS)

// ============================================================
// CONNECTIONS (which OAuth registration a social method uses)
// ============================================================

/** Whose OAuth registration answers: the host's shared one, or the project's own. */
export type IdentityConnectionOwner = 'shared' | 'own'

/**
 * How one social method reaches its provider.
 *
 * NO SECRET FIELD, ON PURPOSE. An `own` client's secret is written to the
 * server through its own endpoint and stored encrypted; it is never part of a
 * plan, a receipt or a package. `.strict()` makes an attempt to put one here a
 * parse error rather than a silent leak.
 */
export interface IdentityConnection {
  readonly owner: IdentityConnectionOwner
  /** The project's own client id. Required when `owner` is `own`. */
  readonly clientId?: string | undefined
  /** Microsoft only: a tenant id, `organizations` or `common`. */
  readonly tenant?: string | undefined
}

export const IdentityConnectionSchema = z
  .object({
    owner: z.enum(['shared', 'own']).default('shared'),
    clientId: z.string().min(1).max(200).optional(),
    // microsoft: tenant id | 'organizations' | 'common'
    tenant: z.string().min(1).max(100).optional(),
  })
  .strict()

/** Per-method connections. Absent key = the shared registration. */
export type IdentityConnections = Readonly<Partial<Record<SocialMethod, IdentityConnection>>>

// ============================================================
// EXTERNAL ISSUER
// ============================================================

/**
 * An OIDC issuer the project supplies.
 *
 * `authorizeUrl` / `tokenUrl` / `jwksUri` are optional because the standard
 * already answers them: absent, they come from the issuer's discovery
 * document. Stated, they win — some deployments sit behind a gateway whose
 * discovery document points somewhere the browser cannot reach.
 */
export interface ProjectIdentityIssuer {
  /** The `iss` value tokens will carry. Also the discovery base. */
  readonly issuer: string
  /** The app's own registration at that issuer. Public client, PKCE. */
  readonly clientId: string
  readonly scopes: readonly string[]
  /** Expected `aud`. Absent, `clientId` is expected. */
  readonly audience?: string | undefined
  readonly authorizeUrl?: string | undefined
  readonly tokenUrl?: string | undefined
  readonly jwksUri?: string | undefined
}

export const ProjectIdentityIssuerSchema = z
  .object({
    issuer: z.string().url().max(500),
    clientId: z.string().min(1).max(200),
    scopes: z.array(z.string().min(1).max(200)).default(['openid', 'profile', 'email']),
    audience: z.string().max(500).optional(),
    authorizeUrl: z.string().url().max(500).optional(),
    tokenUrl: z.string().url().max(500).optional(),
    jwksUri: z.string().url().max(500).optional(),
  })
  .strict()

/**
 * Where the endpoints come from when the issuer did not state them.
 *
 * One function rather than three concatenations at three call sites, which is
 * the shape the Entra hardcode took.
 */
export function discoveryUrlOf(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
}

// ============================================================
// CLAIM MAPPING
// ============================================================

/**
 * Which claim carries what.
 *
 * Defaulted to the OIDC standard names, so a conforming issuer needs none of
 * this. It exists because `roles` in particular is where issuers disagree, and
 * row-level access asks a real question of the token: is this visitor the
 * owner of the record they are editing?
 */
export interface ProjectIdentityClaims {
  readonly subject: string
  readonly email: string
  readonly name: string
  /** Absent means the app has authenticated visitors but no roles. */
  readonly roles?: string | undefined
}

export const ProjectIdentityClaimsSchema = z
  .object({
    subject: z.string().min(1).max(120).default('sub'),
    email: z.string().min(1).max(120).default('email'),
    name: z.string().min(1).max(120).default('name'),
    roles: z.string().min(1).max(120).optional(),
  })
  .strict()

// ============================================================
// THE DECLARATION
// ============================================================

export interface ProjectIdentity {
  /** Sign-in is required to open the app at all. */
  readonly required: boolean
  readonly topology: IdentityTopology
  /** `app` only — the buttons the visitor sees. */
  readonly methods: readonly IdentityMethod[]
  /** `app` only — which registration each declared social method uses. */
  readonly connections: IdentityConnections
  /** `external` only. */
  readonly issuer?: ProjectIdentityIssuer | undefined
  readonly claims: ProjectIdentityClaims
}

/**
 * WHAT IS REFUSED HERE IS CONTRADICTION, NOT INCOMPLETENESS.
 *
 * The two topologies are exclusive, and saying both is a declaration error
 * rather than a precedence puzzle. A project that names an issuer AND login
 * buttons has not decided who runs its login, and every layer downstream would
 * have to guess — which is the class of bug this whole contract exists to end.
 */
export const ProjectIdentitySchema = z
  .object({
    required: z.boolean().default(false),
    topology: IdentityTopologySchema.default('app'),
    methods: z.array(IdentityMethodSchema).default([]),
    // Keyed by SOCIAL method: a `phiwebs` or `password` key fails here.
    connections: z.record(SocialMethodSchema, IdentityConnectionSchema).default({}),
    issuer: ProjectIdentityIssuerSchema.optional(),
    claims: ProjectIdentityClaimsSchema.default({ subject: 'sub', email: 'email', name: 'name' }),
  })
  .strict()
  .superRefine((value, ctx) => {
    const connectionEntries = Object.entries(value.connections) as [
      SocialMethod,
      IdentityConnection | undefined,
    ][]
    if (value.topology === 'external') {
      if (connectionEntries.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connections'],
          message: 'connections belong to the app door; an external issuer runs its own',
        })
      }
      if (!value.issuer) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['issuer'],
          message: 'external identity must name an issuer',
        })
      }
      if (value.methods.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['methods'],
          message: 'login methods belong to the app door; an external issuer runs its own',
        })
      }
      return
    }
    if (value.issuer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['issuer'],
        message: 'app identity is brokered here; naming an issuer means topology "external"',
      })
    }
    for (const [method, connection] of connectionEntries) {
      // A connection for a button nobody sees is a leftover, and a leftover
      // own-client is a credential the author believes is unused.
      if (!value.methods.includes(method)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connections', method],
          message: `connection declared for "${method}", which is not a declared method`,
        })
        continue
      }
      if (connection?.owner === 'own' && !connection.clientId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['connections', method, 'clientId'],
          message: 'an own connection must name its client id',
        })
      }
    }
    // `required` with no method is NOT refused here, and that is deliberate.
    //
    // It was, for one day, and it broke the thing this contract exists to
    // serve: a brief saying "customers must log in" makes the distiller write
    // `required: true` before anybody has chosen the buttons, so every such
    // plan failed to parse. A plan is a document under construction and an
    // unanswered slot is a QUESTION — the same law `shell: null` follows.
    //
    // The state is refused where it is USED, not where it is stored: the
    // middleware answers 401 with an empty `methods` list, the runner's gate
    // disables its button and says no provider is declared, and the canvas
    // card reads "sign-in required, but no way in is offered". Three places
    // that can ask the author to finish the thought, instead of one that
    // refuses to record it.
  })

/**
 * A project that asks nobody to sign in.
 *
 * Named rather than written inline, because "identity was never declared" and
 * "identity was declared as anonymous" are the same runtime state and must not
 * be two different objects in storage.
 */
export const ANONYMOUS_IDENTITY: ProjectIdentity = {
  required: false,
  topology: 'app',
  methods: [],
  connections: {},
  claims: { subject: 'sub', email: 'email', name: 'name' },
}
