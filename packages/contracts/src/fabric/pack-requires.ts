/**
 * Pack-level dependencies — `requires.packs` on a pwpack manifest.
 *
 * A pack can stand on another pack: a vertical pack (commerce) takes its
 * blocks from a horizontal one (records), which stands on foundation. The
 * manifest says so in `requires.packs`, and everything that installs a pack —
 * a pack store, a delivery path, an app builder — has to answer the same
 * two questions the same way:
 *
 *   1. Is this declaration well-formed?   → `PwpackRequirementsSchema`,
 *                                           `validatePwpackRequirements`
 *   2. What gets installed, in which order,
 *      and what stops it?                  → `resolvePackClosure`
 *
 * Both live here, pure, so no consumer writes its own and disagrees.
 *
 * NO SEMVER DEPENDENCY. Contracts depend on zod alone. The range grammar below
 * is the npm subset pack manifests use: exact versions, `^`, `~`, comparators
 * (`>=`, `>`, `<=`, `<`, `=`), x-ranges (`1.x`, `1.2.*`, `*`), hyphen ranges
 * (`1.2.0 - 2.0.0`), space for AND and `||` for OR. Prerelease versions follow
 * npm's rule: they only satisfy a range that names a prerelease on the same
 * `major.minor.patch`.
 *
 * @module @pwfabric/contracts/fabric/pack-requires
 */

import type { PwpackRequirements } from './atom.js'

// ============================================================
// SEMVER
// ============================================================

interface SemVer {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly prerelease: readonly (string | number)[]
}

const NUM = '0|[1-9]\\d*'
const PRE_ID = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)'
const VERSION_RE = new RegExp(
  `^v?(${NUM})\\.(${NUM})\\.(${NUM})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$`
)
const XR = `${NUM}|[xX*]`
const PARTIAL_RE = new RegExp(
  `^v?(${XR})(?:\\.(${XR})(?:\\.(${XR})(?:-(${PRE_ID}(?:\\.${PRE_ID})*))?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?)?)?$`
)

function parsePre(pre: string | undefined): (string | number)[] {
  if (!pre) return []
  return pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p))
}

function parseVersion(input: string): SemVer | null {
  const m = VERSION_RE.exec(input.trim())
  if (!m) return null
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: parsePre(m[4]),
  }
}

function compareVersions(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  // A version without a prerelease ranks above one with it.
  if (!a.prerelease.length || !b.prerelease.length) return b.prerelease.length - a.prerelease.length
  const n = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < n; i++) {
    const x = a.prerelease[i]
    const y = b.prerelease[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x - y
    if (typeof x === 'number') return -1
    if (typeof y === 'number') return 1
    return x < y ? -1 : 1
  }
  return 0
}

type Op = '<' | '<=' | '>' | '>=' | '='
interface Comparator {
  readonly op: Op
  readonly v: SemVer
}

const v = (major: number, minor: number, patch: number, prerelease: (string | number)[] = []): SemVer => ({
  major,
  minor,
  patch,
  prerelease,
})
/** Lowest version on a tuple — `X.Y.Z-0`, the npm upper-bound idiom. */
const floor = (major: number, minor: number, patch: number): SemVer => v(major, minor, patch, [0])

interface PartialVersion {
  readonly major: number | null
  readonly minor: number | null
  readonly patch: number | null
  readonly prerelease: (string | number)[]
}

function parsePartial(input: string): PartialVersion | null {
  const m = PARTIAL_RE.exec(input)
  if (!m) return null
  const part = (s: string | undefined): number | null =>
    s === undefined || s === 'x' || s === 'X' || s === '*' ? null : Number(s)
  const major = part(m[1])
  const minor = major === null ? null : part(m[2])
  const patch = minor === null ? null : part(m[3])
  return {
    major,
    minor,
    patch,
    prerelease: patch === null ? [] : parsePre(m[4]),
  }
}

const ANY: Comparator[] = [{ op: '>=', v: v(0, 0, 0) }]

