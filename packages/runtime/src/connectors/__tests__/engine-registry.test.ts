/**
 * Connector Engine Registry Tests
 *
 * Registry constructs engines from loaded bundles with per-connection
 * config + an injectable access-token hook (the auth-registry seam),
 * caches instances, and isolates failures (failed entry with reason,
 * resolve() never throws).
 *
 * @module @pwfabric/runtime/connectors/__tests__/engine-registry
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createConnectorModuleLoader } from '../module-loader.js'
import {
  createConnectorEngineRegistry,
  DefaultConnectorEngineRegistry,
} from '../engine-registry.js'
import type {
  ConnectorAccessTokenHook,
  ConnectorConnectionBinding,
  ConnectorEngine,
  ConnectorEngineModule,
} from '../types.js'

// ============================================================
// HELPERS
// ============================================================

const BUNDLE_BYTES = new TextEncoder().encode('export const engine = true').buffer as ArrayBuffer

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let out = ''
  for (const v of digest) out += v.toString(16).padStart(2, '0')
  return out
}

let integrity: string

function binding(overrides: Partial<ConnectorConnectionBinding> = {}): ConnectorConnectionBinding {
  return {
    connection: 'graph-lists',
    descriptor: {
      id: 'graph-lists',
      kind: 'connector',
      bundleUrl: 'https://cdn.example.com/bundles/connector/graph-lists.bundle.mjs',
      integrity,
    },
    config: { siteHostname: 'contoso.sharepoint.com', sitePath: '/sites/intranet' },
    ...overrides,
  }
}

/** Loader whose evaluation yields the given module (fetch+integrity real). */
function loaderWith(mod: ConnectorEngineModule) {
  return createConnectorModuleLoader({ evaluate: async () => mod })
}

function stubFetchOk(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => BUNDLE_BYTES })) as unknown as typeof fetch
  )
}

// ============================================================
// TESTS
// ============================================================

