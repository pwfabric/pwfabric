/**
 * DataService Tests (formerly Data Capability Manager Tests)
 *
 * Tests for data source resolution, fetch, and binding
 *
 * @module @pwfabric/runtime/data/__tests__/manager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  DataService,
  DefaultDataCapability,
  createDataService,
  createDataCapability,
} from '../manager.js'
import type { DataSourceDefinition, DataBinding, DataServiceConfig } from '../types.js'

describe('DataService', () => {
  let service: DataService

  beforeEach(() => {
    service = new DataService()
  })

  // ============================================================
  // CONSTRUCTOR CONFIG
  // ============================================================

  describe('constructor', () => {
    it('should accept no config', () => {
      const s = new DataService()
      expect(s.config).toEqual({})
    })

    it('should accept config', () => {
      const config: DataServiceConfig = {
        defaultCacheTtl: 120,
        maxRetries: 5,
        timeout: 10000,
      }
      const s = new DataService(config)
      expect(s.config.defaultCacheTtl).toBe(120)
      expect(s.config.maxRetries).toBe(5)
      expect(s.config.timeout).toBe(10000)
    })
  })

  // ============================================================
  // SOURCE REGISTRATION
  // ============================================================

  describe('registerSource', () => {
    it('should register a static data source', () => {
      const source: DataSourceDefinition<string[]> = {
        id: 'users',
        kind: 'static',
        name: 'Users',
        staticData: ['Alice', 'Bob'],
      }

      service.registerSource(source)

      expect(service.hasSource('users')).toBe(true)
    })

    it('should throw when registering a duplicate source', () => {
      const source: DataSourceDefinition = {
        id: 'users',
        kind: 'static',
        staticData: [],
      }

      service.registerSource(source)

      expect(() => service.registerSource(source)).toThrow(
        "Data source 'users' is already registered"
      )
    })

    it('should register multiple sources', () => {
      service.registerSource({ id: 'a', kind: 'static', staticData: 1 })
      service.registerSource({ id: 'b', kind: 'static', staticData: 2 })
      service.registerSource({ id: 'c', kind: 'static', staticData: 3 })

      expect(service.getSourceIds()).toHaveLength(3)
      expect(service.getSourceIds()).toContain('a')
      expect(service.getSourceIds()).toContain('b')
      expect(service.getSourceIds()).toContain('c')
    })
  })

  // ============================================================
  // SOURCE RESOLUTION
  // ============================================================

  describe('resolveDataSource', () => {
    it('should resolve a registered source', () => {
      const source: DataSourceDefinition = {
        id: 'users',
        kind: 'static',
        name: 'Users List',
        staticData: ['Alice'],
      }
      service.registerSource(source)

      const resolved = service.resolveDataSource('users')

      expect(resolved).toBeDefined()
      expect(resolved?.id).toBe('users')
      expect(resolved?.name).toBe('Users List')
    })

    it('should return undefined for unknown source', () => {
      expect(service.resolveDataSource('nonexistent')).toBeUndefined()
    })
  })

  // ============================================================
  // FETCH DATA
  // ============================================================

  describe('fetchData', () => {
    it('should fetch static data', async () => {
      service.registerSource({
        id: 'items',
        kind: 'static',
        staticData: [1, 2, 3],
      })

      const result = await service.fetchData<number[]>('items')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual([1, 2, 3])
        expect(result.metadata.fromCache).toBe(false)
        expect(result.metadata.duration).toBeGreaterThanOrEqual(0)
        expect(result.metadata.timestamp).toBeGreaterThan(0)
      }
    })

    it('should fetch computed data', async () => {
      service.registerSource({
        id: 'computed',
        kind: 'computed',
        compute: (ctx) => {
          const multiplier = (ctx.params.multiplier as number) ?? 1
          return 42 * multiplier
        },
      })

      const result = await service.fetchData<number>('computed', {
        params: { multiplier: 2 },
      })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toBe(84)
      }
    })

    it('should fetch async computed data', async () => {
      service.registerSource({
        id: 'async-computed',
        kind: 'computed',
        compute: async () => {
          return { value: 'async-result' }
        },
      })

      const result = await service.fetchData<{ value: string }>('async-computed')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.value).toBe('async-result')
      }
    })

    it('should apply transform function', async () => {
      service.registerSource({
        id: 'transformed',
        kind: 'static',
        staticData: { items: [1, 2, 3], total: 3 },
        transform: (raw) => (raw as { items: number[] }).items,
      })

      const result = await service.fetchData<number[]>('transformed')

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual([1, 2, 3])
      }
    })

    it('should return not_found error for missing source', async () => {
      const result = await service.fetchData('nonexistent')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('not_found')
        expect(result.error.message).toContain('nonexistent')
      }
    })

    it('should return error when computed source has no compute function', async () => {
      service.registerSource({
        id: 'broken',
        kind: 'computed',
      })

      const result = await service.fetchData('broken')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('unknown')
      }
    })

    it('should classify AbortError as timeout type', async () => {
      service.registerSource({
        id: 'abort-source',
        kind: 'computed',
        compute: () => {
          const err = new Error('The user aborted a request')
          err.name = 'AbortError'
          throw err
        },
      })

      const result = await service.fetchData('abort-source')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('timeout')
        expect(result.error.message).toBe('Request was aborted')
      }
    })

    it('should evict expired cache entries and re-fetch', async () => {
      vi.useFakeTimers()

      service.registerSource({
        id: 'short-ttl',
        kind: 'static',
        staticData: 'fresh-data',
        cache: { enabled: true, ttl: 100 }, // 100ms TTL
      })

      const result1 = await service.fetchData('short-ttl')
      expect(result1.success).toBe(true)
      if (result1.success) expect(result1.metadata.fromCache).toBe(false)

      // Advance time past the TTL
      vi.advanceTimersByTime(200)

      const result2 = await service.fetchData('short-ttl')
      expect(result2.success).toBe(true)
      // Expired cache should NOT be returned — should re-fetch
      if (result2.success) expect(result2.metadata.fromCache).toBe(false)

      vi.useRealTimers()
    })

    it('should classify non-Error thrown values as unknown with String(err)', async () => {
      service.registerSource({
        id: 'throw-string',
        kind: 'computed',
        compute: () => {
          throw 'something went wrong'
        },
      })

      const result = await service.fetchData('throw-string')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('unknown')
        expect(result.error.message).toBe('something went wrong')
      }
    })

    it('should classify error with timeout message as timeout type', async () => {
      service.registerSource({
        id: 'timeout-source',
        kind: 'computed',
        compute: () => {
          throw new Error('Request timeout exceeded')
        },
      })

      const result = await service.fetchData('timeout-source')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('timeout')
      }
    })

    it('should classify error with status code as network type', async () => {
      service.registerSource({
        id: 'network-source',
        kind: 'computed',
        compute: () => {
          const err = Object.assign(new Error('Not Found'), { status: 404 })
          throw err
        },
      })

      const result = await service.fetchData('network-source')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('network')
        expect((result.error as { status?: number }).status).toBe(404)
      }
    })

    it('should use cache on second fetch', async () => {
      service.registerSource({
        id: 'cached',
        kind: 'static',
        staticData: { value: 'cached-data' },
        cache: { enabled: true, ttl: 60_000 },
      })

      const result1 = await service.fetchData('cached')
      const result2 = await service.fetchData('cached')

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      if (result1.success && result2.success) {
        expect(result1.metadata.fromCache).toBe(false)
        expect(result2.metadata.fromCache).toBe(true)
      }
    })

    it('should skip cache when skipCache option is set', async () => {
      service.registerSource({
        id: 'cached',
        kind: 'static',
        staticData: 'data',
        cache: { enabled: true, ttl: 60_000 },
      })

      await service.fetchData('cached')
      const result = await service.fetchData('cached', { skipCache: true })

      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.metadata.fromCache).toBe(false)
      }
    })

    it('should use defaultCacheTtl from config when source has no ttl', async () => {
      const configuredService = new DataService({ defaultCacheTtl: 60 })
      configuredService.registerSource({
        id: 'auto-cached',
        kind: 'static',
        staticData: 'data',
        cache: { enabled: true },
      })

      const result1 = await configuredService.fetchData('auto-cached')
      const result2 = await configuredService.fetchData('auto-cached')

      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      if (result1.success && result2.success) {
        expect(result1.metadata.fromCache).toBe(false)
        expect(result2.metadata.fromCache).toBe(true)
      }
    })
  })

  // ============================================================
  // DATA BINDING
  // ============================================================

  describe('fetchData — REST source', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
      globalThis.fetch = vi.fn()
    })

    afterEach(() => {
      globalThis.fetch = originalFetch
    })

    it('should fetch from REST endpoint', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ result: 'ok' }),
      })

      service.registerSource({
        id: 'rest-source',
        kind: 'rest',
        endpoint: '/api/data',
      })

      const result = await service.fetchData('rest-source')

      expect(result.success).toBe(true)
      if (result.success) {
        expect((result.data as { result: string }).result).toBe('ok')
      }
    })

    it('plucks the list out of the property `returns` names', async () => {
      // Three response shapes were in circulation — ours `{data:[…]}`,
      // DummyJSON's `{products:[…]}`, and a bare array — and the binding
      // context received whichever came back.
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ products: [{ id: 1 }, { id: 2 }], total: 194 }),
      })

      service.registerSource({
        id: 'dj',
        kind: 'rest',
        endpoint: 'https://dummyjson.com/products',
        returns: 'products',
      })

      const result = await service.fetchData('dj')
      expect(result.success).toBe(true)
      if (result.success) expect(result.data).toEqual([{ id: 1 }, { id: 2 }])
    })

    it('reads a nested path, for the API that wraps twice', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ payload: { items: [{ id: 1 }] } }),
      })

      service.registerSource({
        id: 'nested',
        kind: 'rest',
        endpoint: '/api/x',
        returns: 'payload.items',
      })

      const result = await service.fetchData('nested')
      if (!result.success) throw new Error('expected success')
      expect(result.data).toEqual([{ id: 1 }])
    })

    it('applies the source query to the rows it fetched — filter, sort, pagination', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: 'a', status: 'open', severity: 'low' },
            { id: 'b', status: 'resolved', severity: 'high' },
            { id: 'c', status: 'open', severity: 'critical' },
          ],
        }),
      })

      service.registerSource({
        id: 'incidents',
        kind: 'rest',
        endpoint: 'https://api.example/records/Incident',
        returns: 'data',
        query: {
          filter: { field: 'status', operator: 'eq', value: 'open' },
          sort: [{ field: 'severity', direction: 'asc' }],
          pagination: { offset: 0, limit: 1 },
        },
      } as DataSourceDefinition)

      const result = await service.fetchData('incidents')
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual([{ id: 'c', status: 'open', severity: 'critical' }])
      }
      // Nothing about the query reached the wire.
      const url = String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      expect(url).not.toMatch(/[?&](filter|sort|limit|offset)=/)
    })

    it('returns the body untouched when `returns` is absent', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => [{ id: 1 }],
      })

      service.registerSource({ id: 'bare', kind: 'rest', endpoint: '/api/bare' })

      const result = await service.fetchData('bare')
      if (!result.success) throw new Error('expected success')
      expect(result.data).toEqual([{ id: 1 }])
    })

    it('FAILS when the named path is not there, rather than binding nothing', async () => {
      // A silently empty panel is the failure this field exists to end. "The
      // endpoint answered, but not with what the plan said" is actionable.
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ results: [] }),
      })

      service.registerSource({
        id: 'wrong',
        kind: 'rest',
        endpoint: '/api/x',
        returns: 'products',
      })

      const result = await service.fetchData('wrong')
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.message).toContain('products')
    })

    it('sends the cookie to OUR origin and to nobody else', async () => {
      // The platform store is a REST resource like any other; the one thing
      // that differs is that it authenticates by cookie. A published app is
      // cross-origin from the API, so fetch's `same-origin` default would drop
      // it silently — and sending one to a third party would be a leak.
      const svc = new DataService({ platformApiOrigin: 'https://api.example.com' })
      const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
      ;(globalThis.fetch as unknown) = spy

      svc.registerSource({
        id: 'ours',
        kind: 'rest',
        endpoint: 'https://api.example.com/records/Product',
      })
      svc.registerSource({ id: 'theirs', kind: 'rest', endpoint: 'https://dummyjson.com/products' })
      svc.registerSource({ id: 'relative', kind: 'rest', endpoint: '/api/records/Product' })

      await svc.fetchData('ours')
      expect(spy.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' })

      await svc.fetchData('theirs')
      expect(spy.mock.calls[1]?.[1]).toMatchObject({ credentials: 'omit' })

      // A relative endpoint is same-document, which is ours by definition.
      await svc.fetchData('relative')
      expect(spy.mock.calls[2]?.[1]).toMatchObject({ credentials: 'include' })
    })

    it('sends no cookie anywhere when no platform origin is declared', async () => {
      const svc = new DataService({})
      const spy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
      ;(globalThis.fetch as unknown) = spy

      svc.registerSource({ id: 'x', kind: 'rest', endpoint: 'https://api.example.com/x' })
      await svc.fetchData('x')

      expect(spy.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' })
    })

    it('should handle REST 4xx error as network error', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      })

      service.registerSource({
        id: 'rest-fail',
        kind: 'rest',
        endpoint: '/api/missing',
      })

      const result = await service.fetchData('rest-fail')

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('network')
      }
    })

    it('should send POST body for REST source with method POST', async () => {
      ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ created: true }),
      })

      service.registerSource({
        id: 'rest-post',
        kind: 'rest',
        endpoint: '/api/create',
        method: 'POST',
      })

      const result = await service.fetchData('rest-post', { body: { name: 'test' } })

      expect(result.success).toBe(true)
      const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ]
      expect(init.body).toBe(JSON.stringify({ name: 'test' }))
    })
  })

  describe('bindData', () => {
    it('should create a live data binding', () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: 'hello',
      })

      const binding: DataBinding = {
        id: 'binding-1',
        sourceId: 'source',
        targetPath: 'content.text',
      }

      const liveBinding = service.bindData(binding)

      expect(liveBinding).toBeDefined()
      expect(liveBinding.binding.id).toBe('binding-1')
      expect(liveBinding.state).toBe('idle')
      expect(liveBinding.data).toBeUndefined()
      expect(liveBinding.error).toBeUndefined()
    })

    it('should refresh a live binding', async () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: { message: 'hello world' },
      })

      const liveBinding = service.bindData({
        id: 'binding-2',
        sourceId: 'source',
        targetPath: 'text',
      })

      const result = await liveBinding.refresh()

      expect(result.success).toBe(true)
      expect(liveBinding.state).toBe('loaded')
      expect(liveBinding.data).toEqual({ message: 'hello world' })
    })

    it('should apply binding transform on refresh', async () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: { items: ['a', 'b', 'c'] },
      })

      const liveBinding = service.bindData<{ items: string[] }>({
        id: 'binding-3',
        sourceId: 'source',
        targetPath: 'list',
        transform: (data) => data.items.length,
      })

      await liveBinding.refresh()

      expect(liveBinding.state).toBe('loaded')
      // Transform returns number, but data type is the source type
      expect(liveBinding.data).toBe(3)
    })

    it('should notify subscribers on refresh', async () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: 'data',
      })

      const liveBinding = service.bindData({
        id: 'binding-4',
        sourceId: 'source',
        targetPath: 'path',
      })

      const states: string[] = []
      liveBinding.subscribe((_data, state) => {
        states.push(state)
      })

      await liveBinding.refresh()

      expect(states).toContain('loading')
      expect(states).toContain('loaded')
    })

    it('should unsubscribe correctly', async () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: 'data',
      })

      const liveBinding = service.bindData({
        id: 'binding-5',
        sourceId: 'source',
        targetPath: 'path',
      })

      const callback = vi.fn()
      const unsubscribe = liveBinding.subscribe(callback)

      unsubscribe()
      await liveBinding.refresh()

      expect(callback).not.toHaveBeenCalled()
    })

    it('should handle fetch error in binding', async () => {
      service.registerSource({
        id: 'failing',
        kind: 'computed',
        compute: () => {
          throw new Error('Compute failed')
        },
      })

      const liveBinding = service.bindData({
        id: 'binding-6',
        sourceId: 'failing',
        targetPath: 'path',
      })

      const result = await liveBinding.refresh()

      expect(result.success).toBe(false)
      expect(liveBinding.state).toBe('error')
      expect(liveBinding.error).toBeDefined()
    })

    it('should dispose and reset state', async () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: 'hello',
      })

      const liveBinding = service.bindData({
        id: 'binding-dispose',
        sourceId: 'source',
        targetPath: 'path',
      })

      await liveBinding.refresh()
      expect(liveBinding.state).toBe('loaded')
      expect(liveBinding.data).toBe('hello')

      liveBinding.dispose()

      expect(liveBinding.state).toBe('idle')
      expect(liveBinding.data).toBeUndefined()
      expect(liveBinding.error).toBeUndefined()
    })

    it('should swallow listener errors during notify', async () => {
      service.registerSource({
        id: 'source',
        kind: 'static',
        staticData: 'value',
      })

      const liveBinding = service.bindData({
        id: 'binding-throw',
        sourceId: 'source',
        targetPath: 'path',
      })

      // Subscribe a listener that throws
      liveBinding.subscribe(() => {
        throw new Error('Listener explosion')
      })

      // Should not throw even though listener throws
      await expect(liveBinding.refresh()).resolves.toBeDefined()
      expect(liveBinding.state).toBe('loaded')
    })
  })

  // ============================================================
  // UNREGISTER AND CLEAR
  // ============================================================

  describe('unregisterSource', () => {
    it('should unregister an existing source', () => {
      service.registerSource({ id: 'a', kind: 'static', staticData: 1 })

      expect(service.unregisterSource('a')).toBe(true)
      expect(service.hasSource('a')).toBe(false)
    })

    it('should return false for unknown source', () => {
      expect(service.unregisterSource('nonexistent')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all sources and bindings', () => {
      service.registerSource({ id: 'a', kind: 'static', staticData: 1 })
      service.registerSource({ id: 'b', kind: 'static', staticData: 2 })

      service.clear()

      expect(service.getSourceIds()).toHaveLength(0)
      expect(service.hasSource('a')).toBe(false)
      expect(service.hasSource('b')).toBe(false)
    })
  })
})

// ============================================================
// BACKWARD COMPATIBILITY
// ============================================================

describe('DefaultDataCapability (backward compat)', () => {
  it('should be the same as DataService', () => {
    expect(DefaultDataCapability).toBe(DataService)
  })

  it('should be instantiable', () => {
    const instance = new DefaultDataCapability()
    expect(instance).toBeInstanceOf(DataService)
  })
})

describe('createDataService', () => {
  it('should create a DataService instance', () => {
    const service = createDataService()
    expect(service).toBeInstanceOf(DataService)
  })

  it('should create a DataService with config', () => {
    const service = createDataService({ defaultCacheTtl: 60, maxRetries: 2 })
    expect(service).toBeInstanceOf(DataService)
  })
})

describe('createDataCapability (backward compat)', () => {
  it('should create a DataService instance', () => {
    const instance = createDataCapability()
    expect(instance).toBeInstanceOf(DataService)
  })
})

/**
 * a data call made AS THE SIGNED-IN USER.
 *
 * From a published app's own origin: SharePoint REST anonymous → 403, with
 * cookies → CORS-blocked, Graph without a bearer → 401. Without
 * `authProviderRef` a `rest` source could not read authenticated data at all,
 * so the only answer to "read this API as me" would be a TypeScript engine.
 */
