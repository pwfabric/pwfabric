/**
 * A minimal, deterministic ustar writer and a defensive tar reader.
 *
 * Only what a pwpack needs: regular files and directories on the way out;
 * regular files, directories, PAX `path` records and GNU long names on the
 * way in, with links, devices and FIFOs surfaced so the caller can refuse
 * them. Not a general-purpose tar implementation.
 *
 * @module @pwfabric/pack/tar
 */
import { PackError } from './types.js'
import { compareBytes } from './paths.js'

const BLOCK = 512
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Mode written for every regular file. Executable bits are not carried. */
export const FILE_MODE = 0o644
/** Mode written for every directory entry. */
export const DIR_MODE = 0o755
/** mtime written into every header (seconds since the epoch). */
export const FIXED_MTIME = 0

// ============================================================
// WRITE
// ============================================================

function putString(buf: Uint8Array, value: string, offset: number, length: number): void {
  buf.set(encoder.encode(value).subarray(0, length), offset)
}

/** `width - 1` octal digits followed by NUL. */
function putOctal(buf: Uint8Array, value: number, offset: number, width: number): void {
  putString(buf, value.toString(8).padStart(width - 1, '0') + '\0', offset, width)
}

function byteLength(s: string): number {
  return encoder.encode(s).length
}

/**
 * Split a path into ustar `prefix` (≤155 bytes) and `name` (≤100 bytes) at a
 * `/`. The longest prefix that fits is chosen. `null` when no split fits.
 */
export function splitUstarPath(path: string): { prefix: string; name: string } | null {
  if (byteLength(path) <= 100) return { prefix: '', name: path }
  for (let i = path.length - 1; i > 0; i--) {
    if (path[i] !== '/') continue
    const prefix = path.slice(0, i)
    const name = path.slice(i + 1)
    if (name.length > 0 && byteLength(prefix) <= 155 && byteLength(name) <= 100) return { prefix, name }
  }
  return null
}

/** The first `max` bytes of `s`, cut at a character boundary. */
function truncateUtf8(s: string, max: number): string {
  let out = ''
  let used = 0
  for (const ch of s) {
    const n = byteLength(ch)
    if (used + n > max) break
    out += ch
    used += n
  }
  return out
}

function header(name: string, prefix: string, size: number, mode: number, typeflag: string): Uint8Array {
  const h = new Uint8Array(BLOCK)
  putString(h, name, 0, 100)
  putOctal(h, mode, 100, 8)
  putOctal(h, 0, 108, 8) // uid
  putOctal(h, 0, 116, 8) // gid
  putOctal(h, size, 124, 12)
  putOctal(h, FIXED_MTIME, 136, 12)
  putString(h, '        ', 148, 8) // checksum placeholder
  putString(h, typeflag, 156, 1)
  // linkname (157..256) stays zero.
  putString(h, 'ustar\0', 257, 6)
  putString(h, '00', 263, 2)
  // uname (265..296) and gname (297..328) stay empty.
  putOctal(h, 0, 329, 8) // devmajor
  putOctal(h, 0, 337, 8) // devminor
  if (prefix) putString(h, prefix, 345, 155)
  let sum = 0
  for (const b of h) sum += b
  putString(h, sum.toString(8).padStart(6, '0') + '\0 ', 148, 8)
  return h
}

function padding(size: number): Uint8Array {
  const rem = size % BLOCK
  return new Uint8Array(rem === 0 ? 0 : BLOCK - rem)
}

/** A PAX `x` header + data blocks carrying `path=<path>` for the entry that follows. */
function paxPathBlocks(path: string): Uint8Array[] {
  const record = ` path=${path}\n`
  // The length prefix counts itself; iterate until it is stable.
  let len = byteLength(record) + 1
  while (byteLength(`${len}${record}`) !== len) len = byteLength(`${len}${record}`)
  const data = encoder.encode(`${len}${record}`)
  return [header('PaxHeader', '', data.length, FILE_MODE, 'x'), data, padding(data.length)]
}

function entryBlocks(path: string, data: Uint8Array | null): Uint8Array[] {
  const size = data?.length ?? 0
  const mode = data ? FILE_MODE : DIR_MODE
  const typeflag = data ? '0' : '5'
  const split = splitUstarPath(path)
  const out: Uint8Array[] = []
  if (split) {
    out.push(header(split.name, split.prefix, size, mode, typeflag))
  } else {
    out.push(...paxPathBlocks(path))
    out.push(header(truncateUtf8(path, 100), '', size, mode, typeflag))
  }
  if (data) out.push(data, padding(size))
  return out
}

/**
 * The tar of a file map. Every directory implied by a file path gets its own
 * entry (`<dir>/`); all names are emitted in byte order, so a parent always
 * precedes its children. Callers pass already-validated paths.
 */
export function writeTar(files: ReadonlyMap<string, Uint8Array>): Uint8Array {
  const names = new Map<string, Uint8Array | null>()
  for (const [path, data] of files) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) names.set(`${parts.slice(0, i).join('/')}/`, null)
    names.set(path, data)
  }
  const chunks: Uint8Array[] = []
  for (const name of [...names.keys()].sort(compareBytes)) chunks.push(...entryBlocks(name, names.get(name) ?? null))
  chunks.push(new Uint8Array(BLOCK * 2))
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

// ============================================================
// READ
// ============================================================

