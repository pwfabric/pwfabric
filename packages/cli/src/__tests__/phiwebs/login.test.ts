/**
 * `pwf login`, `whoami` and `logout` against a fake local OAuth server:
 * discovery, dynamic registration, PKCE, the loopback callback, refresh and
 * revocation. No network beyond 127.0.0.1.
 */
import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from '../../index.js'
import { runLogin as loginBody, runLogout as logoutBody, runWhoami as whoamiBody, WHOAMI_PATHS, type AccountDeps } from '../../commands/login.js'
import { guard } from '../../commands/lib/flags.js'
import type { CommandIO, ParsedArgs } from '../../commands/types.js'
import { CLIENTS_FILE, configDir, CREDENTIALS_FILE, DEFAULT_PHIWEBS_URL, serverUrl } from '../../phiwebs/config.js'
import { LOGIN_SCOPES, serverError, startLoopback } from '../../phiwebs/oauth.js'
import { readSession } from '../../phiwebs/session.js'
import { capture, tempDir } from '../commands/helpers.js'
import { startFakeServer, type FakeServer, type FakeServerOptions } from './fake-server.js'

const servers: FakeServer[] = []
afterEach(async () => {
  while (servers.length) await (servers.pop() as FakeServer).close()
})

async function fake(options?: FakeServerOptions): Promise<FakeServer> {
  const s = await startFakeServer(options)
  servers.push(s)
  return s
}

/** A user whose browser follows the sign-in address (and its redirect to the loopback). */
const browser: AccountDeps['openBrowser'] = async (url) => {
  await fetch(url)
}

async function setup(options?: FakeServerOptions): Promise<{ server: FakeServer; home: string; env: Record<string, string>; dir: string }> {
  const server = await fake(options)
  const home = await tempDir()
  const env = { APPDATA: home, XDG_CONFIG_HOME: home, PWF_PHIWEBS_URL: server.url }
  return { server, home, env, dir: join(home, 'pwfabric') }
}

// As the commands run them: failures become exit codes and messages.
const runLogin = (a: ParsedArgs, io: CommandIO, d?: AccountDeps) => guard('login', io, () => loginBody(a, io, d))
const runWhoami = (a: ParsedArgs, io: CommandIO, d?: AccountDeps) => guard('whoami', io, () => whoamiBody(a, io, d))
const runLogout = (a: ParsedArgs, io: CommandIO, d?: AccountDeps) => guard('logout', io, () => logoutBody(a, io, d))

const args = (flags: Record<string, string | boolean> = {}) => ({ positionals: [], flags })

