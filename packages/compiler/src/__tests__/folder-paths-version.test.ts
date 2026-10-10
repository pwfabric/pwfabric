import { describe, it, expect } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compileFolder, readSourceTree } from '../folder.js'
import { compileAtom } from '../compile.js'
import { joinVirtual, normalizeVirtualPath, PathEscapeError, resolveCandidates } from '../paths.js'
import { COMPILER_VERSION } from '../version.js'
import * as api from '../index.js'
import { LIB_BLOCK } from './fixtures.js'

describe('compileFolder', () => {
  it('reads a tree from disk and compiles it to the same bytes as the in-memory call', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pwfabric-compiler-folder-'))
    try {
      for (const [path, content] of Object.entries(LIB_BLOCK.files)) {
        const full = join(dir, ...path.split('/'))
        await mkdir(dirname(full), { recursive: true })
        await writeFile(full, content)
      }
      // Skipped directories never reach the tree.
      await mkdir(join(dir, 'node_modules', 'x'), { recursive: true })
      await writeFile(join(dir, 'node_modules', 'x', 'index.js'), 'skip')
      await mkdir(join(dir, '.git'), { recursive: true })
      await writeFile(join(dir, '.git', 'HEAD'), 'skip')

      const tree = await readSourceTree(dir)
      expect(Object.keys(tree).sort()).toEqual(Object.keys(LIB_BLOCK.files).sort())

      const fromDisk = await compileFolder(dir, LIB_BLOCK.entry, { companions: LIB_BLOCK.companions })
      const inMemory = await compileAtom(LIB_BLOCK)
      expect(fromDisk.ok).toBe(true)
      expect(fromDisk.hash).toBe(inMemory.hash)
      expect((await compileFolder(dir, LIB_BLOCK.entry)).hash).toBe(inMemory.hash)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('virtual paths', () => {
  it('normalises separators and dot segments', () => {
    expect(normalizeVirtualPath('a\\b\\c.ts')).toBe('a/b/c.ts')
    expect(normalizeVirtualPath('./a/./b/../c.ts')).toBe('a/c.ts')
  })

  it('refuses empty, NUL, absolute, root and escaping paths', () => {
    for (const bad of ['', 'a\0b', '/a', 'C:/a', 'c:\\a', '..', '../a', 'a/../../b', '.', 'a/']) {
      expect(() => normalizeVirtualPath(bad), JSON.stringify(bad)).toThrow(PathEscapeError)
    }
  })

  it('joins relative specifiers and refuses a climb past the root', () => {
    expect(joinVirtual('blocks/a/b/component.tsx', '../../../lib/x')).toBe('lib/x')
    expect(() => joinVirtual('blocks/a/component.tsx', '../../../x')).toThrow(PathEscapeError)
  })

  it('lists candidates in esbuild order', () => {
    expect(resolveCandidates('a/b.js').slice(0, 3)).toEqual(['a/b.js', 'a/b.ts', 'a/b.tsx'])
    expect(resolveCandidates('a/b.mjs')[1]).toBe('a/b.mts')
    expect(resolveCandidates('a/b')).toContain('a/b/index.ts')
  })
})

describe('version and public surface', () => {
  it('COMPILER_VERSION is this package version', async () => {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url))
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { version: string }
    expect(COMPILER_VERSION).toBe(pkg.version)
  })

  it('exports the API from the package root', () => {
    for (const name of ['compileAtom', 'compileFolder', 'screenSource', 'collectCompanions', 'buildWrapperSource', 'MAX_ATOM_BUNDLE_BYTES']) {
      expect(api).toHaveProperty(name)
    }
  })
})
