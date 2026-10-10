/**
 * Shared types: the in-memory pack folder, the structured error thrown for
 * I/O and archive problems, and the issue shape validation reports.
 *
 * @module @pwfabric/pack/types
 */

/**
 * A pwpack folder held in memory.
 *
 * Keys are normalised POSIX paths relative to the folder root (no leading
 * `/` or `./`, no `.`/`..` segments, `/` separators). Values are the file's
 * bytes exactly as they were read — never re-encoded, never line-ending
 * converted. Directories are implied by the paths and never stored.
 */
export interface PackFolder {
  readonly files: ReadonlyMap<string, Uint8Array>
}

/** Codes {@link PackError} carries. */
export type PackErrorCode =
  /** A path is empty, absolute, drive-qualified, has a `.`/`..`/empty segment, a backslash or a NUL. */
  | 'UNSAFE_PATH'
  /** A folder walk met a symbolic link, or an archive carries a link entry. */
  | 'LINK_ENTRY'
  /** An archive carries a device, FIFO or other non-file, non-directory entry. */
  | 'UNSUPPORTED_ENTRY'
  /** The same path appears twice (in an archive, or after `package/` unwrapping). */
  | 'DUPLICATE_ENTRY'
  /** A path is a file and also the directory of another path (`atoms/x` and `atoms/x/y`). */
  | 'PATH_CONFLICT'
  /** One entry is larger than `maxEntryBytes`. */
  | 'ENTRY_TOO_LARGE'
  /** More entries than `maxEntries`. */
  | 'TOO_MANY_ENTRIES'
  /** The compressed input, the decompressed tar or the sum of file sizes exceeds its limit. */
  | 'PACK_TOO_LARGE'
  /** The bytes are not gzip (nor a bare tar), or the gzip stream is corrupt. */
  | 'GZIP_INVALID'
  /** The tar stream is malformed: bad checksum, truncated entry, unreadable number. */
  | 'TAR_INVALID'
  /** The folder to read does not exist or is not a directory. */
  | 'NOT_A_DIRECTORY'
  /** A required identity field is absent where a function needs it. */
  | 'IDENTITY_REQUIRED'

/** Thrown for I/O and archive problems. Content problems are reported by `validatePack` instead. */
export class PackError extends Error {
  constructor(
    readonly code: PackErrorCode,
    message: string,
    readonly path?: string
  ) {
    super(message)
    this.name = 'PackError'
  }
}

/** How serious a validation finding is. Only `error` makes a pack invalid. */
export type PackIssueSeverity = 'error' | 'warning' | 'info'

/** One validation finding. */
export interface PackIssue {
  readonly code: string
  readonly severity: PackIssueSeverity
  /** The pack path the issue is about, when it is about one. */
  readonly path?: string
  readonly message: string
}
