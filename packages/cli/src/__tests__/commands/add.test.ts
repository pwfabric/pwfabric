import { describe, expect, it } from 'vitest'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hashPack, packFromRecord, readFolder, writePwpack } from '@pwfabric/pack'
import { main } from '../../index.js'
import { add } from '../../commands/add.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function created(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { cwd, root: join(cwd, 'demo') }
}

const cards = (version: string, extra = ''): Record<string, string> => ({
  'pwpack.json': JSON.stringify({ id: '@pwpack/acme/cards', version }),
  'atoms/blocks/content/card/component.tsx': `export default 1${extra}\n`,
})

describe('pwf add', () => {
  it('caches a .pwpack, pins it and requires its major, keeping key order', async () => {
    const { cwd, root } = await created()
    const archive = join(cwd, 'cards-2.1.0.pwpack')
    const pack = packFromRecord(cards('2.1.0'))
    await writeFile(archive, await writePwpack(pack))

    const c = capture(root)
    expect(await main(['add', archive], c.io)).toBe(0)
    expect(c.out[0]).toBe('Added @pwpack/acme/cards@2.1.0')
    const text = await readFile(join(root, 'pwpack.json'), 'utf8')
    const doc = JSON.parse(text)
    expect(Object.keys(doc)).toEqual(['id', 'version', 'formatVersion', 'engines', 'requires', 'license', 'app', 'packs'])
    expect(text).toBe(`${JSON.stringify(doc, null, 2)}\n`)
    expect(doc.requires[1]).toEqual({ id: '@pwpack/acme/cards', range: '^2.0.0' })
    expect(doc.packs[1]).toEqual({ id: '@pwpack/acme/cards', version: '2.1.0', hash: hashPack(pack) })
    const cached = await readFolder(join(root, '.pwf', 'packs', '@pwpack', 'acme', 'cards@2.1.0'))
    expect(hashPack(cached)).toBe(hashPack(pack))

    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(0)
  })

  it('installs only the pack content of a source folder and pins its hash', async () => {
    const { cwd, root } = await created()
    const folder = join(cwd, 'cards-src')
    const tooling: Record<string, string> = {
      'package.json': '{"name":"cards"}',
      'scripts/build.mjs': '// tooling',
      'vitest.config.ts': 'export default {}',
    }
    for (const [path, text] of Object.entries({ ...cards('2.2.0'), ...tooling })) {
      await mkdir(join(folder, ...path.split('/').slice(0, -1)), { recursive: true })
      await writeFile(join(folder, ...path.split('/')), text)
    }
    expect(await main(['add', folder], capture(root).io)).toBe(0)
    const cached = await readFolder(join(root, '.pwf', 'packs', '@pwpack', 'acme', 'cards@2.2.0'))
    expect([...cached.files.keys()].sort()).toEqual(['atoms/blocks/content/card/component.tsx', 'pwpack.json'])
    const doc = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8'))
    expect(doc.packs[1].hash).toBe(hashPack(packFromRecord(cards('2.2.0'))))
    expect(await main(['validate'], capture(root).io)).toBe(0)
  })

  it('updates an existing pin and a bare-name requirement in place from a folder', async () => {
    const { cwd, root } = await created()
    const identityPath = join(root, 'pwpack.json')
    const doc = JSON.parse(await readFile(identityPath, 'utf8'))
    doc.requires.push('@pwpack/acme/cards')
    doc.packs.push({ id: '@pwpack/acme/cards', version: '1.0.0', hash: 'sha256:old' })
    doc.extra = { kept: true }
    await writeFile(identityPath, JSON.stringify(doc))

    const folder = join(cwd, 'cards')
    for (const [path, text] of Object.entries(cards('3.0.0', ' // v3'))) {
      await mkdir(join(folder, ...path.split('/').slice(0, -1)), { recursive: true })
      await writeFile(join(folder, ...path.split('/')), text)
    }
    const c = capture(cwd)
    expect(await main(['add', 'cards', '--dir', 'demo'], c.io)).toBe(0)
    const next = JSON.parse(await readFile(identityPath, 'utf8'))
    expect(next.requires).toEqual([
      { id: '@pwpack/fixture/foundation', range: '^1.0.0' },
      { id: '@pwpack/acme/cards', range: '^3.0.0' },
    ])
    expect(next.packs).toHaveLength(2)
    expect(next.packs[1]).toMatchObject({ id: '@pwpack/acme/cards', version: '3.0.0' })
    expect(Object.keys(next).at(-1)).toBe('extra')
  })

  it('starts requires and packs when the project has none', async () => {
    const cwd = await tempDir()
    await writeFile(join(cwd, 'pwpack.json'), `${String.fromCharCode(0xfeff)}{ "id": "@pwpack/local/x", "version": "0.1.0" }`)
    const archive = join(cwd, 'c.pwpack')
    await writeFile(archive, await writePwpack(packFromRecord(cards('1.4.2'))))
    expect(await main(['add', archive], capture(cwd).io)).toBe(0)
    const doc = JSON.parse(await readFile(join(cwd, 'pwpack.json'), 'utf8'))
    expect(doc.requires).toEqual([{ id: '@pwpack/acme/cards', range: '^1.0.0' }])
    expect(doc.packs).toHaveLength(1)
  })

  it('refuses an invalid pack, the project itself, and a folder without pwpack.json', async () => {
    const { cwd, root } = await created()
    const bad = join(cwd, 'bad.pwpack')
    await writeFile(bad, await writePwpack(packFromRecord({ 'pwpack.json': '{}' })))
    const c = capture(root)
    expect(await main(['add', bad], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('IDENTITY_INVALID')

    const self = capture(cwd)
    expect(await main(['add', 'demo', '--dir', 'demo'], self.io)).toBe(1)
    expect(self.err[0]).toContain('is this project itself')

    const none = capture(cwd)
    expect(await main(['add', bad], none.io)).toBe(1)
    expect(none.err[0]).toContain('pwpack.json not found')
  })

  it('refuses a project pwpack.json that is not a JSON object', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    await writeFile(join(cwd, 'pwpack.json'), '[]')
    expect(await main(['add', 'x'], c.io)).toBe(1)
    expect(c.err[0]).toContain('not a JSON object')
    await writeFile(join(cwd, 'pwpack.json'), '{')
    expect(await main(['add', 'x'], c.io)).toBe(1)
    expect(c.err.at(-1)).toContain('is not JSON')
    expect(await main(['add'], c.io)).toBe(2)
  })

  it('says registry resolution is not supported', () => {
    expect(add.usage).toContain('not supported')
  })
})
