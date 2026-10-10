import { describe, expect, it } from 'vitest'
import { hashPack, isPackContentPath, packContent, packFromRecord, readPwpack, writePwpack } from '../index.js'
import { CANONICAL_APP } from '../__fixtures__/folders.js'

const TOOLING = {
  'package.json': '{"name":"x"}',
  'tsconfig.json': '{}',
  'vitest.config.ts': 'export default {}',
  'scripts/build.mjs': '',
  'test/a.test.ts': '',
  '.gitignore': 'dist\n',
  'notes.md': '#',
}

describe('packContent', () => {
  it('keeps the identity, app/, atoms/, media/ and the root doc files', () => {
    for (const p of ['pwpack.json', 'LICENSE', 'NOTICE', 'README.md', 'app/plan.json', 'atoms/test/a.test.ts', 'media/x.png']) {
      expect(isPackContentPath(p)).toBe(true)
    }
  })

  it('keeps the rootless atom families and shared code, not root test/', () => {
    for (const p of ['blocks/a/b/manifest.json', 'lib/x.ts', 'auth/AuthProvider.tsx', 'surfaces/g/x.receipt.json']) {
      expect(isPackContentPath(p)).toBe(true)
    }
    expect(isPackContentPath('test/x.test.ts')).toBe(false)
  })

  it('drops tooling a source folder carries', () => {
    const content = packContent(packFromRecord({ ...CANONICAL_APP, ...TOOLING }))
    expect([...content.files.keys()].sort()).toEqual(Object.keys(CANONICAL_APP).sort())
  })

  it('makes the content hash independent of tooling and of where the pack was read from', async () => {
    const clean = packFromRecord(CANONICAL_APP)
    const source = packFromRecord({ ...CANONICAL_APP, ...TOOLING })
    expect(hashPack(source)).toBe(hashPack(clean))
    expect(hashPack(await readPwpack(await writePwpack(packContent(source))))).toBe(hashPack(clean))
    expect(hashPack(await readPwpack(await writePwpack(source)))).toBe(hashPack(clean))
  })

  it('still counts the root doc files in the hash', () => {
    expect(hashPack(packFromRecord({ ...CANONICAL_APP, LICENSE: 'Apache-2.0' }))).not.toBe(hashPack(packFromRecord(CANONICAL_APP)))
  })
})
