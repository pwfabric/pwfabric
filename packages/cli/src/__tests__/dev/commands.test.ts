import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { main } from '../../index.js'
import { COMMANDS } from '../../commands/registry.js'
import { runDev, untilInterrupted } from '../../commands/dev.js'
import type { CommandIO } from '../../commands/types.js'
import { makeApp } from './helpers.js'
import { writePwapp } from '../../dev/output.js'

vi.setConfig({ testTimeout: 90_000 })

let cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const c of cleanups) await c()
  cleanups = []
})
async function app(withPack = true): Promise<string> {
  const a = await makeApp({ withPack })
  cleanups.push(a.cleanup)
  return a.root
}
/** The URL `pwf dev` printed. */
function devUrl(out: readonly string[]): string {
  return /at (http\S+)$/.exec(out.find((l) => l.startsWith('pwf dev: serving')) ?? '')?.[1] ?? ''
}

/** Adds sign-in, a `Note` entity and a page source reading it to an app folder. */
async function withData(root: string): Promise<string> {
  const defs = join(root, 'app', 'definitions')
  await mkdir(defs, { recursive: true })
  await writeFile(join(defs, 'auth.json'), JSON.stringify({ required: false, topology: 'app', methods: ['password'] }))
  await writeFile(join(defs, 'entities.json'), JSON.stringify({ entities: [{ typeId: 'Note', fields: [{ name: 'text', type: 'text' }] }] }))
  const path = join(root, 'app', 'surfaces', 'home.receipt.json')
  const receipt = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  receipt['capabilities'] = [
    { capability: 'platform/persistence', config: { dataSources: [{ id: 'notes', kind: 'entity', entityType: 'Note' }] } },
  ]
  await writeFile(path, JSON.stringify(receipt))
  return root
}

function capture(cwd: string): { io: CommandIO; out: string[]; err: string[] } {
  const out: string[] = []
  const err: string[] = []
  return { io: { cwd, out: (l) => out.push(l), err: (l) => err.push(l), env: {} }, out, err }
}

describe('registry', () => {
  it('lists dev and build', () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(expect.arrayContaining(['dev', 'build']))
  })
})

describe('pwf build', () => {
  it('writes the pwapp to .pwf/out by default and replaces its own previous build', async () => {
    const root = await app()
    const c = capture(root)
    expect(await main(['build'], c.io)).toBe(0)
    const out = join(root, '.pwf', 'out')
    expect((await readdir(out)).sort()).toEqual(['_headers', 'assets', 'blocks', 'engines', 'index.html', 'publish.json', 'pwpack', 'shims'])
    expect(c.out.at(-2)).toMatch(/^built 1 page, 2 block types, 2 engines — 4\/5 atoms compiled/)
    expect(c.out.at(-1)?.startsWith('wrote ')).toBe(true)
    expect(c.out.at(-1)?.endsWith(` files to ${join('.pwf', 'out')}`)).toBe(true)
    expect(c.out.some((l) => l.includes('CREDENTIAL_DROPPED'))).toBe(true)
    expect(await main(['build', root], capture('/').io)).toBe(0)
  })

  it('writes to --out, refusing a folder that is not a previous build', async () => {
    const root = await app()
    const target = join(root, 'site')
    await mkdir(target)
    await writeFile(join(target, 'keep.txt'), 'mine')
    const c = capture(root)
    expect(await main(['build', '.', '--out', 'site'], c.io)).toBe(1)
    expect(c.err.join('\n')).toContain('holds no previous build')
    expect(await readFile(join(target, 'keep.txt'), 'utf8')).toBe('mine')

    const file = join(root, 'file-out')
    await writeFile(file, 'x')
    expect(await main(['build', '--out', 'file-out'], capture(root).io)).toBe(1)
    expect(await main(['build', '--out'], capture(root).io)).toBe(2)
    expect(await main(['build', '--out', 'fresh'], capture(root).io)).toBe(0)
    expect(await readFile(join(root, 'fresh', 'index.html'), 'utf8')).toContain('./assets/boot.js')
  })

  it('fails with the errors and writes nothing', async () => {
    const root = await app(false)
    const c = capture(root)
    expect(await main(['build'], c.io)).toBe(1)
    expect(c.err.some((l) => l.includes('PACK_NOT_CACHED'))).toBe(true)
    expect(c.err.at(-1)).toMatch(/errors; nothing written$/)
    await expect(readdir(join(root, '.pwf', 'out'))).rejects.toThrow()
  })

  it('rethrows unexpected write failures', async () => {
    await expect(writePwapp(new Map([['a\0b', new Uint8Array()]]), join(await app(), 'o'))).rejects.toThrow()
  })
})

