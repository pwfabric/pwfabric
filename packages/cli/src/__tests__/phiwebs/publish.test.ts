/**
 * PhiWebs from the CLI against a fake API and a fake studio on 127.0.0.1: a
 * login for two resources and a refresh per resource, `pwf publish` for an
 * app (new, remembered, refused) and for a pack (the marketplace), and the
 * PhiWebs tools of `pwf mcp` (signed out, signed in, forwarded, local only).
 * No network beyond 127.0.0.1.
 */
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../index.js'
import { runLogin as loginBody, runWhoami as whoamiBody, type AccountDeps } from '../../commands/login.js'
import { REMEMBERED_PROJECT_FILE, runPublish as publishBody } from '../../commands/publish.js'
import { createApp } from '../../commands/create.js'
import { createPack } from '../../commands/lib/scaffold.js'
import { guard } from '../../commands/lib/flags.js'
import type { CommandIO, ParsedArgs } from '../../commands/types.js'
import { CREDENTIALS_FILE } from '../../phiwebs/config.js'
import { LOGIN_SCOPES } from '../../phiwebs/oauth.js'
import { readSession, readStudioSession } from '../../phiwebs/session.js'
import { createPwfMcpServer, SERVER_INSTRUCTIONS, SIGN_IN_TOOL, TOOLS } from '../../mcp/index.js'
import { PUBLISH_HINT } from '../../mcp/tools.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from '../commands/helpers.js'
import { FAKE_DEFAULT_STUDIO, startFakeServer, type FakeServer, type FakeServerOptions } from './fake-server.js'
import { FAKE_STUDIO_TOOLS, startFakeStudio, type FakeStudio } from './fake-studio.js'

const closers: { close(): Promise<void> }[] = []
afterEach(async () => {
  while (closers.length) await (closers.pop() as { close(): Promise<void> }).close()
})

const browser: AccountDeps['openBrowser'] = async (url) => {
  await fetch(url)
}

interface World {
  api: FakeServer
  studio: FakeStudio
  env: Record<string, string>
  dir: string
}

/** A fake API and a fake studio that trusts the API's studio tokens; env points pwf at both. */
async function world(options: FakeServerOptions = {}, studioInEnv = true, split = false): Promise<World> {
  const api = await startFakeServer(options)
  closers.push(api)
  const studio = await startFakeStudio((t) => api.audOf(t) === studio.url, { split })
  closers.push(studio)
  api.studio = studio.url
  const home = await tempDir()
  const env: Record<string, string> = { APPDATA: home, XDG_CONFIG_HOME: home, PWF_PHIWEBS_URL: api.url }
  if (studioInEnv) env['PWF_PHIWEBS_STUDIO_URL'] = studio.url
  return { api, studio, env, dir: join(home, 'pwfabric') }
}

const args = (positionals: string[] = [], flags: Record<string, string | boolean> = {}): ParsedArgs => ({ positionals, flags })
const login = (a: ParsedArgs, io: CommandIO, d: AccountDeps = { openBrowser: browser }) => guard('login', io, () => loginBody(a, io, d))
const whoami = (a: ParsedArgs, io: CommandIO, d?: AccountDeps) => guard('whoami', io, () => whoamiBody(a, io, d))
const publish = (a: ParsedArgs, io: CommandIO, d?: { now?: () => number }) => guard('publish', io, () => publishBody(a, io, d))

async function signedIn(options: FakeServerOptions = {}): Promise<World> {
  const w = await world(options)
  const c = capture(w.dir, w.env)
  expect(await login(args(), c.io), c.text()).toBe(0)
  return w
}

async function appFolder(): Promise<string> {
  const dir = join(await tempDir(), 'shop')
  await createApp({ name: 'shop', dir, foundation: FIXTURE_FOUNDATION })
  return dir
}

async function credentials(dir: string, server: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers[server]
}

