/**
 * Test-only re-creations of the archive framing each existing pwpack producer
 * emits, so the reader can be proven against their shapes without depending
 * on their code. Each function ports the producer's tar header layout, entry
 * order, path shape and gzip call as it stands; see COMPAT.md for the
 * producers themselves.
 */
import { gzipSync } from 'node:zlib'
import { Buffer } from 'node:buffer'

const BLOCK = 512

export interface Entry {
  readonly path: string
  readonly content: Buffer
}

export const entries = (record: Record<string, string>): Entry[] =>
  Object.entries(record).map(([path, text]) => ({ path, content: Buffer.from(text, 'utf8') }))

const octal = (n: number, len: number): string => n.toString(8).padStart(len - 1, '0') + '\0'

function pad(size: number): Buffer {
  const rem = size % BLOCK
  return Buffer.alloc(rem === 0 ? 0 : BLOCK - rem)
}

function finish(chunks: Buffer[]): Buffer {
  chunks.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(chunks)
}

/**
 * The authoring plugin's packer: a pre-ustar header (no magic), the current
 * time as mtime, names cut at 100 bytes, the folder's readdir order, default
 * gzip. Its wire is ROOTLESS: `atoms/` is stripped, `app/surfaces/*` moves to
 * `surfaces/*`, `pwpack.json` is copied and a `package.json` added.
 */
export function pluginTgz(files: Entry[]): Buffer {
  const chunks: Buffer[] = []
  const enc = new TextEncoder()
  for (const f of files) {
    const h = new Uint8Array(BLOCK)
    h.set(enc.encode(f.path).subarray(0, 100), 0)
    h.set(enc.encode('0000644\0'), 100)
    h.set(enc.encode('0000000\0'), 108)
    h.set(enc.encode('0000000\0'), 116)
    h.set(enc.encode(`${f.content.length.toString(8).padStart(11, '0')}\0`), 124)
    h.set(enc.encode(`${Math.floor(Date.now() / 1000).toString(8).padStart(11, '0')}\0`), 136)
    h.set(enc.encode('        '), 148)
    h[156] = 48
    let sum = 0
    for (let i = 0; i < BLOCK; i++) sum += h[i] ?? 0
    h.set(enc.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148)
    chunks.push(Buffer.from(h), f.content, pad(f.content.length))
  }
  return gzipSync(finish(chunks))
}

/** The plugin's rootless wire for a canonical folder (see {@link pluginTgz}). */
export function pluginWire(record: Record<string, string>): Entry[] {
  const out: Entry[] = []
  for (const e of entries(record)) {
    if (e.path.startsWith('atoms/')) out.push({ path: e.path.slice('atoms/'.length), content: e.content })
    else if (e.path.startsWith('app/surfaces/')) out.push({ path: `surfaces/${e.path.slice('app/surfaces/'.length)}`, content: e.content })
    else if (e.path === 'pwpack.json') out.push(e)
  }
  out.push({ path: 'package.json', content: Buffer.from(JSON.stringify({ name: 'workspace-pack', version: '0.1.0' }, null, 2)) })
  return out
}

/** ustar header shared by the first-party exporter and the app generator. */
function ustarHeader(name: string, prefix: string, size: number, mtime: number): Buffer {
  const header = Buffer.alloc(BLOCK)
  header.write(name.padEnd(100, '\0'), 0, 'utf8')
  if (prefix) header.write(prefix, 345, 'utf8')
  header.write(octal(0o644, 8), 100, 'ascii')
  header.write(octal(0, 8), 108, 'ascii')
  header.write(octal(0, 8), 116, 'ascii')
  header.write(octal(size, 12), 124, 'ascii')
  header.write(octal(mtime, 12), 136, 'ascii')
  header.write('        ', 148, 'ascii')
  header.write('0', 156, 'ascii')
  header.write('ustar', 257, 'ascii')
  header.write('\0', 262, 'ascii')
  header.write('00', 263, 'ascii')
  header.write(octal(0, 8), 329, 'ascii')
  header.write(octal(0, 8), 337, 'ascii')
  let sum = 0
  for (const b of header) sum += b
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return header
}

/**
 * The first-party pack exporter: rootless wire like the plugin, mtime 0,
 * family entries sorted, then `pwpack.json` and a rewritten `package.json`
 * APPENDED unsorted; gzip level 9 with the platform's own OS byte.
 */
