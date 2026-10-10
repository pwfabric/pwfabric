import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { hashPack, packFromRecord, PackError, readFolder, readPwpack, writePwpack } from '../index.js'
import { CRLF_PACK } from '../__fixtures__/folders.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pwpack-folder-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function put(rel: string, content: string | Uint8Array): Promise<void> {
  const abs = join(root, ...rel.split('/'))
  await mkdir(join(abs, '..'), { recursive: true })
  await writeFile(abs, content)
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

describe('readFolder', () => {
  it('walks into POSIX paths and keeps bytes as they are', async () => {
    for (const [p, c] of Object.entries(CRLF_PACK)) await put(p, c)
    const pack = await readFolder(root)
    expect([...pack.files.keys()].sort()).toEqual(Object.keys(CRLF_PACK).sort())
    for (const [p, c] of Object.entries(CRLF_PACK)) expect(Buffer.from(pack.files.get(p)!).toString('utf8')).toBe(c)
    // folder → memory → archive → memory is the same pack
    expect(hashPack(await readPwpack(await writePwpack(pack)))).toBe(hashPack(packFromRecord(CRLF_PACK)))
  })

  it('skips dependency, build, VCS and OS junk at any depth, and root .pwpack outputs', async () => {
    await put('pwpack.json', '{}')
    await put('node_modules/x/index.js', 'x')
    await put('dist/out.js', 'x')
    await put('.git/HEAD', 'x')
    await put('atoms/.DS_Store', 'x')
    await put('atoms/blocks/a/b/Thumbs.db', 'x')
    await put('atoms/blocks/a/b/desktop.ini', 'x')
    await put('acme-1.0.0.pwpack', 'x')
    await put('media/inner.pwpack', 'kept')
    const pack = await readFolder(root)
    expect([...pack.files.keys()].sort()).toEqual(['media/inner.pwpack', 'pwpack.json'])
  })

  it('takes a custom ignore set in place of the default', async () => {
    await put('dist/out.js', 'x')
    await put('skip-me/a', 'x')
    const pack = await readFolder(root, { ignore: new Set(['skip-me']) })
    expect([...pack.files.keys()]).toEqual(['dist/out.js'])
  })

  it('rejects a symbolic link or junction', async () => {
    await put('atoms/real/a.json', '{}')
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    await symlink(join(root, 'atoms', 'real'), join(root, 'atoms', 'linked'), 'junction')
    expect(await codeOf(readFolder(root))).toBe('LINK_ENTRY')
  })

  it('rejects a missing folder and a file given as the folder', async () => {
    expect(await codeOf(readFolder(join(root, 'nope')))).toBe('NOT_A_DIRECTORY')
    await put('file.txt', 'x')
    expect(await codeOf(readFolder(join(root, 'file.txt')))).toBe('NOT_A_DIRECTORY')
  })

  it.skipIf(process.platform === 'win32')('rejects a file name that is not a safe pack path', async () => {
    await put('atoms/back\\slash.json', '{}')
    expect(await codeOf(readFolder(root))).toBe('UNSAFE_PATH')
  })
})

describe('packFromRecord', () => {
  it('encodes strings as UTF-8 and copies bytes', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const pack = packFromRecord({ 'a.txt': 'ü', 'b.bin': bytes })
    expect([...pack.files.get('a.txt')!]).toEqual([0xc3, 0xbc])
    bytes[0] = 9
    expect([...pack.files.get('b.bin')!]).toEqual([1, 2, 3])
  })

  it('rejects an unsafe path', () => {
    expect(() => packFromRecord({ '/abs': 'x' })).toThrow(PackError)
  })
})
