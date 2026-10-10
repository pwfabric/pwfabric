/**
 * Virtual paths. The compiler never touches a disk: every file lives in the
 * caller's `files` map under a POSIX path relative to a virtual root. This
 * module is the one place that decides what such a path may look like.
 *
 * Containment is decided by where a path RESOLVES, not by whether it spells
 * `..`: `lib/../lib/x.ts` is fine, `../x.ts` is not. A relative import that
 * climbs within the tree is legitimate (a block in `blocks/a/b/` reaching
 * `lib/` climbs three levels); one that climbs past the root is the escape.
 */
import { posix } from 'node:path'

/** Thrown for a path that resolves outside the virtual root. */
export class PathEscapeError extends Error {
  constructor(readonly attempted: string) {
    super(`Path resolves outside the source tree: ${attempted}`)
    this.name = 'PathEscapeError'
  }
}

/**
 * Normalise a caller-supplied key to the canonical virtual form: forward
 * slashes, no leading `./`, no `.`/`..` segments. Throws {@link PathEscapeError}
 * for an absolute path (POSIX or drive-letter), a NUL byte, an empty path, or a
 * path whose `..` segments climb past the root.
 */
export function normalizeVirtualPath(raw: string): string {
  const slashed = raw.replace(/\\/g, '/')
  if (slashed.length === 0 || slashed.includes('\0')) throw new PathEscapeError(raw)
  if (slashed.startsWith('/') || /^[A-Za-z]:/.test(slashed)) throw new PathEscapeError(raw)
  const normalized = posix.normalize(slashed)
  if (normalized === '..' || normalized.startsWith('../') || normalized === '.' || normalized.endsWith('/')) {
    throw new PathEscapeError(raw)
  }
  return normalized
}

/**
 * Join a relative specifier onto the directory of `fromPath` and normalise.
 * Throws {@link PathEscapeError} when the result leaves the root.
 */
export function joinVirtual(fromPath: string, spec: string): string {
  const joined = posix.normalize(posix.join(posix.dirname(fromPath), spec))
  if (joined === '..' || joined.startsWith('../') || joined.startsWith('/')) {
    throw new PathEscapeError(spec)
  }
  return joined
}

/** esbuild's default resolve order, which the on-disk compiler relied on. */
const RESOLVE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.json'] as const

/**
 * The files a resolved-but-unextended path may name, in esbuild's own order:
 * the exact path; for a `.js`/`.jsx`/`.mjs` spelling, the TypeScript file it
 * stands for (esbuild rewrites `./x.js` to `./x.ts` the same way); the path
 * plus each resolve extension; then `index.*` inside it.
 */
export function resolveCandidates(joined: string): string[] {
  const out = [joined]
  const ext = posix.extname(joined)
  if (ext === '.js' || ext === '.jsx') {
    const base = joined.slice(0, -ext.length)
    out.push(`${base}.ts`, `${base}.tsx`)
  } else if (ext === '.mjs') {
    out.push(`${joined.slice(0, -4)}.mts`)
  }
  for (const e of RESOLVE_EXTENSIONS) out.push(`${joined}${e}`)
  for (const e of RESOLVE_EXTENSIONS) out.push(`${joined}/index${e}`)
  return out
}