export function foundationTgz(record: Record<string, string>): Buffer {
  const wire: Entry[] = []
  for (const e of entries(record)) {
    if (e.path.startsWith('atoms/')) wire.push({ path: e.path.slice('atoms/'.length), content: e.content })
    else if (e.path.startsWith('app/surfaces/')) wire.push({ path: `surfaces/${e.path.slice('app/surfaces/'.length)}`, content: e.content })
  }
  wire.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const identity = record['pwpack.json']
  if (identity) wire.push({ path: 'pwpack.json', content: Buffer.from(identity) })
  wire.push({ path: 'package.json', content: Buffer.from('{"name":"@pwpack/acme/widgets","version":"0.3.0","private":true}\n') })
  const chunks: Buffer[] = []
  for (const e of wire) {
    if (Buffer.byteLength(e.path) > 100) throw new Error(`Path too long for USTAR (>100 bytes): ${e.path}`)
    chunks.push(ustarHeader(e.path, '', e.content.length, 0), e.content, pad(e.content.length))
  }
  return gzipSync(finish(chunks), { level: 9 })
}

/**
 * The app generator's `.pwpack` delivery: the CANONICAL folder (`pwpack.json`,
 * `app/…`, `atoms/…`), text normalised to LF, paths sorted, ustar with the
 * shortest prefix split, mtime 0, gzip level 9 with the OS byte forced to 3.
 */
export function generatorTgz(record: Record<string, string>): Buffer {
  const files = Object.keys(record)
    .sort()
    .map((path) => ({ path, content: Buffer.from((record[path] as string).split('\r\n').join('\n'), 'utf8') }))
  const chunks: Buffer[] = []
  for (const f of files) {
    let name = f.path
    let prefix = ''
    if (Buffer.byteLength(f.path) > 100) {
      let found = false
      for (let i = f.path.indexOf('/'); i > 0; i = f.path.indexOf('/', i + 1)) {
        const p = f.path.slice(0, i)
        const n = f.path.slice(i + 1)
        if (Buffer.byteLength(p) <= 155 && Buffer.byteLength(n) <= 100 && n) {
          prefix = p
          name = n
          found = true
          break
        }
      }
      if (!found) throw new Error(`Path too long for USTAR: ${f.path}`)
    }
    chunks.push(ustarHeader(name, prefix, f.content.length, 0), f.content, pad(f.content.length))
  }
  const gz = gzipSync(finish(chunks), { level: 9 })
  gz[9] = 3
  return gz
}

/**
 * A hosting platform's build service: every member under `package/`, ALL
 * directory entries first (sorted), then the files, ustar with the longest
 * prefix split, mode 0644 / 0755, mtime 0, gzip level 9 (platform OS byte).
 */
export function buildServiceTgz(record: Record<string, string>): Buffer {
  const files = Object.keys(record)
    .sort()
    .map((rel) => ({ name: `package/${rel}`, data: Buffer.from(record[rel] as string, 'utf8') }))
  const header = (name: string, size: number, mode: number, typeflag: string): Buffer => {
    const h = Buffer.alloc(BLOCK)
    let prefix = ''
    let rest = name
    if (name.length > 100) {
      const idx = name.lastIndexOf('/', 100)
      prefix = name.slice(0, idx)
      rest = name.slice(idx + 1)
    }
    h.write(rest, 0, 100, 'utf8')
    h.write(octal(mode, 8), 100, 8, 'utf8')
    h.write(octal(0, 8), 108, 8, 'utf8')
    h.write(octal(0, 8), 116, 8, 'utf8')
    h.write(octal(size, 12), 124, 12, 'utf8')
    h.write(octal(0, 12), 136, 12, 'utf8')
    h.write('        ', 148, 8, 'utf8')
    h.write(typeflag, 156, 1, 'utf8')
    h.write('ustar\0', 257, 6, 'utf8')
    h.write('00', 263, 2, 'utf8')
    h.write(prefix, 345, 155, 'utf8')
    let sum = 0
    for (let i = 0; i < BLOCK; i++) sum += h[i] ?? 0
    h.write(octal(sum, 7), 148, 7, 'utf8')
    h[155] = 0x20
    return h
  }
  const dirs = new Set<string>()
  for (const f of files) {
    const parts = f.name.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/')
  }
  const chunks: Buffer[] = []
  for (const d of [...dirs].sort()) chunks.push(header(d, 0, 0o755, '5'))
  for (const f of files) chunks.push(header(f.name, f.data.length, 0o644, '0'), f.data, pad(f.data.length))
  return gzipSync(finish(chunks), { level: 9 })
}

/**
 * A hosting platform's project export: rootless, `pwfabric.manifest.json`
 * FIRST, app envelope files (`project.json`, `navigation.json`, …) at the
 * root, the current time as mtime, default gzip, and a PAX `path` record for
 * any path no ustar split fits.
 */
