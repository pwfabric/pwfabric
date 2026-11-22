import { describe, expect, it } from 'vitest'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { changelogBetween, compareVersions } from '../../commands/upgrade.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

const json = async (path: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(path, 'utf8'))

/** A copy of the fixture foundation at `version`, its heading without `level`, with a changelog. */
async function foundationAt(dir: string, version: string, engines?: string): Promise<string> {
  const to = join(dir, `foundation-${version}`)
  await cp(FIXTURE_FOUNDATION, to, { recursive: true })
  const id = await json(join(to, 'pwpack.json'))
  id['version'] = version
  if (engines) id['engines'] = { pwfabric: engines }
  await writeFile(join(to, 'pwpack.json'), JSON.stringify(id))
  const manifest = join(to, 'atoms', 'blocks', 'text', 'heading', 'manifest.json')
  const m = await json(manifest)
  ;(m['definition'] as { props: { name: string }[] }).props = [{ name: 'text', type: 'string' } as { name: string }]
  await writeFile(manifest, JSON.stringify(m))
  await writeFile(join(to, 'CHANGELOG.md'), `# foundation\n\n## ${version}\n\n- Removed: heading level.\n\n## 1.2.0\n\n- Old.\n`)
  return to
}

async function app(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  const root = join(cwd, 'demo')
  await writeFile(
    join(root, 'app', 'surfaces', 'home.receipt.json'),
    JSON.stringify({ title: 'Home', blocks: [{ id: 'hi', type: 'heading', props: { text: 'Hi', level: 'h1' } }] })
  )
  return { cwd, root }
}

describe('versions and changelogs', () => {
  it('orders versions as semver does', () => {
    expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0-rc.1', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('1.0.0', 'x')).toBeNaN()
  })
  it('takes the sections after the pinned version up to the new one', () => {
    const log = '# x\n\n## 3.0.0\n\n- c\n\n## [2.1.0] - 2026-01-01\n\n- b\n\n## 2.0.0\n\n- a\n'
    expect(changelogBetween(log, '2.0.0', '2.1.0')).toEqual(['## [2.1.0] - 2026-01-01', '', '- b'])
  })
})

describe('pwf upgrade', () => {
  it('says it needs --from, and changes nothing without one', async () => {
    const { root } = await app()
    const c = capture(root)
    expect(await main(['upgrade'], c.io)).toBe(0)
    expect(c.out[0]).toMatch(/keeps no registry/)
    expect(c.text()).toMatch(/no newer build/)
  })

  it('--check reports engine fit, the major, removed props and where they are used, and the changelog', async () => {
    const { cwd, root } = await app()
    await foundationAt(cwd, '2.0.0')
    await foundationAt(cwd, '3.0.0', '>=99 <100')
    const before = await readFile(join(root, 'pwpack.json'), 'utf8')
    const c = capture(root)
    expect(await main(['upgrade', '--check', '--from', '..'], c.io)).toBe(0)
    const text = c.text()
    expect(text).toMatch(/3\.0\.0 \(new major: expect breaking changes\) — excludes this engine \(engines\.pwfabric ">=99 <100"\)/)
    expect(text).toMatch(/prop removed: text\.heading level — set at home#hi/)
    expect(text).toMatch(/\| - Removed: heading level\./)
    expect(text).toMatch(/would re-pin to 2\.0\.0/)
    expect(await readFile(join(root, 'pwpack.json'), 'utf8')).toBe(before)

    const j = capture(root)
    expect(await main(['upgrade', '--check', '--from', '..', '--json'], j.io)).toBe(0)
    const report = JSON.parse(j.out.join('\n'))
    expect(report.packs[0]).toMatchObject({ pinned: '1.2.0', chosen: '2.0.0', compared: true })
    expect(report.packs[0].candidates.map((x: { version: string }) => x.version)).toEqual(['3.0.0', '2.0.0'])
  })

  it('re-pins to the newest build this engine runs, as pwf add does', async () => {
    const { cwd, root } = await app()
    await foundationAt(cwd, '2.0.0')
    const c = capture(root)
    expect(await main(['upgrade', '--from', '..'], c.io)).toBe(0)
    expect(c.text()).toMatch(/re-pinned to 2\.0\.0/)
    const id = await json(join(root, 'pwpack.json'))
    expect((id['packs'] as { version: string }[])[0]?.version).toBe('2.0.0')
    expect((id['requires'] as { range: string }[])[0]?.range).toBe('^2.0.0')
  })

  it('--to refuses a version that excludes this engine or is not there', async () => {
    const { cwd, root } = await app()
    await foundationAt(cwd, '3.0.0', '>=99 <100')
    const id = ((await json(join(root, 'pwpack.json')))['packs'] as { id: string }[])[0]?.id as string
    const c = capture(root)
    expect(await main(['upgrade', '--from', '..', '--to', `${id}@3.0.0`], c.io)).toBe(1)
    expect(c.text()).toMatch(/excludes this engine/)
    expect(await main(['upgrade', '--from', '..', '--to', `${id}@4.0.0`], capture(root).io)).toBe(1)
    expect(await main(['upgrade', '--to', 'nope'], capture(root).io)).toBe(2)
  })
})
