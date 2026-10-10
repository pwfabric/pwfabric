/**
 * Folder ⇄ memory: walk a pwpack folder on disk into a {@link PackFolder},
 * and build one from a plain path → content record.
 *
 * @module @pwfabric/pack/folder
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { PackError, type PackFolder } from './types.js'
import { compareBytes, unsafePathReason } from './paths.js'

/**
 * Entry names skipped anywhere in the walk: dependency and build output, VCS
 * metadata and the junk files operating systems drop into folders.
 */
export const DEFAULT_IGNORED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  'dist',
  '.git',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
])

export interface ReadFolderOptions {
  /** Entry names to skip at any depth. Replaces {@link DEFAULT_IGNORED_NAMES}. */
  readonly ignore?: ReadonlySet<string>
}

/**
 * Walk `dir` into memory.
 *
 * Paths are POSIX and relative to `dir`; bytes are taken as they are on disk
 * (no line-ending or Unicode normalisation). Skipped: names in the ignore set
 * at any depth, and `*.pwpack` archives directly at the root (a folder's own
 * packed output never packs itself). Refused with {@link PackError}: a
 * symbolic link or junction (`LINK_ENTRY`), anything that is neither a file
 * nor a directory (`UNSUPPORTED_ENTRY`), and a name that cannot be a safe
 * pack path, e.g. one containing a backslash (`UNSAFE_PATH`).
 */
export async function readFolder(dir: string, options: ReadFolderOptions = {}): Promise<PackFolder> {
  const ignore = options.ignore ?? DEFAULT_IGNORED_NAMES
  const st = await stat(dir).catch(() => null)
  if (!st?.isDirectory()) throw new PackError('NOT_A_DIRECTORY', `not a directory: ${dir}`)

  const files = new Map<string, Uint8Array>()
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await readdir(abs, { withFileTypes: true })
    entries.sort((a, b) => compareBytes(a.name, b.name))
    for (const entry of entries) {
      if (ignore.has(entry.name)) continue
      const relPath = rel ? `${rel}/${entry.name}` : entry.name
      const reason = unsafePathReason(relPath)
      if (reason) throw new PackError('UNSAFE_PATH', `${relPath}: ${reason}`, relPath)
      const full = join(abs, entry.name)
      if (entry.isSymbolicLink()) {
        throw new PackError('LINK_ENTRY', `${relPath} is a symbolic link; a pack folder carries files only`, relPath)
      }
      if (entry.isDirectory()) {
        await walk(full, relPath)
      } else if (entry.isFile()) {
        if (!rel && entry.name.endsWith('.pwpack')) continue
        files.set(relPath, new Uint8Array(await readFile(full)))
      } else {
        throw new PackError('UNSUPPORTED_ENTRY', `${relPath} is neither a file nor a directory`, relPath)
      }
    }
  }
  await walk(dir, '')
  return { files }
}

/**
 * A {@link PackFolder} from a `path → content` record. Strings are encoded
 * as UTF-8 exactly as given; bytes are copied. Paths must already be safe.
 */
export function packFromRecord(record: Readonly<Record<string, string | Uint8Array>>): PackFolder {
  const encoder = new TextEncoder()
  const files = new Map<string, Uint8Array>()
  for (const [path, value] of Object.entries(record)) {
    const reason = unsafePathReason(path)
    if (reason) throw new PackError('UNSAFE_PATH', `${path}: ${reason}`, path)
    files.set(path, typeof value === 'string' ? encoder.encode(value) : new Uint8Array(value))
  }
  return { files }
}
