/**
 * `pwf add @pwpack/<handle>/<name>[@<version>]` and `pwf_add_pack` with a pack
 * id: signed in against a fake API on 127.0.0.1, the pack sources route and
 * the download answered by a mocked fetch. The pack is checked against its
 * sha256 and installed as a local file is; skipped packs, a wrong hash and a
 * missing session are refused with the reason. No network beyond 127.0.0.1.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { hashPack, packFromRecord, readFolder, sha256Hex, writePwpack } from '@pwfabric/pack'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../index.js'
import { runAdd as addBody, type AddDeps } from '../../commands/add.js'
import { guard } from '../../commands/lib/flags.js'
import { runLogin as loginBody, type AccountDeps } from '../../commands/login.js'
import type { CommandIO, ParsedArgs } from '../../commands/types.js'
import { createPwfMcpServer } from '../../mcp/index.js'
import { CREDENTIALS_FILE } from '../../phiwebs/config.js'
import type { Fetch } from '../../phiwebs/oauth.js'
import { PACK_SOURCES_PATH, parsePackRef } from '../../phiwebs/pack-sources.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from '../commands/helpers.js'
import { startFakeServer, type FakeServer } from './fake-server.js'

const closers: { close(): Promise<void> }[] = []
afterEach(async () => {
  while (closers.length) await (closers.pop() as { close(): Promise<void> }).close()
})

const ID = '@pwpack/acme/cards'
/** A presigned address: a credential that must never be printed. */
const DOWNLOAD = 'https://storage.example.com/atoms/cards-2.1.0.pwpack?X-Amz-Signature=very-secret'

const browser: AccountDeps['openBrowser'] = async (url) => {
  await fetch(url)
}
const args = (positionals: string[], flags: Record<string, string | boolean> = {}): ParsedArgs => ({ positionals, flags })
const add = (a: ParsedArgs, io: CommandIO, d?: AddDeps) => guard('add', io, () => addBody(a, io, d))

async function cardsArchive(version = '2.1.0'): Promise<{ bytes: Uint8Array; hash: string }> {
  const pack = packFromRecord({
    'pwpack.json': JSON.stringify({ id: ID, version }),
    'atoms/blocks/content/card/component.tsx': 'export default 1\n',
  })
  return { bytes: await writePwpack(pack), hash: hashPack(pack) }
}

interface Seen {
  readonly url: string
  readonly authorization: string | null
}

interface Answer {
  packs?: unknown[]
  skipped?: unknown[]
}

/** The API's pack sources and the download, answered here; everything else goes to the fake API. */
function mockedFetch(api: FakeServer, answer: Answer, bytes: Uint8Array, seen: Seen[]): Fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input)
    const authorization = new Headers(init?.headers).get('authorization')
    if (url === `${api.url}${PACK_SOURCES_PATH}`) {
      seen.push({ url, authorization })
      return Response.json({ data: { packs: answer.packs ?? [], skipped: answer.skipped ?? [], expiresAt: new Date().toISOString() } })
    }
    if (url === DOWNLOAD) {
      seen.push({ url, authorization })
      return new Response(bytes, { headers: { 'content-type': 'application/gzip' } })
    }
    return fetch(input, init)
  }) as Fetch
}

async function signedIn(): Promise<{ api: FakeServer; env: Record<string, string>; dir: string; cwd: string; root: string }> {
  const api = await startFakeServer()
  closers.push(api)
  const home = await tempDir()
  const env = { APPDATA: home, XDG_CONFIG_HOME: home, PWF_PHIWEBS_URL: api.url }
  const dir = join(home, 'pwfabric')
  const c = capture(dir, env)
  expect(await guard('login', c.io, () => loginBody(args([]), c.io, { openBrowser: browser })), c.text()).toBe(0)
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return { api, env, dir, cwd, root: join(cwd, 'demo') }
}

const offered = async (version = '2.1.0') => {
  const archive = await cardsArchive(version)
  return { archive, answer: { packs: [{ id: ID, version, sha256: sha256Hex(archive.bytes), downloadUrl: DOWNLOAD }] } }
}

