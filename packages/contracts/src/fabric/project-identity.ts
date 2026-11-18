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


// ============================================================
// TOPOLOGY
// ============================================================

export const IDENTITY_TOPOLOGIES = ['app', 'external'] as const

/** Who runs the login: the host, or an issuer the project names. */
export type IdentityTopology = (typeof IDENTITY_TOPOLOGIES)[number]

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

/**
 * The methods that run at a third-party provider — the ones a CONNECTION can
 * be declared for. `password` has no provider and `phiwebs` is PhiWebs' own
 * authorization server, so neither ever takes one.
 */
export const SOCIAL_METHODS = ['google', 'github', 'microsoft'] as const

export type SocialMethod = (typeof SOCIAL_METHODS)[number]

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

// ============================================================

/**
 * WHO MAY MAKE AN ACCOUNT, said once by the app.
 *
 *  - `open`: anyone may register (a shop's customers, a conference's
 *    attendees).
 *  - `invite`: an account is made only with an invitation the owner sent —
 *    the register door takes the invitation's token and refuses without one.
 *  - `closed`: nobody registers through the app; the accounts are the ones
 *    the owner made or assigned.
 *
 * `member` in an access rule means "any signed-in account", so an app whose
 * members are a team is only private if not just anyone can become one. That
 * is why registration is a declaration and not a runner habit.
 */
export const IDENTITY_REGISTRATIONS = ['open', 'invite', 'closed'] as const
export type IdentityRegistration = (typeof IDENTITY_REGISTRATIONS)[number]

/**
 * The registration an app has: the one it declares, else `closed` when sign-in
 * is required and `open` when it is not.
 *
 * WHY THAT DEFAULT. An app that requires sign-in is a members' space — a
 * team's dashboard, an intranet — and an open door would make every `member`
 * rule public to whoever registers. An app with optional sign-in is a public
 * app whose visitors make their own accounts. Roles do not decide it: a shop
 * declares `staff` and still takes customers. Roles are never granted by
 * registering; they are assigned by the owner (or carried by an invitation).
 */
export function registrationOf(declaration: { readonly required?: unknown; readonly registration?: unknown }): IdentityRegistration {
  const r = declaration.registration
  if (typeof r === 'string' && (IDENTITY_REGISTRATIONS as readonly string[]).includes(r)) return r as IdentityRegistration
  return declaration.required === true ? 'closed' : 'open'
}

// ============================================================
// THE DECLARATION
// ============================================================

export interface ProjectIdentity {
  /** Sign-in is required to open the app at all. */
  readonly required: boolean
  readonly topology: IdentityTopology
  /** `app` only — the buttons the visitor sees. */
  readonly methods: readonly IdentityMethod[]
  /** `app` only — who may make an account; absent: see `registrationOf`. */
  readonly registration?: IdentityRegistration | undefined
  /** `app` only — which registration each declared social method uses. */
  readonly connections: IdentityConnections
  /** `external` only. */
  readonly issuer?: ProjectIdentityIssuer | undefined
  readonly claims: ProjectIdentityClaims
}

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