/** What a tar member is. */
export type TarEntryType = 'file' | 'dir' | 'symlink' | 'hardlink' | 'other'

export interface TarEntry {
  readonly name: string
  readonly type: TarEntryType
  readonly data: Uint8Array
}

export interface TarReadLimits {
  readonly maxEntries: number
  readonly maxEntryBytes: number
  readonly maxTotalBytes: number
}

function cString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return decoder.decode(end === -1 ? bytes : bytes.subarray(0, end))
}

function readOctal(h: Uint8Array, offset: number, width: number, what: string): number {
  const field = h.subarray(offset, offset + width)
  // Base-256 (high bit set) is how tar spells numbers past the octal range — far past any limit here.
  if (((field[0] as number) & 0x80) !== 0) {
    throw new PackError('ENTRY_TOO_LARGE', `tar ${what} uses base-256 encoding (a value beyond the octal range)`)
  }
  const text = cString(field).trim()
  if (text === '') return 0
  if (!/^[0-7]+$/.test(text)) throw new PackError('TAR_INVALID', `tar ${what} is not an octal number: "${text}"`)
  return parseInt(text, 8)
}

function verifyChecksum(h: Uint8Array): void {
  const stored = readOctal(h, 148, 8, 'checksum')
  let unsigned = 0
  let signed = 0
  for (let i = 0; i < BLOCK; i++) {
    const b = i >= 148 && i < 156 ? 0x20 : (h[i] as number)
    unsigned += b
    signed += b > 127 ? b - 256 : b
  }
  if (stored !== unsigned && stored !== signed) {
    throw new PackError('TAR_INVALID', 'tar header checksum does not match')
  }
}

/** The `path` record of a PAX extended header, if it has one. Lengths count bytes. */
function paxPath(data: Uint8Array): string | null {
  let at = 0
  let path: string | null = null
  while (at < data.length) {
    const space = data.indexOf(0x20, at)
    if (space === -1) break
    const len = Number(decoder.decode(data.subarray(at, space)))
    if (!Number.isInteger(len) || len <= space - at + 1 || at + len > data.length) {
      throw new PackError('TAR_INVALID', 'malformed PAX record')
    }
    const body = decoder.decode(data.subarray(space + 1, at + len)).replace(/\n$/, '')
    const eq = body.indexOf('=')
    if (eq > 0 && body.slice(0, eq) === 'path') path = body.slice(eq + 1)
    at += len
  }
  return path
}

type HeaderKind = TarEntryType | 'pax' | 'pax-global' | 'gnu-longname' | 'gnu-longlink'

function typeOf(flag: number): HeaderKind {
  switch (String.fromCharCode(flag)) {
    case '\0':
    case '0':
    case '7':
      return 'file'
    case '5':
      return 'dir'
    case '1':
      return 'hardlink'
    case '2':
      return 'symlink'
    case 'x':
      return 'pax'
    case 'g':
      return 'pax-global'
    case 'L':
      return 'gnu-longname'
    case 'K':
      return 'gnu-longlink'
    default:
      return 'other'
  }
}

/**
 * Every member of an uncompressed tar, in archive order. Names are returned
 * as stored (ustar prefix joined, PAX `path` and GNU long names applied);
 * normalisation and safety are the caller's job. Throws {@link PackError}
 * for a malformed stream or a crossed limit.
 */
export function readTar(tar: Uint8Array, limits: TarReadLimits): TarEntry[] {
  const out: TarEntry[] = []
  let at = 0
  let total = 0
  let nextName: string | null = null
  while (at + BLOCK <= tar.length) {
    const h = tar.subarray(at, at + BLOCK)
    if (h.every((b) => b === 0)) break
    verifyChecksum(h)
    const size = readOctal(h, 124, 12, 'size')
    const kind = typeOf(h[156] as number)
    at += BLOCK
    if (at + size > tar.length) throw new PackError('TAR_INVALID', 'tar entry is truncated')
    const data = tar.subarray(at, at + size)
    at += Math.ceil(size / BLOCK) * BLOCK

    if (kind === 'pax') {
      nextName = paxPath(data) ?? nextName
      continue
    }
    if (kind === 'gnu-longname') {
      nextName = cString(data)
      continue
    }
    if (kind === 'pax-global' || kind === 'gnu-longlink') continue

    // POSIX ustar ("ustar\0") carries a prefix field; the old GNU magic ("ustar ") uses those bytes for other things.
    const posix = decoder.decode(h.subarray(257, 263)) === 'ustar\0'
    const prefix = posix ? cString(h.subarray(345, 500)) : ''
    const short = cString(h.subarray(0, 100))
    const name = nextName ?? (prefix ? `${prefix}/${short}` : short)
    nextName = null

    if (out.length >= limits.maxEntries) {
      throw new PackError('TOO_MANY_ENTRIES', `archive has more than ${limits.maxEntries} entries`)
    }
    if (kind === 'file') {
      if (size > limits.maxEntryBytes) {
        throw new PackError('ENTRY_TOO_LARGE', `${name} is ${size} bytes (limit ${limits.maxEntryBytes})`, name)
      }
      total += size
      if (total > limits.maxTotalBytes) {
        throw new PackError('PACK_TOO_LARGE', `archive files exceed ${limits.maxTotalBytes} bytes in total`)
      }
    }
    out.push({ name, type: kind, data: kind === 'file' ? data : new Uint8Array(0) })
  }
  return out
}
