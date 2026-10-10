import { afterEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { request } from 'node:http'
import { createLocalHost } from '../../index.js'
import { authAddresses, SESSION_COOKIE } from '../../host/local-host.js'
import { fixture, PREFIX, serve, type Served } from './serve.js'

let served: Served | undefined
afterEach(async () => {
  await served?.close()
  served = undefined
})

async function start(name: string, options: Parameters<typeof serve>[1] = {}): Promise<Served> {
  served = await serve(name, options)
  return served
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

async function signIn(base: string): Promise<string> {
  const res = await fetch(`${base}/login`, json({ email: 'a@b.c', password: 'x' }))
  expect(res.status).toBe(200)
  return ((await res.json()) as { data: { token: string } }).data.token
}

const withSession = (token: string, init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), 'x-app-session': token },
})

describe('mounting', () => {
  it('resolves false outside its prefix and handles everything under it', async () => {
    const s = await start('l-shop')
    const outside = await fetch(`${s.origin}/_hostile`)
    expect(outside.status).toBe(404)
    expect(await outside.text()).toBe('not the host')
    const root = await fetch(`${s.origin}${PREFIX}`)
    expect(root.status).toBe(404)
    expect(await root.json()).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } })
  })

  it('normalises the prefix and refuses an empty one', async () => {
    const s = await start('l-shop', { prefix: '/dev-host/' })
    expect((await fetch(`${s.origin}/dev-host/session`)).status).toBe(200)
    expect(() => createLocalHost({ root: fixture('l-shop'), prefix: '/' })).toThrow(/prefix/)
  })

  it('answers a malformed path segment with 400', async () => {
    const s = await start('l-shop')
    const res = await fetch(`${s.base}/records/%E0%A4%A`)
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('INVALID_PATH')
  })

  it('reports a broken definition file as a host error, naming the file', async () => {
    const s = await start('l-broken')
    const res = await fetch(`${s.base}/session`)
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe('HOST_ERROR')
    expect(body.error.message).toMatch(/auth\.json is not valid JSON/)
  })
})

describe('envelopeEntries', () => {
  it('points the app door and the pages at the host', async () => {
    const host = createLocalHost({ root: fixture('l-shop'), prefix: '/_host' })
    const entries = host.envelopeEntries('http://127.0.0.1:4600/')
    const base = 'http://127.0.0.1:4600/_host'
    expect(entries['auth.json']).toEqual({
      provider: 'password',
      loginUrl: `${base}/login`,
      registerUrl: `${base}/register`,
      logoutUrl: `${base}/logout`,
      sessionUrl: `${base}/session`,
      providers: [{ method: 'google' }],
      startUrl: `${base}/_auth/start`,
      gatewaySessionUrl: `${base}/_auth/session`,
      gatewayLogoutUrl: `${base}/_auth/logout`,
      methods: ['password', 'google'],
    })
    expect(Object.keys(entries).sort()).toEqual(['auth.json', 'surfaces/home.receipt.json', 'surfaces/orders.receipt.json'])
    const home = entries['surfaces/home.receipt.json'] as { capabilities: { config?: { dataSources?: unknown[] } }[] }
    expect(home.capabilities[0]!.config!.dataSources).toEqual([
      {
        id: 'products',
        kind: 'rest',
        method: 'GET',
        endpoint: `${base}/records/Product`,
        authProviderRef: base,
        returns: 'data',
        query: { sort: [{ field: 'name', direction: 'asc' }] },
        fallback: [],
      },
      {
        id: 'spend',
        kind: 'rest',
        method: 'GET',
        endpoint: `${base}/records/Product/aggregate?fn=sum&field=price&filter=${encodeURIComponent(
          JSON.stringify({ field: 'price', operator: 'gt', value: 4 })
        ).replace(/%20/g, '+')}`,
        authProviderRef: base,
        returns: 'data',
      },
      { id: 'howMany', kind: 'rest', method: 'GET', endpoint: `${base}/records/Order/count`, authProviderRef: base, returns: 'data' },
      { id: 'remote', kind: 'entity', entityType: 'Product', connector: 'shop-api' },
      { id: 'unknown', kind: 'entity', entityType: 'Ghost' },
      { id: 'static', kind: 'static', staticData: [1, 2] },
      'not-a-source',
    ])
    // A capability without a source list is passed through.
    expect(home.capabilities[2]).toEqual({ capability: 'persistence' })
  })

  it('writes only the provider half for a provider-only door', () => {
    const entries = createLocalHost({ root: fixture('l-social'), prefix: '/h' }).envelopeEntries('http://x')
    expect(entries).toEqual({
      'auth.json': {
        provider: 'platform',
        providers: [{ method: 'github' }, { method: 'phiwebs' }],
        startUrl: 'http://x/h/_auth/start',
        gatewaySessionUrl: 'http://x/h/_auth/session',
        gatewayLogoutUrl: 'http://x/h/_auth/logout',
        methods: ['github', 'phiwebs'],
      },
    })
  })

  it('names the gateway addresses for a password-only door too, since the runner calls them on boot and sign-out', () => {
    const entries = createLocalHost({ root: fixture('l-members'), prefix: '/h' }).envelopeEntries('http://x')
    expect(entries['auth.json']).toMatchObject({
      provider: 'password',
      loginUrl: 'http://x/h/login',
      gatewaySessionUrl: 'http://x/h/_auth/session',
      gatewayLogoutUrl: 'http://x/h/_auth/logout',
    })
    expect(entries['auth.json']).not.toHaveProperty('startUrl')
  })

  it('points an external issuer at the stand-in, keeping client, scopes and audience', () => {
    const entries = createLocalHost({ root: fixture('l-issuer'), prefix: '/h' }).envelopeEntries('http://x')
    expect(entries['auth.json']).toEqual({
      provider: 'oauth2-pkce',
      issuer: 'http://x/h/oidc',
      clientId: 'client-1',
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      audience: 'api://client-1',
    })
    const plain = createLocalHost({ root: fixture('l-issuer-plain'), prefix: '/h' }).envelopeEntries('http://x')
    expect((plain['auth.json'] as { scopes: string[] }).scopes).toEqual(['openid', 'offline_access'])
    expect(plain['auth.json']).not.toHaveProperty('audience')
  })

  it('writes no auth.json when the app has no way in', () => {
    expect(createLocalHost({ root: fixture('l-badseed'), prefix: '/h' }).envelopeEntries('http://x')).toEqual({})
    expect(authAddresses(undefined, 'b')).toBeUndefined()
    const base = { required: true, methods: [] as string[], access: { rules: [] } }
    expect(authAddresses({ ...base, topology: 'app' }, 'b')).toBeUndefined()
    expect(authAddresses({ ...base, topology: 'external' }, 'b')).toBeUndefined()
  })
})