export function platformExportTgz(files: Entry[]): Buffer {
  const mtime = Math.floor(Date.now() / 1000)
  const raw = (name: string, size: number, typeflag: string, prefix = ''): Buffer => {
    const h = Buffer.alloc(BLOCK)
    h.write(name, 0, 100, 'utf8')
    if (prefix) h.write(prefix, 345, 155, 'utf8')
    h.write('0000644', 100, 8, 'utf8')
    h.write('0000000', 108, 8, 'utf8')
    h.write('0000000', 116, 8, 'utf8')
    h.write(size.toString(8).padStart(11, '0'), 124, 12, 'utf8')
    h.write(mtime.toString(8).padStart(11, '0'), 136, 12, 'utf8')
    h.write('        ', 148, 8, 'utf8')
    h.write(typeflag, 156, 1, 'utf8')
    h.write('ustar\0', 257, 6, 'utf8')
    h.write('00', 263, 2, 'utf8')
    let sum = 0
    for (const b of h) sum += b
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8')
    return h
  }
  const split = (path: string): { prefix: string; name: string } | null => {
    if (Buffer.byteLength(path) <= 100) return { prefix: '', name: path }
    for (let i = path.length - 1; i > 0; i--) {
      if (path[i] !== '/') continue
      const prefix = path.slice(0, i)
      const name = path.slice(i + 1)
      if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { prefix, name }
    }
    return null
  }
  const chunks: Buffer[] = []
  for (const e of files) {
    const s = split(e.path)
    if (s) {
      chunks.push(raw(s.name, e.content.length, '0', s.prefix))
    } else {
      const record = `path=${e.path}\n`
      let len = Buffer.byteLength(record) + 3
      for (;;) {
        const actual = Buffer.byteLength(`${len} ${record}`)
        if (actual === len) break
        len = actual
      }
      const data = Buffer.from(`${len} ${record}`)
      chunks.push(raw('PaxHeader/data', data.length, 'x'), data, pad(data.length))
      chunks.push(raw('PaxHeader/file', e.content.length, '0'))
    }
    chunks.push(e.content, pad(e.content.length))
  }
  return gzipSync(finish(chunks))
}

/** One raw header + data, for hand-built hostile archives. */
export function rawEntry(name: string, data: Buffer, typeflag = '0', opts: { mode?: number; size?: number } = {}): Buffer {
  const size = opts.size ?? data.length
  const h = ustarHeader(name, '', size, 0)
  h.write(typeflag, 156, 'ascii')
  if (opts.mode !== undefined) h.write(octal(opts.mode, 8), 100, 'ascii')
  h.write('        ', 148, 'ascii')
  let sum = 0
  for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
  return Buffer.concat([h, data, pad(data.length)])
}

/** A gzipped tar of raw entries. */
export function rawTgz(parts: Buffer[]): Buffer {
  return gzipSync(finish([...parts]))
}

/** An uncompressed tar of raw entries. */
export function rawTar(parts: Buffer[]): Buffer {
  return finish([...parts])
}

/**
 * A port of the tar reader a hosting platform's extractor uses today: ustar
 * prefix joined, PAX `path` records applied, regular files only (directory
 * entries are skipped). Used to prove the writer's output reads there.
 */
export function platformReadTar(tar: Uint8Array): { name: string; data: Uint8Array }[] {
  const out: { name: string; data: Uint8Array }[] = []
  const decoder = new TextDecoder()
  let offset = 0
  let pax: string | null = null
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK)
    if (header.every((b) => b === 0)) break
    const prefix = decoder.decode(header.subarray(345, 500)).replace(/\0[\s\S]*$/, '')
    const short = decoder.decode(header.subarray(0, 100)).replace(/\0+$/, '')
    const name = prefix ? `${prefix}/${short}` : short
    const size = parseInt(decoder.decode(header.subarray(124, 136)).replace(/\0+$/, '').trim(), 8) || 0
    const type = header[156]
    offset += BLOCK
    if (type === 120) {
      const match = /(?:^|\n)\d+ path=([\s\S]*?)\n/.exec(decoder.decode(tar.subarray(offset, offset + size)))
      if (match?.[1]) pax = match[1]
    } else if (type === 0 || type === 48) {
      out.push({ name: pax ?? name, data: tar.subarray(offset, offset + size) })
      pax = null
    } else {
      pax = null
    }
    offset += Math.ceil(size / BLOCK) * BLOCK
  }
  return out
}
