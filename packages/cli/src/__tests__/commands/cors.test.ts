import { describe, expect, it } from 'vitest'
import { request, type IncomingHttpHeaders } from 'node:http'
import { cp, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { corsOriginsOf, parseCorsOrigin } from '../../dev/cors.js'
import { createDevServer } from '../../dev/server.js'
import { createLocalHost } from '../../host/index.js'
import { runRun } from '../../commands/run.js'
import { runDev } from '../../commands/dev.js'
import { startStaticServer } from '../../commands/lib/static-server.js'
import { makeApp } from '../dev/helpers.js'
import { capture, tempDir } from './helpers.js'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '__fixtures__')
const LISTED = 'http://localhost:3000'
const OTHER = 'https://evil.example'

interface Answer {
  status: number
  headers: IncomingHttpHeaders
  body: string
}

/** One request with the headers given (fetch would not let a test set `Origin`). */
function send(base: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Answer> {
  return new Promise((done, fail) => {
    const req = request(new URL(path, base), { method: init.method ?? 'GET', headers: init.headers ?? {} }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', fail)
    req.end(init.body)
  })
}

const preflight = (base: string, path: string, origin: string, method: string, headers = ''): Promise<Answer> =>
  send(base, path, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      ...(headers ? { 'access-control-request-headers': headers } : {}),
    },
  })

function corsHeadersOf(a: Answer): string[] {
  return Object.keys(a.headers).filter((h) => h.startsWith('access-control-'))
}

async function builtApp(): Promise<string> {
  const dir = await tempDir()
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, 'index.html'), '<!doctype html><div id="root"></div>')
  await writeFile(join(dir, 'assets', 'runner.js'), `export const runApp = () => ${JSON.stringify('x'.repeat(2000))}`)
  return dir
}

describe('--cors origins', () => {
  it('takes exact origins as a browser writes them', () => {
    expect(parseCorsOrigin('http://localhost:3000')).toBe('http://localhost:3000')
    expect(parseCorsOrigin('HTTPS://Example.COM')).toBe('https://example.com')
    expect(parseCorsOrigin('https://example.com:443')).toBe('https://example.com')
    expect(parseCorsOrigin('http://[::1]:8080')).toBe('http://[::1]:8080')
    expect(parseCorsOrigin('app-scheme://Local')).toBe('app-scheme://local')
    expect([...corsOriginsOf(['http://a.test', 'http://a.test', 'http://b.test'])]).toEqual(['http://a.test', 'http://b.test'])
  })

  it('refuses *, null, paths and anything that is not an origin, saying why', () => {
    expect(() => parseCorsOrigin('*')).toThrow(/exact origin, not "\*"/)
    expect(() => parseCorsOrigin('null')).toThrow(/does not take "null"/)
    expect(() => parseCorsOrigin('http://localhost:3000/')).toThrow(/path, query or fragment.*\(http:\/\/localhost:3000\)/)
    expect(() => parseCorsOrigin('http://localhost:3000/app')).toThrow(/path/)
    expect(() => parseCorsOrigin('http://localhost:3000?x=1')).toThrow(/query/)
    expect(() => parseCorsOrigin('http://user@localhost')).toThrow(/not an origin/)
    expect(() => parseCorsOrigin('localhost:3000')).toThrow(/not an origin/)
    expect(() => parseCorsOrigin('http://')).toThrow(/not an origin/)
    expect(() => parseCorsOrigin('http://localhost:99999')).toThrow(/malformed/)
  })
})