describe('pwf login for the API and the studio', () => {
  it('asks for both resources, keeps a token for each, and whoami names the studio', async () => {
    const w = await world()
    const c = capture(w.dir, w.env)
    let opened = ''
    expect(await login(args(), c.io, { openBrowser: async (u) => ((opened = u), void (await fetch(u))) }), c.text()).toBe(0)
    const auth = new URL(opened)
    expect(auth.searchParams.getAll('resource')).toEqual([w.api.url, w.studio.url])
    expect(auth.searchParams.get('scope')).toBe(LOGIN_SCOPES.join(' '))
    // marketplace:read: the workspace tools the studio lists for pwf mcp (list_marketplace, get_listing, list_pack_sources).
    for (const s of ['studio:read', 'studio:build', 'studio:publish', 'marketplace:read', 'marketplace:publish', 'world:read']) expect(LOGIN_SCOPES).toContain(s)
    // The code is redeemed for the API, then the same grant refreshed for the studio.
    expect(w.api.tokenRequests.map((r) => [r['grant_type'], r['resource']])).toEqual([
      ['authorization_code', w.api.url],
      ['refresh_token', w.studio.url],
    ])
    const saved = (await credentials(w.dir, w.api.url)) as { accessToken: string; studio: { resource: string; accessToken: string } }
    expect(w.api.audOf(saved.accessToken)).toBe(w.api.url)
    expect(saved.studio.resource).toBe(w.studio.url)
    expect(w.api.audOf(saved.studio.accessToken)).toBe(w.studio.url)
    expect(c.out.at(-1)).toBe(`  studio     ${w.studio.url}`)

    const who = capture(w.dir, w.env)
    expect(await whoami(args(), who.io)).toBe(0)
    expect(who.out.at(-1)).toBe(`  studio     ${w.studio.url}`)
  })

  it('takes the studio the API names, else the default; --studio wins', async () => {
    const named = await world({ advertiseStudio: 'http://127.0.0.1:1/' }, false)
    named.api.studio = 'http://127.0.0.1:1'
    let opened = ''
    expect(await login(args(), capture(named.dir, named.env).io, { openBrowser: async (u) => ((opened = u), void (await fetch(u))) })).toBe(0)
    expect(new URL(opened).searchParams.getAll('resource')).toEqual([named.api.url, 'http://127.0.0.1:1'])

    const plain = await world({}, false)
    plain.api.studio = undefined
    expect(await login(args(), capture(plain.dir, plain.env).io, { openBrowser: async (u) => ((opened = u), void (await fetch(u))) })).toBe(0)
    expect(new URL(opened).searchParams.getAll('resource')).toEqual([plain.api.url, FAKE_DEFAULT_STUDIO])

    const flag = await world({}, false)
    expect(await login(args([], { studio: flag.studio.url }), capture(flag.dir, flag.env).io, { openBrowser: async (u) => ((opened = u), void (await fetch(u))) })).toBe(0)
    expect(new URL(opened).searchParams.getAll('resource')).toEqual([flag.api.url, flag.studio.url])
  })

  it('refreshes each resource on its own, with the shared refresh token', async () => {
    const w = await signedIn({ expiresIn: 300 })
    const before = (await credentials(w.dir, w.api.url)) as { accessToken: string; refreshToken: string }
    const later = () => Date.now() + 10 * 60_000
    const studio = await readStudioSession({ env: w.env, now: later })
    expect(w.api.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', resource: w.studio.url, refresh_token: before.refreshToken })
    expect(w.api.audOf(studio?.accessToken as string)).toBe(w.studio.url)
    const mid = (await credentials(w.dir, w.api.url)) as { accessToken: string; refreshToken: string }
    // The API's token was left alone; the refresh token moved on.
    expect(mid.accessToken).toBe(before.accessToken)
    expect(mid.refreshToken).not.toBe(before.refreshToken)

    const api = await readSession({ env: w.env, now: later })
    const last = w.api.tokenRequests.at(-1) as Record<string, string>
    expect(last).toMatchObject({ grant_type: 'refresh_token', refresh_token: mid.refreshToken })
    expect(last['resource']).toBeUndefined()
    expect(w.api.audOf(api?.accessToken as string)).toBe(w.api.url)
  })

  it('a session from an earlier pwf has no studio token: the message says to sign in again', async () => {
    const w = await signedIn()
    const file = join(w.dir, CREDENTIALS_FILE)
    const all = JSON.parse(await readFile(file, 'utf8'))
    delete all.servers[w.api.url].studio
    await writeFile(file, JSON.stringify(all))
    const who = capture(w.dir, w.env)
    expect(await whoami(args(), who.io)).toBe(0)
    expect(who.out.at(-1)).toContain('run `pwf login` again')
    const p = capture(w.dir, w.env)
    expect(await publish(args([await appFolder()]), p.io)).toBe(1)
    expect(p.err.join('\n')).toContain('STUDIO_NOT_SIGNED_IN')
    expect(p.err.join('\n')).toContain('signing in again adds it')
  })

  it('a studio that gives no token leaves the API session and says what will not work', async () => {
    const w = await world()
    w.api.studio = 'https://elsewhere.example.com'
    w.env['PWF_PHIWEBS_STUDIO_URL'] = 'https://elsewhere.example.com'
    const c = capture(w.dir, w.env)
    // The authorize accepts it; the fake API then refuses the refresh for it.
    expect(await login(args(), c.io, {
      openBrowser: async (u) => {
        await fetch(u)
        w.api.refuseRefresh = true
      },
    })).toBe(0)
    expect(c.err.join('\n')).toContain('`pwf publish` and the PhiWebs tools of `pwf mcp` will not work')
    expect(((await credentials(w.dir, w.api.url)) as { studio?: unknown }).studio).toBeUndefined()
  })
})

describe('a studio whose web origin is not its resource (PhiWebs: /s/* on studio.phiwebs.com, /mcp on mcp.phiwebs.com)', () => {
  /** A split studio the API names in its metadata; nothing in the environment. */
  async function splitWorld(advertiseUrl = true): Promise<World> {
    const api = await startFakeServer()
    closers.push(api)
    const studio = await startFakeStudio((t) => api.audOf(t) === studio.url, { split: true })
    closers.push(studio)
    api.studio = studio.url
    const home = await tempDir()
    const env: Record<string, string> = { APPDATA: home, XDG_CONFIG_HOME: home, PWF_PHIWEBS_URL: api.url, PWF_PHIWEBS_STUDIO_URL: studio.url }
    if (advertiseUrl) env['PWF_PHIWEBS_STUDIO_WEB'] = studio.webUrl
    return { api, studio, env, dir: join(home, 'pwfabric') }
  }

  it('the API names both: the token is for the resource, every /s/* call goes to the origin, /mcp to the resource', async () => {
    const api = await startFakeServer()
    closers.push(api)
    const studio = await startFakeStudio((t) => api.audOf(t) === studio.url, { split: true })
    closers.push(studio)
    api.studio = studio.url
    api.advertise = { studio_resource: studio.url, studio_url: studio.webUrl }
    const home = await tempDir()
    const w: World = { api, studio, env: { APPDATA: home, XDG_CONFIG_HOME: home, PWF_PHIWEBS_URL: api.url }, dir: join(home, 'pwfabric') }
    expect(studio.webUrl).not.toBe(studio.url)

    const c = capture(w.dir, w.env)
    let opened = ''
    expect(await login(args(), c.io, { openBrowser: async (u) => ((opened = u), void (await fetch(u))) }), c.text()).toBe(0)
    expect(new URL(opened).searchParams.getAll('resource')).toEqual([api.url, studio.url])
    expect(c.out.at(-1)).toBe(`  studio     ${studio.webUrl} (tokens for ${studio.url})`)
    const saved = (await credentials(w.dir, api.url)) as { studio: { resource: string; url: string; accessToken: string } }
    expect(saved.studio).toMatchObject({ resource: studio.url, url: studio.webUrl })
    expect(api.audOf(saved.studio.accessToken)).toBe(studio.url)

    const app = await appFolder()
    const p = capture(app, w.env)
    expect(await publish(args(), p.io), p.text()).toBe(0)
    expect(studio.requests.map((r) => `${r.host} ${r.method} ${r.path}`)).toEqual([
      'web POST /s/projects/import?name=shop',
      'web POST /s/p/p-1/publish',
      'web POST /s/p/p-1/open',
      'web POST /s/p/p-1/publish',
    ])
    expect(p.out).toContain('  url      https://p-1.apps.example.com/')
    expect(p.out.at(-1)).toBe(`Keep building it with the studio's AI at ${studio.webUrl}, or edit here and run \`pwf publish\` again.`)

    // pwf mcp reaches the studio's tools on the resource.
    const client = await mcpClient(w)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('list_projects')
    expect(studio.requests.at(-1)).toMatchObject({ host: 'resource', method: 'POST', path: '/mcp' })
  })

  it('--studio-url / PWF_PHIWEBS_STUDIO_WEB name the origin when the API does not; without either the resource host is the origin', async () => {
    // Named at login (env): saved with the session and used by publish.
    const named = await splitWorld(true)
    expect(await login(args(), capture(named.dir, named.env).io), 'login').toBe(0)
    const app = await appFolder()
    const env = { ...named.env }
    delete env['PWF_PHIWEBS_STUDIO_WEB']
    expect(await publish(args([app]), capture(app, env).io)).toBe(0)
    expect(named.studio.requests.filter((r) => r.path.startsWith('/s/')).every((r) => r.host === 'web')).toBe(true)

    // Not named anywhere: the resource itself; this split studio then refuses /s/* (404) — what the bug looked like.
    const unnamed = await splitWorld(false)
    expect(await login(args(), capture(unnamed.dir, unnamed.env).io)).toBe(0)
    const refused = capture(app, unnamed.env)
    expect(await publish(args([app]), refused.io)).toBe(1)
    expect(unnamed.studio.requests.at(-1)).toMatchObject({ host: 'resource', path: '/s/p/p-1/import' })
    // ...and --studio-url on publish puts it right without a new login.
    const fixed = capture(app, unnamed.env)
    expect(await publish(args([app], { new: true, 'studio-url': unnamed.studio.webUrl }), fixed.io), fixed.text()).toBe(0)
    expect(unnamed.studio.requests.at(-1)).toMatchObject({ host: 'web', path: '/s/p/p-1/publish' })
  })

  it("PhiWebs' own resource defaults to PhiWebs' own studio origin", async () => {
    const w = await world({}, false)
    w.api.studio = undefined
    expect(await login(args(), capture(w.dir, w.env).io)).toBe(0)
    const saved = (await credentials(w.dir, w.api.url)) as { studio: { resource: string; url: string } }
    expect(saved.studio).toEqual(expect.objectContaining({ resource: 'https://mcp.phiwebs.com', url: 'https://studio.phiwebs.com' }))
    // A session saved before the origin was kept reads the same default.
    const file = join(w.dir, CREDENTIALS_FILE)
    const all = JSON.parse(await readFile(file, 'utf8'))
    delete all.servers[w.api.url].studio.url
    await writeFile(file, JSON.stringify(all))
    expect((await readStudioSession({ env: w.env }))?.url).toBe('https://studio.phiwebs.com')
  })
})

describe('pwf publish an app', () => {
  it('imports a new project, wakes it, publishes, prints the address and remembers the project', async () => {
    const w = await signedIn()
    const app = await appFolder()
    const c = capture(app, w.env)
    expect(await publish(args(), c.io), c.text()).toBe(0)
    expect(c.out).toContain('Imported as the new project p-1')
    expect(c.out).toContain('Published p-1@abc1234')
    expect(c.out).toContain('  url      https://p-1.apps.example.com/')
    expect(w.studio.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /s/projects/import?name=shop',
      'POST /s/p/p-1/publish',
      'POST /s/p/p-1/open',
      'POST /s/p/p-1/publish',
    ])
    expect(w.studio.requests[0]?.contentType).toBe('application/octet-stream')
    // The body is the folder's deterministic archive, byte for byte.
    const archive = new Uint8Array(await readFile(join(app, '.pwf', 'publish', 'shop-0.1.0.pwpack')))
    expect(Buffer.from(w.studio.imports[0] as Uint8Array).equals(Buffer.from(archive))).toBe(true)
    expect(JSON.parse(await readFile(join(app, ...REMEMBERED_PROJECT_FILE.split('/')), 'utf8'))).toEqual({ projectId: 'p-1' })
    expect(existsSync(join(app, 'shop-0.1.0.pwpack'))).toBe(false)

    // Again: into the remembered project.
    const again = capture(app, w.env)
    expect(await publish(args(), again.io), again.text()).toBe(0)
    expect(again.out).toContain('Imported into project p-1')
    expect(w.studio.requests.at(-2)?.path).toBe('/s/p/p-1/import')

    // --new: another project, now remembered.
    const fresh = capture(app, w.env)
    expect(await publish(args([], { new: true }), fresh.io)).toBe(0)
    expect(fresh.out).toContain('Imported as the new project p-2')
    expect(JSON.parse(await readFile(join(app, ...REMEMBERED_PROJECT_FILE.split('/')), 'utf8'))).toEqual({ projectId: 'p-2' })

    // --project names one.
    const named = capture(app, w.env)
    expect(await publish(args([], { project: 'p-1' }), named.io)).toBe(0)
    expect(named.out).toContain('Imported into project p-1')
  })

  it('a publish the studio holds for approval prints the approve address, not "Published", and exits 0', async () => {
    const w = await signedIn()
    const app = await appFolder()
    w.studio.publishAnswer = {
      status: 202,
      body: {
        status: 'awaiting_approval',
        requestId: 'r-1',
        approveUrl: 'https://studio.example.com/p/p-1?approve=r-1',
        version: 'abc1234',
        url: 'https://p-1.apps.example.com/',
        action: 'publish',
        expiresAt: '2026-01-01T00:30:00.000Z',
      },
    }
    const c = capture(app, w.env)
    expect(await publish(args(), c.io), c.text()).toBe(0)
    expect(c.out.some((l) => /^Published/.test(l)), c.text()).toBe(false)
    expect(c.out).toContain('Waiting for approval: p-1@abc1234 is not online yet')
    expect(c.out).toContain('  approve  https://studio.example.com/p/p-1?approve=r-1')
    expect(c.out).toContain('  url      https://p-1.apps.example.com/ (once approved)')
    expect(c.out.at(-1)).toContain('approve this version in the studio before 2026-01-01T00:30:00.000Z')
    expect(c.err).toEqual([])
    // The project is still remembered: the next publish goes to it.
    expect(JSON.parse(await readFile(join(app, ...REMEMBERED_PROJECT_FILE.split('/')), 'utf8'))).toEqual({ projectId: 'p-1' })

    // A 202 alone (no status) is not a publish either; without url or version the lines say less.
    w.studio.publishAnswer = { status: 202, body: { approveUrl: 'https://studio.example.com/p/p-1?approve=r-2' } }
    const bare = capture(app, w.env)
    expect(await publish(args(), bare.io), bare.text()).toBe(0)
    expect(bare.out.some((l) => /^Published/.test(l))).toBe(false)
    expect(bare.out).toContain('Waiting for approval: p-1 is not online yet')
    expect(bare.out).toContain('  approve  https://studio.example.com/p/p-1?approve=r-2')
    expect(bare.out.some((l) => l.startsWith('  url '))).toBe(false)
  })

  it('an approval answer without a usable approve address is a failure, never "Published"', async () => {
    const w = await signedIn()
    const app = await appFolder()
    for (const approveUrl of [undefined, 'javascript:alert(1)', 'not a url']) {
      w.studio.publishAnswer = { status: 202, body: { status: 'awaiting_approval', version: 'abc1234', url: 'https://p-1.apps.example.com/', ...(approveUrl ? { approveUrl } : {}) } }
      const c = capture(app, w.env)
      expect(await publish(args(), c.io), c.text()).toBe(1)
      expect(c.out.some((l) => /^Published/.test(l))).toBe(false)
      expect(c.err.join('\n')).toContain('PUBLISH_FAILED: the studio says the publish waits for approval but gave no address to approve it')
    }
  })

  it('shows findings and refusals with their codes and fixes', async () => {
    const w = await signedIn()
    const app = await appFolder()

    w.studio.importRefusal = { status: 422, body: { error: 'packs not installable: @pwpack/acme/cards', code: 'PACK_NOT_AVAILABLE', packs: ['@pwpack/acme/cards'] } }
    const refused = capture(app, w.env)
    expect(await publish(args(), refused.io)).toBe(1)
    expect(refused.err).toContain('PACK_NOT_AVAILABLE: packs not installable: @pwpack/acme/cards')
    expect(refused.err.find((l) => l.startsWith('fix: '))).toContain('Install @pwpack/acme/cards in your PhiWebs workspace')
    expect(existsSync(join(app, ...REMEMBERED_PROJECT_FILE.split('/')))).toBe(false)

    w.studio.findings = [
      { severity: 'warning', code: 'IMAGE_LARGE', path: 'media/a.png', message: 'large image' },
      { severity: 'error', code: 'BLOCK_UNKNOWN', path: 'app/surfaces/home.receipt.json', message: 'no such block' },
    ]
    const invalid = capture(app, w.env)
    expect(await publish(args(), invalid.io)).toBe(1)
    expect(invalid.out).toContain('  IMAGE_LARGE media/a.png: large image')
    expect(invalid.err).toContain('  BLOCK_UNKNOWN app/surfaces/home.receipt.json: no such block')
    expect(invalid.err.join('\n')).toContain('PROJECT_INVALID')
    expect(w.studio.requests.some((r) => r.path.endsWith('/publish'))).toBe(false)
    w.studio.findings = []

    // A remembered project the studio no longer has.
    await writeFile(join(app, ...REMEMBERED_PROJECT_FILE.split('/')), JSON.stringify({ projectId: 'gone' }))
    const gone = capture(app, w.env)
    expect(await publish(args(), gone.io)).toBe(1)
    expect(gone.err.join('\n')).toContain('NOT_FOUND: no such project')
    expect(gone.err.join('\n')).toContain('pwf publish --new')
  })

  it('needs a session, and refuses a malformed invocation with exit 2', async () => {
    const w = await world()
    const app = await appFolder()
    const out = capture(app, w.env)
    expect(await publish(args(), out.io)).toBe(1)
    expect(out.err.join('\n')).toContain('NOT_SIGNED_IN')
    expect(out.err.join('\n')).toContain('Run `pwf login`')
    expect(w.studio.requests).toHaveLength(0)

    expect(await main(['publish', app, '--new', '--project', 'p-1'], capture(app, w.env).io)).toBe(2)
    expect(await main(['publish', app, '--project', '../x'], capture(app, w.env).io)).toBe(2)
    expect(await main(['publish', app, 'extra'], capture(app, w.env).io)).toBe(2)
  })

  it('a studio that turns the session down says to sign in again', async () => {
    const w = await signedIn()
    const app = await appFolder()
    const file = join(w.dir, CREDENTIALS_FILE)
    const all = JSON.parse(await readFile(file, 'utf8'))
    all.servers[w.api.url].studio.accessToken = 'revoked'
    await writeFile(file, JSON.stringify(all))
    const c = capture(app, w.env)
    expect(await publish(args(), c.io)).toBe(1)
    expect(c.err).toContain('SESSION_REFUSED: the studio no longer accepts the saved session')
    expect(c.err).toContain('fix: Run `pwf login` to sign in again.')
  })
})

