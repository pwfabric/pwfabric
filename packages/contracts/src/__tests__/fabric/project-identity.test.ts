/**
 * ProjectIdentity — the declaration must refuse to be ambiguous.
 *
 * The defaults are the easy half. What is worth testing is the half that says
 * no: a project which names an issuer AND login buttons has not decided who
 * runs its login, and every layer downstream — the runner building an
 * authorize URL, the API validating a token, the canvas drawing a card — would
 * have to guess differently. That guess is the bug class this contract exists
 * to end, so it fails at parse.
 *
 * @module @pwfabric/contracts/__tests__/fabric/project-identity
 */

import { describe, it, expect } from 'vitest'
import {
  ProjectIdentitySchema,
  ANONYMOUS_IDENTITY,
  IDENTITY_METHODS,
  IDENTITY_TOPOLOGIES,
  SOCIAL_METHODS,
  IdentityConnectionSchema,
  IdentityMethodSchema,
  discoveryUrlOf,
} from '../../fabric/project-identity.js'

describe('ProjectIdentitySchema', () => {
  it('an empty declaration is an anonymous app, not an error', () => {
    const parsed = ProjectIdentitySchema.parse({})
    expect(parsed).toEqual(ANONYMOUS_IDENTITY)
  })

  it('defaults the claim names to the OIDC standard', () => {
    const parsed = ProjectIdentitySchema.parse({ required: true, methods: ['password'] })
    expect(parsed.claims).toEqual({ subject: 'sub', email: 'email', name: 'name' })
    // Roles are absent rather than defaulted: an app can have authenticated
    // visitors and no roles at all, and inventing a claim name would make
    // every token look like it failed to carry one.
    expect(parsed.claims.roles).toBeUndefined()
  })

  it('accepts the app door with login methods', () => {
    const parsed = ProjectIdentitySchema.parse({
      required: true,
      topology: 'app',
      methods: ['password', 'github'],
    })
    expect(parsed.methods).toEqual(['password', 'github'])
    expect(parsed.issuer).toBeUndefined()
  })

  it('records a required sign-in with no method chosen yet — that is a question, not an error', () => {
    // This WAS refused, for one day, and it broke the pipeline it exists to
    // serve: a brief saying "customers must log in" makes the distiller set
    // `required` before anyone has picked the buttons, so every such plan
    // failed to parse. A plan under construction must be able to hold an
    // unanswered slot; the middleware, the runner's gate and the canvas card
    // are the three places that then ask the author to finish the thought.
    const r = ProjectIdentitySchema.safeParse({ required: true, methods: [] })
    expect(r.success).toBe(true)
    expect(r.success && r.data.methods).toEqual([])
  })

  it('accepts an external issuer and derives nothing it was not told', () => {
    const parsed = ProjectIdentitySchema.parse({
      required: true,
      topology: 'external',
      issuer: { issuer: 'https://id.grocer.example', clientId: 'app-1' },
    })
    expect(parsed.issuer?.scopes).toEqual(['openid', 'profile', 'email'])
    // Endpoints stay absent — discovery answers them at call time, and
    // guessing a vendor's URL shape here is exactly the hardcode that made
    // one tenant the only identity an app could have.
    expect(parsed.issuer?.authorizeUrl).toBeUndefined()
    expect(parsed.issuer?.jwksUri).toBeUndefined()
  })

  it('refuses external identity with no issuer', () => {
    const r = ProjectIdentitySchema.safeParse({ topology: 'external' })
    expect(r.success).toBe(false)
    expect(r.success === false && r.error.issues[0]?.path).toEqual(['issuer'])
  })

  it('refuses the two topologies at once, from either side', () => {
    const issuerOnPlatform = ProjectIdentitySchema.safeParse({
      topology: 'app',
      issuer: { issuer: 'https://id.grocer.example', clientId: 'app-1' },
    })
    const methodsOnExternal = ProjectIdentitySchema.safeParse({
      topology: 'external',
      methods: ['github'],
      issuer: { issuer: 'https://id.grocer.example', clientId: 'app-1' },
    })
    expect(issuerOnPlatform.success).toBe(false)
    expect(methodsOnExternal.success).toBe(false)
  })

  it('rejects an unknown login method rather than passing it through', () => {
    // The set is closed because the platform's own door implements exactly
    // these; an unknown one would render a button that authenticates nobody.
    expect(ProjectIdentitySchema.safeParse({ methods: ['okta'] }).success).toBe(false)
    expect(IDENTITY_METHODS).toEqual(['password', 'phiwebs', 'google', 'github', 'microsoft'])
  })

  it('names the two topologies app and external — platform is gone', () => {
    expect(IDENTITY_TOPOLOGIES).toEqual(['app', 'external'])
    expect(ProjectIdentitySchema.parse({}).topology).toBe('app')
    expect(ProjectIdentitySchema.safeParse({ topology: 'platform' }).success).toBe(false)
  })

  it('accepts the PhiWebs account as a login method', () => {
    const parsed = ProjectIdentitySchema.parse({ required: true, methods: ['phiwebs', 'password'] })
    expect(parsed.methods).toEqual(['phiwebs', 'password'])
    expect(parsed.connections).toEqual({})
  })

  it('refuses `host`, the pre-1.0 name of the PhiWebs account method', () => {
    expect(ProjectIdentitySchema.safeParse({ methods: ['host'] }).success).toBe(false)
    expect(IdentityMethodSchema.safeParse('host').success).toBe(false)
  })
})