describe('the app door', () => {
  it('signs the development user in and out', async () => {
    const s = await start('l-shop', { user: { id: 'u-7', name: 'Ada', email: 'ada@example.com' } })
    const anon = await fetch(`${s.base}/session`)
    expect(await anon.json()).toEqual({ data: { principal: null } })

    const login = await fetch(`${s.base}/login`, json({ email: 'whoever@example.com', password: 'anything' }))
    expect(login.status).toBe(200)
    const door = (await login.json()) as { data: { token: string; expiresAt: string; principal: unknown } }
    expect(door.data.token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Date.parse(door.data.expiresAt)).toBeGreaterThan(Date.now())
    expect(door.data.principal).toEqual({ id: 'u-7', email: 'ada@example.com', displayName: 'Ada' })

    const me = await fetch(`${s.base}/session`, withSession(door.data.token))
    expect(await me.json()).toEqual({ data: { principal: door.data.principal } })
    const viaBearer = await fetch(`${s.base}/session`, { headers: { authorization: `Bearer ${door.data.token}` } })
    expect(viaBearer.status).toBe(200)

    const out = await fetch(`${s.base}/logout`, withSession(door.data.token, { method: 'POST' }))
    expect(await out.json()).toEqual({ data: { signedOut: true } })
    const again = await fetch(`${s.base}/logout`, withSession(door.data.token, { method: 'POST' }))
    expect(again.status).toBe(200)
    const stale = await fetch(`${s.base}/session`, withSession(door.data.token))
    expect(stale.status).toBe(401)
    expect(((await stale.json()) as { error: { code: string } }).error.code).toBe('SIGN_IN_REQUIRED')
  })

  it('registers with 201 and the default development user', async () => {
    const s = await start('l-shop')
    const res = await fetch(`${s.base}/register`, json({ email: 'n@e.w', password: 'longenough', displayName: 'N' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { data: { principal: unknown } }
    expect(body.data.principal).toEqual({ id: 'dev-user', email: 'dev@localhost', displayName: 'Developer' })
  })

  it('refuses a password sign-in the app does not declare', async () => {
    for (const name of ['l-social', 'l-issuer', 'l-badseed']) {
      const s = await serve(name)
      const res = await fetch(`${s.base}/login`, json({ email: 'a', password: 'b' }))
      expect(res.status).toBe(404)
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_PASSWORD_DOOR')
      await s.close()
    }
  })

  it('needs a session at /session when sign-in is required', async () => {
    const s = await start('l-members')
    expect((await fetch(`${s.base}/session`)).status).toBe(401)
  })

  it('takes JSON only, up to 1 MiB', async () => {
    const s = await start('l-shop')
    const form = await fetch(`${s.base}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=a',
    })
    expect(form.status).toBe(415)
    const broken = await fetch(`${s.base}/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })
    expect(broken.status).toBe(400)
    expect(((await broken.json()) as { error: { code: string } }).error.code).toBe('INVALID_JSON')
    const array = await fetch(`${s.base}/login`, json([1]))
    expect(((await array.json()) as { error: { code: string } }).error.code).toBe('INVALID_BODY')
    const big = await fetch(`${s.base}/login`, json({ pad: 'x'.repeat(1024 * 1024) }))
    expect(big.status).toBe(413)
    const empty = await fetch(`${s.base}/login`, { method: 'POST' })
    expect(empty.status).toBe(200)
  })

  it('refuses a body that grows past 1 MiB without declaring its length', async () => {
    const s = await start('l-shop')
    const url = new URL(`${s.base}/login`)
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: url.hostname, port: url.port, path: url.pathname, method: 'POST', headers: { 'content-type': 'application/json', 'transfer-encoding': 'chunked' } },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      const chunk = 'x'.repeat(64 * 1024)
      for (let i = 0; i < 20; i++) req.write(chunk)
      req.end()
    })
    expect(status).toBe(413)
  })

  it('answers the wrong method with 405 and an unknown route with 404', async () => {
    const s = await start('l-shop')
    expect((await fetch(`${s.base}/login`)).status).toBe(405)
    expect((await fetch(`${s.base}/session`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${s.base}/session/extra`)).status).toBe(404)
    expect((await fetch(`${s.base}/nothing`)).status).toBe(404)
  })
})

describe('provider sign-in through the gateway', () => {
  async function roundTrip(s: Served, method: string, returnTo: string): Promise<{ location: string; cookie: string | null }> {
    const startRes = await fetch(`${s.base}/_auth/start/${method}?returnTo=${encodeURIComponent(returnTo)}`, { redirect: 'manual' })
    expect(startRes.status).toBe(302)
    const callback = startRes.headers.get('location') ?? ''
    if (!callback.startsWith(`${PREFIX}/_auth/callback/`)) return { location: callback, cookie: null }
    const back = await fetch(s.origin + callback, { redirect: 'manual' })
    expect(back.status).toBe(302)
    return { location: back.headers.get('location') ?? '', cookie: back.headers.get('set-cookie') }
  }

  it('leaves an HttpOnly cookie on the way back and reads the session out of it', async () => {
    const s = await start('l-social')
    const { location, cookie } = await roundTrip(s, 'github', '/app/#/orders')
    expect(location).toBe('/app/#/orders')
    expect(cookie).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]+; Path=${PREFIX}/_auth; HttpOnly; SameSite=Lax; Max-Age=28800$`))
    const pair = cookie!.split(';')[0]!

    const refused = await fetch(`${s.base}/_auth/session`, { headers: { cookie: pair } })
    expect(refused.status).toBe(403)
    const session = await fetch(`${s.base}/_auth/session`, { headers: { cookie: pair, 'x-pwapp-request': '1' } })
    expect(session.status).toBe(200)
    const body = (await session.json()) as { data: { token: string; principal: { id: string } } }
    expect(body.data.principal.id).toBe('dev-user')
    expect(pair.endsWith(body.data.token)).toBe(true)

    expect((await fetch(`${s.base}/_auth/logout`, { method: 'POST', headers: { cookie: pair } })).status).toBe(403)
    const out = await fetch(`${s.base}/_auth/logout`, { method: 'POST', headers: { cookie: pair, 'x-pwapp-request': '1' } })
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie')).toMatch(/Max-Age=0/)
    expect((await fetch(`${s.base}/_auth/session`, { headers: { cookie: pair, 'x-pwapp-request': '1' } })).status).toBe(401)
  })

  it('keeps returnTo on this origin and reports an undeclared provider', async () => {
    const s = await start('l-social')
    expect((await roundTrip(s, 'github', '//evil.example/x')).location).toBe('/')
    expect((await roundTrip(s, 'github', '/\\evil')).location).toBe('/')
    expect((await roundTrip(s, 'github', 'relative')).location).toBe('/')
    expect((await roundTrip(s, 'google', '/p?x=1#/a')).location).toBe('/p?x=1&auth_error=provider_unavailable#/a')
    const plain = await serve('l-badseed')
    expect((await roundTrip(plain, 'github', '/')).location).toBe('/?auth_error=provider_unavailable')
    await plain.close()
  })

  it('refuses a replayed or mismatched transaction', async () => {
    const s = await start('l-social')
    const startRes = await fetch(`${s.base}/_auth/start/github?returnTo=/`, { redirect: 'manual' })
    const callback = startRes.headers.get('location')!
    const wrong = await fetch(s.origin + callback.replace('/github?', '/host?'), { redirect: 'manual' })
    expect(wrong.headers.get('location')).toBe('/?auth_error=invalid_transaction')
    // The mismatched attempt spent the transaction.
    const replay = await fetch(s.origin + callback, { redirect: 'manual' })
    expect(replay.headers.get('location')).toBe('/?auth_error=invalid_transaction')
  })

  it('answers only the cookie of an app session, and the right methods', async () => {
    const s = await start('l-social')
    expect((await fetch(`${s.base}/_auth/session`, { headers: { 'x-pwapp-request': '1' } })).status).toBe(401)
    expect((await fetch(`${s.base}/_auth/session`, { headers: { 'x-pwapp-request': '1', cookie: 'other=1; broken; pwf_dev_session=%E0%A4%A' } })).status).toBe(401)
    expect((await fetch(`${s.base}/_auth/session`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${s.base}/_auth/logout`)).status).toBe(405)
    expect((await fetch(`${s.base}/_auth/start/github`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${s.base}/_auth/start`)).status).toBe(404)
    expect((await fetch(`${s.base}/_auth/session/x`)).status).toBe(404)
    expect((await fetch(`${s.base}/_auth/other`)).status).toBe(404)
  })
})