describe('static server with --cors', () => {
  it('answers a listed origin with its own origin, nobody else, and never allows credentials', async () => {
    const dir = await builtApp()
    const server = await startStaticServer({ source: { dir }, port: 0, cors: corsOriginsOf([LISTED]) })
    try {
      const listed = await send(server.url, 'assets/runner.js', { headers: { origin: LISTED, 'accept-encoding': 'gzip' } })
      expect(listed.status).toBe(200)
      expect(listed.headers['access-control-allow-origin']).toBe(LISTED)
      expect(listed.headers['access-control-allow-credentials']).toBeUndefined()
      expect(listed.headers['vary']).toBe('Origin, Accept-Encoding')

      const other = await send(server.url, 'assets/runner.js', { headers: { origin: OTHER } })
      expect(other.status).toBe(200)
      expect(corsHeadersOf(other)).toEqual([])
      expect(other.headers['vary']).toBe('Origin')

      const none = await send(server.url, 'index.html')
      expect(corsHeadersOf(none)).toEqual([])

      // A 404 a listed page reads is readable too (it can say what is missing).
      const missing = await send(server.url, 'assets/missing.js', { headers: { origin: LISTED } })
      expect(missing.status).toBe(404)
      expect(missing.headers['access-control-allow-origin']).toBe(LISTED)
    } finally {
      await server.close()
    }
  })

  it("answers a listed origin's preflight for reading only, with harmless headers only; any other is 405", async () => {
    const dir = await builtApp()
    const server = await startStaticServer({ source: { dir }, port: 0, cors: corsOriginsOf([LISTED, 'http://127.0.0.1:5173']) })
    try {
      const pf = await preflight(server.url, 'assets/runner.js', LISTED, 'GET', 'Range, Authorization, X-App-Session, If-None-Match')
      expect(pf.status).toBe(204)
      expect(pf.headers['access-control-allow-origin']).toBe(LISTED)
      expect(pf.headers['access-control-allow-methods']).toBe('GET, HEAD')
      expect(pf.headers['access-control-allow-headers']).toBe('range, if-none-match')
      expect(pf.headers['access-control-allow-credentials']).toBeUndefined()
      expect(pf.headers['vary']).toMatch(/^Origin/)

      const second = await preflight(server.url, 'index.html', 'http://127.0.0.1:5173', 'GET')
      expect(second.status).toBe(204)
      expect(second.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
      expect(second.headers['access-control-allow-headers']).toBeUndefined()

      const other = await preflight(server.url, 'assets/runner.js', OTHER, 'GET')
      expect(other.status).toBe(405)
      expect(corsHeadersOf(other)).toEqual([])
      // An OPTIONS that is not a preflight is answered as before.
      expect((await send(server.url, 'index.html', { method: 'OPTIONS', headers: { origin: LISTED } })).status).toBe(405)
      // A write from a listed origin is still not a thing files take.
      expect((await send(server.url, 'index.html', { method: 'POST', headers: { origin: LISTED } })).status).toBe(405)
    } finally {
      await server.close()
    }
  })

  it("decides CORS itself: the build's _headers sets no Access-Control-* header under --cors, and does without", async () => {
    const dir = await builtApp()
    await writeFile(join(dir, '_headers'), '/*\n  Access-Control-Allow-Origin: *\n  X-Kept: yes\n')
    const withCors = await startStaticServer({ source: { dir }, port: 0, cors: corsOriginsOf([LISTED]) })
    const without = await startStaticServer({ source: { dir }, port: 0 })
    try {
      const other = await send(withCors.url, 'index.html', { headers: { origin: OTHER } })
      expect(other.headers['access-control-allow-origin']).toBeUndefined()
      expect(other.headers['x-kept']).toBe('yes')
      expect((await send(withCors.url, 'index.html', { headers: { origin: LISTED } })).headers['access-control-allow-origin']).toBe(LISTED)
      expect((await send(without.url, 'index.html', { headers: { origin: OTHER } })).headers['access-control-allow-origin']).toBe('*')
    } finally {
      await withCors.close()
      await without.close()
    }
  })

  it('without --cors is unchanged: no Access-Control-* header, OPTIONS is 405', async () => {
    const dir = await builtApp()
    for (const cors of [undefined, corsOriginsOf([])]) {
      const server = await startStaticServer({ source: { dir }, port: 0, ...(cors ? { cors } : {}) })
      try {
        const get = await send(server.url, 'assets/runner.js', { headers: { origin: LISTED } })
        expect(corsHeadersOf(get)).toEqual([])
        expect(get.headers['vary']).toBeUndefined()
        const pf = await preflight(server.url, 'assets/runner.js', LISTED, 'GET')
        expect(pf.status).toBe(405)
        expect(pf.headers['allow']).toBe('GET, HEAD')
        expect(corsHeadersOf(pf)).toEqual([])
      } finally {
        await server.close()
      }
    }
  })
})

describe('pwf run --cors and the record host', () => {
  async function builtShop(): Promise<string> {
    const app = join(await tempDir(), 'shop')
    await cp(join(FIXTURES, 'l-shop'), app, { recursive: true })
    const out = join(app, '.pwf', 'out')
    await mkdir(join(out, 'pwpack', 'surfaces'), { recursive: true })
    await writeFile(join(out, 'index.html'), '<!doctype html><div id="root"></div>')
    await writeFile(join(out, 'pwpack', 'surfaces', 'home.receipt.json'), JSON.stringify({ blocks: [], capabilities: [] }))
    return app
  }

  it('lets a listed origin sign in with a token and read records — never with credentials', async () => {
    const app = await builtShop()
    const c = capture(dirname(app))
    const code = await runRun({ positionals: [app], flags: { port: '0' }, lists: { cors: [LISTED] } }, c.io, {
      until: async (server) => {
        // The preflights the runner's own requests need.
        const login = await preflight(server.url, '_host/login', LISTED, 'POST', 'content-type')
        expect(login.status).toBe(204)
        expect(login.headers['access-control-allow-origin']).toBe(LISTED)
        expect(login.headers['access-control-allow-methods']).toBe('GET, POST, PATCH, DELETE')
        expect(login.headers['access-control-allow-headers']).toBe('content-type')
        expect(login.headers['access-control-allow-credentials']).toBeUndefined()
        const records = await preflight(server.url, '_host/records/Product', LISTED, 'GET', 'x-app-session, authorization, x-pwapp-request, x-other')
        expect(records.headers['access-control-allow-headers']).toBe('x-app-session, authorization, x-pwapp-request')

        const signedIn = await send(server.url, '_host/login', {
          method: 'POST',
          headers: { origin: LISTED, 'content-type': 'application/json' },
          body: JSON.stringify({ email: 'dev@localhost', password: 'x' }),
        })
        expect(signedIn.status).toBe(200)
        expect(signedIn.headers['access-control-allow-origin']).toBe(LISTED)
        expect(signedIn.headers['access-control-allow-credentials']).toBeUndefined()
        expect(signedIn.headers['vary']).toBe('Origin')
        const token = (JSON.parse(signedIn.body) as { data: { token: string } }).data.token
        const list = await send(server.url, '_host/records/Product', { headers: { origin: LISTED, 'x-app-session': token } })
        expect(list.status).toBe(200)
        expect(list.headers['access-control-allow-origin']).toBe(LISTED)
        // An error answer is readable to the listed page as well.
        const write = await send(server.url, '_host/records/Product', {
          method: 'POST',
          headers: { origin: LISTED, 'content-type': 'application/json', 'x-app-session': token },
          body: '{}',
        })
        expect(write.status).toBe(403)
        expect(write.headers['access-control-allow-origin']).toBe(LISTED)

        // The cookie addresses keep asking for the runner's mark.
        const probe = await send(server.url, '_host/_auth/session', { headers: { origin: LISTED } })
        expect(probe.status).toBe(403)
        expect(JSON.parse(probe.body)).toMatchObject({ error: { code: 'RUNNER_REQUEST_REQUIRED' } })

        // Any other origin: no grant, no preflight — the token door stays shut to it.
        const foreign = await send(server.url, '_host/login', {
          method: 'POST',
          headers: { origin: OTHER, 'content-type': 'application/json' },
          body: '{}',
        })
        expect(corsHeadersOf(foreign)).toEqual([])
        const foreignPf = await preflight(server.url, '_host/login', OTHER, 'POST', 'content-type')
        expect(foreignPf.status).toBe(405)
        expect(corsHeadersOf(foreignPf)).toEqual([])
        expect(corsHeadersOf(await send(server.url, '_host/records/Product'))).toEqual([])

        // The app's files, beside the host.
        const auth = await send(server.url, 'pwpack/auth.json', { headers: { origin: LISTED } })
        expect(auth.headers['access-control-allow-origin']).toBe(LISTED)
      },
    })
    expect(code).toBe(0)
    expect(c.text()).toContain(`Cross-origin requests are answered for ${LISTED}`)
  })

  it('refuses * and a path with exit 2', async () => {
    const dir = await builtApp()
    for (const bad of ['*', 'http://localhost:3000/app', 'null']) {
      // runRun throws a UsageError before it listens; the command's guard makes it exit 2.
      await expect(
        runRun({ positionals: [dir], flags: { port: '0' }, lists: { cors: [LISTED, bad] } }, capture(dir).io, { until: async () => undefined })
      ).rejects.toThrow(/--cors/)
    }
    const { main } = await import('../../index.js')
    const out: string[] = []
    const io = { cwd: dir, out: (l: string) => out.push(l), err: (l: string) => out.push(l), env: {} }
    expect(await main(['run', dir, '--port', '0', '--cors', '*'], io)).toBe(2)
    expect(out.join('\n')).toMatch(/exact origin, not "\*"/)
    expect(await main(['run', dir, '--port', '0', '--cors'], io)).toBe(2)
    expect(out.join('\n')).toMatch(/--cors needs a value/)
  })
})

describe('pwf dev --cors', () => {
  it('answers a listed origin for the files and the local host, and nothing else', async () => {
    const a = await makeApp()
    try {
      await writeFile(join(a.root, 'app/definitions/auth.json'), JSON.stringify({ required: false, methods: ['password'], registration: 'open' }))
      const server = await createDevServer({ root: a.root, port: 0, localHost: true, cors: [LISTED] }, { watch: false, createHost: createLocalHost })
      try {
        const shell = await send(server.url, '', { headers: { origin: LISTED } })
        expect(shell.status).toBe(200)
        expect(shell.headers['access-control-allow-origin']).toBe(LISTED)
        expect(shell.headers['vary']).toBe('Origin')
        expect(corsHeadersOf(await send(server.url, '', { headers: { origin: OTHER } }))).toEqual([])
        expect(corsHeadersOf(await send(server.url, ''))).toEqual([])

        const filePf = await preflight(server.url, 'pwpack/project.json', LISTED, 'GET', 'authorization')
        expect(filePf.status).toBe(204)
        expect(filePf.headers['access-control-allow-methods']).toBe('GET, HEAD')
        expect(filePf.headers['access-control-allow-headers']).toBeUndefined()

        const hostPf = await preflight(server.url, '_host/register', LISTED, 'POST', 'content-type')
        expect(hostPf.status).toBe(204)
        expect(hostPf.headers['access-control-allow-methods']).toBe('GET, POST, PATCH, DELETE')
        expect(hostPf.headers['access-control-allow-credentials']).toBeUndefined()
        const session = await send(server.url, '_host/session', { headers: { origin: LISTED } })
        expect(session.headers['access-control-allow-origin']).toBe(LISTED)
        expect(session.headers['access-control-allow-credentials']).toBeUndefined()

        const otherPf = await preflight(server.url, '_host/register', OTHER, 'POST', 'content-type')
        expect(otherPf.status).toBe(405)
        expect(corsHeadersOf(otherPf)).toEqual([])
        // The reload channel is the dev server's own: no grant.
        expect(corsHeadersOf(await send(server.url, '_pwf/status', { headers: { origin: LISTED } }))).toEqual([])
      } finally {
        await server.close()
      }

      // Without --cors: as before.
      const plain = await createDevServer({ root: a.root, port: 0, localHost: true }, { watch: false, createHost: createLocalHost })
      try {
        expect(corsHeadersOf(await send(plain.url, '', { headers: { origin: LISTED } }))).toEqual([])
        expect((await preflight(plain.url, 'index.html', LISTED, 'GET')).status).toBe(405)
        const hostPf = await preflight(plain.url, '_host/register', LISTED, 'POST')
        expect(hostPf.status).toBe(405)
        expect(corsHeadersOf(hostPf)).toEqual([])
      } finally {
        await plain.close()
      }
    } finally {
      await a.cleanup()
    }
  })

  it('refuses * with exit 2 before it serves anything', async () => {
    const c = capture(process.cwd())
    expect(await runDev({ positionals: [], flags: { port: '0' }, lists: { cors: ['*'] } }, c.io)).toBe(2)
    expect(c.text()).toMatch(/pwf dev: --cors takes an exact origin/)
    const d = capture(process.cwd())
    expect(await runDev({ positionals: [], flags: { port: '0', cors: true } }, d.io)).toBe(2)
    expect(d.text()).toMatch(/--cors needs a value/)
  })
})
