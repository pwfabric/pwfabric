import { describe, expect, it } from 'vitest'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import {
  DEFAULT_LIMITS,
  hashPack,
  packFromRecord,
  PackError,
  readPwpack,
  writePwpack,
  type PackFolder,
} from '../index.js'
import { CANONICAL_APP, CRLF_PACK } from '../__fixtures__/folders.js'
import { rawEntry, rawTar, rawTgz } from '../__fixtures__/producers.js'

const text = (pack: PackFolder, path: string): string => new TextDecoder().decode(pack.files.get(path))

function expectSameFiles(a: PackFolder, b: PackFolder): void {
  expect([...a.files.keys()].sort()).toEqual([...b.files.keys()].sort())
  for (const [path, bytes] of a.files) expect(Buffer.compare(Buffer.from(bytes), Buffer.from(b.files.get(path)!))).toBe(0)
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(PackError)
    return (e as PackError).code
  }
  throw new Error('expected a PackError')
}

describe('writePwpack determinism', () => {
  it('packs the same folder three times into identical bytes and hash', async () => {
    const runs = await Promise.all([1, 2, 3].map(() => writePwpack(packFromRecord(CANONICAL_APP))))
    expect(Buffer.from(runs[0]!).equals(Buffer.from(runs[1]!))).toBe(true)
    expect(Buffer.from(runs[1]!).equals(Buffer.from(runs[2]!))).toBe(true)
    const hashes = await Promise.all(runs.map(async (r) => hashPack(await readPwpack(r))))
    expect(new Set(hashes).size).toBe(1)
  })

  it('does not depend on the insertion order of the file map', async () => {
    const reversed = Object.fromEntries(Object.entries(CANONICAL_APP).reverse())
    const a = await writePwpack(packFromRecord(CANONICAL_APP))
    const b = await writePwpack(packFromRecord(reversed))
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('writes a fixed gzip header: mtime 0, no name, level-9 flag, Unix OS byte', async () => {
    const gz = await writePwpack(packFromRecord(CANONICAL_APP))
    expect([...gz.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 3])
  })

  it('writes ustar headers with mtime 0, uid/gid 0, empty uname/gname, 0644/0755', async () => {
    const tar = gunzipSync(await writePwpack(packFromRecord({ 'atoms/a.json': '{}' })))
    const field = (at: number, len: number): string => tar.subarray(at, at + len).toString('latin1')
    // first entry is the directory atoms/
    expect(field(0, 7)).toBe('atoms/\0')
    expect(field(100, 8)).toBe('0000755\0')
    expect(String.fromCharCode(tar[156]!)).toBe('5')
    const f = 512
    expect(field(f, 12)).toBe('atoms/a.json')
    expect(field(f + 100, 8)).toBe('0000644\0')
    expect(field(f + 108, 16)).toBe('0000000\x000000000\0')
    expect(field(f + 136, 12)).toBe('00000000000\0')
    expect(field(f + 257, 8)).toBe('ustar\x0000')
    expect(tar.subarray(f + 265, f + 329).every((b) => b === 0)).toBe(true)
  })

  it('keeps CRLF bytes exactly as given', async () => {
    const pack = packFromRecord(CRLF_PACK)
    const back = await readPwpack(await writePwpack(pack))
    expect(text(back, 'pwpack.json')).toContain('\r\n')
    expect(text(back, 'atoms/patterns/mixed.json')).toBe(CRLF_PACK['atoms/patterns/mixed.json'])
    expectSameFiles(pack, back)
  })

  it('refuses to write an unsafe path', async () => {
    const pack: PackFolder = { files: new Map([['../evil', new Uint8Array(1)]]) }
    expect(await codeOf(writePwpack(pack))).toBe('UNSAFE_PATH')
  })
})

describe('round trip', () => {
  it('readPwpack(writePwpack(x)) equals x byte-for-byte', async () => {
    const pack = packFromRecord(CANONICAL_APP)
    expectSameFiles(pack, await readPwpack(await writePwpack(pack)))
  })

  it('round-trips binary content, empty files, unicode and very long paths', async () => {
    const binary = new Uint8Array(1500).map((_, i) => (i * 7) % 256)
    const longDir = `atoms/blocks/${'d'.repeat(120)}/${'e'.repeat(60)}`
    const longLeaf = `app/surfaces/${'p'.repeat(140)}.receipt.json`
    const pack: PackFolder = {
      files: new Map<string, Uint8Array>([
        ['media/blob.bin', binary],
        ['atoms/empty.txt', new Uint8Array(0)],
        ['atoms/blocks/ünï/çødé/component.tsx', new TextEncoder().encode('x')],
        [`${longDir}/component.tsx`, new TextEncoder().encode('long dir')],
        [longLeaf, new TextEncoder().encode('{}')],
      ]),
    }
    const back = await readPwpack(await writePwpack(pack))
    expectSameFiles(pack, back)
  })
})

describe('readPwpack tolerance', () => {
  it('reads a bare (uncompressed) tar', async () => {
    const tar = rawTar([rawEntry('pwpack.json', Buffer.from('{}'))])
    const pack = await readPwpack(tar)
    expect([...pack.files.keys()]).toEqual(['pwpack.json'])
  })

  it('unwraps a package/ prefix on every file, ignores directory entries and ./', async () => {
    const tgz = rawTgz([
      rawEntry('package/', Buffer.alloc(0), '5'),
      rawEntry('./package/pwpack.json', Buffer.from('{}')),
      rawEntry('package/atoms/x.json', Buffer.from('1')),
    ])
    const pack = await readPwpack(tgz)
    expect([...pack.files.keys()].sort()).toEqual(['atoms/x.json', 'pwpack.json'])
  })

  it('keeps a partial package/ directory as an ordinary directory', async () => {
    const tgz = rawTgz([rawEntry('pwpack.json', Buffer.from('{}')), rawEntry('package/x.json', Buffer.from('1'))])
    const pack = await readPwpack(tgz)
    expect([...pack.files.keys()].sort()).toEqual(['package/x.json', 'pwpack.json'])
  })

  it('reads a GNU long-name entry and skips global PAX headers', async () => {
    const long = `atoms/${'n'.repeat(150)}.json`
    const tgz = rawTgz([
      rawEntry('pax_global_header', Buffer.from('18 comment=hello\n'), 'g'),
      rawEntry('././@LongLink', Buffer.from(`${long}\0`), 'L'),
      rawEntry(long.slice(0, 100), Buffer.from('{}')),
      rawEntry('././@LongLink', Buffer.from('target\0'), 'K'),
      rawEntry('regular.json', Buffer.from('{}'), '\0'),
    ])
    const pack = await readPwpack(tgz)
    expect([...pack.files.keys()].sort()).toEqual([long, 'regular.json'].sort())
  })

  it('applies a PAX path record only to the next entry', async () => {
    const record = (p: string): Buffer => {
      const body = ` path=${p}\n`
      let len = body.length + 2
      while (`${len}${body}`.length !== len) len = `${len}${body}`.length
      return Buffer.from(`${len}${body}`)
    }
    const tgz = rawTgz([
      rawEntry('PaxHeader', Buffer.concat([Buffer.from('12 mtime=10\n'), record('atoms/real.json')]), 'x'),
      rawEntry('placeholder', Buffer.from('a')),
      rawEntry('second.json', Buffer.from('b')),
    ])
    const pack = await readPwpack(tgz)
    expect([...pack.files.keys()].sort()).toEqual(['atoms/real.json', 'second.json'])
  })
})

describe('readPwpack security', () => {
  const one = (name: string, typeflag = '0'): Buffer => rawTgz([rawEntry(name, Buffer.from('x'), typeflag)])

  it.each([
    ['../escape.json', 'UNSAFE_PATH'],
    ['atoms/../../escape.json', 'UNSAFE_PATH'],
    ['/etc/passwd', 'UNSAFE_PATH'],
    ['C:/Windows/x', 'UNSAFE_PATH'],
    ['atoms\\..\\x', 'UNSAFE_PATH'],
    ['atoms//x', 'UNSAFE_PATH'],
  ])('rejects %s with %s', async (name, code) => {
    expect(await codeOf(readPwpack(one(name)))).toBe(code)
  })

  it('rejects an unsafe directory entry', async () => {
    expect(await codeOf(readPwpack(one('../up/', '5')))).toBe('UNSAFE_PATH')
  })

  it('rejects symlink and hardlink members', async () => {
    expect(await codeOf(readPwpack(one('atoms/link', '2')))).toBe('LINK_ENTRY')
    expect(await codeOf(readPwpack(one('atoms/link', '1')))).toBe('LINK_ENTRY')
  })

  it('rejects devices and FIFOs', async () => {
    expect(await codeOf(readPwpack(one('dev', '3')))).toBe('UNSUPPORTED_ENTRY')
    expect(await codeOf(readPwpack(one('fifo', '6')))).toBe('UNSUPPORTED_ENTRY')
  })

  it('rejects a path present twice, including after unwrapping', async () => {
    const dup = rawTgz([rawEntry('a.json', Buffer.from('1')), rawEntry('./a.json', Buffer.from('2'))])
    expect(await codeOf(readPwpack(dup))).toBe('DUPLICATE_ENTRY')
  })

  it('rejects an oversize archive, entry, total and entry count', async () => {
    const tgz = rawTgz([rawEntry('a.json', Buffer.alloc(100)), rawEntry('b.json', Buffer.alloc(100))])
    expect(await codeOf(readPwpack(tgz, { maxArchiveBytes: 10 }))).toBe('PACK_TOO_LARGE')
    expect(await codeOf(readPwpack(tgz, { maxEntryBytes: 50 }))).toBe('ENTRY_TOO_LARGE')
    expect(await codeOf(readPwpack(tgz, { maxTotalBytes: 150 }))).toBe('PACK_TOO_LARGE')
    expect(await codeOf(readPwpack(tgz, { maxEntries: 1 }))).toBe('TOO_MANY_ENTRIES')
    const tar = rawTar([rawEntry('a.json', Buffer.alloc(100))])
    expect(await codeOf(readPwpack(tar, { maxTarBytes: 600 }))).toBe('PACK_TOO_LARGE')
  })

  it('stops a decompression bomb at maxTarBytes', async () => {
    const bomb = gzipSync(Buffer.alloc(8 * 1024 * 1024))
    expect(bomb.length).toBeLessThan(DEFAULT_LIMITS.maxArchiveBytes)
    expect(await codeOf(readPwpack(bomb, { maxTarBytes: 1024 * 1024 }))).toBe('PACK_TOO_LARGE')
  })

  it('rejects bytes that are neither gzip nor tar, and corrupt gzip', async () => {
    expect(await codeOf(readPwpack(Buffer.from('{"json":true}')))).toBe('GZIP_INVALID')
    expect(await codeOf(readPwpack(Buffer.from([0x1f, 0x8b, 8, 0, 1, 2, 3])))).toBe('GZIP_INVALID')
  })

  it('rejects a bad checksum, a truncated entry, a non-octal size and a base-256 size', async () => {
    const good = rawEntry('a.json', Buffer.from('hello'))
    const badSum = Buffer.from(good)
    badSum[0] = 'b'.charCodeAt(0)
    expect(await codeOf(readPwpack(rawTgz([badSum])))).toBe('TAR_INVALID')

    const truncated = rawEntry('a.json', Buffer.from('hi'), '0', { size: 4096 })
    expect(await codeOf(readPwpack(gzipSync(truncated)))).toBe('TAR_INVALID')

    const nonOctal = Buffer.from(good)
    nonOctal.write('00000000009\0', 124, 'ascii')
    fixSum(nonOctal)
    expect(await codeOf(readPwpack(rawTgz([nonOctal])))).toBe('TAR_INVALID')

    const base256 = Buffer.from(good)
    base256[124] = 0x80
    fixSum(base256)
    expect(await codeOf(readPwpack(rawTgz([base256])))).toBe('ENTRY_TOO_LARGE')
  })

  it('rejects a malformed PAX record', async () => {
    const tgz = rawTgz([rawEntry('PaxHeader', Buffer.from('99 path=x\n'), 'x'), rawEntry('a', Buffer.from('a'))])
    expect(await codeOf(readPwpack(tgz))).toBe('TAR_INVALID')
  })

  it('accepts a header whose checksum was computed with signed bytes', async () => {
    const h = rawEntry('é.json', Buffer.from('{}'))
    let signed = 0
    for (let i = 0; i < 512; i++) {
      const b = i >= 148 && i < 156 ? 0x20 : h[i]!
      signed += b > 127 ? b - 256 : b
    }
    h.write(signed.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
    const pack = await readPwpack(rawTgz([h]))
    expect([...pack.files.keys()]).toEqual(['é.json'])
  })
})

function fixSum(h: Buffer): void {
  h.write('        ', 148, 'ascii')
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]!
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii')
}
