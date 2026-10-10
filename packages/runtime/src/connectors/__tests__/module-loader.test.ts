/**
 * Connector Module Loader Tests
 *
 * Mirrors the BlockModuleLoader suite: loading, caching, concurrent
 * dedup, failure recording (error isolation), and invalidation. The
 * Blob-URL import step is injected (evaluator seam) — browsers own that
 * step, tests own everything before it (fetch + integrity + export
 * resolution).
 *
 * @module @pwfabric/runtime/connectors/__tests__/module-loader
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createConnectorModuleLoader, ConnectorModuleLoader } from '../module-loader.js'
import type {
  ConnectorEngineDescriptor,
  ConnectorEngineFactory,
  ConnectorEngineModule,
} from '../types.js'

// ============================================================
// HELPERS
// ============================================================

const BUNDLE_BYTES = new TextEncoder().encode('export const x = 1').buffer as ArrayBuffer

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  let out = ''
  for (const v of digest) out += v.toString(16).padStart(2, '0')
  return out
}

function descriptor(overrides: Partial<ConnectorEngineDescriptor> = {}): ConnectorEngineDescriptor {
  return {
    id: 'graph-lists',
    kind: 'connector',
    bundleUrl: 'https://cdn.example.com/pwpacks/base/1.0.0/bundles/connector/graph-lists.bundle.mjs',
    integrity: 'set-per-test',
    ...overrides,
  }
}

function okFetch(bytes: ArrayBuffer = BUNDLE_BYTES) {
  return vi.fn(async () => ({
    ok: true,
    arrayBuffer: async () => bytes,
  })) as unknown as typeof fetch
}

const engineFactory: ConnectorEngineFactory = () => ({ query: async () => ({ success: true }) })

// ============================================================
// TESTS
// ============================================================

describe('ConnectorModuleLoader', () => {
  let integrity: string

  beforeEach(async () => {
    integrity = await sha256Hex(BUNDLE_BYTES)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('load', () => {
    it('fetches, verifies integrity, evaluates, and returns the createConnector factory', async () => {
      const fetchMock = okFetch()
      vi.stubGlobal('fetch', fetchMock)
      const evaluate = vi.fn(
        async (): Promise<ConnectorEngineModule> => ({ createConnector: engineFactory })
      )
      const loader = createConnectorModuleLoader({ evaluate })

      const factory = await loader.load(descriptor({ integrity }))

      expect(factory).toBe(engineFactory)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(evaluate).toHaveBeenCalledTimes(1)
      expect(loader.isLoaded('graph-lists')).toBe(true)
      expect(loader.getFailure('graph-lists')).toBeNull()
    })

    it('falls back to a default function export', async () => {
      vi.stubGlobal('fetch', okFetch())
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ default: engineFactory }),
      })

      await expect(loader.load(descriptor({ integrity }))).resolves.toBe(engineFactory)
    })

    it('caches by atom id — second load does not re-fetch', async () => {
      const fetchMock = okFetch()
      vi.stubGlobal('fetch', fetchMock)
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })
      const d = descriptor({ integrity })

      await loader.load(d)
      await loader.load(d)

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('deduplicates concurrent loads of the same atom', async () => {
      const fetchMock = okFetch()
      vi.stubGlobal('fetch', fetchMock)
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })
      const d = descriptor({ integrity })

      const [a, b] = await Promise.all([loader.load(d), loader.load(d)])

      expect(a).toBe(b)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('error isolation', () => {
    it('records the failure reason on fetch failure and rejects', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch
      )
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })

      await expect(loader.load(descriptor({ integrity }))).rejects.toThrow('404')
      expect(loader.getFailure('graph-lists')).toContain('404')
      expect(loader.isLoaded('graph-lists')).toBe(false)
    })

    it('refuses to evaluate a bundle whose integrity does not match', async () => {
      vi.stubGlobal('fetch', okFetch())
      const evaluate = vi.fn(
        async (): Promise<ConnectorEngineModule> => ({ createConnector: engineFactory })
      )
      const loader = createConnectorModuleLoader({ evaluate })
      const wrongIntegrity = 'a'.repeat(64)

      await expect(loader.load(descriptor({ integrity: wrongIntegrity }))).rejects.toThrow(
        'Integrity check failed'
      )
      expect(evaluate).not.toHaveBeenCalled()
      expect(loader.getFailure('graph-lists')).toContain('Integrity check failed')
    })

    it('fails honestly when the module exports no factory', async () => {
      vi.stubGlobal('fetch', okFetch())
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({}) as ConnectorEngineModule,
      })

      await expect(loader.load(descriptor({ integrity }))).rejects.toThrow(
        'does not export a connector factory'
      )
    })

    it('tryLoad returns null instead of throwing, with the reason retrievable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch
      )
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })

      await expect(loader.tryLoad(descriptor({ integrity }))).resolves.toBeNull()
      expect(loader.getFailure('graph-lists')).toContain('503')
    })

    it('a retry after failure succeeds and clears the failure record', async () => {
      let failNext = true
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (failNext) {
            failNext = false
            return { ok: false, status: 500 }
          }
          return { ok: true, arrayBuffer: async () => BUNDLE_BYTES }
        }) as unknown as typeof fetch
      )
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })
      const d = descriptor({ integrity })

      await expect(loader.load(d)).rejects.toThrow('500')
      await expect(loader.load(d)).resolves.toBe(engineFactory)
      expect(loader.getFailure('graph-lists')).toBeNull()
    })
  })

  describe('invalidate', () => {
    it('clears a specific atom id', async () => {
      vi.stubGlobal('fetch', okFetch())
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })
      await loader.load(descriptor({ integrity }))
      expect(loader.isLoaded('graph-lists')).toBe(true)

      loader.invalidate('graph-lists')

      expect(loader.isLoaded('graph-lists')).toBe(false)
    })

    it('clears everything when called without argument', async () => {
      vi.stubGlobal('fetch', okFetch())
      const loader = createConnectorModuleLoader({
        evaluate: async () => ({ createConnector: engineFactory }),
      })
      await loader.load(descriptor({ integrity }))

      loader.invalidate()

      expect(loader.isLoaded('graph-lists')).toBe(false)
      expect(loader.getFailure('graph-lists')).toBeNull()
    })
  })

  describe('singleton', () => {
    it('exposes a shared instance mirroring BlockModuleLoader', () => {
      expect(ConnectorModuleLoader.isLoaded('nonexistent')).toBe(false)
      expect(ConnectorModuleLoader.getFailure('nonexistent')).toBeNull()
    })
  })
})