const PUBLISHER = '/api/marketplace/publishers/me'
const ARTIFACTS = '/api/marketplace/artifacts/publish'

async function packFolder(): Promise<string> {
  const dir = join(await tempDir(), 'cards')
  await createPack({ name: 'cards', id: '@pwpack/acme/cards', dir })
  return dir
}

describe('pwf publish a pack', () => {
  it('sends the .pwpack and its manifest to the marketplace as the publisher, id unchanged', async () => {
    const w = await signedIn()
    w.api.marketplace[PUBLISHER] = { status: 200, body: { data: { id: 'pub-1', handle: 'acme', status: 'approved' } } }
    w.api.marketplace[ARTIFACTS] = {
      status: 201,
      body: { data: { listingId: 'l-1', versionId: 'v-1', version: '0.1.0', state: 'staged', listingStatus: 'pending', reviewFindings: [{ severity: 'warning', code: 'NO_README_EXAMPLE', message: 'no example' }] } },
    }
    const pack = await packFolder()
    const c = capture(pack, w.env)
    expect(await publish(args(), c.io), c.text()).toBe(0)
    expect(c.out).toContain('Sent @pwpack/acme/cards@0.1.0 to the PhiWebs marketplace as acme')
    expect(c.out).toContain('  listing  l-1 (pending)')
    expect(c.out).toContain('  NO_README_EXAMPLE: no example')
    const upload = w.api.marketplaceUploads[0]
    expect(upload?.fields['scope']).toBe('marketplace')
    const manifest = JSON.parse(upload?.fields['manifest'] as string)
    expect(manifest.id).toBe('@pwpack/acme/cards')
    expect(manifest.version).toBe('0.1.0')
    expect(manifest.contentHash).toMatch(/^sha256:/)
    expect(upload?.file?.name).toBe('cards-0.1.0.pwpack')
    expect(upload?.file?.bytes).toBe((await readFile(join(pack, '.pwf', 'publish', 'cards-0.1.0.pwpack'))).length)
    // No studio involved.
    expect(w.studio.requests).toHaveLength(0)
  })

  it('says how to register a publisher, and waits for an approved one', async () => {
    const w = await signedIn()
    const pack = await packFolder()
    const none = capture(pack, w.env)
    expect(await publish(args(), none.io)).toBe(1)
    expect(none.err[0]).toBe('PUBLISHER_REQUIRED: this workspace is not registered as a publisher')
    expect(none.err[1]).toContain('register_publisher')
    expect(w.api.marketplaceUploads).toHaveLength(0)

    w.api.marketplace[PUBLISHER] = { status: 200, body: { data: { id: 'pub-1', handle: 'acme', status: 'pending' } } }
    const pending = capture(pack, w.env)
    expect(await publish(args(), pending.io)).toBe(1)
    expect(pending.err[0]).toBe('PUBLISHER_NOT_APPROVED: the workspace publisher is pending, not approved')

    w.api.marketplace[PUBLISHER] = { status: 200, body: { data: { id: 'pub-1', handle: 'acme', status: 'approved' } } }
    w.api.marketplace[ARTIFACTS] = { status: 409, body: { error: { code: 'VERSION_EXISTS', message: 'Version 0.1.0 is already published' } } }
    const exists = capture(pack, w.env)
    expect(await publish(args(), exists.io)).toBe(1)
    expect(exists.err[0]).toBe('VERSION_EXISTS: Version 0.1.0 is already published')
    expect(exists.err[1]).toContain('raise "version" in pwpack.json')

    expect(await main(['publish', pack, '--new'], capture(pack, w.env).io)).toBe(2)
  })
})