/** `1.2.x` / `1` / `*` → the interval it names. */
function xRange(p: PartialVersion): Comparator[] {
  if (p.major === null) return ANY
  if (p.minor === null)
    return [
      { op: '>=', v: v(p.major, 0, 0) },
      { op: '<', v: floor(p.major + 1, 0, 0) },
    ]
  if (p.patch === null) {
    return [
      { op: '>=', v: v(p.major, p.minor, 0) },
      { op: '<', v: floor(p.major, p.minor + 1, 0) },
    ]
  }
  return [{ op: '=', v: v(p.major, p.minor, p.patch, p.prerelease) }]
}

function caret(p: PartialVersion): Comparator[] {
  if (p.major === null) return ANY
  if (p.minor === null) return xRange(p)
  if (p.patch === null) {
    const upper = p.major > 0 ? floor(p.major + 1, 0, 0) : floor(0, p.minor + 1, 0)
    return [
      { op: '>=', v: v(p.major, p.minor, 0) },
      { op: '<', v: upper },
    ]
  }
  const lower = v(p.major, p.minor, p.patch, p.prerelease)
  const upper =
    p.major > 0 ? floor(p.major + 1, 0, 0) : p.minor > 0 ? floor(0, p.minor + 1, 0) : floor(0, 0, p.patch + 1)
  return [
    { op: '>=', v: lower },
    { op: '<', v: upper },
  ]
}

function tilde(p: PartialVersion): Comparator[] {
  if (p.major === null || p.minor === null || p.patch === null) return xRange(p)
  return [
    { op: '>=', v: v(p.major, p.minor, p.patch, p.prerelease) },
    { op: '<', v: floor(p.major, p.minor + 1, 0) },
  ]
}

function primitive(op: Op, p: PartialVersion): Comparator[] | null {
  if (op === '=') return xRange(p)
  if (p.major === null) return op === '<' || op === '>' ? null : ANY // `<*` / `>*` match nothing
  const full = p.minor !== null && p.patch !== null
  if (full) return [{ op, v: v(p.major, p.minor as number, p.patch as number, p.prerelease) }]
  // Partial versions: `>1.2` means "above every 1.2.x", `<=1` means "up to every 1.x".
  const nextTuple = p.minor === null ? floor(p.major + 1, 0, 0) : floor(p.major, p.minor + 1, 0)
  const low = v(p.major, p.minor ?? 0, 0)
  switch (op) {
    case '>=':
      return [{ op: '>=', v: low }]
    case '>':
      return [{ op: '>=', v: nextTuple }]
    case '<':
      return [{ op: '<', v: floor(low.major, low.minor, 0) }]
    case '<=':
      return [{ op: '<', v: nextTuple }]
  }
}

const COMPARATOR_RE = /^(<=|>=|<|>|=|\^|~>?)?\s*(.+)$/

/** One whitespace-separated AND-set → primitive comparators, or null if malformed. */
function parseSet(input: string): Comparator[] | null {
  const trimmed = input.trim()
  if (trimmed === '') return ANY
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(trimmed)
  if (hyphen) {
    const lo = parsePartial(hyphen[1] as string)
    const hi = parsePartial(hyphen[2] as string)
    if (!lo || !hi) return null
    const lower =
      lo.major === null
        ? ANY
        : [
            {
              op: '>=' as const,
              v: v(lo.major, lo.minor ?? 0, lo.patch ?? 0, lo.prerelease),
            },
          ]
    const upper = primitive('<=', hi)
    if (!upper) return null
    return [...lower, ...upper]
  }
  // Glue operators to their version (`>= 1.2.0` → `>=1.2.0`) before splitting.
  const tokens = trimmed.replace(/(<=|>=|<|>|=|\^|~>?)\s+/g, '$1').split(/\s+/)
  const out: Comparator[] = []
  for (const token of tokens) {
    const m = COMPARATOR_RE.exec(token)
    if (!m) return null
    const op = m[1]
    const p = parsePartial(m[2] as string)
    if (!p) return null
    const cs = op === '^' ? caret(p) : op === '~' || op === '~>' ? tilde(p) : primitive((op ?? '=') as Op, p)
    if (!cs) return null
    out.push(...cs)
  }
  return out
}