describe('ConnectorEngineRegistry', () => {
  beforeEach(async () => {
    integrity = await sha256Hex(BUNDLE_BYTES)
    stubFetchOk()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('resolve (construction)', () => {
    it('constructs the engine with the connection config and caches the instance', async () => {
      const factory = vi.fn((_token: ConnectorAccessTokenHook, config: Record<string, unknown>) => ({
        name: 'graph-lists',
        receivedConfig: config,
        query: async () => ({ success: true as const, result: { items: [], total: 0 } }),
      }))
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({ createConnector: factory }),
      })
      registry.configure([binding()])

      const engine1 = await registry.resolve('graph-lists')
      const engine2 = await registry.resolve('graph-lists')

      expect(engine1).not.toBeNull()
      expect(engine2).toBe(engine1)
      expect(factory).toHaveBeenCalledTimes(1)
      expect(factory.mock.calls[0]?.[1]).toEqual({
        siteHostname: 'contoso.sharepoint.com',
        sitePath: '/sites/intranet',
      })
      expect(registry.getStatus('graph-lists')).toEqual({ state: 'ready' })
    })

    it('deduplicates concurrent resolves into one construction', async () => {
      const factory = vi.fn(() => ({ query: async () => ({ success: true }) }))
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({ createConnector: factory }),
      })
      registry.configure([binding()])

      const [a, b] = await Promise.all([
        registry.resolve('graph-lists'),
        registry.resolve('graph-lists'),
      ])

      expect(a).toBe(b)
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('resolves null for an unregistered connection', async () => {
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({ createConnector: () => ({ query: async () => ({}) }) }),
      })

      await expect(registry.resolve('unknown')).resolves.toBeNull()
      expect(registry.getStatus('unknown')).toEqual({ state: 'unregistered' })
    })
  })

  describe('access-token hook (auth seam)', () => {
    it('defaults to an unauthenticated hook resolving null', async () => {
      let capturedHook: ConnectorAccessTokenHook | undefined
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({
          createConnector: (getAccessToken) => {
            capturedHook = getAccessToken
            return { query: async () => ({ success: true }) }
          },
        }),
      })
      registry.configure([binding()])
      await registry.resolve('graph-lists')

      await expect(capturedHook?.()).resolves.toBeNull()
    })

    it('routes the injected resolver per connection binding', async () => {
      let capturedHook: ConnectorAccessTokenHook | undefined
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({
          createConnector: (getAccessToken) => {
            capturedHook = getAccessToken
            return { query: async () => ({ success: true }) }
          },
        }),
        getAccessToken: async (b) => `tok:${b.connection}:${b.authProviderRef ?? 'none'}`,
      })
      registry.configure([binding({ authProviderRef: 'entra-main' })])
      await registry.resolve('graph-lists')

      await expect(capturedHook?.()).resolves.toBe('tok:graph-lists:entra-main')
    })

    it('setAccessTokenResolver takes effect on the NEXT token request without reconstructing', async () => {
      let capturedHook: ConnectorAccessTokenHook | undefined
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({
          createConnector: (getAccessToken) => {
            capturedHook = getAccessToken
            return { query: async () => ({ success: true }) }
          },
        }),
      })
      registry.configure([binding()])
      await registry.resolve('graph-lists')
      await expect(capturedHook?.()).resolves.toBeNull()

      registry.setAccessTokenResolver(async () => 'fresh-token')

      await expect(capturedHook?.()).resolves.toBe('fresh-token')
    })
  })

  describe('error isolation', () => {
    it('marks the entry failed with the load reason and resolves null (never throws)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
      )
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({ createConnector: () => ({ query: async () => ({}) }) }),
      })
      registry.configure([binding()])

      await expect(registry.resolve('graph-lists')).resolves.toBeNull()

      const status = registry.getStatus('graph-lists')
      expect(status.state).toBe('failed')
      expect(status.state === 'failed' && status.reason).toContain('404')
    })

    it('marks failed when the factory output does not expose query()', async () => {
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({ createConnector: () => ({ notAnEngine: true }) }),
      })
      registry.configure([binding()])

      await expect(registry.resolve('graph-lists')).resolves.toBeNull()
      const status = registry.getStatus('graph-lists')
      expect(status.state).toBe('failed')
      expect(status.state === 'failed' && status.reason).toContain('query()')
    })

    it('failure is sticky until reconfigure', async () => {
      const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }))
      vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
      const registry = createConnectorEngineRegistry({
        loader: loaderWith({ createConnector: () => ({ query: async () => ({}) }) }),
      })
      registry.configure([binding()])

      await registry.resolve('graph-lists')
      await registry.resolve('graph-lists')
      expect(fetchMock).toHaveBeenCalledTimes(1) // no hammering

      stubFetchOk()
      registry.configure([binding()]) // reconfigure resets the entry
      await expect(registry.resolve('graph-lists')).resolves.not.toBeNull()
    })
  })

  describe('register / configure / clear', () => {
    it('register() exposes an in-process engine directly', async () => {
      const engine: ConnectorEngine = {
        name: 'local',
        query: async () => ({
          success: true,
          result: { items: [], total: 0, offset: 0, limit: 0, hasMore: false },
        }),
      }
      const registry = new DefaultConnectorEngineRegistry()

      registry.register('local', engine)

      await expect(registry.resolve('local')).resolves.toBe(engine)
      expect(registry.getStatus('local')).toEqual({ state: 'ready' })
      expect(registry.list()).toEqual(['local'])
    })

    it('configure() replaces the current set', () => {
      const registry = new DefaultConnectorEngineRegistry()
      registry.register('old', { query: async () => ({}) } as never)

      registry.configure([binding()])

      expect(registry.list()).toEqual(['graph-lists'])
      expect(registry.getStatus('old')).toEqual({ state: 'unregistered' })
      expect(registry.getStatus('graph-lists')).toEqual({ state: 'pending' })
    })

    it('clear() drops everything', () => {
      const registry = new DefaultConnectorEngineRegistry()
      registry.configure([binding()])

      registry.clear()

      expect(registry.list()).toEqual([])
    })
  })
})