describe('records', () => {
  it('lists seeded rows newest first, with filter, sort, limit and offset', async () => {
    const s = await start('l-shop')
    const all = (await (await fetch(`${s.base}/records/Product`)).json()) as {
      data: { id: string; name: string; entityType: string; createdAt: string }[]
      meta: { total: number; scope: string; timestamp: string }
    }
    expect(all.data.map((r) => r.name)).toEqual(['Cocoa', 'Coffee', 'Tea'])
    expect(all.data[2]).toMatchObject({ id: 'p1', entityType: 'Product', price: 4 })
    expect(all.data[0]!.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(all.meta).toMatchObject({ total: 3, scope: 'project' })

    const q = new URLSearchParams({
      filter: JSON.stringify({ field: 'price', operator: 'gte', value: 5 }),
      sort: 'price:desc,name',
      limit: '1',
      offset: '1',
    })
    const page = (await (await fetch(`${s.base}/records/Product?${q}`)).json()) as { data: { name: string }[]; meta: { total: number } }
    expect(page.data.map((r) => r.name)).toEqual(['Cocoa'])
    expect(page.meta.total).toBe(2)

    const clamp = (await (await fetch(`${s.base}/records/Product?limit=0&offset=-4`)).json()) as { data: unknown[] }
    expect(clamp.data).toHaveLength(1)
    const junk = (await (await fetch(`${s.base}/records/Product?limit=abc&offset=x`)).json()) as { data: unknown[] }
    expect(junk.data).toHaveLength(3)
    const bad = await fetch(`${s.base}/records/Product?filter=${encodeURIComponent('[1]')}`)
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe('INVALID_QUERY')
  })

  it('creates, reads, updates and deletes', async () => {
    const s = await start('l-shop')
    const created = await fetch(`${s.base}/records/Product`, json({ name: 'Mate', price: 3, id: 'forged', createdAt: 'x' }))
    expect(created.status).toBe(201)
    const c = (await created.json()) as { id: string; data: { id: string; name: string; createdAt: string; updatedAt: string } }
    expect(c.id).toBe(c.data.id)
    expect(c.data.id).not.toBe('forged')
    expect(c.data.createdAt).not.toBe('x')

    const read = (await (await fetch(`${s.base}/records/Product/${c.id}`)).json()) as { id: string; data: { name: string } }
    expect(read).toEqual({ id: c.id, data: c.data })

    const patched = await fetch(`${s.base}/records/Product/${c.id}`, { ...json({ data: { price: 7 } }), method: 'PATCH' })
    const p = (await patched.json()) as { data: { name: string; price: number; createdAt: string } }
    expect(p.data).toMatchObject({ name: 'Mate', price: 7, createdAt: c.data.createdAt })
    const list = (await (await fetch(`${s.base}/records/Product`)).json()) as { data: { id: string }[] }
    expect(list.data[0]!.id).toBe(c.id)

    const del = await fetch(`${s.base}/records/Product/${c.id}`, { method: 'DELETE' })
    expect(await del.json()).toEqual({ data: { id: c.id, deleted: true } })
    expect((await fetch(`${s.base}/records/Product/${c.id}`)).status).toBe(404)
    expect((await fetch(`${s.base}/records/Product/${c.id}`, { method: 'DELETE' })).status).toBe(404)
  })

  it('validates required fields on create and update', async () => {
    const s = await start('l-shop')
    const missing = await fetch(`${s.base}/records/Product`, json({ price: 1 }))
    expect(missing.status).toBe(400)
    expect(await missing.json()).toEqual({ error: { code: 'VALIDATION_FAILED', message: 'Missing required field(s): name.' } })
    const cleared = await fetch(`${s.base}/records/Product/p1`, { ...json({ name: '' }), method: 'PATCH' })
    expect(cleared.status).toBe(400)
  })

  it('counts and aggregates', async () => {
    const s = await start('l-shop')
    const count = await fetch(`${s.base}/records/Product/count`)
    expect(((await count.json()) as { data: unknown }).data).toEqual({ fn: 'count', value: 3, count: 3 })
    const filter = encodeURIComponent(JSON.stringify({ field: 'price', operator: 'gt', value: 4 }))
    const sum = await fetch(`${s.base}/records/Product/aggregate?fn=sum&field=price&filter=${filter}`)
    expect(((await sum.json()) as { data: unknown }).data).toEqual({ fn: 'sum', field: 'price', value: 11, count: 2 })
    const avg = await fetch(`${s.base}/records/Product/aggregate?fn=avg&field=price`)
    expect(((await avg.json()) as { data: { value: number } }).data.value).toBe(5)
    const none = await fetch(`${s.base}/records/Product/aggregate?fn=avg&field=nothing`)
    expect(((await none.json()) as { data: { value: unknown } }).data.value).toBeNull()
    const cnt = await fetch(`${s.base}/records/Product/aggregate?fn=count&field=price`)
    expect(((await cnt.json()) as { data: { value: number } }).data.value).toBe(3)
    expect((await fetch(`${s.base}/records/Product/aggregate?fn=max&field=price`)).status).toBe(400)
    expect((await fetch(`${s.base}/records/Product/aggregate?fn=sum`)).status).toBe(400)
    expect((await fetch(`${s.base}/records/Product/count`, { method: 'POST' })).status).toBe(405)
  })

  it('refuses an undeclared type, an unknown route and a wrong method', async () => {
    const s = await start('l-shop')
    const ghost = await fetch(`${s.base}/records/Ghost`)
    expect(ghost.status).toBe(404)
    expect(((await ghost.json()) as { error: { code: string } }).error.code).toBe('UNKNOWN_ENTITY_TYPE')
    expect((await fetch(`${s.base}/records`)).status).toBe(404)
    expect((await fetch(`${s.base}/records/Product/p1/extra`)).status).toBe(404)
    expect((await fetch(`${s.base}/records/Product`, { method: 'PUT' })).status).toBe(405)
    expect((await fetch(`${s.base}/records/Product/p1`, { method: 'POST' })).status).toBe(405)
  })

  it('keeps an owner-scoped collection per visitor', async () => {
    const s = await start('l-shop')
    // Rule-scoped (an access rule names Order), field-scoped (Note has ownerId), declared (Draft).
    for (const type of ['Order', 'Note', 'Draft']) {
      const anon = await fetch(`${s.base}/records/${type}`)
      expect(anon.status).toBe(401)
      expect(((await anon.json()) as { error: { code: string } }).error.code).toBe('SIGN_IN_REQUIRED')
    }
    const token = await signIn(s.base)
    const notes = (await (await fetch(`${s.base}/records/Note`, withSession(token))).json()) as {
      data: { id: string }[]
      meta: { scope: string }
    }
    expect(notes.data.map((n) => n.id)).toEqual(['n1'])
    expect(notes.meta.scope).toBe('owner')
    expect((await fetch(`${s.base}/records/Note/n2`, withSession(token))).status).toBe(404)
    expect((await fetch(`${s.base}/records/Note/n2`, withSession(token, { method: 'DELETE' }))).status).toBe(404)

    const note = await fetch(`${s.base}/records/Note`, withSession(token, json({ text: 'new' })))
    expect(((await note.json()) as { data: { ownerId: string } }).data.ownerId).toBe('dev-user')
    const count = await fetch(`${s.base}/records/Note/count`, withSession(token))
    expect(((await count.json()) as { data: { value: number } }).data.value).toBe(2)

    // A public read grant keeps Review shared.
    expect((await fetch(`${s.base}/records/Review`)).status).toBe(200)
  })

  it('needs a session for every record when sign-in is required', async () => {
    const s = await start('l-members')
    expect((await fetch(`${s.base}/records/Task`)).status).toBe(401)
    expect((await fetch(`${s.base}/records/Task`, json({ title: 't' }))).status).toBe(401)
    // A stale credential is an anonymous caller.
    expect((await fetch(`${s.base}/records/Task`, withSession('nope'))).status).toBe(401)
    const token = await signIn(s.base)
    const created = await fetch(`${s.base}/records/Task`, withSession(token, json({ title: 't', points: 2 })))
    expect(created.status).toBe(201)
  })

  it('reports unusable seed files', async () => {
    const s = await start('l-badseed')
    const bad = await fetch(`${s.base}/records/Bad`)
    expect(bad.status).toBe(500)
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/Bad\.jsonl:2 is not valid JSON/)
    expect(((await (await fetch(`${s.base}/records/Arr`)).json()) as { error: { message: string } }).error.message).toMatch(
      /Arr\.jsonl:1 is not a JSON object/
    )
    expect(((await (await fetch(`${s.base}/records/Obj`)).json()) as { error: { message: string } }).error.message).toMatch(
      /must be \{ "data": \[ \.\.\.records \] \}/
    )
    const ok = (await (await fetch(`${s.base}/records/Ok`)).json()) as { data: unknown[] }
    expect(ok.data).toEqual([])
  })

  it('forgets everything on reset', async () => {
    const s = await start('l-shop')
    const token = await signIn(s.base)
    await fetch(`${s.base}/records/Product`, json({ name: 'Gone' }))
    s.host.reset()
    expect((await fetch(`${s.base}/session`, withSession(token))).status).toBe(401)
    const list = (await (await fetch(`${s.base}/records/Product`)).json()) as { data: { name: string }[] }
    expect(list.data.map((r) => r.name)).not.toContain('Gone')
  })
})

