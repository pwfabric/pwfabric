/**
 * The zod schemas of `project-identity.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { IDENTITY_METHODS, IDENTITY_REGISTRATIONS, IDENTITY_TOPOLOGIES, IdentityConnection, SOCIAL_METHODS, SocialMethod } from './project-identity.js'

export const IdentityTopologySchema = z.enum(IDENTITY_TOPOLOGIES)

// ============================================================
// LOGIN METHODS (app topology only)

export const IdentityMethodSchema = z.enum(IDENTITY_METHODS)

export const SocialMethodSchema = z.enum(SOCIAL_METHODS)

// ============================================================
// CONNECTIONS (which OAuth registration a social method uses)

export const IdentityConnectionSchema = z
  .object({
    owner: z.enum(['shared', 'own']).default('shared'),
    clientId: z.string().min(1).max(200).optional(),
    // microsoft: tenant id | 'organizations' | 'common'
    tenant: z.string().min(1).max(100).optional(),
  })
  .strict()

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

export const ProjectIdentityClaimsSchema = z
  .object({
    subject: z.string().min(1).max(120).default('sub'),
    email: z.string().min(1).max(120).default('email'),
    name: z.string().min(1).max(120).default('name'),
    roles: z.string().min(1).max(120).optional(),
  })
  .strict()

// ============================================================
// REGISTRATION — who may make an account

export const IdentityRegistrationSchema = z.enum(IDENTITY_REGISTRATIONS)

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
    registration: IdentityRegistrationSchema.optional(),
    // Keyed by SOCIAL method: a `phiwebs` or `password` key fails here.
    // Partial: a project connects only the methods it uses (zod 4's
    // z.record with an enum key would require every one).
    connections: z.partialRecord(SocialMethodSchema, IdentityConnectionSchema).default({}),
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