describe('pwf dev', () => {
  it('serves until stopped, then closes', async () => {
    const root = await app()
    const c = capture(root)
    let url = ''
    const code = await runDev({ positionals: [], flags: { port: '0' } }, c.io, {
      internals: { watch: false },
      until: async () => {
        url = /at (http\S+)$/.exec(c.out.find((l) => l.startsWith('pwf dev: serving')) ?? '')?.[1] ?? ''
        expect((await fetch(url)).status).toBe(200)
      },
    })
    expect(code).toBe(0)
    expect(c.out.at(-1)).toBe('pwf dev: stopped')
    await expect(fetch(url)).rejects.toThrow()
  })

  it('validates its flags', async () => {
    const c = capture(process.cwd())
    expect(await runDev({ positionals: [], flags: { port: 'abc' } }, c.io)).toBe(2)
    expect(await runDev({ positionals: [], flags: { port: '70000' } }, c.io)).toBe(2)
    expect(await runDev({ positionals: [], flags: { port: true } }, c.io)).toBe(2)
    expect(await runDev({ positionals: [], flags: { host: true } }, c.io)).toBe(2)
    expect(c.err).toHaveLength(4)
  })

  it('says when the port is taken, and reports other start failures', async () => {
    const root = await app()
    const blocker = createServer()
    await new Promise<void>((r) => blocker.listen(0, '127.0.0.1', r))
    cleanups.push(() => new Promise((r) => blocker.close(() => r())))
    const port = (blocker.address() as AddressInfo).port
    const c = capture(root)
    expect(await runDev({ positionals: [], flags: { port: String(port) } }, c.io, { internals: { watch: false } })).toBe(1)
    expect(c.err[0]).toContain(`port ${port} is in use`)
    const d = capture(root)
    expect(await runDev({ positionals: [], flags: { port: '0', host: 'no-such-host.invalid' } }, d.io, { internals: { watch: false } })).toBe(1)
    expect(d.err[0]).toMatch(/^pwf dev: /)
  })

  it('mounts the local host when the app declares sign-in and records, and its receipts win', async () => {
    const root = await withData(await app())
    const c = capture(root)
    let checked = false
    const code = await runDev({ positionals: [], flags: { port: '0' } }, c.io, {
      internals: { watch: false },
      until: async () => {
        const base = devUrl(c.out)
        const origin = base.replace(/\/$/, '')
        expect(c.out.some((l) => l.startsWith(`local host mounted at ${origin}/_host`))).toBe(true)
        const auth = (await (await fetch(`${base}pwpack/auth.json`)).json()) as Record<string, unknown>
        expect(auth).toMatchObject({ provider: 'password', loginUrl: `${origin}/_host/login`, methods: ['password'] })
        const project = (await (await fetch(`${base}pwpack/project.json`)).json()) as Record<string, unknown>
        expect(project['identity']).toEqual({ required: false, topology: 'app', methods: ['password'] })
        const receipt = (await (await fetch(`${base}pwpack/surfaces/home.receipt.json`)).json()) as {
          capabilities: { config: { dataSources: Record<string, unknown>[] } }[]
        }
        expect(receipt.capabilities[0]?.config.dataSources[0]).toMatchObject({
          id: 'notes',
          kind: 'rest',
          endpoint: `${origin}/_host/records/Note`,
          authProviderRef: `${origin}/_host`,
        })
        const rows = (await (await fetch(`${base}_host/records/Note`)).json()) as { data: unknown[] }
        expect(rows.data).toEqual([])
        checked = true
      },
    })
    expect(code).toBe(0)
    expect(checked).toBe(true)
  })

  it('serves without a host under --no-host, and mounts one on request with --local-host', async () => {
    const root = await withData(await app())
    const c = capture(process.cwd())
    // The folder after a switch is read back as the folder.
    expect(
      await runDev({ positionals: [], flags: { port: '0', 'no-host': root } }, c.io, {
        internals: { watch: false },
        until: async () => {
          const base = devUrl(c.out)
          expect((await fetch(`${base}pwpack/auth.json`)).status).toBe(404)
          // No host: a path without an extension is the page (SPA fallback), not a session answer.
          expect((await fetch(`${base}_host/session`)).headers.get('content-type')).toContain('text/html')
        },
      })
    ).toBe(0)
    expect(c.out.some((l) => l.startsWith('local host mounted'))).toBe(false)

    const plain = await app()
    const d = capture(plain)
    expect(
      await runDev({ positionals: [], flags: { port: '0', 'local-host': true } }, d.io, {
        internals: { watch: false },
        until: async () => {
          const res = await fetch(`${devUrl(d.out)}_host/session`)
          expect(res.status).toBe(200)
          expect(await res.json()).toEqual({ data: { principal: null } })
        },
      })
    ).toBe(0)
  })

  it('refuses contradicting host switches and a second folder', async () => {
    const c = capture(process.cwd())
    expect(await runDev({ positionals: [], flags: { 'local-host': true, 'no-host': true } }, c.io)).toBe(2)
    expect(c.err[0]).toContain('contradict')
    expect(await runDev({ positionals: ['a'], flags: { 'no-host': 'b' } }, c.io)).toBe(2)
    expect(c.err[1]).toContain('unexpected argument "b"')
  })

  it('stops on SIGINT', async () => {
    const stopped = untilInterrupted()
    process.emit('SIGINT')
    await expect(stopped).resolves.toBeUndefined()
    const terminated = untilInterrupted()
    process.emit('SIGTERM')
    await expect(terminated).resolves.toBeUndefined()
  })
})
