/**
 * The zod schemas of `pack-requires.ts` (tooling only: `@pwfabric/<pkg>/schemas`).
 * The package root is zod-free, so the visitor bundle never loads zod.
 */
import { z } from 'zod'
import type { PwpackRequirements } from './atom.js'
import { PackClosureCandidate, PackClosureError, PackClosureResult, PwpackRequirementsValidation, isValidSemverRange, isValidSemverVersion, packRefKey, satisfiesSemverRange } from './pack-requires.js'

export const PwpackPackRequirementSchema = z
  .object({
    id: z
      .string()
      .min(1, 'requires.packs[].id is required')
      .max(200)
      .regex(
        // A bare name (`records`) or a scoped id: `@pwpack/records`,
        // `@pwpack/example/cards`, or a pack under its own npm scope
        // (`@pwfabric/foundation`).
        /^(@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/,
        'requires.packs[].id must be a pack name (`records`) or a scoped id (`@pwpack/records`, `@pwfabric/foundation`)'
      ),
    range: z
      .string()
      .min(1, 'requires.packs[].range is required')
      .refine(isValidSemverRange, {
        error: (issue) => `requires.packs[].range "${String(issue.input)}" is not a semver range`,
      }),
  })
  .strict()

/**
 * `requires` on a pwpack manifest. `tokens` is unchanged; `packs` is new and
 * optional. Duplicate pack ids are rejected (after {@link packRefKey}, so
 * `records` and `@pwpack/records` collide). A pack requiring itself needs the
 * pack's own id to detect — use {@link validatePwpackRequirements} for that.
 */
export const PwpackRequirementsSchema = z
  .object({
    tokens: z.array(z.string().min(1)).optional(),
    packs: z.array(PwpackPackRequirementSchema).optional(),
  })
  .passthrough()
  .superRefine((req, ctx) => {
    const seen = new Set<string>()
    req.packs?.forEach((p, i) => {
      const key = packRefKey(p.id)
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['packs', i, 'id'],
          message: `requires.packs names "${key}" more than once`,
        })
      }
      seen.add(key)
    })
  })

/**
 * Validate a pack's `requires` block in the context of the pack that owns it:
 * the schema rules plus "a pack does not require itself".
 * `requires` may be undefined — a pack with no requirements is valid.
 */
export function validatePwpackRequirements(packId: string, requires: unknown): PwpackRequirementsValidation {
  if (requires === undefined) return { ok: true, value: {} }
  const parsed = PwpackRequirementsSchema.safeParse(requires)
  const issues: string[] = parsed.success
    ? []
    : parsed.error.issues.map((i) => (i.path.length ? `${i.path.map(String).join('.')}: ${i.message}` : i.message))
  if (parsed.success) {
    const self = packRefKey(packId)
    parsed.data.packs?.forEach((p, i) => {
      if (packRefKey(p.id) === self) issues.push(`packs.${i}.id: pack "${self}" requires itself`)
    })
  }
  if (issues.length || !parsed.success) return { ok: false, issues }
  return { ok: true, value: parsed.data as PwpackRequirements }
}

// ============================================================
// CLOSURE

/**
 * Resolve what installing `roots` means.
 *
 * `candidates` is the set of packs that CAN be installed — one version per
 * pack (e.g. the latest approved listing of each). `roots` are the packs asked
 * for, by bare name or full id. The result is every pack in the dependency
 * closure of `roots`, dependencies before dependents, each exactly once —
 * install them in that order. Ordering is deterministic: roots in the order
 * given, dependencies in the order declared.
 *
 * Refuses with a typed error instead of returning a partial list: a missing
 * pack, a version outside the declared range, a cycle, a malformed `requires`,
 * or two candidates for one pack. Pure — no I/O; filtering out what is already
 * installed is the caller's job.
 */
export function resolvePackClosure<T extends PackClosureCandidate>(
  roots: readonly string[],
  candidates: readonly T[]
): PackClosureResult<T> {
  const byKey = new Map<string, T>()
  for (const c of candidates) {
    const key = packRefKey(c.id)
    if (byKey.has(key)) return { ok: false, error: { code: 'DUPLICATE_PACK', pack: key } }
    byKey.set(key, c)
  }

  const order: T[] = []
  const done = new Set<string>()
  const stack: string[] = []

  const visit = (key: string, requiredBy: string | null, range: string | null): PackClosureError | null => {
    const pack = byKey.get(key)
    if (!pack) return { code: 'MISSING_PACK', pack: key, requiredBy, range }
    if (range !== null && requiredBy !== null && !satisfiesSemverRange(pack.version, range)) {
      return {
        code: 'UNSATISFIED_RANGE',
        pack: key,
        version: pack.version,
        range,
        requiredBy,
      }
    }
    if (done.has(key)) return null
    const onStack = stack.indexOf(key)
    if (onStack >= 0) return { code: 'CYCLE', path: [...stack.slice(onStack), key] }

    const checked = validatePwpackRequirements(pack.id, pack.requires)
    if (!checked.ok) return { code: 'INVALID_REQUIRES', pack: key, issues: checked.issues }
    if (!isValidSemverVersion(pack.version)) {
      return {
        code: 'INVALID_REQUIRES',
        pack: key,
        issues: [`version "${pack.version}" is not a semver version`],
      }
    }

    stack.push(key)
    for (const dep of checked.value.packs ?? []) {
      const err = visit(packRefKey(dep.id), key, dep.range)
      if (err) return err
    }
    stack.pop()
    done.add(key)
    order.push(pack)
    return null
  }

  for (const root of roots) {
    const err = visit(packRefKey(root), null, null)
    if (err) return { ok: false, error: err }
  }
  return { ok: true, order }
}
