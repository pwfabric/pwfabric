import { describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readPwpack } from '@pwfabric/pack'
import { main } from '../../index.js'
import { archiveName } from '../../commands/pack.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function created(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { cwd, root: join(cwd, 'demo') }
}

describe('pwf validate', () => {
  it('prints the raw result with --json', async () => {
    const { root } = await created()
    const c = capture(root)
    expect(await main(['validate', '--json'], c.io)).toBe(0)
    const result = JSON.parse(c.out.join('\n'))
    expect(result).toMatchObject({ ok: true, layout: 'canonical', identity: { id: '@pwpack/local/demo' } })
    // The atoms/ note is documentation: reported as such, never an error or a warning.
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'info', code: 'DOC_FILE', path: 'atoms/README.md' })])
  })

  it('warns about a pinned build that is not cached', async () => {
    const { root } = await created()
    await rm(join(root, '.pwf'), { recursive: true })
    const c = capture(root)
    expect(await main(['validate'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Warnings (1):')
    expect(c.out[1]).toContain('PIN_NOT_CACHED .pwf/packs/@pwpack/fixture/foundation@1.2.0')
    expect(c.out.at(-1)).toContain('valid (0 errors, 1 warning;')
  })

  it('groups errors, warnings and notes and exits 1 on errors', async () => {
    const cwd = await tempDir()
    await mkdir(join(cwd, 'blocks', 'x', 'y'), { recursive: true })
    await writeFile(join(cwd, 'blocks', 'x', 'y', 'component.tsx'), '')
    await writeFile(join(cwd, 'package.json'), '{}')
    await writeFile(join(cwd, 'pwpack.json'), JSON.stringify({ id: '@pwpack/a/b', version: '1.0.0', app: { entry: 'home', surfaceOrder: ['home'] } }))
    const c = capture(cwd)
    expect(await main(['validate'], c.io)).toBe(1)
    expect(c.err[0]).toBe('Errors (1):')
    expect(c.err[1]).toContain('APP_SURFACE_MISSING app/surfaces/home.receipt.json')
    expect(c.out).toContain('Warnings (1):')
    expect(c.out).toContain('Notes (1):')
    expect(c.err.at(-1)).toContain('@pwpack/a/b@1.0.0: invalid (1 error, 1 warning; layout rootless; 1 atoms)')
  })

  it('reports an unusable pin id as an error', async () => {
    const cwd = await tempDir()
    await writeFile(join(cwd, 'pwpack.json'), JSON.stringify({ id: '@pwpack/a/b', version: '1.0.0', packs: [{ id: '../x', version: '1.0.0', hash: 'h' }] }))
    const c = capture(cwd)
    expect(await main(['validate', '--json'], c.io)).toBe(1)
    expect(JSON.parse(c.out.join('\n')).issues[0]).toMatchObject({ code: 'PIN_INVALID', severity: 'error' })
  })

  it('names the folder when there is no identity, and fails on a missing folder', async () => {
    const cwd = await tempDir()
    const c = capture(cwd)
    expect(await main(['validate'], c.io)).toBe(1)
    expect(c.err.at(-1)).toContain(`${cwd}: invalid`)
    const d = capture(cwd)
    expect(await main(['validate', 'missing'], d.io)).toBe(1)
    expect(d.err[0]).toContain('pwf validate: not a directory')
  })
})

describe('pwf pack', () => {
  it('writes <name>-<version>.pwpack into the folder by default and leaves out the cache', async () => {
    const { cwd, root } = await created()
    const c = capture(cwd)
    expect(await main(['pack', 'demo'], c.io)).toBe(0)
    const out = join(root, 'demo-0.1.0.pwpack')
    expect(c.out).toContain(`  file  ${out}`)
    expect(c.out.find((l) => l.startsWith('  size'))).toMatch(/^ {2}size {2}\d+ bytes, 6 files$/)
    const files = [...(await readPwpack(new Uint8Array(await readFile(out)))).files.keys()]
    expect(files.some((f) => f.startsWith('.pwf') || f === '.gitignore')).toBe(false)
    // The atoms/ note is pack content (documentation) and travels with the pack.
    expect(files).toContain('atoms/README.md')
    // packing again does not pack the previous archive
    const again = capture(cwd)
    expect(await main(['pack', 'demo'], again.io)).toBe(0)
    expect(again.out.find((l) => l.startsWith('  hash'))).toBe(c.out.find((l) => l.startsWith('  hash')))
  })

  it('neither packs nor reports dot entries at the root', async () => {
    const { root } = await created()
    await writeFile(join(root, '.editorconfig'), 'root = true')
    await mkdir(join(root, '.vscode'), { recursive: true })
    await writeFile(join(root, '.vscode', 'settings.json'), '{}')
    const v = capture(root)
    expect(await main(['validate'], v.io)).toBe(0)
    expect(v.out.at(-1)).toContain('(0 errors, 0 warnings;')
    const c = capture(root)
    expect(await main(['pack', '--out', '../dots.pwpack'], c.io)).toBe(0)
    const files = [...(await readPwpack(new Uint8Array(await readFile(join(root, '..', 'dots.pwpack'))))).files.keys()]
    expect(files.some((f) => f.startsWith('.'))).toBe(false)
  })

  it('prints warnings but still packs', async () => {
    const { root } = await created()
    await writeFile(join(root, 'notes.txt'), 'x')
    const c = capture(root)
    expect(await main(['pack', '--out', 'out/x.pwpack'], c.io)).toBe(0)
    expect(c.out[0]).toBe('Warnings (1):')
    expect(existsSync(join(root, 'out', 'x.pwpack'))).toBe(true)
  })

  it('packs the pack content only: tooling is left out and does not change the hash', async () => {
    const { root } = await created()
    const before = capture(root)
    expect(await main(['pack', '--out', '../a.pwpack'], before.io)).toBe(0)
    await writeFile(join(root, 'package.json'), '{"name":"demo"}')
    await mkdir(join(root, 'scripts'), { recursive: true })
    await writeFile(join(root, 'scripts', 'build.mjs'), '// tooling')
    const after = capture(root)
    expect(await main(['pack', '--out', '../b.pwpack'], after.io)).toBe(0)
    expect(after.out.find((l) => l.startsWith('  size'))).toMatch(/6 files \(2 outside the pack content left out\)$/)
    expect(after.out.find((l) => l.startsWith('  hash'))).toBe(before.out.find((l) => l.startsWith('  hash')))
    const files = [...(await readPwpack(new Uint8Array(await readFile(join(root, '..', 'b.pwpack'))))).files.keys()]
    expect(files).not.toContain('package.json')
    expect(files.some((f) => f.startsWith('scripts/'))).toBe(false)
  })

  it('names archives after the last id segment', () => {
    expect(archiveName('@pwpack/acme/cards', '1.2.0')).toBe('cards-1.2.0.pwpack')
    expect(archiveName('@solo', '1.0.0')).toBe('solo-1.0.0.pwpack')
    expect(archiveName('', '1.0.0')).toBe('pack-1.0.0.pwpack')
  })
})