describe('DataService — authenticated REST', () => {
  const captured: Array<{ url: string; headers: Record<string, string> }> = []

  beforeEach(() => {
    captured.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        captured.push({ url: String(url), headers: (init.headers ?? {}) as Record<string, string> })
        return { ok: true, status: 200, json: async () => ({ items: [] }) } as unknown as Response
      })
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  const source = (extra: Partial<DataSourceDefinition> = {}): DataSourceDefinition => ({
    id: 'adaylar',
    kind: 'rest',
    endpoint: 'https://api.example.com/adaylar',
    ...extra,
  })

  it('attaches the identity the source names', async () => {
    const svc = new DataService({ getAccessToken: async () => 'live-token' })
    svc.registerSource(source({ authProviderRef: 'microsoft' }))
    await svc.fetchData('adaylar')

    expect(captured[0]?.headers['Authorization']).toBe('Bearer live-token')
  })

  it('resolves the token PER CALL — a session-length token is why this is a function', async () => {
    let n = 0
    const svc = new DataService({ getAccessToken: async () => `token-${++n}` })
    svc.registerSource(source({ authProviderRef: 'microsoft', cache: { enabled: false } }))

    await svc.fetchData('adaylar')
    await svc.fetchData('adaylar', { skipCache: true })

    expect(captured.map((c) => c.headers['Authorization'])).toEqual([
      'Bearer token-1',
      'Bearer token-2',
    ])
  })

  it('passes the ref through, so one app can hold more than one identity', async () => {
    const seen: Array<string | undefined> = []
    const svc = new DataService({
      getAccessToken: async (ref) => {
        seen.push(ref)
        return 't'
      },
    })
    svc.registerSource(source({ authProviderRef: 'musteri-b2b' }))
    await svc.fetchData('adaylar')

    expect(seen).toEqual(['musteri-b2b'])
  })

  it('still sends the request when the resolver answers null — the server says 401, not us', async () => {
    const svc = new DataService({ getAccessToken: async () => null })
    svc.registerSource(source({ authProviderRef: 'microsoft' }))
    await svc.fetchData('adaylar')

    expect(captured).toHaveLength(1)
    expect(captured[0]?.headers['Authorization']).toBeUndefined()
  })

  it('a source naming no identity is untouched — today’s behaviour, pinned', async () => {
    const svc = new DataService({ getAccessToken: async () => 'live-token' })
    svc.registerSource(source())
    await svc.fetchData('adaylar')

    expect(captured[0]?.headers['Authorization']).toBeUndefined()
  })
})

