/**
 * The zod schemas of `pwpack-json.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import { PwpackPackRequirementSchema } from './pack-requires.schema.js'
import { isValidSemverRange } from './pack-requires.js'
import { PWPACK_CATEGORY_PATTERN, PWPACK_TOKEN_PATTERN, PwpackIdentity, PwpackIdentityValidation } from './pwpack-json.js'

export const PwpackIdentityPinSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  hash: z.string().min(1),
})

export const PwpackIdentityAppSchema = z.object({
  entry: z.string().min(1),
  surfaceOrder: z.array(z.string().min(1)),
  notFound: z.string().min(1).optional(),
  signIn: z.string().min(1).optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
})

export const PwpackEnginesSchema = z.object({
  pwfabric: z
    .string()
    .min(1)
    .refine(isValidSemverRange, {
      error: (issue) => `engines.pwfabric "${String(issue.input)}" is not a semver range`,
    })
    .optional(),
})

export const PwpackIdentitySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  formatVersion: z
    .string()
    .regex(/^\d+\.\d+$/, 'formatVersion must be MAJOR.MINOR, e.g. "1.0"')
    .optional(),
  name: z.string().min(1, 'name must be a non-empty string').optional(),
  description: z.string().optional(),
  category: z
    .string()
    .regex(PWPACK_CATEGORY_PATTERN, 'category must be a lowercase slug, e.g. "ui-design"')
    .optional(),
  engines: PwpackEnginesSchema.optional(),
  requires: z.array(z.union([z.string().min(1), PwpackPackRequirementSchema])).optional(),
  tokens: z
    .array(z.string().regex(PWPACK_TOKEN_PATTERN, 'each token must be a CSS custom property name, e.g. "--pw-color-primary-ink"'))
    .optional(),
  license: z.object({ fork: z.boolean(), redistribute: z.boolean() }).optional(),
  app: PwpackIdentityAppSchema.optional(),
  packs: z.array(PwpackIdentityPinSchema).optional(),
})

// ============================================================
// HELPERS

/** Parse a `pwpack.json` document. Throws a `ZodError` when it is not valid. */
export function parsePwpackIdentity(input: unknown): PwpackIdentity {
  // Cast: zod's optional output is `T | undefined`, the contract type is
  // `T`-or-absent (exactOptionalPropertyTypes). Same shape, as in
  // `validatePwpackRequirements`.
  return PwpackIdentitySchema.parse(input) as PwpackIdentity
}

/** Validate a `pwpack.json` document without throwing. Issues read `path: message`. */
export function safeParsePwpackIdentity(input: unknown): PwpackIdentityValidation {
  const parsed = PwpackIdentitySchema.safeParse(input)
  if (parsed.success) return { ok: true, value: parsed.data as PwpackIdentity }
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message)),
  }
}
