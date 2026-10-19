/**
 * THE CONTRACT: the runner's and runtime's own client code, unmodified,
 * against the local host.
 *
 * Nothing here re-implements a client. The session boot, the password door,
 * the profile fill, the provider round trip, the PKCE bridge, the receipt
 * fetch, the entity facade (`buildEntityFacade` → `HttpEntityConnector`) and
 * the REST data service are imported from their source and pointed at a
 * host on port 0 through the real global `fetch`. The only stand-ins are the
 * browser objects these modules touch (`sessionStorage`, `location`,
 * `history`, `window`) — no DOM is needed for any of them.
 *
 * What `run-app.ts` does between these calls (it is browser orchestration and
 * cannot run in Node) is restated in one place: `ownApiBase` and the
 * `dataServiceConfig.getAccessToken` matcher, copied as written there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  readAppSession,
  readGatewaySession,
  signIn,
  signOut,
  startSocialSignIn,
  withProfile,
  writeAppSession,
  type AppSession,
} from '../../../../runner/src/app-session.js'
import { bootSession } from '../../../../runner/src/boot-session.js'
import { createAuthBridge } from '../../../../runner/src/auth.js'
import { clearDiscoveryCache } from '../../../../runner/src/pkce.js'
import { doorHeaders, fetchJson } from '../../../../runner/src/helpers.js'
import { buildEntityFacade, extractEntityTypes } from '../../../../runner/src/entity-facade.js'
import type { PwappAuth, PwappProject, SurfaceReceipt } from '../../../../runner/src/types.js'
import { createEntityFacade } from '../../../../runtime/src/entity/facade.js'
import { HttpEntityConnector } from '../../../../runtime/src/entity/http-connector.js'
import { DataService } from '../../../../runtime/src/data/manager.js'
import { memoryStorage, serve, type Served } from './serve.js'

let served: Served | undefined
afterEach(async () => {
  vi.unstubAllGlobals()
  await served?.close()
  served = undefined
})

/** `run-app.ts`: the app's own API base, read back out of `loginUrl`. */
function ownApiBaseOf(auth: PwappAuth | null): string | null {
  const login = auth?.loginUrl
  if (typeof login !== 'string' || !login.endsWith('/login')) return null
  return login.slice(0, -'/login'.length)
}

const noHistory = { replaceState: () => undefined }
const nowhere = { pathname: '/', search: '', hash: '#/home' }

function projectOf(auth: Record<string, unknown>, required: boolean, topology: 'app' | 'external'): PwappProject {
  return {
    id: 'contract-app',
    title: 'Contract',
    entrySurfaceId: 'home',
    surfaceOrder: ['home'],
    identity: { required, topology, methods: (auth.methods as string[] | undefined) ?? [] },
  }
}

/** A connector the facade is handed the way the runner's engine registry hands a bundled one. */
function recordsConnector(base: string, token: () => Promise<string | null>): HttpEntityConnector {
  return new HttpEntityConnector('local', {
    baseUrl: `${base}/records`,
    auth: { type: 'bearer', token },
    retry: { maxRetries: 0, baseDelay: 0, maxDelay: 0, retryableStatuses: [] },
  })
}