describe('SOCIAL_METHODS', () => {
  it('is the three providers a connection can be declared for', () => {
    expect(SOCIAL_METHODS).toEqual(['google', 'github', 'microsoft'])
  })
})

describe('IdentityConnectionSchema', () => {
  it('defaults the owner to shared', () => {
    expect(IdentityConnectionSchema.parse({})).toEqual({ owner: 'shared' })
  })

  it('carries a client id and a tenant, and nothing secret', () => {
    expect(
      IdentityConnectionSchema.parse({ owner: 'own', clientId: 'abc', tenant: 'organizations' })
    ).toEqual({ owner: 'own', clientId: 'abc', tenant: 'organizations' })
    expect(IdentityConnectionSchema.safeParse({ owner: 'own', clientSecret: 'x' }).success).toBe(
      false
    )
  })
})

describe('ProjectIdentitySchema — connections', () => {
  it('accepts a shared connection and an own one with a client id', () => {
    const parsed = ProjectIdentitySchema.parse({
      methods: ['google', 'github', 'microsoft'],
      connections: {
        google: { owner: 'own', clientId: 'g-1' },
        github: {},
        microsoft: { owner: 'own', clientId: 'm-1', tenant: 'common' },
      },
    })
    expect(parsed.connections.github).toEqual({ owner: 'shared' })
    expect(parsed.connections.google).toEqual({ owner: 'own', clientId: 'g-1' })
  })

  it('refuses an own connection with no client id', () => {
    const r = ProjectIdentitySchema.safeParse({
      methods: ['google'],
      connections: { google: { owner: 'own' } },
    })
    expect(r.success).toBe(false)
    expect(r.success === false && r.error.issues[0]?.path).toEqual([
      'connections',
      'google',
      'clientId',
    ])
  })

  it('refuses a connection for a method that is not declared', () => {
    const r = ProjectIdentitySchema.safeParse({
      methods: ['google'],
      connections: { github: { owner: 'shared' } },
    })
    expect(r.success).toBe(false)
    expect(r.success === false && r.error.issues[0]?.path).toEqual(['connections', 'github'])
  })

  it('refuses connections on an external issuer', () => {
    const r = ProjectIdentitySchema.safeParse({
      topology: 'external',
      issuer: { issuer: 'https://id.grocer.example', clientId: 'app-1' },
      connections: { google: { owner: 'shared' } },
    })
    expect(r.success).toBe(false)
    expect(r.success === false && r.error.issues.some((i) => i.path[0] === 'connections')).toBe(
      true
    )
  })

  it('refuses a connection for the PhiWebs account — that door is PhiWebs’', () => {
    const r = ProjectIdentitySchema.safeParse({
      methods: ['phiwebs'],
      connections: { phiwebs: { owner: 'own', clientId: 'x' } },
    })
    expect(r.success).toBe(false)
  })
})

describe('discoveryUrlOf', () => {
  it('builds the standard document address and tolerates a trailing slash', () => {
    expect(discoveryUrlOf('https://id.grocer.example')).toBe(
      'https://id.grocer.example/.well-known/openid-configuration'
    )
    expect(discoveryUrlOf('https://id.grocer.example/')).toBe(
      'https://id.grocer.example/.well-known/openid-configuration'
    )
  })
})
