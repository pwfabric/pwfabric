/**
 * The `.pwpack` archive: a deterministic gzipped tar of the folder, rootless.
 *
 * @module @pwfabric/pack/archive
 */
import { gunzipSync, gzipSync } from 'node:zlib'
import { PackError, type PackFolder } from './types.js'
import { findPathConflict, unsafePathReason } from './paths.js'
import { readTar, writeTar } from './tar.js'

/** zlib level used for every archive. Part of the byte-identity contract. */
export const GZIP_LEVEL = 9
/** RFC 1952 OS byte written into every archive (3 = Unix), whatever platform wrote it. */
export const GZIP_OS_UNIX = 3

/** Ceilings `readPwpack` enforces. Every field is optional when passed. */
export interface PwpackLimits {
  /** Size of the archive as given (compressed). */
  readonly maxArchiveBytes: number
  /** Size of the tar stream after gunzip — the decompression-bomb ceiling. */
  readonly maxTarBytes: number
  /** Number of tar members (files, directories, links). */
  readonly maxEntries: number
  /** Size of one file. */
  readonly maxEntryBytes: number
  /** Sum of all file sizes. */
  readonly maxTotalBytes: number
}

/**
 * Defaults, chosen to match the most generous limits an existing extractor
 * enforces (5 000 entries, 20 MiB per file, 50 MiB of files, 128 MiB of tar)
 * so nothing that opens today stops opening here.
 */
export const DEFAULT_LIMITS: PwpackLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxTarBytes: 128 * 1024 * 1024,
  maxEntries: 5000,
  maxEntryBytes: 20 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
}

/**
 * The deterministic `.pwpack` bytes of a folder.
 *
 * Tar: ustar, one entry per file plus one per implied directory, names in
 * byte order, mode 0644 / 0755, uid/gid 0, empty uname/gname, mtime 0; a
 * path that fits no ustar name/prefix split travels in a PAX `path` record.
 * Gzip: level 9, header mtime 0, no file name, OS byte fixed to Unix (zlib
 * otherwise stamps the platform it was built for, so the same folder hashed
 * differently on Windows and Linux). File bytes are written exactly as given.
 *
 * Throws {@link PackError} `UNSAFE_PATH` if any path is unsafe and
 * `PATH_CONFLICT` if a path is both a file and a directory — the writer
 * never produces an archive a reader would have to refuse.
 */
export async function writePwpack(pack: PackFolder): Promise<Uint8Array> {
  for (const path of pack.files.keys()) {
    const reason = unsafePathReason(path)
    if (reason) throw new PackError('UNSAFE_PATH', `${path}: ${reason}`, path)
  }
  assertNoPathConflict(pack.files.keys())
  const gz = gzipSync(writeTar(pack.files), { level: GZIP_LEVEL })
  gz[9] = GZIP_OS_UNIX
  return new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength)
}

/** Throws `PATH_CONFLICT` when a path is a file and also the directory of another path. */
function assertNoPathConflict(paths: Iterable<string>): void {
  const conflict = findPathConflict(paths)
  if (conflict) {
    throw new PackError(
      'PATH_CONFLICT',
      `${conflict.file} is a file and also the directory of ${conflict.inside}`,
      conflict.file
    )
  }
}

function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}

function isBareTar(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && new TextDecoder().decode(bytes.subarray(257, 262)) === 'ustar'
}

/** The wrapper directory one existing producer puts in front of every member. */
const PACKAGE_WRAPPER = 'package/'

