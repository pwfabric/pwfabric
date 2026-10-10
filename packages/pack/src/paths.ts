/**
 * Path rules shared by the folder reader, the archive reader and writer, and
 * validation. One definition of "safe", one ordering.
 *
 * @module @pwfabric/pack/paths
 */

const encoder = new TextEncoder()

/**
 * Why a pack path is unsafe, or `null` when it is safe.
 *
 * Safe means: non-empty, relative, `/`-separated, no empty / `.` / `..`
 * segment, no backslash, no NUL, no drive letter. Segment-based, so
 * `a/../b`, a bare `..` and `..\x` all fail alike.
 */
export function unsafePathReason(path: string): string | null {
  if (path.length === 0) return 'empty path'
  if (path.includes('\0')) return 'contains a NUL byte'
  if (path.includes('\\')) return 'contains a backslash'
  if (path.startsWith('/')) return 'absolute path'
  if (/^[A-Za-z]:/.test(path)) return 'drive-qualified path'
  for (const seg of path.split('/')) {
    if (seg === '..') return 'parent-directory segment'
    if (seg === '.') return 'current-directory segment'
    if (seg.length === 0) return 'empty segment'
  }
  return null
}

/** True when {@link unsafePathReason} finds nothing. */
export function isSafePackPath(path: string): boolean {
  return unsafePathReason(path) === null
}

/** Byte-wise comparison of the UTF-8 encodings — stable across locales and platforms. */
export function compareBytes(a: string, b: string): number {
  if (a === b) return 0
  const ba = encoder.encode(a)
  const bb = encoder.encode(b)
  const n = Math.min(ba.length, bb.length)
  for (let i = 0; i < n; i++) {
    const d = (ba[i] as number) - (bb[i] as number)
    if (d !== 0) return d
  }
  return ba.length - bb.length
}

/** The pack's paths in byte order. */
export function sortedPaths(paths: Iterable<string>): string[] {
  return [...paths].sort(compareBytes)
}

/**
 * The first file/directory collision in a set of file paths: a path that is a
 * file and also a directory of another path (`atoms/x` and `atoms/x/y`).
 * Such a set cannot exist on any file system — extracting it clobbers one
 * side or fails. `null` when there is none. Checked in byte order, so the
 * answer is the same whatever order the paths come in.
 */
export function findPathConflict(paths: Iterable<string>): { readonly file: string; readonly inside: string } | null {
  const all = new Set(paths)
  for (const path of sortedPaths(all)) {
    let i = path.indexOf('/')
    while (i !== -1) {
      const dir = path.slice(0, i)
      if (all.has(dir)) return { file: dir, inside: path }
      i = path.indexOf('/', i + 1)
    }
  }
  return null
}

/** The key two paths share when a case-insensitive, normalisation-insensitive file system treats them as one. */
export function foldPath(path: string): string {
  return path.normalize('NFC').toLowerCase()
}

/**
 * Groups of distinct paths that collide on a case-insensitive file system
 * (paths themselves are case-sensitive, so the pack is valid, but extracting
 * it there overwrites one file with another). Two kinds: two files whose
 * folded paths are equal (`Hero.json` / `hero.json`, or NFC / NFD spellings),
 * and a file whose folded path equals the folded path of another file's
 * directory (`Atoms` / `atoms/x`). Exact file/directory collisions are
 * {@link findPathConflict}'s and are not repeated here. Each group is sorted
 * in byte order; groups are sorted by their first member.
 */
export function findCaseConflicts(paths: Iterable<string>): string[][] {
  const sorted = sortedPaths(new Set(paths))
  const files = new Map<string, string[]>()
  for (const path of sorted) {
    const key = foldPath(path)
    const group = files.get(key)
    if (group) group.push(path)
    else files.set(key, [path])
  }
  const dirs = new Map<string, Set<string>>()
  for (const path of sorted) {
    let i = path.indexOf('/')
    while (i !== -1) {
      const dir = path.slice(0, i)
      const key = foldPath(dir)
      const set = dirs.get(key) ?? new Set<string>()
      set.add(dir)
      dirs.set(key, set)
      i = path.indexOf('/', i + 1)
    }
  }
  const out: string[][] = []
  for (const [key, group] of files) {
    const members = new Set(group)
    for (const dir of dirs.get(key) ?? []) if (!members.has(dir)) members.add(`${dir}/`)
    if (members.size > 1) out.push(sortedPaths(members))
  }
  return out.sort((a, b) => compareBytes(a[0] as string, b[0] as string))
}