describe('pwf login', () => {
  it('signs in with discovery, registration, PKCE and the loopback callback, then whoami reads the account', async () => {
    const { server, env, dir } = await setup()
    const c = capture(dir, env)
    let opened = ''
    const code = await runLogin(args(), c.io, {
      openBrowser: async (url) => {
        opened = url
        await fetch(url)
      },
    })
    expect(code, c.text()).toBe(0)
    expect(server.registrations).toHaveLength(1)
    expect(server.registrations[0]?.client_name).toBe('PWFabric CLI')
    expect(server.registrations[0]?.redirect_uris[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)
    expect(server.pkceChecks).toEqual([true])

    const auth = new URL(opened)
    expect(auth.origin + auth.pathname).toBe(`${server.url}/oauth/authorize`)
    expect(auth.searchParams.get('scope')).toBe(LOGIN_SCOPES.join(' '))
    expect(auth.searchParams.get('code_challenge_method')).toBe('S256')
    expect(c.out).toContain(`  ${opened}`)
    expect(c.out.at(-3)).toBe(`Signed in to ${server.url} as ada@example.com.`)
    expect(c.out.at(-2)).toBe('  workspace  Ada Studio (owner)')
    expect(c.out.at(-1)).toBe('  studio     https://studio.phiwebs.com (tokens for https://mcp.phiwebs.com)')

    const saved = JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8'))
    expect(saved.servers[server.url]).toMatchObject({ clientId: 'client_1', tokenEndpoint: `${server.url}/api/oauth/token` })
    expect(typeof saved.servers[server.url].refreshToken).toBe('string')
    if (process.platform !== 'win32') expect(statSync(join(dir, CREDENTIALS_FILE)).mode & 0o777).toBe(0o600)

    const w = capture(dir, env)
    expect(await runWhoami(args(), w.io)).toBe(0)
    expect(w.out).toEqual([`Signed in to ${server.url}`, '  account    ada@example.com', '  workspace  Ada Studio (owner)', '  studio     https://studio.phiwebs.com (tokens for https://mcp.phiwebs.com)'])

    // A second login reuses the registered client: its port is free again.
    const again = capture(dir, env)
    expect(await runLogin(args(), again.io, { openBrowser: browser })).toBe(0)
    expect(server.registrations).toHaveLength(1)
    const clients = JSON.parse(await readFile(join(dir, CLIENTS_FILE), 'utf8'))
    expect(clients.servers[server.url].clientId).toBe('client_1')
  })

  it('registers a new client when the saved one was registered elsewhere', async () => {
    const { server, env, dir } = await setup()
    expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    // Hold the saved port so the next login must move.
    const saved = JSON.parse(await readFile(join(dir, CLIENTS_FILE), 'utf8')).servers[server.url]
    const squatter = await startLoopback(Number(new URL(saved.redirectUri).port))
    try {
      expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
      expect(server.registrations).toHaveLength(2)
    } finally {
      await squatter.close()
    }
  })

  it('a saved client the server no longer knows (invalid_client at authorize) is dropped, registered again once, and the sign-in retried', async () => {
    const { server, env, dir } = await setup()
    expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    server.forgetClients()
    const c = capture(dir, env)
    let opened = 0
    expect(await runLogin(args(), c.io, { openBrowser: async (u) => ((opened += 1), void (await fetch(u))) }), c.text()).toBe(0)
    expect(opened).toBe(2)
    expect(server.registrations).toHaveLength(2)
    expect(c.err.join('\n')).toContain('no longer knows the registration pwf saved')
    expect(JSON.parse(await readFile(join(dir, CLIENTS_FILE), 'utf8')).servers[server.url].clientId).toBe('client_2')
    expect(JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers[server.url].clientId).toBe('client_2')
  })

  it('invalid_client at the token endpoint does the same; a client registered just now is not retried', async () => {
    const { server, env, dir } = await setup()
    expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    server.tokenInvalidClient = 1
    const c = capture(dir, env)
    expect(await runLogin(args(), c.io, { openBrowser: browser }), c.text()).toBe(0)
    expect(server.registrations).toHaveLength(2)

    // A fresh home: the client is registered now, so invalid_client is final.
    const other = await setup()
    other.server.tokenInvalidClient = 5
    const x = capture(other.dir, other.env)
    expect(await runLogin(args(), x.io, { openBrowser: browser })).toBe(1)
    expect(other.server.registrations).toHaveLength(1)
    expect(x.err.join('\n')).toContain('invalid_client')
  })

  it('refreshes an expired session and saves the rotated tokens', async () => {
    const { server, env, dir } = await setup({ expiresIn: 300 })
    expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    const before = JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers[server.url]
    const later = () => Date.now() + 10 * 60_000
    const w = capture(dir, env)
    expect(await runWhoami(args(), w.io, { now: later })).toBe(0)
    // whoami refreshes the API's token (no resource: the grant's first), then the studio's.
    expect(server.tokenRequests.at(-2)).toMatchObject({ grant_type: 'refresh_token', client_id: 'client_1', refresh_token: before.refreshToken })
    expect(server.tokenRequests.at(-2)?.['resource']).toBeUndefined()
    expect(server.tokenRequests.at(-1)).toMatchObject({ grant_type: 'refresh_token', resource: 'https://mcp.phiwebs.com' })
    const after = JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers[server.url]
    expect(after.refreshToken).not.toBe(before.refreshToken)
    expect(after.accessToken).not.toBe(before.accessToken)

    // A refresh the server refuses ends the session.
    server.refuseRefresh = true
    const x = capture(dir, env)
    expect(await runWhoami(args(), x.io, { now: () => Date.now() + 60 * 60_000 })).toBe(1)
    expect(x.err.join('\n')).toContain('pwf login')
    expect(existsSync(join(dir, CREDENTIALS_FILE))).toBe(false)
    expect(await readSession({ env })).toBeNull()
  })

  it('logout revokes when the server can, and deletes the saved session', async () => {
    const { server, env, dir } = await setup({ revocation: true })
    expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    const saved = JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers[server.url]
    const out = capture(dir, env)
    expect(await runLogout(args(), out.io)).toBe(0)
    expect(server.revoked).toEqual([saved.refreshToken])
    expect(out.out).toEqual([`Signed out of ${server.url}; the saved session is deleted.`])
    expect(existsSync(join(dir, CREDENTIALS_FILE))).toBe(false)

    const w = capture(dir, env)
    expect(await runWhoami(args(), w.io)).toBe(1)
    expect(w.out).toEqual([`Not signed in to ${server.url}. Run \`pwf login\` to sign in.`])
    const none = capture(dir, env)
    expect(await runLogout(args(), none.io)).toBe(0)
    expect(none.out).toEqual([`Not signed in to ${server.url}.`])
  })

  it('logout without a revocation endpoint says the grant lives on, and keeps other servers', async () => {
    const { env, dir } = await setup()
    const other = await fake()
    expect(await runLogin(args(), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    expect(await runLogin(args({ server: other.url }), capture(dir, env).io, { openBrowser: browser })).toBe(0)
    const out = capture(dir, env)
    expect(await runLogout(args(), out.io)).toBe(0)
    expect(out.out[1]).toContain('no revocation endpoint')
    const left = JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')).servers
    expect(Object.keys(left)).toEqual([other.url])
  })

  it('fails on a denied consent, a wrong state and a timeout', async () => {
    const denied = await setup({ deny: 'access_denied' })
    const d = capture(denied.dir, denied.env)
    expect(await runLogin(args(), d.io, { openBrowser: browser })).toBe(1)
    expect(d.err.join('\n')).toContain('the server did not authorize pwf: access_denied: User denied authorization')
    expect(existsSync(join(denied.dir, CREDENTIALS_FILE))).toBe(false)

    const { env, dir } = await setup()
    const w = capture(dir, env)
    let refused = 0
    const code = await runLogin(args(), w.io, {
      timeoutMs: 300,
      openBrowser: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri') as string
        refused = (await fetch(`${redirect}?code=stolen&state=not-ours`)).status
        expect((await fetch(redirect.replace('/callback', '/elsewhere'))).status).toBe(404)
      },
    })
    expect(refused).toBe(400)
    expect(code).toBe(1)
    expect(w.err.join('\n')).toContain('no answer from the browser')

    const n = capture(dir, env)
    const noCode = await runLogin(args(), n.io, {
      openBrowser: async (url) => {
        const u = new URL(url)
        await fetch(`${u.searchParams.get('redirect_uri')}?state=${u.searchParams.get('state')}`)
      },
    })
    expect(noCode).toBe(1)
    expect(n.err.join('\n')).toContain('no authorization code')
  })

  it('refuses a server it cannot use', async () => {
    const home = await tempDir()
    const env = { APPDATA: home, XDG_CONFIG_HOME: home }
    const plain = capture(home, env)
    expect(await main(['login', '--server', 'http://example.com'], plain.io)).toBe(1)
    expect(plain.err.join('\n')).toContain('must be https')
    const notUrl = capture(home, env)
    expect(await main(['whoami', '--server', 'nope'], notUrl.io)).toBe(1)
    expect(notUrl.err.join('\n')).toContain('is not a URL')

    const noDcr = await fake({ noRegistration: true })
    const r = capture(home, env)
    expect(await runLogin(args({ server: noDcr.url }), r.io, { openBrowser: browser })).toBe(1)
    expect(r.err.join('\n')).toContain('dynamic client registration')

    const gone = capture(home, env)
    expect(await runLogin(args({ server: 'http://127.0.0.1:9' }), gone.io, { openBrowser: browser })).toBe(1)
    expect(gone.err.join('\n')).toContain('cannot reach')

    const extra = capture(home, env)
    expect(await main(['whoami', 'someone'], extra.io)).toBe(2)
  })

  it('reads its settings from the flag, the environment and the platform', () => {
    expect(serverUrl(undefined, {})).toBe(DEFAULT_PHIWEBS_URL)
    expect(serverUrl(undefined, { PWF_PHIWEBS_URL: 'http://localhost:4000/' })).toBe('http://localhost:4000')
    expect(serverUrl('https://staging.example.com/base/', { PWF_PHIWEBS_URL: 'http://localhost:4000' })).toBe('https://staging.example.com/base')
    expect(configDir({ env: { APPDATA: '/appdata' }, platform: 'win32', home: '/h' })).toBe(join('/appdata', 'pwfabric'))
    expect(configDir({ env: {}, platform: 'win32', home: '/h' })).toBe(join('/h', 'AppData', 'Roaming', 'pwfabric'))
    expect(configDir({ env: { XDG_CONFIG_HOME: '/x' }, platform: 'linux', home: '/h' })).toBe(join('/x', 'pwfabric'))
    expect(configDir({ env: { XDG_CONFIG_HOME: 'relative' }, platform: 'darwin', home: '/h' })).toBe(join('/h', '.config', 'pwfabric'))
    expect(serverError({ error: 'invalid_grant', error_description: 'expired' }, 400)).toBe('invalid_grant: expired')
    expect(serverError({ error: 'invalid_grant' }, 400)).toBe('invalid_grant')
    expect(serverError({ error: { code: 'INVALID_GRANT', message: 'used' } }, 400)).toBe('INVALID_GRANT: used')
    expect(serverError({ error: {} }, 400)).toBe('HTTP 400')
    expect(serverError({ message: 'nope' }, 500)).toBe('nope')
    expect(serverError('text', 502)).toBe('HTTP 502')
    expect(WHOAMI_PATHS.workspace).toBe('/api/worlds/me')
  })
})
