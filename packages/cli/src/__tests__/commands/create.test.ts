import { describe, expect, it } from 'vitest'
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { hashPack, packContent, packFromRecord, readFolder, writePwpack } from '@pwfabric/pack'
import { create, FOUNDATION_ENV, runCreate } from '../../commands/create.js'
import { main } from '../../index.js'
import { capture, FIXTURE_FOUNDATION, schemaErrors, SPEC_SCHEMAS_MISSING, tempDir } from './helpers.js'

const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'))

describe('pwf create', () => {
  it('writes a canonical app folder pinned to the foundation', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['create', 'my-shop', '--foundation', FIXTURE_FOUNDATION], c.io)).toBe(0)
    const root = join(cwd, 'my-shop')
    const identity = await readJson(join(root, 'pwpack.json'))
    const foundationHash = hashPack(await readFolder(FIXTURE_FOUNDATION))
    expect(Object.keys(identity)).toEqual(['id', 'version', 'formatVersion', 'engines', 'requires', 'license', 'app', 'packs'])
    expect(identity).toMatchObject({
      id: '@pwpack/local/my-shop',
      version: '0.1.0',
      formatVersion: '1.0',
      requires: [{ id: '@pwpack/fixture/foundation', range: '^1.0.0' }],
      license: { fork: true, redistribute: true },
      app: { entry: 'home', surfaceOrder: ['home'] },
      packs: [{ id: '@pwpack/fixture/foundation', version: '1.2.0', hash: foundationHash }],
    })
    expect(identity.engines.pwfabric).toMatch(/^>=\d+\.\d+ <\d+$/)
    expect(c.out.join('\n')).toContain('home page  heading, text, button; theme theme-plain')
    expect(c.out.join('\n')).toContain('cd my-shop')
  })

  it.skipIf(SPEC_SCHEMAS_MISSING !== undefined)(
    `writes documents that satisfy the spec schemas${SPEC_SCHEMAS_MISSING ? ` (skipped: ${SPEC_SCHEMAS_MISSING})` : ''}`,
    async () => {
      const cwd = await tempDir()
      expect(await runCreate({ positionals: ['demo'], flags: { foundation: FIXTURE_FOUNDATION } }, capture(cwd).io)).toBe(0)
      const root = join(cwd, 'demo')
      const app = join(root, 'app')
      expect(schemaErrors('pwpack-format', await readJson(join(root, 'pwpack.json')))).toEqual([])
      expect(schemaErrors('receipt', await readJson(join(app, 'surfaces', 'home.receipt.json')))).toEqual([])
      expect(schemaErrors('plan', await readJson(join(app, 'plan.json')))).toEqual([])
      expect(schemaErrors('definitions.appearance', await readJson(join(app, 'definitions', 'appearance.json')))).toEqual([])
      expect(schemaErrors('definitions.navigation', await readJson(join(app, 'definitions', 'navigation.json')))).toEqual([])
    }
  )

  it('writes a starter page that uses only foundation blocks', async () => {
    const cwd = await tempDir()
    expect(await runCreate({ positionals: ['demo'], flags: { foundation: FIXTURE_FOUNDATION } }, capture(cwd).io)).toBe(0)
    const app = join(cwd, 'demo', 'app')
    const receipt = await readJson(join(app, 'surfaces', 'home.receipt.json'))
    expect(receipt.blocks.map((b: any) => b.type)).toEqual(['heading', 'text', 'button'])
    expect(receipt.blocks[0].props).toEqual({ text: 'Demo', level: 'h1' })
    expect(receipt.blocks[2].props).toEqual({ label: 'Get started', href: '/' })
    const appearance = await readJson(join(app, 'definitions', 'appearance.json'))
    expect(appearance).toEqual({ use: 'theme-plain' })
    expect(await readFile(join(cwd, 'demo', '.gitignore'), 'utf8')).toBe('.pwf/\n*.pwpack\n')
    expect(existsSync(join(cwd, 'demo', 'atoms', 'README.md'))).toBe(true)
  })

  it('copies the foundation into the project cache so its hash matches the pin', async () => {
    const cwd = await tempDir()
    await runCreate({ positionals: ['demo'], flags: { foundation: FIXTURE_FOUNDATION } }, capture(cwd).io)
    const cached = join(cwd, 'demo', '.pwf', 'packs', '@pwpack', 'fixture', 'foundation@1.2.0')
    expect(hashPack(await readFolder(cached))).toBe(hashPack(await readFolder(FIXTURE_FOUNDATION)))
  })

  it('caches and pins only the pack content of a foundation source folder', async () => {
    const cwd = await tempDir()
    const source = join(cwd, 'foundation-src')
    await cp(FIXTURE_FOUNDATION, source, { recursive: true })
    await writeFile(join(source, 'package.json'), '{"name":"foundation"}')
    await mkdir(join(source, 'test'), { recursive: true })
    await writeFile(join(source, 'test', 'blocks.test.ts'), '// tooling')
    await writeFile(join(source, 'tsconfig.json'), '{}')
    expect(await main(['create', 'demo', '--foundation', source], capture(cwd).io)).toBe(0)
    const cached = await readFolder(join(cwd, 'demo', '.pwf', 'packs', '@pwpack', 'fixture', 'foundation@1.2.0'))
    expect([...cached.files.keys()].some((f) => f === 'package.json' || f === 'tsconfig.json' || f.startsWith('test/'))).toBe(false)
    const pin = JSON.parse(await readFile(join(cwd, 'demo', 'pwpack.json'), 'utf8')).packs[0].hash
    expect(pin).toBe(hashPack(packContent(await readFolder(source))))
    expect(pin).toBe(hashPack(await readFolder(FIXTURE_FOUNDATION)))
    expect(await main(['validate', 'demo'], capture(cwd).io)).toBe(0)
  })

  it('accepts a .pwpack foundation from PWF_FOUNDATION and honours --dir', async () => {
    const cwd = await tempDir()
    const archive = join(cwd, 'foundation-1.2.0.pwpack')
    await writeFile(archive, await writePwpack(await readFolder(FIXTURE_FOUNDATION)))
    const c = capture(cwd, { [FOUNDATION_ENV]: archive })
    expect(await main(['create', 'demo', '--dir', 'nested/app'], c.io)).toBe(0)
    expect(existsSync(join(cwd, 'nested', 'app', 'pwpack.json'))).toBe(true)
    expect(c.out.join('\n')).toContain(join('nested', 'app'))
  })

  it('prints an absolute path to cd into when the target is outside the working folder', async () => {
    const cwd = await tempDir()
    const elsewhere = await tempDir()
    const c = capture(cwd)
    expect(await main(['create', 'demo', '--dir', elsewhere, '--foundation', FIXTURE_FOUNDATION], c.io)).toBe(0)
    expect(c.out).toContain(`  cd ${elsewhere}`)
  })

  it('explains how to point at a foundation when none is given', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['create', 'demo'], c.io)).toBe(1)
    const text = c.err.join('\n')
    expect(text).toContain('not published')
    expect(text).toContain('--foundation')
    expect(text).toContain(FOUNDATION_ENV)
    expect(existsSync(join(cwd, 'demo'))).toBe(false)
  })

  it('refuses a non-empty target without --force and writes into it with --force', async () => {
    const cwd = await tempDir()
    await mkdir(join(cwd, 'demo'))
    await writeFile(join(cwd, 'demo', 'keep.txt'), 'x')
    const c = capture(cwd)
    expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], c.io)).toBe(1)
    expect(c.err[0]).toContain('is not empty')
    expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION, '--force'], c.io)).toBe(0)
    expect(existsSync(join(cwd, 'demo', 'keep.txt'))).toBe(true)
    expect(existsSync(join(cwd, 'demo', 'pwpack.json'))).toBe(true)
  })

  it('rejects a missing or malformed name or flag with exit 2', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['create'], c.io)).toBe(2)
    expect(await main(['create', 'My App', '--foundation', FIXTURE_FOUNDATION], c.io)).toBe(2)
    expect(await main(['create', 'x', '--foundation'], c.io)).toBe(2)
    expect(c.err.join('\n')).toContain('--foundation needs a value')
  })

  it('refuses an invalid foundation, a missing one and one without starter blocks', async () => {
    const cwd = await tempDir()
    const bad = join(cwd, 'bad')
    await mkdir(bad)
    await writeFile(join(bad, 'pwpack.json'), '{ "version": "1.0.0" }')
    const c = capture(cwd)
    expect(await main(['create', 'a', '--foundation', bad], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('IDENTITY_INVALID')

    const bare = join(cwd, 'bare.pwpack')
    await writeFile(bare, await writePwpack(packFromRecord({ 'pwpack.json': '{ "id": "@pwpack/x/bare", "version": "2.0.0" }' })))
    const d = capture(cwd)
    expect(await main(['create', 'b', '--foundation', bare], d.io)).toBe(1)
    expect(d.err.join('\n')).toContain('has no heading, text or button block')

    const e = capture(cwd)
    expect(await main(['create', 'c', '--foundation', join(cwd, 'nope')], e.io)).toBe(1)
    expect(e.err.join('\n')).toContain('no such file or folder')
  })

  it('uses the engine version it is given for the engines range', async () => {
    const cwd = await tempDir()
    await runCreate({ positionals: ['demo'], flags: { foundation: FIXTURE_FOUNDATION } }, capture(cwd).io, { engineVersion: '7.3.1' })
    expect((await readJson(join(cwd, 'demo', 'pwpack.json'))).engines).toEqual({ pwfabric: '>=7.3 <8' })
  })

  it('describes itself', () => {
    expect(create.usage).toContain('--foundation')
  })
})