function parseRange(range: string): Comparator[][] | null {
  if (typeof range !== 'string' || range.length > 256) return null
  const sets: Comparator[][] = []
  for (const part of range.split('||')) {
    const set = parseSet(part)
    if (!set) return null
    sets.push(set)
  }
  return sets
}

function test(c: Comparator, x: SemVer): boolean {
  const d = compareVersions(x, c.v)
  switch (c.op) {
    case '<':
      return d < 0
    case '<=':
      return d <= 0
    case '>':
      return d > 0
    case '>=':
      return d >= 0
    case '=':
      return d === 0
  }
}

function testSet(set: readonly Comparator[], x: SemVer): boolean {
  if (!set.every((c) => test(c, x))) return false
  if (!x.prerelease.length) return true
  // npm: a prerelease only satisfies a set that names a prerelease on its own tuple.
  // The synthetic `<X.Y.Z-0` upper bounds are excluded — they fence, they do not invite.
  return set.some(
    (c) =>
      !(c.op === '<' && c.v.prerelease.length === 1 && c.v.prerelease[0] === 0) &&
      c.v.prerelease.length > 0 &&
      c.v.major === x.major &&
      c.v.minor === x.minor &&
      c.v.patch === x.patch
  )
}

/** True when `range` parses as a semver range. */
export function isValidSemverRange(range: string): boolean {
  return parseRange(range) !== null
}

/** True when `version` parses as a full semver version (`1.2.3`, `1.2.3-rc.1`). */
export function isValidSemverVersion(version: string): boolean {
  return typeof version === 'string' && parseVersion(version) !== null
}

/**
 * True when `version` satisfies `range`. An unparseable version or range
 * satisfies nothing — the caller validates first when it needs to say why.
 */
export function satisfiesSemverRange(version: string, range: string): boolean {
  const x = typeof version === 'string' ? parseVersion(version) : null
  const sets = parseRange(range)
  if (!x || !sets) return false
  return sets.some((set) => testSet(set, x))
}

// ============================================================
// PACK IDENTITY
// ============================================================

/**
 * The comparison key of a pack reference. First-party pack sources write dependencies
 * by bare name (`records`) while a published manifest's `id` is the full npm
 * name (`@pwpack/records`). Both name the same pack; this is the one place
 * that says so.
 */
export function packRefKey(id: string): string {
  return id.trim().replace(/^@pwpack\//, '')
}

// ============================================================
// SCHEMA
// ============================================================

export type PwpackRequirementsValidation =
  { readonly ok: true; readonly value: PwpackRequirements } | { readonly ok: false; readonly issues: readonly string[] }

// ============================================================

/** What the resolver needs to know about a pack. A `PwpackManifest` fits. */
export interface PackClosureCandidate {
  readonly id: string
  readonly version: string
  readonly requires?: PwpackRequirements
}

export type PackClosureError =
  /** A root, or a dependency of `requiredBy`, is not in the candidate set. */
  | {
      readonly code: 'MISSING_PACK'
      readonly pack: string
      readonly requiredBy: string | null
      readonly range: string | null
    }
  /** The only available version of `pack` is outside the range `requiredBy` asks for. */
  | {
      readonly code: 'UNSATISFIED_RANGE'
      readonly pack: string
      readonly version: string
      readonly range: string
      readonly requiredBy: string
    }
  /** `path` starts and ends on the same pack: a → b → a. */
  | { readonly code: 'CYCLE'; readonly path: readonly string[] }
  /** A candidate's `requires` or `version` is malformed (see `validatePwpackRequirements`). */
  | {
      readonly code: 'INVALID_REQUIRES'
      readonly pack: string
      readonly issues: readonly string[]
    }
  /** Two candidates share a pack id; the caller must choose one version per pack. */
  | { readonly code: 'DUPLICATE_PACK'; readonly pack: string }

export type PackClosureResult<T extends PackClosureCandidate = PackClosureCandidate> =
  { readonly ok: true; readonly order: readonly T[] } | { readonly ok: false; readonly error: PackClosureError }