describe('the app door, end to end', () => {
  it('boots signed out, signs in, writes, lists, updates, aggregates, deletes and signs out', async () => {
    served = await serve('l-members')
    const s = served
    vi.stubGlobal('__pwfabric_runtime', { createEntityFacade })
    const auth = s.host.envelopeEntries(s.origin)['auth.json'] as PwappAuth
    const project = projectOf(auth as unknown as Record<string, unknown>, true, 'app')
    const storage = memoryStorage()

    // 1. Boot: nothing stored, the gateway has no cookie for us — signed out.
    const boot = await bootSession({ project, auth, storage, appId: 'contract-app', location: nowhere, history: noHistory })
    expect(boot).toEqual({ session: null, authError: null })

    // The gate is enforced server-side too: no receipt without a session.
    await expect(fetchJson(`${s.base}/surfaces/home.receipt.json`, doorHeaders({ appSession: undefined, doorToken: undefined }))).rejects.toThrow(
      /401/
    )

    // 2. Sign in through the password door, store the session as the runner does.
    const result = await signIn(auth.loginUrl!, { email: 'dev@localhost', password: 'unused' })
    expect(result.ok).toBe(true)
    const session = (result as { ok: true; session: AppSession }).session
    writeAppSession(storage, 'contract-app', session)
    expect(readAppSession(storage, 'contract-app')?.token).toBe(session.token)

    // A session without a profile is completed from sessionUrl.
    const bare: AppSession = { token: session.token, expiresAt: session.expiresAt }
    const full = await withProfile(bare, auth.sessionUrl)
    expect(full.principal).toEqual({ id: 'dev-user', email: 'dev@localhost', displayName: 'Developer' })

    // A reload finds the stored session with no request.
    const reboot = await bootSession({ project, auth, storage, appId: 'contract-app', location: nowhere, history: noHistory })
    expect(reboot.session?.token).toBe(session.token)

    // 3. The receipt, with the session as x-app-session.
    const receipt = await fetchJson<SurfaceReceipt>(
      `${s.base}/surfaces/home.receipt.json`,
      doorHeaders({ appSession: session.token, doorToken: undefined })
    )
    expect(receipt.title).toBe('Tasks')

    // 4. Entity path: the runner's facade builder, over the runtime's HTTP connector.
    const original = { capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'tasks', kind: 'entity', entityType: 'Task', connector: 'local' }] } }] }
    const bindings = extractEntityTypes(original)
    expect(bindings).toEqual([{ entityType: 'Task', connector: 'local' }])
    const facade = await buildEntityFacade(
      bindings,
      { connections: [{ name: 'local', connector: 'local' }] },
      async () => session.token,
      new Map(),
      { resolve: async () => recordsConnector(s.base, async () => session.token) }
    )
    expect(facade).toBeDefined()
    const store = facade!.store
    const Task = 'Task' as never

    const created = await store.create(Task, { title: 'Write the host', points: 3 })
    expect(created.success).toBe(true)
    const id = (created as { id: string }).id
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    await store.create(Task, { title: 'Test it', points: 5 })

    const listed = await facade!.resolveBinding(Task, { sort: [{ field: 'points', direction: 'desc' }], pagination: { offset: 0, limit: 10 } })
    expect(listed.items.map((r) => r.title)).toEqual(['Test it', 'Write the host'])
    expect(listed.total).toBe(2)

    const filtered = await facade!.resolveBinding(Task, { filter: { field: 'title', operator: 'startsWith', value: 'write' } })
    expect(filtered.items.map((r) => r.id)).toEqual([id])

    const updated = await store.update(Task, id as never, { done: true })
    expect(updated.success).toBe(true)
    const reread = await store.read(Task, id as never)
    expect(reread.success && (reread.data.data as { done: boolean }).done).toBe(true)

    expect(await facade!.resolveAggregate!(Task, { fn: 'sum', field: 'points' })).toEqual({ fn: 'sum', field: 'points', value: 8, count: 2 })
    expect(await facade!.resolveAggregate!(Task, { fn: 'count' })).toEqual({ fn: 'count', value: 2, count: 2 })
    expect(
      await facade!.resolveAggregate!(Task, { fn: 'count', filter: { field: 'done', operator: 'eq', value: true } })
    ).toEqual({ fn: 'count', value: 1, count: 1 })

    const deleted = await store.delete(Task, id as never)
    expect(deleted.success).toBe(true)
    expect((await facade!.resolveBinding(Task)).items).toHaveLength(1)

    // 5. Sign out — both places a session lives — and the host forgets the token.
    await signOut(auth, session.token)
    expect(await withProfile(bare, auth.sessionUrl)).toBe(bare)
    expect((await facade!.resolveBinding(Task)).items).toEqual([])
    await expect(facade!.resolveAggregate!(Task, { fn: 'count' })).rejects.toThrow(/401/)
  })

  it('serves the rewritten receipt sources through the runtime REST data path, with the runner credential rule', async () => {
    served = await serve('l-shop')
    const s = served
    const auth = s.host.envelopeEntries(s.origin)['auth.json'] as PwappAuth
    const ownApiBase = ownApiBaseOf(auth)
    expect(ownApiBase).toBe(s.base)
    const login = await signIn(auth.loginUrl!, { email: 'dev@localhost', password: 'b' })
    let appSession: AppSession | null = (login as { ok: true; session: AppSession }).session

    // run-app.ts `dataServiceConfig.getAccessToken`, as written there.
    const getAccessToken = async (ref?: string): Promise<string | null> => {
      if (!ref || !ownApiBase || ref.replace(/[/]+$/, '') !== ownApiBase) return null
      return appSession?.token ?? null
    }
    const service = new DataService({ getAccessToken })
    const receipt = await fetchJson<SurfaceReceipt>(`${s.base}/surfaces/home.receipt.json`, doorHeaders({ appSession: appSession.token, doorToken: undefined }))
    const orders = await fetchJson<SurfaceReceipt>(`${s.base}/surfaces/orders.receipt.json`, doorHeaders({ appSession: appSession.token, doorToken: undefined }))
    const sourcesOf = (r: SurfaceReceipt): Record<string, unknown>[] =>
      ((r.capabilities?.[0]?.config?.dataSources as Record<string, unknown>[] | undefined) ?? []).filter((x) => typeof x === 'object')
    for (const source of [...sourcesOf(receipt), ...sourcesOf(orders)]) {
      if (source.kind === 'rest') service.registerSource(source as never)
    }

    const products = await service.fetchData<{ name: string }[]>('products')
    expect(products.success && products.data.map((p) => p.name)).toEqual(['Cocoa', 'Coffee', 'Tea'])
    const spend = await service.fetchData<{ value: number }>('spend')
    expect(spend.success && spend.data).toEqual({ fn: 'sum', field: 'price', value: 11, count: 2 })

    // Orders are owner-scoped: the session token travels as a bearer because the ref is ours.
    const before = await service.fetchData<unknown[]>('howMany', { skipCache: true })
    expect(before.success && before.data).toEqual({ fn: 'count', value: 1, count: 1 })
    const write = await service.fetchData('orders', { method: 'POST', body: { item: 'Coffee', qty: 1 } })
    expect(write.success).toBe(true)
    const list = await service.fetchData<{ item: string; id: string }[]>('orders', { skipCache: true })
    expect(list.success && list.data.map((o) => o.item)).toEqual(['Coffee', 'Tea'])
    const id = list.success ? list.data[0]!.id : ''
    const patch = await service.fetchData('orders', { method: 'PATCH', recordId: id, body: { qty: 4 } })
    expect(patch.success).toBe(true)

    // Signed out, the same source is refused with the server's own words.
    appSession = null
    const refused = await service.fetchData('orders', { skipCache: true })
    expect(refused.success).toBe(false)
    expect(!refused.success && refused.error.message).toMatch(/Sign in/)
  })

  it('signs in with a provider through the gateway and back', async () => {
    served = await serve('l-social')
    const s = served
    const auth = s.host.envelopeEntries(s.origin)['auth.json'] as PwappAuth
    const assigned: string[] = []
    vi.stubGlobal('location', { assign: (u: string) => assigned.push(u) })

    startSocialSignIn(auth, 'github', '/#/home')
    expect(assigned).toEqual([`${s.base}/_auth/start/github?returnTo=${encodeURIComponent('/#/home')}`])

    // The browser follows the redirects; the cookie lands on the app origin.
    const toCallback = await fetch(assigned[0]!, { redirect: 'manual' })
    const back = await fetch(s.origin + toCallback.headers.get('location')!, { redirect: 'manual' })
    expect(back.headers.get('location')).toBe('/#/home')
    const cookie = back.headers.get('set-cookie')!.split(';')[0]!

    // What the browser does with `credentials: same-origin`.
    const nativeFetch = globalThis.fetch
    const withCookie: typeof fetch = (input, init) => nativeFetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), cookie } })
    const project = projectOf(auth as unknown as Record<string, unknown>, false, 'app')
    const storage = memoryStorage()
    const boot = await bootSession({ project, auth, storage, appId: 'social', fetchImpl: withCookie, location: nowhere, history: noHistory })
    expect(boot.session?.principal).toEqual({ id: 'dev-user', email: 'dev@localhost', displayName: 'Developer' })
    expect(readAppSession(storage, 'social')?.token).toBe(boot.session?.token)

    // Sign-out deletes the cookie's session (gateway logout, x-pwapp-request).
    vi.stubGlobal('fetch', withCookie)
    await signOut(auth, boot.session!.token)
    vi.unstubAllGlobals()
    expect(await readGatewaySession(auth, withCookie)).toBeNull()

    // A failed round trip comes back as ?auth_error, which boot reads and wipes.
    const replaced: string[] = []
    const failed = await bootSession({
      project,
      auth,
      storage: memoryStorage(),
      appId: 'social',
      location: { pathname: '/', search: '?auth_error=provider_unavailable', hash: '' },
      history: { replaceState: (_d: unknown, _t: string, url?: string | URL | null) => void replaced.push(String(url)) },
    })
    expect(failed.authError).toBe('provider_unavailable')
    expect(replaced).toEqual(['/'])
  })
})

