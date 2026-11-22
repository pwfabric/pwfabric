/**
 * The tables `woff2Metrics` reads out of a WOFF2 file, on fonts made here
 * table by table: a Unicode cmap of format 12 or 4, hmtx as it is or as WOFF2
 * transforms it, the typographic metrics a font asks for, and every way a
 * file can fail to give them.
 */
import { brotliCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { fallbackFaceOf, woff2Metrics } from '../../dev/font-file.js'

const TAG_INDEX: Record<string, number> = { cmap: 0, head: 1, hhea: 2, hmtx: 3, 'OS/2': 6 }

interface Table {
  readonly tag: string
  readonly data: Uint8Array
  readonly transformed?: boolean
}

const u16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const base128 = (n: number): number[] => {
  const out = [n & 0x7f]
  for (let v = n >>> 7; v > 0; v >>>= 7) out.unshift((v & 0x7f) | 0x80)
  return out
}

/** A WOFF2 file of `tables`, in one Brotli stream. */
function woff2(tables: readonly Table[], options: { stream?: Uint8Array; directory?: number[] } = {}): Uint8Array {
  const directory: number[] = []
  for (const t of tables) {
    const index = TAG_INDEX[t.tag]
    if (index === undefined) {
      directory.push(63, ...[...t.tag].map((c) => c.charCodeAt(0)))
    } else directory.push(index | (t.transformed ? 0x40 : 0))
    directory.push(...base128(t.data.byteLength))
    if (t.transformed) directory.push(...base128(t.data.byteLength))
  }
  const stream = options.stream ?? brotliCompressSync(Buffer.concat(tables.map((t) => Buffer.from(t.data))))
  const header = [...u32(0x774f4632), ...u32(0x00010000), ...u32(0), ...u16(tables.length), ...u16(0), ...u32(0), ...u32(stream.byteLength), ...new Array(24).fill(0)]
  return new Uint8Array([...header, ...(options.directory ?? directory), ...stream])
}

const bytes = (...parts: number[][]): Uint8Array => new Uint8Array(parts.flat())

/** head: units per em at offset 18. */
const head = (unitsPerEm = 1000): Table => ({ tag: 'head', data: bytes(new Array(18).fill(0), u16(unitsPerEm), new Array(34).fill(0)) })
/** hhea: ascender, descender, line gap, and the number of advances at 34. */
const hhea = (advances: number, ascent = 800, descent = -200, gap = 0): Table => ({
  tag: 'hhea',
  data: bytes(u16(1), u16(0), u16(ascent & 0xffff), u16(descent & 0xffff), u16(gap), new Array(24).fill(0), u16(advances)),
})
/** OS/2 with fsSelection at 62 (bit 7: use typographic metrics) and the typographic ones at 68. */
const os2 = (useTypo: boolean): Table => ({
  tag: 'OS/2',
  data: bytes(u16(4), u16(500), new Array(58).fill(0), u16(useTypo ? 0x80 : 0), new Array(4).fill(0), u16(900), u16(-300 & 0xffff), u16(100), new Array(22).fill(0)),
})
/** hmtx: (advance, lsb) pairs, or transformed: a flags byte and the advances alone. */
const hmtx = (advances: number[], transformed = false): Table =>
  transformed
    ? { tag: 'hmtx', data: bytes([0x03], ...advances.map(u16)), transformed: true }
    : { tag: 'hmtx', data: bytes(...advances.map((a) => [...u16(a), ...u16(0)])) }

/** A cmap whose one Unicode subtable maps U+0020–U+007E to glyphs 1…, in format 12. */
function cmap12(platform = 3, encoding = 10): Table {
  const sub = bytes(u16(12), u16(0), u32(28), u32(0), u32(1), u32(0x20), u32(0x7e), u32(1))
  return { tag: 'cmap', data: bytes(u16(0), u16(1), u16(platform), u16(encoding), u32(12), [...sub]) }
}

/** The same mapping in format 4: one segment by delta, one by an index array, and the end segment. */
function cmap4(withSymbolTable = false): Table {
  // Segments: 0x20–0x60 by delta (glyph = code - 0x1f), 0x61–0x7e through idRangeOffset, 0xffff end.
  const seg = 3
  const ends = [0x60, 0x7e, 0xffff]
  const starts = [0x20, 0x61, 0xffff]
  const deltas = [(-0x1f) & 0xffff, 0, 1]
  const glyphIds = Array.from({ length: 0x7e - 0x61 + 1 }, (_, i) => 0x61 - 0x1f + i)
  // idRangeOffset of segment 1: from its own slot to the glyph array (2 slots later).
  const ranges = [0, 4, 0]
  const body = bytes(u16(4), u16(0), u16(0), u16(seg * 2), u16(0), u16(0), u16(0), ...ends.map(u16), u16(0), ...starts.map(u16), ...deltas.map(u16), ...ranges.map(u16), ...glyphIds.map(u16))
  const records = withSymbolTable ? 2 : 1
  const header = bytes(u16(0), u16(records), ...(withSymbolTable ? [[...u16(3), ...u16(0), ...u32(4 + records * 8 + body.byteLength)]] : []), u16(0), u16(3), u32(4 + records * 8))
  return { tag: 'cmap', data: bytes([...header], [...body], ...(withSymbolTable ? [[...body]] : [])) }
}

/** Advances: .notdef 600, then 400 for the space and 500 for every other glyph. */
const ADVANCES = [600, 400, ...new Array(0x7e - 0x20).fill(500)]

describe('woff2Metrics', () => {
  it('reads the same running-text advance through a format 12 or a format 4 cmap, and a transformed hmtx', () => {
    const font = (cmap: Table, h: Table) => woff2([cmap, head(), hhea(ADVANCES.length), h, os2(false)])
    const a = woff2Metrics(font(cmap12(), hmtx(ADVANCES)))
    const b = woff2Metrics(font(cmap4(), hmtx(ADVANCES)))
    const c = woff2Metrics(font(cmap12(0, 4), hmtx(ADVANCES, true)))
    if (typeof a === 'string') throw new Error(a)
    expect(a).toEqual(b)
    expect(c).toEqual(a)
    // Space (15.4%) at 400, á and é (no glyph: .notdef) at 600, the rest at 500.
    expect(a.avgWidth).toBeGreaterThan(480)
    expect(a.avgWidth).toBeLessThan(500)
    expect(a).toMatchObject({ unitsPerEm: 1000, ascent: 800, descent: 200, lineGap: 0 })
  })

  it('takes a format 12 subtable over a format 4 one, whichever comes first', () => {
    const four = cmap4().data
    const twelve = cmap12().data.subarray(12)
    // Two records: format 4 at the first offset, format 12 after it.
    const data = bytes(u16(0), u16(2), u16(3), u16(1), u32(20), u16(3), u16(10), u32(20 + four.byteLength - 12), [...four.subarray(12)], [...twelve])
    const m = woff2Metrics(woff2([{ tag: 'cmap', data }, head(), hhea(ADVANCES.length), hmtx(ADVANCES), os2(false)]))
    expect(typeof m).toBe('object')
  })

  it('gives a glyph past the last advance the last advance', () => {
    const one = woff2Metrics(woff2([cmap12(), head(), hhea(1), hmtx([700]), os2(false)]))
    if (typeof one === 'string') throw new Error(one)
    // Every character's glyph takes the one advance there is.
    expect(Math.abs(one.avgWidth / 700 - 1)).toBeLessThan(0.02)
  })

  it('uses the typographic metrics when the font asks for them', () => {
    const m = woff2Metrics(woff2([cmap12(), head(2048), hhea(ADVANCES.length), hmtx(ADVANCES), os2(true)]))
    expect(m).toMatchObject({ unitsPerEm: 2048, ascent: 900, descent: 300, lineGap: 100 })
    if (typeof m === 'string') throw new Error(m)
    expect(fallbackFaceOf(m, 'monospace').local).toBe('Courier New')
    expect(fallbackFaceOf(m).local).toBe('Arial')
  })

  it('says which table a file lacks, or why it cannot be read', () => {
    const all = [cmap12(), head(), hhea(ADVANCES.length), hmtx(ADVANCES), os2(false)]
    const without = (tag: string) => woff2Metrics(woff2(all.filter((t) => t.tag !== tag)))
    expect(without('head')).toBe('it has no head table')
    expect(without('hhea')).toBe('it has no hhea table')
    expect(without('OS/2')).toBe('it has no OS/2 table')
    expect(without('cmap')).toBe('it has no Unicode cmap table')
    expect(without('hmtx')).toBe('it has no hmtx table')
    // A cmap with only a symbol subtable, and one too short to read.
    const symbolOnly = bytes(u16(0), u16(1), u16(3), u16(0), u32(12), [...cmap12().data.subarray(12)])
    expect(woff2Metrics(woff2([{ tag: 'cmap', data: symbolOnly }, ...all.slice(1)]))).toBe('it has no Unicode cmap table')
    expect(woff2Metrics(woff2([{ tag: 'cmap', data: bytes(u16(0)) }, ...all.slice(1)]))).toBe('it has no Unicode cmap table')
    // A format 12 subtable that claims more groups than it holds.
    const lying = bytes(u16(0), u16(1), u16(3), u16(10), u32(12), u16(12), u16(0), u32(28), u32(0), u32(99), u32(0x20), u32(0x7e), u32(1))
    expect(woff2Metrics(woff2([{ tag: 'cmap', data: lying }, ...all.slice(1)]))).toBe('it has no Unicode cmap table')
    // An hmtx that says there are no advances.
    expect(woff2Metrics(woff2([cmap12(), head(), hhea(0), hmtx(ADVANCES), os2(false)]))).toBe('it has no hmtx table')
    expect(woff2Metrics(woff2(all, { stream: new Uint8Array([1, 2, 3, 4]) }))).toBe('its tables do not decompress')
    expect(woff2Metrics(woff2(all, { directory: [1, 0x80] }))).toMatch(/^its table directory cannot be read \(/)
    expect(woff2Metrics(woff2(all, { directory: [1, 0x81, 0x81, 0x81, 0x81, 0x81, 0x81] }))).toMatch(/bad UIntBase128/)
    // A table WOFF2 names by its own tag (index 63) is read past.
    expect(typeof woff2Metrics(woff2([{ tag: 'zzzz', data: bytes([1, 2]) }, ...all]))).toBe('object')
  })
})
