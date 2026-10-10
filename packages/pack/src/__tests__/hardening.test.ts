import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import {
  findCaseConflicts,
  findPathConflict,
  packFromRecord,
  PackError,
  readPwpack,
  validatePack,
  writePwpack,
  type PackFolder,
  type PackValidation,
} from '../index.js'
import { rawEntry, rawTgz } from '../__fixtures__/producers.js'

const codes = (v: PackValidation, severity?: string): string[] =>
  v.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code)

const withIdentity = (identity: unknown, extra: Record<string, string> = {}): PackValidation =>
  validatePack(packFromRecord({ 'pwpack.json': JSON.stringify(identity), ...extra }))

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    expect(e).toBeInstanceOf(PackError)
    return (e as PackError).code
  }
  throw new Error('expected a PackError')
}

const ID = '{"id":"x","version":"1"}'
const packOf = (paths: string[]): PackFolder => {
  const files = new Map<string, Uint8Array>([['pwpack.json', new TextEncoder().encode(ID)]])
  for (const p of paths) files.set(p, new Uint8Array([1]))
  return { files }
}

describe('findPathConflict / findCaseConflicts', () => {
  it('finds the first file/directory collision whatever the input order', () => {
    expect(findPathConflict(['a/b/c', 'a/b', 'z'])).toEqual({ file: 'a/b', inside: 'a/b/c' })
    expect(findPathConflict(['a/b', 'a/c'])).toBeNull()
  })

  it('groups paths that fold together, files and directories alike', () => {
    expect(findCaseConflicts(['b/X', 'b/x', 'a/Y', 'a/y/z'])).toEqual([
      ['a/Y', 'a/y/'],
      ['b/X', 'b/x'],
    ])
    expect(findCaseConflicts(['a/b', 'a/b/c'])).toEqual([])
  })
})

describe('validatePack — path collisions', () => {
  it('errors on a path that is a file and also a directory', () => {
    const v = validatePack(packOf(['atoms/lib/x', 'atoms/lib/x/y.ts']))
    expect(v.ok).toBe(false)
    expect(codes(v, 'error')).toEqual(['PATH_CONFLICT'])
    expect(v.issues.find((i) => i.code === 'PATH_CONFLICT')?.path).toBe('atoms/lib/x')
  })

  it('warns on paths that differ only in case', () => {
    const v = validatePack(packOf(['atoms/lib/Hero.ts', 'atoms/lib/hero.ts']))
    expect(v.ok).toBe(true)
    expect(codes(v, 'warning')).toEqual(['CASE_CONFLICT'])
  })

  it('warns on paths that differ only in Unicode normalisation or non-ASCII case', () => {
    expect(codes(validatePack(packOf(['atoms/lib/café.ts', 'atoms/lib/café.ts'])), 'warning')).toEqual(['CASE_CONFLICT'])
    expect(codes(validatePack(packOf(['atoms/lib/Été.ts', 'atoms/lib/été.ts'])), 'warning')).toEqual(['CASE_CONFLICT'])
  })

  it('warns on a file whose name folds onto another file’s directory', () => {
    expect(codes(validatePack(packOf(['atoms/lib/X', 'atoms/lib/x/y.ts'])), 'warning')).toEqual(['CASE_CONFLICT'])
  })

  it('does not warn on directories that differ only in case (they merge, nothing is overwritten)', () => {
    expect(codes(validatePack(packOf(['atoms/lib/A/x.ts', 'atoms/lib/a/y.ts'])))).toEqual([])
  })
})

describe('archive — file/directory collisions', () => {
  it('writePwpack refuses a path that is a file and also a directory', async () => {
    expect(await codeOf(writePwpack(packOf(['atoms/lib/x', 'atoms/lib/x/y.ts'])))).toBe('PATH_CONFLICT')
  })

  it('readPwpack refuses a file and a file below it', async () => {
    const tgz = rawTgz([
      rawEntry('pwpack.json', Buffer.from(ID)),
      rawEntry('atoms/lib/x', Buffer.from('a')),
      rawEntry('atoms/lib/x/y.ts', Buffer.from('b')),
    ])
    expect(await codeOf(readPwpack(tgz))).toBe('PATH_CONFLICT')
  })

  it('readPwpack refuses a file and a directory member of the same name, also under a package/ wrapper', async () => {
    const plain = rawTgz([rawEntry('atoms/x/', Buffer.alloc(0), '5'), rawEntry('atoms/x', Buffer.from('a'))])
    expect(await codeOf(readPwpack(plain))).toBe('PATH_CONFLICT')
    const wrapped = rawTgz([rawEntry('package/atoms/x/', Buffer.alloc(0), '5'), rawEntry('package/atoms/x', Buffer.from('a'))])
    expect(await codeOf(readPwpack(wrapped))).toBe('PATH_CONFLICT')
  })

  it('readPwpack accepts paths that differ only in case (validation warns)', async () => {
    const tgz = rawTgz([rawEntry('atoms/patterns/Hero.json', Buffer.from('{}')), rawEntry('atoms/patterns/hero.json', Buffer.from('{}'))])
    expect((await readPwpack(tgz)).files.size).toBe(2)
  })
})

describe('validatePack — media provenance that is invalid', () => {
  it('reports only MEDIA_PROVENANCE_INVALID, not every media file as undeclared', () => {
    const record = {
      'pwpack.json': ID,
      'media/hero.webp': 'x',
      'media/other.png': 'y',
      'media/provenance.json': JSON.stringify({ items: [{ path: 'media/hero.webp', source: 'nowhere' }] }),
    }
    expect([...new Set(codes(validatePack(packFromRecord(record))))]).toEqual(['MEDIA_PROVENANCE_INVALID'])
    expect(codes(validatePack(packFromRecord({ ...record, 'media/provenance.json': '{' })))).toEqual(['MEDIA_PROVENANCE_INVALID'])
  })
})

describe('validatePack — documentation files', () => {
  const id = { id: 'x', version: '1' }

  it('treats Markdown directly in atoms/ or a family directory as documentation', () => {
    const v = withIdentity(id, { 'atoms/README.md': '#', 'atoms/blocks/NOTES.md': '#', 'atoms/blocks/a/b/component.tsx': 'x' })
    expect(codes(v, 'warning')).toEqual([])
    expect(codes(v, 'info')).toEqual(['DOC_FILE', 'DOC_FILE'])
  })

  it('treats Markdown in a rootless family directory as documentation', () => {
    const v = withIdentity(id, { 'blocks/README.md': '#', 'blocks/a/b/component.tsx': 'x' })
    expect(codes(v, 'info')).toEqual(['DOC_FILE'])
    expect(codes(v, 'warning')).toEqual(['LAYOUT_ROOTLESS'])
  })

  it('accepts LICENSE, NOTICE and README.md at the root without a finding', () => {
    const v = withIdentity(id, { LICENSE: 'Apache', NOTICE: 'n', 'README.md': '#', 'atoms/icons/icons.json': '{}' })
    expect(v.issues).toEqual([])
  })

  it('still warns on a non-Markdown file directly in atoms/', () => {
    expect(codes(withIdentity(id, { 'atoms/notes.txt': 'x' }), 'warning')).toEqual(['UNKNOWN_ATOM_FAMILY'])
  })
})