describe('pwf add <PhiWebs pack id>', () => {
  it('downloads the pack, checks its sha256 and installs it as a local file is', async () => {
    const { api, env, dir, root } = await signedIn()
    const { archive, answer } = await offered()
    const seen: Seen[] = []
    const c = capture(root, env)
    expect(await add(args([`${ID}@2.1.0`]), c.io, { fetch: mockedFetch(api, answer, archive.bytes, seen) }), c.text()).toBe(0)
    expect(c.out[0]).toBe(`Added ${ID}@2.1.0`)
    expect(c.text()).not.toContain('storage.example.com')
    expect(c.text()).not.toContain('very-secret')

    // The API is asked with the session's API token; the presigned download carries none.
    const saved = JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers[api.url]
    expect(seen).toEqual([
      { url: `${api.url}${PACK_SOURCES_PATH}`, authorization: `Bearer ${saved.accessToken}` },
      { url: DOWNLOAD, authorization: null },
    ])

    const doc = JSON.parse(await readFile(join(root, 'pwpack.json'), 'utf8'))
    expect(doc.packs.at(-1)).toEqual({ id: ID, version: '2.1.0', hash: archive.hash })
    expect(doc.requires.at(-1)).toEqual({ id: ID, range: '^2.0.0' })
    const cached = await readFolder(join(root, '.pwf', 'packs', '@pwpack', 'acme', 'cards@2.1.0'))
    expect(hashPack(cached)).toBe(archive.hash)
    expect(await main(['validate'], capture(root).io)).toBe(0)

    // No version: the one the workspace has.
    const again = capture(root, env)
    expect(await add(args([ID]), again.io, { fetch: mockedFetch(api, answer, archive.bytes, []) }), again.text()).toBe(0)
    expect(again.out[0]).toBe(`Added ${ID}@2.1.0`)
  })

  it('refuses a pack PhiWebs skips with the reason and what to do', async () => {
    const { api, env, root } = await signedIn()
    const before = await readFile(join(root, 'pwpack.json'), 'utf8')
    const run = async (answer: Answer, ref = ID): Promise<string> => {
      const c = capture(root, env)
      expect(await add(args([ref]), c.io, { fetch: mockedFetch(api, answer, new Uint8Array(), []) })).toBe(1)
      return c.err.join('\n')
    }
    const notLicensed = await run({ skipped: [{ id: ID, version: '2.1.0', reason: 'source_not_licensed' }] })
    expect(notLicensed).toContain(`PACK_NOT_LICENSED: ${ID}@2.1.0 cannot be used locally: the workspace's licence for it does not include its source`)
    expect(notLicensed).toContain('fix: Use it in the PhiWebs studio')
    const patterns = await run({ skipped: [{ id: ID, version: '2.1.0', reason: 'pattern_pack' }] })
    expect(patterns).toContain('PACK_PATTERNS_ONLY')
    expect(patterns).toContain('studio')
    for (const [reason, code] of [
      ['source_not_stored', 'PACK_SOURCE_NOT_STORED'],
      ['listing_missing', 'PACK_LISTING_MISSING'],
      ['hash_changed', 'PACK_SOURCE_CHANGED'],
    ] as const) {
      expect(await run({ skipped: [{ id: ID, version: '2.1.0', reason }] })).toContain(`${code}: `)
    }
    const missing = await run({})
    expect(missing).toContain(`PACK_NOT_INSTALLED: ${ID} is not installed in your PhiWebs workspace`)
    expect(missing).toContain('fix: Install it in your PhiWebs workspace from the marketplace first')
    const otherVersion = await run((await offered('2.1.0')).answer, `${ID}@3.0.0`)
    expect(otherVersion).toContain(`your PhiWebs workspace has ${ID} at 2.1.0, not 3.0.0`)
    expect(otherVersion).not.toContain('storage.example.com')
    expect(await readFile(join(root, 'pwpack.json'), 'utf8')).toBe(before)
  })

  it('installs nothing when the bytes do not match the sha256', async () => {
    const { api, env, root } = await signedIn()
    const { answer } = await offered()
    const other = await cardsArchive('2.2.0')
    const before = await readFile(join(root, 'pwpack.json'), 'utf8')
    const c = capture(root, env)
    expect(await add(args([ID]), c.io, { fetch: mockedFetch(api, answer, other.bytes, []) })).toBe(1)
    expect(c.err[0]).toMatch(new RegExp(`^PACK_HASH_MISMATCH: the downloaded ${ID}@2\\.1\\.0 has sha256 [0-9a-f]{64}, not the [0-9a-f]{64} PhiWebs gave$`))
    expect(c.text()).not.toContain('very-secret')
    expect(await readFile(join(root, 'pwpack.json'), 'utf8')).toBe(before)
  })

  it('needs pwf login for a pack id, and takes an existing path as a path', async () => {
    const home = await tempDir()
    const env = { APPDATA: home, XDG_CONFIG_HOME: home, PWF_PHIWEBS_URL: 'http://127.0.0.1:9' }
    const cwd = await tempDir()
    expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
    const root = join(cwd, 'demo')
    const c = capture(root, env)
    expect(await main(['add', ID], c.io)).toBe(1)
    expect(c.err).toEqual([
      `NOT_SIGNED_IN: ${ID} is a PhiWebs pack id, and pwf is not signed in to PhiWebs`,
      'fix: Run `pwf login` to sign in to PhiWebs, then add the pack again.',
    ])
    // Not an id and not a path: the local error, as before.
    const nothing = capture(root, env)
    expect(await main(['add', 'cards.pwpack'], nothing.io)).toBe(1)
    expect(nothing.err.join('\n')).toContain('no such file or folder')

    expect(parsePackRef(ID)).toEqual({ id: ID })
    expect(parsePackRef(`${ID}@1.2.0-rc.1`)).toEqual({ id: ID, version: '1.2.0-rc.1' })
    expect(parsePackRef('@pwpack/cards')).toBeNull()
    expect(parsePackRef('./cards.pwpack')).toBeNull()
    expect(parsePackRef('@pwpack/Acme/cards')).toBeNull()
  })
})

