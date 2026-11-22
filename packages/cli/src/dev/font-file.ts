/**
 * AN APP'S FONT FILE (WOFF2): what the build reads of it to draw a
 * metric-matched stand-in until it arrives — the units per em (`head`), the
 * vertical metrics (`hhea`, or `OS/2`'s typographic ones when the font asks
 * for them) and the average advance of running text: each character's
 * advance (`cmap` + `hmtx`) weighed by how often it occurs, as capsize
 * measures it. `OS/2`'s xAvgCharWidth is no measure of text: it averages
 * every glyph in the font, figures, symbols and accented letters alike.
 *
 * WOFF2 keeps its tables in one Brotli stream; `head`, `hhea`, `OS/2` and
 * `cmap` are never transformed, and a transformed `hmtx` still opens with the
 * advances, so all are read straight out of it (Node's own Brotli, no
 * dependency).
 *
 * @module @pwfabric/cli/dev/font-file
 */
import { brotliDecompressSync } from 'node:zlib'

/** The metrics a stand-in is computed from, in font units. */
export interface FontMetrics {
  readonly unitsPerEm: number
  readonly ascent: number
  /** Positive: the distance below the baseline. */
  readonly descent: number
  readonly lineGap: number
  /** The average advance of running Latin text. */
  readonly avgWidth: number
}

/**
 * How often each character occurs in running Latin text (capsize's
 * weighting, MIT): the average advance is each one's advance times its share.
 */
const LATIN_WEIGHTS: Readonly<Record<string, number>> = {
  '0': 0.0053, '1': 0.0023, '2': 0.0026, '3': 0.001, '4': 0.0008, '5': 0.0015, '6': 0.0007, '7': 0.0005, '8': 0.0007, '9': 0.0006,
  ',': 0.0083, ' ': 0.154, t: 0.0672, h: 0.0351, e: 0.0922, o: 0.0571, f: 0.017, P: 0.0023, p: 0.0163, l: 0.0304, "'": 0.0014,
  s: 0.0469, R: 0.0015, u: 0.0207, b: 0.0114, i: 0.0588, c: 0.0232, C: 0.0031, n: 0.0578, a: 0.0668, d: 0.0298, y: 0.0123,
  w: 0.011, B: 0.002, r: 0.0526, z: 0.0011, G: 0.0011, j: 0.0009, T: 0.0041, '.': 0.0079, L: 0.0012, k: 0.0046, m: 0.0181,
  ']': 0.0007, J: 0.0009, F: 0.0015, v: 0.0076, g: 0.0155, A: 0.004, N: 0.0014, '-': 0.0018, H: 0.0013, D: 0.0013, M: 0.0025,
  I: 0.0022, E: 0.0011, '"': 0.0012, S: 0.0041, '(': 0.001, ')': 0.001, x: 0.0025, W: 0.0012, Q: 0.0001, Y: 0.0003, q: 0.0008,
  V: 0.0005, 'á': 0.0001, K: 0.0007, U: 0.0016, '=': 0.0007, '[': 0.0021, O: 0.0009, 'é': 0.0001, $: 0.0002, ':': 0.0008,
  '|': 0.0038, '/': 0.0001, '%': 0.0001, Z: 0.0002, ';': 0.0001, X: 0.0001,
}

/** The WOFF2 signature, `wOF2`. */
const WOFF2_SIGNATURE = 0x774f4632

/** Whether `bytes` is a WOFF2 file (its signature). */
export function isWoff2(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 48 && new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0) === WOFF2_SIGNATURE
}

/** The tags WOFF2 names by index (its "known tags" table). */
const KNOWN_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT',
  'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH',
  'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar',
  'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill',
]