describe('pages', () => {
  it('serves a receipt with its entity sources pointed at the host', async () => {
    const s = await start('l-shop')
    const res = await fetch(`${s.base}/surfaces/orders.receipt.json`)
    expect(res.status).toBe(200)
    const receipt = (await res.json()) as { capabilities: { config: { dataSources?: unknown[] } }[] }
    expect(receipt.capabilities[0]!.config.dataSources).toEqual([
      { id: 'orders', kind: 'rest', method: 'GET', endpoint: `${s.base}/records/Order`, authProviderRef: s.base, returns: 'data' },
    ])
  })

  it('refuses a page without a session when sign-in is required', async () => {
    const s = await start('l-members')
    expect((await fetch(`${s.base}/surfaces/home.receipt.json`)).status).toBe(401)
    const token = await signIn(s.base)
    expect((await fetch(`${s.base}/surfaces/home.receipt.json`, withSession(token))).status).toBe(200)
    expect((await fetch(`${s.base}/surfaces/home.receipt.json`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(200)
  })

  it('answers unknown pages and file names with 404', async () => {
    const s = await start('l-shop')
    expect((await fetch(`${s.base}/surfaces/nope.receipt.json`)).status).toBe(404)
    expect((await fetch(`${s.base}/surfaces/home.json`)).status).toBe(404)
    expect((await fetch(`${s.base}/surfaces/..%2Fdefinitions%2Fauth.receipt.json`)).status).toBe(404)
    expect((await fetch(`${s.base}/surfaces`)).status).toBe(404)
    expect((await fetch(`${s.base}/surfaces/home.receipt.json`, { method: 'POST' })).status).toBe(405)
  })
})

describe('the issuer stand-in', () => {
  const verifier = randomBytes(32).toString('hex')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  function authorizeUrl(s: Served, overrides: Record<string, string | null> = {}): string {
    const params: Record<string, string | null> = {
      response_type: 'code',
      client_id: 'client-1',
      redirect_uri: `${s.origin}/app/`,
      scope: 'openid profile',
      state: 'st-1',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      ...overrides,
    }
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== null) q.set(k, v)
    return `${s.base}/oidc/authorize?${q}`
  }

  const form = (fields: Record<string, string>): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  })

  async function code(s: Served): Promise<string> {
    const res = await fetch(authorizeUrl(s), { redirect: 'manual' })
    expect(res.status).toBe(302)
    const back = new URL(res.headers.get('location')!)
    expect(back.searchParams.get('state')).toBe('st-1')
    return back.searchParams.get('code')!
  }

  it('publishes discovery at the declared issuer path', async () => {
    const s = await start('l-issuer')
    const doc = (await (await fetch(`${s.base}/oidc/.well-known/openid-configuration`)).json()) as Record<string, unknown>
    expect(doc).toMatchObject({
      issuer: `${s.base}/oidc`,
      authorization_endpoint: `${s.base}/oidc/authorize`,
      token_endpoint: `${s.base}/oidc/token`,
      code_challenge_methods_supported: ['S256'],
    })
  })

  it('runs the code exchange, refresh and door-token redemption', async () => {
    const s = await start('l-issuer')
    const c = await code(s)
    const tok = await fetch(
      `${s.base}/oidc/token`,
      form({ grant_type: 'authorization_code', code: c, redirect_uri: `${s.origin}/app/`, client_id: 'client-1', code_verifier: verifier })
    )
    expect(tok.status).toBe(200)
    const t = (await tok.json()) as Record<string, string | number>
    expect(t).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'openid profile' })
    const [header, payload, signature] = String(t.id_token).split('.')
    expect(JSON.parse(Buffer.from(header!, 'base64url').toString())).toEqual({ alg: 'none', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(payload!, 'base64url').toString())).toMatchObject({
      iss: `${s.base}/oidc`,
      sub: 'dev-user',
      aud: 'client-1',
      name: 'Developer',
      email: 'dev@localhost',
    })
    expect(signature).toBe('')

    // The access token is a credential of this host.
    expect((await fetch(`${s.base}/session`, { headers: { authorization: `Bearer ${t.access_token}` } })).status).toBe(200)
    // The code is single use.
    const replay = await fetch(
      `${s.base}/oidc/token`,
      form({ grant_type: 'authorization_code', code: c, redirect_uri: `${s.origin}/app/`, client_id: 'client-1', code_verifier: verifier })
    )
    expect(((await replay.json()) as { error: string }).error).toBe('invalid_grant')

    const door = await fetch(
      `${s.base}/oidc/token`,
      form({ grant_type: 'refresh_token', refresh_token: String(t.refresh_token), client_id: 'client-1', scope: 'api://client-1/.default' })
    )
    const d = (await door.json()) as Record<string, string>
    expect(d.scope).toBe('api://client-1/.default')
    expect(d).not.toHaveProperty('id_token')
    expect((await fetch(`${s.base}/surfaces/home.receipt.json`, { headers: { authorization: `Bearer ${d.access_token}` } })).status).toBe(200)

    // The rotated refresh token still carries the data scopes.
    const refreshed = await fetch(`${s.base}/oidc/token`, form({ grant_type: 'refresh_token', refresh_token: d.refresh_token!, client_id: 'client-1' }))
    const r = (await refreshed.json()) as Record<string, string>
    expect(r.scope).toBe('openid profile')
    expect(r.id_token).toBeTruthy()
    // The old refresh token rotated away.
    const old = await fetch(`${s.base}/oidc/token`, form({ grant_type: 'refresh_token', refresh_token: String(t.refresh_token), client_id: 'client-1' }))
    expect(old.status).toBe(400)
  })

  it('refuses bad exchanges with OAuth errors', async () => {
    const s = await start('l-issuer')
    const base = { grant_type: 'authorization_code', redirect_uri: `${s.origin}/app/`, client_id: 'client-1', code_verifier: verifier }
    const wrongVerifier = await fetch(`${s.base}/oidc/token`, form({ ...base, code: await code(s), code_verifier: 'x' }))
    expect(((await wrongVerifier.json()) as { error: string }).error).toBe('invalid_grant')
    const wrongRedirect = await fetch(`${s.base}/oidc/token`, form({ ...base, code: await code(s), redirect_uri: `${s.origin}/other` }))
    expect(((await wrongRedirect.json()) as { error: string }).error).toBe('invalid_grant')
    const wrongClient = await fetch(`${s.base}/oidc/token`, form({ ...base, code: await code(s), client_id: 'nope' }))
    expect(wrongClient.status).toBe(401)
    expect(((await wrongClient.json()) as { error: string }).error).toBe('invalid_client')
    const grant = await fetch(`${s.base}/oidc/token`, form({ grant_type: 'password', client_id: 'client-1' }))
    expect(((await grant.json()) as { error: string }).error).toBe('unsupported_grant_type')
    const json1 = await fetch(`${s.base}/oidc/token`, json({ grant_type: 'refresh_token' }))
    expect(json1.status).toBe(415)
    const tok = (await (
      await fetch(`${s.base}/oidc/token`, form({ ...base, code: await code(s) }))
    ).json()) as Record<string, string>
    const scope = await fetch(
      `${s.base}/oidc/token`,
      form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token!, client_id: 'client-1', scope: 'https://graph.example/.default' })
    )
    expect(((await scope.json()) as { error: string }).error).toBe('invalid_scope')
    const missing = await fetch(`${s.base}/oidc/token`, form({ grant_type: 'refresh_token', client_id: 'client-1' }))
    expect(((await missing.json()) as { error: string }).error).toBe('invalid_grant')
  })

  it('refuses an audience scope when the app declares no audience', async () => {
    const s = await start('l-issuer-plain')
    const authorize = new URLSearchParams({
      response_type: 'code',
      client_id: 'client-2',
      redirect_uri: `${s.origin}/`,
      state: 's',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })
    const res = await fetch(`${s.base}/oidc/authorize?${authorize}`, { redirect: 'manual' })
    const c = new URL(res.headers.get('location')!).searchParams.get('code')!
    const tok = (await (
      await fetch(
        `${s.base}/oidc/token`,
        form({ grant_type: 'authorization_code', code: c, redirect_uri: `${s.origin}/`, client_id: 'client-2', code_verifier: verifier })
      )
    ).json()) as Record<string, string>
    expect(tok.scope).toBe('')
    const door = await fetch(
      `${s.base}/oidc/token`,
      form({ grant_type: 'refresh_token', refresh_token: tok.refresh_token!, client_id: 'client-2', scope: 'api://x/.default' })
    )
    expect(((await door.json()) as { error: string }).error).toBe('invalid_scope')
  })

  it('validates the authorize request', async () => {
    const s = await start('l-issuer')
    expect((await fetch(authorizeUrl(s, { client_id: 'nope' }), { redirect: 'manual' })).status).toBe(400)
    expect((await fetch(authorizeUrl(s, { redirect_uri: 'not a url' }), { redirect: 'manual' })).status).toBe(400)
    expect((await fetch(authorizeUrl(s, { redirect_uri: 'https://elsewhere.example/' }), { redirect: 'manual' })).status).toBe(400)
    expect((await fetch(authorizeUrl(s, { redirect_uri: `ftp://${new URL(s.origin).host}/` }), { redirect: 'manual' })).status).toBe(400)

    const rt = await fetch(authorizeUrl(s, { response_type: 'token' }), { redirect: 'manual' })
    expect(new URL(rt.headers.get('location')!).searchParams.get('error')).toBe('unsupported_response_type')
    const plain = await fetch(authorizeUrl(s, { code_challenge_method: 'plain', state: null }), { redirect: 'manual' })
    const back = new URL(plain.headers.get('location')!)
    expect(back.searchParams.get('error')).toBe('invalid_request')
    expect(back.searchParams.has('state')).toBe(false)
  })

  it('exists only for an external-issuer app, on its own routes and methods', async () => {
    const s = await start('l-issuer')
    expect((await fetch(`${s.base}/oidc/.well-known/openid-configuration`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${s.base}/oidc/authorize`, { method: 'POST' })).status).toBe(405)
    expect((await fetch(`${s.base}/oidc/token`)).status).toBe(405)
    expect((await fetch(`${s.base}/oidc/jwks`)).status).toBe(404)
    const app = await serve('l-shop')
    const res = await fetch(`${app.base}/oidc/.well-known/openid-configuration`)
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('NO_ISSUER')
    await app.close()
  })
})
