import { describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { runDoctor } from '../../commands/doctor.js'
import { parseArgs } from '../../args.js'
import { saveTokens } from '../../phiwebs/config.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function app(): Promise<{ root: string; env: Record<string, string> }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { root: join(cwd, 'demo'), env: { XDG_CONFIG_HOME: join(cwd, 'config') } }
}
const deps = { platform: 'linux' as const }

describe('pwf doctor', () => {
  it('reports a healthy app, signed out, without the network', async () => {
    const { root, env } = await app()
    const fetchless = globalThis.fetch
    globalThis.fetch = (() => {
      throw new Error('no network in pwf doctor')
    }) as typeof fetch
    try {
      const c = capture(root, env)
      expect(await runDoctor(parseArgs(['doctor']).args, c.io, deps), c.text()).toBe(0)
      const text = c.text()
      expect(text).toMatch(/^pwf \S+, engine \S+, Node \S+/)
      expect(text).toMatch(/app @pwpack\/local\/demo@0\.1\.0/)
      expect(text).toMatch(/pin @pwpack\/fixture\/foundation@1\.2\.0: cached, matches its pin/)
      expect(text).toMatch(/routing: not built yet; origin none; 0 redirects/)
      expect(text).toMatch(/languages: en/)
      expect(text).toMatch(/PhiWebs \(https:\/\/api\.phiwebs\.com\): not signed in/)
    } finally {
      globalThis.fetch = fetchless
    }
  })

  it('names the fix for a pin that is not cached and an engine range that excludes this engine', async () => {
    const { root, env } = await app()
    await rm(join(root, '.pwf', 'packs'), { recursive: true })
    const id = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8'))
    id.engines = { pwfabric: '>=99 <100' }
    await writeFile(join(root, 'pwpack.json'), JSON.stringify(id))
    const c = capture(root, env)
    expect(await runDoctor(parseArgs(['doctor']).args, c.io, deps)).toBe(1)
    const err = c.err.join('\n')
    expect(err).toMatch(/ERROR PIN_NOT_CACHED: @pwpack\/fixture\/foundation@1\.2\.0 is pinned but not in \.pwf\/packs/)
    expect(err).toMatch(/fix: pwf add @pwpack\/fixture\/foundation@1\.2\.0/)
    expect(err).toMatch(/ERROR ENGINE_RANGE_EXCLUDED: .*">=99 <100"/)
    expect(err).toMatch(/fix: move the folder to this engine and set engines\.pwfabric to ">=\d+\.\d+ <\d+"/)
    const j = capture(root, env)
    await runDoctor(parseArgs(['doctor', '--json']).args, j.io, deps)
    const report = JSON.parse(j.out.join('\n'))
    expect(report.folder.pins[0]).toEqual({ id: '@pwpack/fixture/foundation', version: '1.2.0', cached: false })
  })

  it('reads the saved session, the languages and the font files', async () => {
    const { root, env } = await app()
    await saveTokens('https://api.phiwebs.com', { accessToken: 'a', refreshToken: 'r', clientId: 'c', tokenEndpoint: 'https://api.phiwebs.com/token', studio: { resource: 'https://mcp.phiwebs.com', accessToken: 's' } }, { env, ...deps })
    expect(await main(['locale', 'add', 'de'], capture(root).io)).toBe(0)
    await mkdir(join(root, 'media', 'fonts'), { recursive: true })
    await writeFile(join(root, 'media', 'fonts', 'inter.woff2'), new Uint8Array(2048))
    const c = capture(root, env)
    expect(await runDoctor(parseArgs(['doctor']).args, c.io, deps)).toBe(0)
    expect(c.text()).toMatch(/signed in, with the studio/)
    expect(c.text()).toMatch(/languages: en, de \(default en\)/)
    expect(c.text()).toMatch(/fonts: 1 file in media\/fonts \(2\.0 KB\)/)
  })

  it('outside a pwpack folder checks pwf alone', async () => {
    const dir = await tempDir()
    const c = capture(dir, { XDG_CONFIG_HOME: join(dir, 'config') })
    expect(await runDoctor(parseArgs(['doctor']).args, c.io, deps)).toBe(0)
    expect(c.text()).toMatch(/not a pwpack folder/)
  })
})
