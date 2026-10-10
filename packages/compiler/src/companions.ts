/**
 * Companions — the shared pack code an atom's entry may import at value level.
 *
 * A pack keeps code that several atoms share in `atoms/lib/` (or `lib/` in the
 * rootless layout) and in `_shared-*` files next to the atoms. Those are the
 * only files a value-level relative import may reach; anything else in the tree
 * belongs to another atom and is not shipped with this one.
 *
 * {@link collectCompanions} walks an entry's relative imports transitively,
 * screening the entry and every companion it reaches with the same
 * {@link screenSource} rules, and returns the companion paths `compileAtom`
 * should be given. It is pure: the tree comes in as a map, nothing is read.
 *
 * @module @pwfabric/compiler/companions
 */
import { posix } from 'node:path'
import { screenSource, type ScreenOptions, type ScreenResult } from './screen.js'

/** A screening function with {@link screenSource}'s shape — injectable for tests or stricter hosts. */
export type ScreenFn = (source: string, opts?: ScreenOptions) => ScreenResult

/**
 * Whether a tree path may be reached by a value-level relative import:
 * shared lib code (`lib/…`, `atoms/lib/…`) or a `_shared-*` file anywhere.
 */
export function isCompanionTarget(path: string): boolean {
  if (path.startsWith('lib/') || path.startsWith('atoms/lib/')) return true
  const base = path.slice(path.lastIndexOf('/') + 1)
  return base.startsWith('_shared-')
}

/**
 * Resolve `spec`, imported from `fromPath`, to a companion file in `files`, or
 * `null` when it does not name one (missing, outside the tree, or not a
 * companion target).
 */
export function resolveCompanion(
  fromPath: string,
  spec: string,
  files: ReadonlySet<string> | ReadonlyMap<string, unknown>
): string | null {
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), spec))
  if (joined.startsWith('..') || joined.startsWith('/')) return null
  const noJs = joined.replace(/\.(m?js|jsx)$/, '')
  const candidates = [
    joined,
    `${noJs}.ts`,
    `${noJs}.tsx`,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.json`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
  ]
  for (const c of candidates) {
    if (files.has(c) && isCompanionTarget(c)) return c
  }
  return null
}

/** Result of {@link collectCompanions}. */
export interface CompanionScan {
  readonly ok: boolean
  /** Every screening violation; a companion's are prefixed with its path. */
  readonly violations: readonly string[]
  /** Companion paths the entry reaches, in discovery order. Pass to `compileAtom`. */
  readonly companions: readonly string[]
}

function textOf(value: string | Uint8Array): string {
  return typeof value === 'string' ? value : new TextDecoder().decode(value)
}

/**
 * Screen `entry` and every companion it reaches, transitively. A relative value
 * import passes only when it resolves to a companion target, and that target is
 * screened in turn. JSON companions are data: collected, not screened or
 * followed.
 */
export function collectCompanions(
  files: Readonly<Record<string, string | Uint8Array>>,
  entry: string,
  screen: ScreenFn = screenSource
): CompanionScan {
  const index = new Map(Object.entries(files))
  const source = index.get(entry)
  if (source === undefined) {
    return { ok: false, violations: [`entry '${entry}' is not in the source tree`], companions: [] }
  }
  const violations: string[] = []
  const companions: string[] = []
  const queue: Array<[string, string]> = [[entry, textOf(source)]]
  const seen = new Set<string>([entry])
  while (queue.length > 0) {
    const [path, text] = queue.shift() as [string, string]
    const reached: string[] = []
    const result = screen(text, {
      allowRelativeImport: (spec) => {
        const target = resolveCompanion(path, spec, index)
        if (target) reached.push(target)
        return target !== null
      },
    })
    if (!result.ok) {
      const prefix = path === entry ? '' : `${path}: `
      violations.push(...result.violations.map((v) => `${prefix}${v}`))
    }
    for (const target of reached) {
      if (seen.has(target)) continue
      seen.add(target)
      companions.push(target)
      if (!target.endsWith('.json')) queue.push([target, textOf(index.get(target) as string | Uint8Array)])
    }
  }
  return { ok: violations.length === 0, violations, companions }
}