describe('the external issuer stand-in, end to end', () => {
  beforeEach(() => clearDiscoveryCache())

  it("completes the runner's PKCE flow, restores from the refresh token, and presents the door token", async () => {
    served = await serve('l-issuer')
    const s = served
    const auth = s.host.envelopeEntries(s.origin)['auth.json'] as PwappAuth
    const storage = memoryStorage()
    const assigned: string[] = []
    const replaced: string[] = []
    const loc = { origin: s.origin, pathname: '/', search: '', hash: '#/home', assign: (u: string) => void assigned.push(u) }
    vi.stubGlobal('sessionStorage', storage)
    vi.stubGlobal('location', loc)
    vi.stubGlobal('history', { replaceState: (_d: unknown, _t: string, url?: string | URL | null) => void replaced.push(String(url)) })
    vi.stubGlobal('window', {})

    const bridge = createAuthBridge(auth, { redirectUri: `${s.origin}/` })
    await bridge.init()
    expect(bridge.session).toBeUndefined()

    // Sign in: discovery, then a full-page redirect to the authorize endpoint.
    bridge.loginWithPkce()
    await vi.waitFor(() => expect(assigned).toHaveLength(1))
    const authorize = new URL(assigned[0]!)
    expect(authorize.origin + authorize.pathname).toBe(`${s.base}/oidc/authorize`)
    expect(authorize.searchParams.get('scope')).toBe('openid profile email offline_access')

    // The browser goes there; the stand-in signs the development user in and sends it back.
    const res = await fetch(authorize, { redirect: 'manual' })
    const callback = new URL(res.headers.get('location')!)
    expect(callback.origin + callback.pathname).toBe(`${s.origin}/`)
    loc.search = callback.search
    await bridge.init()
    expect(bridge.lastError).toBeUndefined()
    expect(bridge.session?.user).toEqual({ id: 'dev-user', name: 'Developer', email: 'dev@localhost' })
    expect(replaced).toEqual(['/#/home'])

    // The door token opens a gated receipt; the data token reads records.
    const doorToken = await bridge.getDoorToken()
    expect(doorToken).toBeTruthy()
    const receipt = await fetchJson<SurfaceReceipt>(`${s.base}/surfaces/home.receipt.json`, doorHeaders({ appSession: undefined, doorToken }))
    expect(receipt.title).toBe('Docs')
    const accessToken = await bridge.getAccessToken()
    const docs = recordsConnector(s.base, async () => (await bridge.getAccessToken()) ?? null)
    const made = await docs.create('Doc' as never, { title: 'Spec' })
    expect(made.success).toBe(true)
    expect(accessToken).not.toBe(doorToken)

    // A reload restores the session silently from the stored refresh token.
    loc.search = ''
    const again = createAuthBridge(auth, { redirectUri: `${s.origin}/` })
    await again.init()
    expect(again.session?.user?.name).toBe('Developer')

    // Sign-out forgets it; the host refuses a stale or replayed callback.
    again.logout()
    expect(again.session).toBeUndefined()
    loc.search = callback.search
    const replay = createAuthBridge(auth, { redirectUri: `${s.origin}/` })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await replay.init()
    expect(replay.session).toBeUndefined()
    expect(replay.lastError).toBeTruthy()
  })
})
