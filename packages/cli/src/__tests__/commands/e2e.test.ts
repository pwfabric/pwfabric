/**
 * create → validate → pack, in process, against the fixture foundation.
 */
import { describe, expect, it } from 'vitest'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hashPack, readPwpack } from '@pwfabric/pack'
import { main } from '../../index.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function created(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { cwd, root: join(cwd, 'demo') }
}

describe('create → validate → pack', () => {
  it('produces a valid folder that packs to identical bytes twice', async () => {
    const { cwd, root } = await created()

    const v = capture(cwd)
    expect(await main(['validate', 'demo'], v.io)).toBe(0)
    expect(v.out.at(-1)).toBe('@pwpack/local/demo@0.1.0: valid (0 errors, 0 warnings; layout canonical; 0 atoms)')

    const p1 = capture(root)
    expect(await main(['pack', '--out', join(cwd, 'one.pwpack')], p1.io)).toBe(0)
    const p2 = capture(root)
    expect(await main(['pack', '--out', join(cwd, 'two.pwpack')], p2.io)).toBe(0)
    const one = await readFile(join(cwd, 'one.pwpack'))
    const two = await readFile(join(cwd, 'two.pwpack'))
    expect(Buffer.compare(one, two)).toBe(0)
    const hashLine = (lines: string[]): string | undefined => lines.find((l) => l.startsWith('  hash'))
    expect(hashLine(p1.out)).toBe(hashLine(p2.out))

    const opened = await readPwpack(new Uint8Array(one))
    expect([...opened.files.keys()].sort()).toEqual([
      'app/definitions/appearance.json',
      'app/definitions/navigation.json',
      'app/plan.json',
      'app/surfaces/home.receipt.json',
      'atoms/README.md',
      'pwpack.json',
    ])
    expect(hashLine(p1.out)).toBe(`  hash  ${hashPack(opened)}`)
  })

  it('fails validation (exit 1) when the pinned hash no longer matches the cache', async () => {
    const { cwd, root } = await created()
    const path = join(root, 'pwpack.json')
    const identity = JSON.parse(await readFile(path, 'utf8'))
    identity.packs[0].hash = `sha256:${'0'.repeat(64)}`
    await writeFile(path, JSON.stringify(identity, null, 2))

    const v = capture(cwd)
    expect(await main(['validate', 'demo'], v.io)).toBe(1)
    expect(v.err.join('\n')).toContain('PIN_HASH_MISMATCH')

    const p = capture(cwd)
    expect(await main(['pack', 'demo'], p.io)).toBe(1)
    expect(p.err.at(-1)).toContain('nothing written')
  })
})