/** The glyph a code point maps to in `cmap`'s Unicode subtable (format 12 or 4), 0 when none; undefined when there is no such subtable. */
function glyphLookup(cmap: DataView): ((code: number) => number) | undefined {
  if (cmap.byteLength < 4) return undefined
  const count = cmap.getUint16(2)
  let best: { offset: number; format: number } | undefined
  for (let i = 0; i < count && 12 + i * 8 <= cmap.byteLength; i++) {
    const platform = cmap.getUint16(4 + i * 8)
    const encoding = cmap.getUint16(6 + i * 8)
    const offset = cmap.getUint32(8 + i * 8)
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))
    if (!unicode || offset + 16 > cmap.byteLength) continue
    const format = cmap.getUint16(offset)
    if (format === 12 || (format === 4 && best?.format !== 12)) best = { offset, format }
  }
  if (!best) return undefined
  const at = best.offset
  if (best.format === 12) {
    const groups = cmap.getUint32(at + 12)
    if (at + 16 + groups * 12 > cmap.byteLength) return undefined
    return (code) => {
      for (let g = 0; g < groups; g++) {
        const start = cmap.getUint32(at + 16 + g * 12)
        if (code >= start && code <= cmap.getUint32(at + 20 + g * 12)) return cmap.getUint32(at + 24 + g * 12) + (code - start)
      }
      return 0
    }
  }
  const segX2 = cmap.getUint16(at + 6)
  const ends = at + 14
  const starts = ends + segX2 + 2
  const deltas = starts + segX2
  const ranges = deltas + segX2
  if (ranges + segX2 > cmap.byteLength) return undefined
  return (code) => {
    if (code > 0xffff) return 0
    for (let s = 0; s < segX2; s += 2) {
      if (code > cmap.getUint16(ends + s)) continue
      const start = cmap.getUint16(starts + s)
      if (code < start) return 0
      const delta = cmap.getUint16(deltas + s)
      const range = cmap.getUint16(ranges + s)
      if (range === 0) return (code + delta) & 0xffff
      const glyphAt = ranges + s + range + (code - start) * 2
      if (glyphAt + 2 > cmap.byteLength) return 0
      const glyph = cmap.getUint16(glyphAt)
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff
    }
    return 0
  }
}

/**
 * The metrics of a WOFF2 file, or why they cannot be read (not WOFF2, a
 * table missing, a stream that does not decompress).
 */