describe('pwf_add_pack with a PhiWebs pack id', () => {
  async function connect(phiwebs?: Parameters<typeof createPwfMcpServer>[0]['phiwebs']): Promise<Client> {
    const server = createPwfMcpServer({ version: '0.0.0-test', ...(phiwebs ? { phiwebs } : {}) })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    await server.connect(serverSide)
    const client = new Client({ name: 'test', version: '0.0.0' })
    await client.connect(clientSide)
    closers.push(client)
    return client
  }
  type ToolResult = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> }
  const textOf = (r: ToolResult): string => r.content.map((c) => c.text).join('\n')

  it('installs it signed in, refuses a skipped one with its fix, and asks for pwf login without a session', async () => {
    const { api, env, root } = await signedIn()
    const { archive, answer } = await offered()
    const client = await connect({ env, fetch: mockedFetch(api, answer, archive.bytes, []) })
    const added = (await client.callTool({ name: 'pwf_add_pack', arguments: { projectDir: root, pack: ID } })) as ToolResult
    expect(added.isError, textOf(added)).toBeFalsy()
    expect(added.structuredContent).toMatchObject({ id: ID, version: '2.1.0', hash: archive.hash, range: '^2.0.0' })
    expect(JSON.stringify(added)).not.toContain('very-secret')

    const skipping = await connect({ env, fetch: mockedFetch(api, { skipped: [{ id: ID, version: '2.1.0', reason: 'source_not_licensed' }] }, new Uint8Array(), []) })
    const refused = (await skipping.callTool({ name: 'pwf_add_pack', arguments: { projectDir: root, pack: ID } })) as ToolResult
    expect(refused.isError).toBe(true)
    expect(refused.structuredContent).toMatchObject({ error: { code: 'PACK_NOT_LICENSED' } })
    expect(textOf(refused)).toContain('Fix: Use it in the PhiWebs studio')

    // A server made without PhiWebs options reads no session.
    const bare = await connect()
    const signedOut = (await bare.callTool({ name: 'pwf_add_pack', arguments: { projectDir: root, pack: ID } })) as ToolResult
    expect(signedOut.structuredContent).toMatchObject({ error: { code: 'NOT_SIGNED_IN' } })
    expect(textOf(signedOut)).toContain('pwf login')
  })
})
