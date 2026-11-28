/**
 * `pwf validate` and THEME_NOT_FOUND: a theme nothing can draw stops validation
 * as it stops the build; a theme that exists — in a pack or among the runner's
 * presets — and what the build never reads are no finding.
 */
import { describe, expect, it } from 'vitest'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function app(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { cwd, root: join(cwd, 'demo') }
}

const write = (root: string, rel: string, doc: unknown): Promise<void> => writeFile(join(root, ...rel.split('/')), JSON.stringify(doc))

async function validate(cwd: string): Promise<{ code: number; text: string }> {
  const c = capture(cwd)
  const code = await main(['validate', 'demo'], c.io)
  return { code, text: c.text() }
}

async function withPageAppearance(root: string, rel: string, appearance: unknown): Promise<void> {
  const page = JSON.parse(await readFile(join(root, ...rel.split('/')), 'utf8')) as Record<string, unknown>
  await write(root, rel, { ...page, appearance })
}

describe('pwf validate: THEME_NOT_FOUND', () => {
  it('a theme nothing carries stops validation, naming it and the ones there are', async () => {
    const { cwd, root } = await app()
    await write(root, 'app/definitions/appearance.json', { use: 'theme-linen' })
    const r = await validate(cwd)
    expect(r.code).toBe(1)
    expect(r.text).toContain('THEME_NOT_FOUND')
    expect(r.text).toContain('"theme-linen"')
    expect(r.text).toContain('"theme-plain"')
  })

  it('the { config } shape and a served page are judged the same way', async () => {
    const { cwd, root } = await app()
    await write(root, 'app/definitions/appearance.json', { config: { use: 'midnight' } })
    expect((await validate(cwd)).text).toContain('"midnight"')
    await write(root, 'app/definitions/appearance.json', { use: 'theme-plain' })
    await withPageAppearance(root, 'app/surfaces/home.receipt.json', { use: 'slate' })
    const r = await validate(cwd)
    expect(r.code).toBe(1)
    expect(r.text).toMatch(/THEME_NOT_FOUND[^\n]*|home\.receipt\.json/)
    expect(r.text).toContain('"slate"')
  })

  it('a pack theme, a runner preset and "default" are no finding (positive control)', async () => {
    for (const use of ['theme-plain', 'plain', 'theme-zinc', 'paper', 'default']) {
      const { cwd, root } = await app()
      await write(root, 'app/definitions/appearance.json', { use })
      const r = await validate(cwd)
      expect(r.text, use).not.toContain('THEME_NOT_FOUND')
      expect(r.code, use).toBe(0)
    }
  })

  it('what the build never reads is not judged: an unserved receipt, a locale receipt, the layout', async () => {
    const { cwd, root } = await app()
    const home = JSON.parse(await readFile(join(root, 'app', 'surfaces', 'home.receipt.json'), 'utf8')) as Record<string, unknown>
    await write(root, 'app/surfaces/old.receipt.json', { ...home, appearance: { use: 'theme-linen' } })
    const r = await validate(cwd)
    expect(r.text).not.toContain('THEME_NOT_FOUND')
  })

  it('a pinned pack that cannot be read leaves theme names unjudged (its pin is the finding)', async () => {
    const { cwd, root } = await app()
    await write(root, 'app/definitions/appearance.json', { use: 'theme-plain' })
    await rm(join(root, '.pwf', 'packs'), { recursive: true, force: true })
    const r = await validate(cwd)
    expect(r.text).not.toContain('THEME_NOT_FOUND')
  })
})