// ============================================================
// WRITES — a form addressing one record of a collection it reads
// ============================================================

describe('fetchData — writes against a REST source', () => {
  const originalFetch = globalThis.fetch
  let service: DataService

  beforeEach(() => {
    globalThis.fetch = vi.fn()
    service = new DataService()
    service.registerSource({
      id: 'me',
      kind: 'rest',
      endpoint: 'https://api.test/api/app/w/p/records/Attendee/',
      returns: 'data',
      cache: { enabled: true, ttl: 60_000 },
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('`recordId` addresses one record under the collection endpoint', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'r 1', name: 'Rivka' } }),
    })
    const result = await service.fetchData('me', { method: 'PATCH', body: { name: 'Rivka' }, recordId: 'r 1' })
    expect(result.success).toBe(true)
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit]
    // No double slash, the id encoded.
    expect(url).toBe('https://api.test/api/app/w/p/records/Attendee/r%201')
    expect(init.method).toBe('PATCH')
    expect(init.body).toBe(JSON.stringify({ name: 'Rivka' }))
  })

  it('a refused write carries the server status, code and message', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'Route not found' } }),
    })
    const result = await service.fetchData('me', { method: 'PATCH', body: {} })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.status).toBe(404)
      expect(result.error.code).toBe('NOT_FOUND')
      expect(result.error.message).toBe('Route not found')
    }
  })

  it('a refusal without a JSON body still reports the HTTP status line', async () => {
    ;(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
      json: async () => {
        throw new Error('not json')
      },
    })
    const result = await service.fetchData('me', { method: 'POST', body: {} })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.status).toBe(502)
      expect(result.error.code).toBeUndefined()
      expect(result.error.message).toBe('HTTP 502: Bad Gateway')
    }
  })

  it('a write neither reads nor fills the read cache', async () => {
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'a' }] }) })
    const read = await service.fetchData('me')
    expect(read.success && read.data).toEqual([{ id: 'a' }])

    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: 'b' } }) })
    const write = await service.fetchData('me', { method: 'POST', body: { name: 'B' } })
    // Not answered from the cache: the POST went out and its own record came back.
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(write.success && write.data).toEqual({ id: 'b' })

    // And the list a reader sees afterwards is still the list, not the record.
    const again = await service.fetchData('me')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(again.success && again.data).toEqual([{ id: 'a' }])
  })
})
