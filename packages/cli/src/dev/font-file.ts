/**
 * AN APP'S FONT FILE (WOFF2): what the build reads of it to draw a
 * metric-matched stand-in until it arrives — the units per em (`head`), the
 * vertical metrics (`hhea`, or `OS/2`'s typographic ones when the font asks
 * for them) and the average glyph width (`OS/2`).
 *
 * WOFF2 keeps its tables in one Brotli stream; `head`, `hhea` and `OS/2` are
 * never transformed, so they are read straight out of it (Node's own Brotli,
 * no dependency).
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
  readonly xAvgCharWidth: number
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
  const tables: { tag: string; offset: number; length: number }[] = []
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
      tables.push({ tag, offset, length })
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
  const table = (tag: string): DataView | undefined => {
    const t = tables.find((x) => x.tag === tag)
    return t && t.offset + t.length <= data.byteLength ? new DataView(data.buffer, data.byteOffset + t.offset, t.length) : undefined
  }
  const head = table('head')
  const hhea = table('hhea')
  const os2 = table('OS/2')
  if (!head || head.byteLength < 20) return 'it has no head table'
  if (!hhea || hhea.byteLength < 10) return 'it has no hhea table'
  if (!os2 || os2.byteLength < 4) return 'it has no OS/2 table'
  const unitsPerEm = head.getUint16(18)
  // fsSelection bit 7, USE_TYPO_METRICS: the typographic metrics are the font's own.
  const typo = os2.byteLength >= 74 && (os2.getUint16(62) & 0x80) !== 0
  return {
    unitsPerEm,
    ascent: typo ? os2.getInt16(68) : hhea.getInt16(4),
    descent: Math.abs(typo ? os2.getInt16(70) : hhea.getInt16(6)),
    lineGap: typo ? os2.getInt16(72) : hhea.getInt16(8),
    xAvgCharWidth: os2.getInt16(2),
  }
}

/** A font every visitor has, standing in for a family until its file arrives, and its own metrics. */
export const LOCAL_FALLBACKS = {
  'sans-serif': { local: 'Arial', unitsPerEm: 2048, xAvgCharWidth: 904 },
  serif: { local: 'Times New Roman', unitsPerEm: 2048, xAvgCharWidth: 821 },
  monospace: { local: 'Courier New', unitsPerEm: 2048, xAvgCharWidth: 1229 },
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
 * its average glyph is as wide, with the font's own ascent, descent and line
 * gap (relative to the adjusted size), so text keeps its place when the font
 * arrives.
 */
export function fallbackFaceOf(metrics: FontMetrics, kind: FallbackKind = 'sans-serif'): FallbackFace {
  const local = LOCAL_FALLBACKS[kind]
  const adjust = metrics.xAvgCharWidth / metrics.unitsPerEm / (local.xAvgCharWidth / local.unitsPerEm)
  const em = metrics.unitsPerEm * adjust
  return {
    local: local.local,
    sizeAdjust: pct(adjust),
    ascent: pct(metrics.ascent / em),
    descent: pct(metrics.descent / em),
    lineGap: pct(metrics.lineGap / em),
  }
}
