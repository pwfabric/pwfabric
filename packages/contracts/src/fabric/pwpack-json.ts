/**
 * `pwpack.json` — the identity file at the root of a pwpack folder.
 *
 * A pwpack folder is the unit the engine reads: `pwpack.json` at the root,
 * `app/` (an app's own composition) and `atoms/` (reusable parts). This file
 * says which pack the folder is, what it stands on, what its publisher allows,
 * where an app starts, and which exact pack builds it was made against.
 *
 * NOT THE DERIVED MANIFEST. {@link PwpackManifest} in ./atom.ts is what a
 * build DERIVES from the folder (`atoms[]`, `contentHash`, `storageRef`); it
 * is never written by hand. `pwpack.json` is the hand-written input. Its
 * `requires` lists the packs this one stands on. Each entry is `{ id, range }`
 * (the shape first-party packs write) or, in older files, a bare pack name.
 * It is not the derived manifest's `{ tokens, packs }` object.
 *
 * TWO VERSIONS, TWO MEANINGS. `version` is the pack's own semver.
 * `formatVersion` is the version of THIS FILE'S CONTRACT and of the folder
 * layout it describes — it changes when the folder format changes, never
 * because the pack's content did. `engines.pwfabric` is a third, separate
 * thing: which engine releases can run the pack.
 *
 * The schema strips unknown keys (it does not reject them), so a file written
 * against a newer format still parses here; check `formatVersion` to know
 * whether you understand everything it says.
 *
 * @module @pwfabric/contracts/fabric/pwpack-json
 */

import { z } from 'zod'
import { isValidSemverRange, PwpackPackRequirementSchema } from './pack-requires.js'
import type { PwpackManifest } from './atom.js'

// ============================================================
// TYPES
// ============================================================

/** One pinned pack: the exact version and content hash the folder was built against. */
export interface PwpackIdentityPin {
  readonly id: string
  readonly version: string
  readonly hash: string
}

/** Present only when the folder is an app: its entry surface and page order. */
export interface PwpackIdentityApp {
  /** Key of the entry surface under `app/surfaces/`. */
  readonly entry: string
  /** Surface keys in navigation order; each names an `app/surfaces/<key>.receipt.json`. */
  readonly surfaceOrder: readonly string[]
  /** Display name of the app. */
  readonly title?: string
  /** One-line description of the app. */
  readonly description?: string
  /** Icon name or asset key for the app. */
  readonly icon?: string
}

/** Which engine releases a pack runs on. */
export interface PwpackEngines {
  /**
   * Semver range of PWFabric engine versions the pack runs on, e.g.
   * `">=1.0.0 <2"`. Absent means the pack states no constraint.
   */
  readonly pwfabric?: string
}

/** The parsed `pwpack.json` at the root of a pwpack folder. */
export interface PwpackIdentity {
  /** `@pwpack/<publisher>/<name>` for a published pack. */
  readonly id: string
  /** The pack's own semver. */
  readonly version: string
  /**
   * Version of the folder / `pwpack.json` contract, independent of the pack's
   * `version` and of the engine version — `MAJOR.MINOR`, e.g. `"1.0"`.
   * ABSENT MEANS THE PRE-VERSIONED LAYOUT: the format as it was before this
   * field existed. A reader treats an absent value as that layout, not as
   * "latest".
   */
  readonly formatVersion?: string
  /** Engine releases the pack runs on. Absent: no constraint is stated. */
  readonly engines?: PwpackEngines
  /** Names of what the pack needs from the host or from other packs. */
  readonly requires?: readonly (string | { readonly id: string; readonly range: string })[]
  /**
   * What the publisher allows others to do with the pack's atoms. Same shape
   * as {@link PwpackManifest.license}; absent is not "both off" — the
   * consumer applies its own default.
   */
  readonly license?: NonNullable<PwpackManifest['license']>
  /** Present only when the folder is an app. A folder without it is a pack. */
  readonly app?: PwpackIdentityApp
  /** Declared pins: the exact pack builds this folder was made against. */
  readonly packs?: readonly PwpackIdentityPin[]
}

// ============================================================
// SCHEMAS
// ============================================================

export const PwpackIdentityPinSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  hash: z.string().min(1),
})

export const PwpackIdentityAppSchema = z.object({
  entry: z.string().min(1),
  surfaceOrder: z.array(z.string().min(1)),
  title: z.string().optional(),
  description: z.string().optional(),
  icon: z.string().optional(),
})

export const PwpackEnginesSchema = z.object({
  pwfabric: z
    .string()
    .min(1)
    .refine(isValidSemverRange, (range) => ({
      message: `engines.pwfabric "${range}" is not a semver range`,
    }))
    .optional(),
})

export const PwpackIdentitySchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  formatVersion: z
    .string()
    .regex(/^\d+\.\d+$/, 'formatVersion must be MAJOR.MINOR, e.g. "1.0"')
    .optional(),
  engines: PwpackEnginesSchema.optional(),
  requires: z.array(z.union([z.string().min(1), PwpackPackRequirementSchema])).optional(),
  license: z.object({ fork: z.boolean(), redistribute: z.boolean() }).optional(),
  app: PwpackIdentityAppSchema.optional(),
  packs: z.array(PwpackIdentityPinSchema).optional(),
})

// ============================================================
// HELPERS
// ============================================================

export type PwpackIdentityValidation =
  { readonly ok: true; readonly value: PwpackIdentity } | { readonly ok: false; readonly issues: readonly string[] }

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
    issues: parsed.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)),
  }
}