export function woff2Metrics(bytes: Uint8Array): FontMetrics | string {
  if (!isWoff2(bytes)) return 'it is not a WOFF2 file'
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numTables = view.getUint16(12)
  const compressedLength = view.getUint32(20)
  let at = 48
  const readBase128 = (): number => {
    let value = 0
    for (let i = 0; i < 5; i++) {
      if (at >= bytes.byteLength) throw new Error('truncated table directory')
      const byte = bytes[at++] as number
      if (i === 0 && byte === 0x80) throw new Error('bad UIntBase128')
      value = value * 128 + (byte & 0x7f)
      if ((byte & 0x80) === 0) return value
    }
    throw new Error('bad UIntBase128')
  }
  const tables: { tag: string; offset: number; length: number; transformed: boolean }[] = []
  let offset = 0
  try {
    for (let i = 0; i < numTables; i++) {
      const flags = bytes[at++] as number
      const index = flags & 0x3f
      const version = flags >> 6
      let tag: string
      if (index === 63) {
        tag = String.fromCharCode(...bytes.subarray(at, at + 4))
        at += 4
      } else tag = KNOWN_TAGS[index] ?? '????'
      const origLength = readBase128()
      // glyf and loca are transformed at version 0; any other table at a version but 0.
      const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0
      const length = transformed ? readBase128() : origLength
      tables.push({ tag, offset, length, transformed })
      offset += length
    }
  } catch (err) {
    return `its table directory cannot be read (${(err as Error).message})`
  }
  let data: Uint8Array
  try {
    data = brotliDecompressSync(bytes.subarray(at, at + compressedLength))
  } catch {
    return 'its tables do not decompress'
  }
  const entry = (tag: string) => tables.find((x) => x.tag === tag)
  const table = (tag: string, skip = 0): DataView | undefined => {
    const t = entry(tag)
    return t && t.offset + t.length <= data.byteLength && skip <= t.length
      ? new DataView(data.buffer, data.byteOffset + t.offset + skip, t.length - skip)
      : undefined
  }
  const head = table('head')
  const hhea = table('hhea')
  const os2 = table('OS/2')
  if (!head || head.byteLength < 20) return 'it has no head table'
  if (!hhea || hhea.byteLength < 36) return 'it has no hhea table'
  if (!os2 || os2.byteLength < 4) return 'it has no OS/2 table'
  const cmap = table('cmap')
  const glyphOf = cmap ? glyphLookup(cmap) : undefined
  if (!glyphOf) return 'it has no Unicode cmap table'
  // hmtx: (advance, lsb) pairs; transformed, one flags byte and then the advances alone.
  const packed = entry('hmtx')?.transformed === true
  const hmtx = table('hmtx', packed ? 1 : 0)
  const advances = hhea.getUint16(34)
  const stride = packed ? 2 : 4
  if (!hmtx || advances === 0 || hmtx.byteLength < (advances - 1) * stride + 2) return 'it has no hmtx table'
  // A glyph past the last advance takes the last one.
  const advanceOf = (glyph: number): number => hmtx.getUint16(Math.min(glyph, advances - 1) * stride)
  let avgWidth = 0
  for (const [char, weight] of Object.entries(LATIN_WEIGHTS)) avgWidth += advanceOf(glyphOf(char.codePointAt(0) as number)) * weight
  const unitsPerEm = head.getUint16(18)
  // fsSelection bit 7, USE_TYPO_METRICS: the typographic metrics are the font's own.
  const typo = os2.byteLength >= 74 && (os2.getUint16(62) & 0x80) !== 0
  return {
    unitsPerEm,
    ascent: typo ? os2.getInt16(68) : hhea.getInt16(4),
    descent: Math.abs(typo ? os2.getInt16(70) : hhea.getInt16(6)),
    lineGap: typo ? os2.getInt16(72) : hhea.getInt16(8),
    avgWidth: Math.round(avgWidth),
  }
}

/** A font every visitor has, standing in for a family until its file arrives, and its average advance measured the same way. */
export const LOCAL_FALLBACKS = {
  'sans-serif': { local: 'Arial', unitsPerEm: 2048, avgWidth: 913 },
  serif: { local: 'Times New Roman', unitsPerEm: 2048, avgWidth: 832 },
  monospace: { local: 'Courier New', unitsPerEm: 2048, avgWidth: 1229 },
} as const

export type FallbackKind = keyof typeof LOCAL_FALLBACKS

/** A metric-matched stand-in, as `@font-face` takes it: `local()`, `size-adjust` and the vertical overrides, in %. */
export interface FallbackFace {
  readonly local: string
  readonly sizeAdjust: number
  readonly ascent: number
  readonly descent: number
  readonly lineGap: number
}

const pct = (n: number): number => Math.round(n * 10000) / 100

/**
 * The stand-in for a font of `metrics`: the local font of `kind` resized so
 * its average advance in running text is as wide, with the font's own
 * ascent, descent and line gap (relative to the adjusted size), so text keeps
 * its place when the font arrives.
 */
export function fallbackFaceOf(metrics: FontMetrics, kind: FallbackKind = 'sans-serif'): FallbackFace {
  const local = LOCAL_FALLBACKS[kind]
  const adjust = metrics.avgWidth / metrics.unitsPerEm / (local.avgWidth / local.unitsPerEm)
  const em = metrics.unitsPerEm * adjust
  return {
    local: local.local,
    sizeAdjust: pct(adjust),
    ascent: pct(metrics.ascent / em),
    descent: pct(metrics.descent / em),
    lineGap: pct(metrics.lineGap / em),
  }
}