interface Answer {
  isError?: boolean
  content: { type: string; text: string }[]
  structuredContent?: Record<string, unknown>
}

async function mcpClient(w: World, options: { localOnly?: boolean; cacheMs?: number } = {}): Promise<Client> {
  const server = createPwfMcpServer({
    version: '0.0.0-test',
    phiwebs: { env: w.env, ...(options.cacheMs !== undefined ? { cacheMs: options.cacheMs } : {}) },
    ...(options.localOnly ? { localOnly: true } : {}),
  })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(b)
  const client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(a)
  closers.push(client)
  return client
}

const call = async (c: Client, name: string, a: Record<string, unknown> = {}): Promise<Answer> => (await c.callTool({ name, arguments: a })) as unknown as Answer
const text = (a: Answer): string => a.content.map((x) => x.text).join('\n')
const LOCAL = [...TOOLS.map((t) => t.name), 'pwf_publish_pack']

describe('pwf mcp and PhiWebs', () => {
  it('signed out: the local tools and phiwebs_sign_in, which explains pwf login and what PhiWebs adds', async () => {
    const w = await world()
    const client = await mcpClient(w)
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS)
    expect(SERVER_INSTRUCTIONS).toContain('phiwebs_sign_in')
    expect(SERVER_INSTRUCTIONS).toContain('pwf publish')
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual([...LOCAL, SIGN_IN_TOOL])
    const answer = await call(client, SIGN_IN_TOOL)
    expect(answer.isError).toBeUndefined()
    expect(text(answer)).toContain('`pwf login`')
    expect(text(answer)).toContain("the studio's AI")
    expect(text(answer)).toContain('publish it at a public address, hosted by PhiWebs')
    const pack = await call(client, 'pwf_publish_pack', { projectDir: await packFolder() })
    expect(pack.isError).toBe(true)
    expect(text(pack)).toContain('NOT_SIGNED_IN')
    expect(w.studio.rpc).toHaveLength(0)
  })

  it('signed in: the studio tools are listed (checked) and calls are forwarded with the studio token', async () => {
    const w = await signedIn()
    const client = await mcpClient(w)
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual([...LOCAL, 'list_projects', 'start_turn', 'odd_schema'])
    const listProjects = tools.find((t) => t.name === 'list_projects')
    expect(listProjects?.description).toBe('PhiWebs: Lists the apps (projects) in this workspace.')
    expect(listProjects?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: true })
    const odd = tools.find((t) => t.name === 'odd_schema')
    expect(odd?.inputSchema).toEqual({ type: 'object' })
    expect(odd?.annotations).toEqual({ destructiveHint: true, openWorldHint: true })
    // The local pwf_build is the local one, not the studio's.
    expect(tools.find((t) => t.name === 'pwf_build')?.description).not.toContain('shadows')
    // Instructions never change.
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS)

    const answer = await call(client, 'list_projects')
    expect(text(answer)).toContain('Shop (id p-1)')
    expect(answer.content).toHaveLength(1)
    expect(answer.structuredContent).toEqual({ projects: [{ id: 'p-1' }] })
    expect(w.studio.rpc.filter((r) => r.method === 'tools/list')).toHaveLength(1)
    expect(w.studio.rpc.at(-1)).toEqual({ method: 'tools/call', params: { name: 'list_projects', arguments: {} } })

    const busy = await call(client, 'start_turn', { projectId: 'busy', message: 'go' })
    expect(busy.isError).toBe(true)
    expect(text(busy)).toContain('PROJECT_BUSY')
    const failed = await call(client, 'odd_schema')
    expect(failed.isError).toBe(true)
    expect(text(failed)).toContain('UPSTREAM_UNAVAILABLE: the studio failed')

    await expect(call(client, 'no_such_tool')).rejects.toThrow(/not found/)
    // The list is reused within the cache time.
    await client.listTools()
    expect(w.studio.rpc.filter((r) => r.method === 'tools/list').length).toBeLessThanOrEqual(2)

    // pwf_pack on an app points to pwf publish.
    const packed = await call(client, 'pwf_pack', { projectDir: await appFolder() })
    expect(text(packed)).toContain(PUBLISH_HINT.slice(1))
  })

  it("signed in, the studio's publish tool is forwarded as it answers: awaiting approval, with the approve address", async () => {
    const w = await signedIn()
    w.studio.tools = [...FAKE_STUDIO_TOOLS, { name: 'publish', description: 'Asks to put the project online.', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } } } }]
    const client = await mcpClient(w)
    const answer = await call(client, 'publish', { projectId: 'p-1' })
    expect(answer.isError).toBeUndefined()
    expect(answer.structuredContent).toMatchObject({ status: 'awaiting_approval', approveUrl: `${w.studio.webUrl}/p/p-1?approve=r-1`, version: 'abc1234' })
    expect(text(answer)).toContain('Waiting for approval')
    expect(text(answer)).not.toMatch(/^Published/m)
  })

  it('signed in, pwf_publish_pack publishes a pack folder as the publisher', async () => {
    const w = await signedIn()
    w.api.marketplace[PUBLISHER] = { status: 200, body: { data: { id: 'pub-1', handle: 'acme', status: 'approved' } } }
    w.api.marketplace[ARTIFACTS] = { status: 201, body: { data: { listingId: 'l-9', version: '0.1.0', state: 'staged', listingStatus: 'pending' } } }
    const client = await mcpClient(w, { localOnly: true })
    const answer = await call(client, 'pwf_publish_pack', { projectDir: await packFolder() })
    expect(answer.isError, text(answer)).toBeUndefined()
    expect(text(answer)).toContain('Sent @pwpack/acme/cards@0.1.0 to the PhiWebs marketplace as acme')
    expect(answer.structuredContent).toMatchObject({ id: '@pwpack/acme/cards', listingId: 'l-9', listingStatus: 'pending' })

    const onApp = await call(client, 'pwf_publish_pack', { projectDir: await appFolder() })
    expect(onApp.isError).toBe(true)
    expect(text(onApp)).toContain('NOT_A_PACK')
  })

  it('--local-only serves the local tools only, signed in or not', async () => {
    const w = await signedIn()
    const client = await mcpClient(w, { localOnly: true })
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toEqual(LOCAL)
    await expect(call(client, 'list_projects')).rejects.toThrow(/not found/)
    await expect(call(client, SIGN_IN_TOOL)).rejects.toThrow(/not found/)
    expect(w.studio.rpc).toHaveLength(0)
  })

  it('a session from an earlier pwf lists phiwebs_sign_in, which says to sign in again', async () => {
    const w = await signedIn()
    const file = join(w.dir, CREDENTIALS_FILE)
    const all = JSON.parse(await readFile(file, 'utf8'))
    delete all.servers[w.api.url].studio
    await writeFile(file, JSON.stringify(all))
    const client = await mcpClient(w)
    const { tools } = await client.listTools()
    expect(tools.at(-1)?.name).toBe(SIGN_IN_TOOL)
    expect(text(await call(client, SIGN_IN_TOOL))).toContain('signing in again adds it')
  })
})