/**
 * Open a `.pwpack` (or any pwpack tgz) into memory.
 *
 * Accepted: gzip-compressed tar (the normal case) and a bare uncompressed
 * tar. Tolerated, from layouts existing producers emit: a `package/` wrapper
 * on EVERY file (removed; a partial wrapper is kept as a plain directory),
 * `./` prefixes, explicit directory entries (ignored), ustar `prefix` split
 * names, PAX `path` records and GNU long names, header-less mtimes and any
 * mode. Refused with {@link PackError}: unsafe paths (`UNSAFE_PATH`), link
 * members (`LINK_ENTRY`), devices / FIFOs (`UNSUPPORTED_ENTRY`), a path
 * present twice (`DUPLICATE_ENTRY`), a path that is both a file and a
 * directory — of another file or of a directory member (`PATH_CONFLICT`),
 * malformed streams (`GZIP_INVALID`,
 * `TAR_INVALID`) and every crossed limit (`PACK_TOO_LARGE`,
 * `ENTRY_TOO_LARGE`, `TOO_MANY_ENTRIES`).
 */
export async function readPwpack(bytes: Uint8Array, limits: Partial<PwpackLimits> = {}): Promise<PackFolder> {
  const lim: PwpackLimits = { ...DEFAULT_LIMITS, ...limits }
  if (bytes.length > lim.maxArchiveBytes) {
    throw new PackError('PACK_TOO_LARGE', `archive is ${bytes.length} bytes (limit ${lim.maxArchiveBytes})`)
  }

  let tar: Uint8Array
  if (isGzip(bytes)) {
    try {
      tar = gunzipSync(bytes, { maxOutputLength: lim.maxTarBytes })
    } catch (e) {
      if ((e as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE') {
        throw new PackError('PACK_TOO_LARGE', `decompressed archive exceeds ${lim.maxTarBytes} bytes`)
      }
      throw new PackError('GZIP_INVALID', `archive is not a readable gzip stream: ${(e as Error).message}`)
    }
  } else if (isBareTar(bytes)) {
    if (bytes.length > lim.maxTarBytes) {
      throw new PackError('PACK_TOO_LARGE', `tar is ${bytes.length} bytes (limit ${lim.maxTarBytes})`)
    }
    tar = bytes
  } else {
    throw new PackError('GZIP_INVALID', 'archive is neither gzip nor tar')
  }

  const files: { path: string; data: Uint8Array }[] = []
  const dirs: string[] = []
  for (const entry of readTar(tar, lim)) {
    let name = entry.name
    while (name.startsWith('./')) name = name.slice(2)
    if (entry.type === 'symlink' || entry.type === 'hardlink') {
      throw new PackError('LINK_ENTRY', `${name} is a ${entry.type} member; a pwpack carries files only`, name)
    }
    if (entry.type === 'other') {
      throw new PackError('UNSUPPORTED_ENTRY', `${name} is neither a file nor a directory`, name)
    }
    if (entry.type === 'dir') {
      const dir = name.replace(/\/+$/, '')
      const reason = dir === '' || dir === '.' ? null : unsafePathReason(dir)
      if (reason) throw new PackError('UNSAFE_PATH', `${name}: ${reason}`, name)
      if (dir !== '' && dir !== '.') dirs.push(dir)
      continue
    }
    const reason = unsafePathReason(name)
    if (reason) throw new PackError('UNSAFE_PATH', `${name}: ${reason}`, name)
    files.push({ path: name, data: entry.data })
  }

  const wrapped = files.length > 0 && files.every((f) => f.path.startsWith(PACKAGE_WRAPPER))
  const out = new Map<string, Uint8Array>()
  for (const f of files) {
    const path = wrapped ? f.path.slice(PACKAGE_WRAPPER.length) : f.path
    if (out.has(path)) throw new PackError('DUPLICATE_ENTRY', `${path} appears more than once in the archive`, path)
    out.set(path, f.data.slice())
  }
  assertNoPathConflict(out.keys())
  // An explicit directory member named like a file is the same collision.
  for (const d of dirs) {
    const dir = wrapped && d.startsWith(PACKAGE_WRAPPER) ? d.slice(PACKAGE_WRAPPER.length) : d
    if (out.has(dir)) throw new PackError('PATH_CONFLICT', `${dir} is a file and also a directory member`, dir)
  }
  return { files: out }
}
