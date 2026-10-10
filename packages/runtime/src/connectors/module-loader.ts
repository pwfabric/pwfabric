/**
 * Connector Module Loader
 *
 * Mirror of `BlockModuleLoader` (render/dynamic-block-loader.ts) for
 * kind='connector' / kind='provider' atom bundles: fetches the ESM bundle
 * from `bundleUrl`, SHA-256 verifies the bytes against
 * `descriptor.integrity` BEFORE evaluation (same security boundary as block
 * bundles — a CDN-side compromise must not execute under our origin), then
 * imports it via a Blob URL and resolves the engine FACTORY under the
 * stable export convention (`createConnector`, `default` fallback).
 *
 * Error isolation: a failed load never throws out of `tryLoad` — the
 * failure reason is recorded per atom id (`getFailure`) so the registry can
 * mark its entry failed and consumers degrade honestly. `load` (the raw
 * form) rejects for callers that want the exception.
 *
 * @module @pwfabric/runtime/connectors/module-loader
 */

import { verifyIntegrity } from '../render/dynamic-block-loader.js'
import type {
  ConnectorEngineDescriptor,
  ConnectorEngineFactory,
  ConnectorEngineModule,
} from './types.js'

// ============================================================
// TYPES
// ============================================================

/**
 * Evaluates verified bundle bytes into a module namespace. Injectable so
 * tests (and non-browser hosts) can substitute the Blob-URL `import()`
 * step, which only exists in browsers.
 */
export type ConnectorModuleEvaluator = (
  bytes: ArrayBuffer,
  descriptor: ConnectorEngineDescriptor
) => Promise<ConnectorEngineModule>

interface CachedEngineModule {
  readonly factory: ConnectorEngineFactory
  readonly loadedAt: number
}

const LOAD_TIMEOUT_MS = 10_000

// ============================================================
// DEFAULT EVALUATOR (browser Blob-URL import)
// ============================================================

async function blobImportEvaluator(
  bytes: ArrayBuffer,
  _descriptor: ConnectorEngineDescriptor
): Promise<ConnectorEngineModule> {
  const blob = new Blob([bytes], { type: 'text/javascript' })
  const blobUrl = URL.createObjectURL(blob)
  try {
    return (await import(/* webpackIgnore: true */ blobUrl)) as ConnectorEngineModule
  } finally {
    URL.revokeObjectURL(blobUrl)
  }
}

// ============================================================
// MODULE LOADER
// ============================================================

/**
 * Loader for connector-engine ESM bundles.
 *
 * - Caches loaded factories by atom id
 * - Deduplicates concurrent requests for the same atom
 * - Records the last failure reason per atom id (does NOT poison the cache
 *   — a later retry is allowed and clears the failure on success)
 */
export class ConnectorModuleLoaderImpl {
  private readonly cache = new Map<string, CachedEngineModule>()
  private readonly pending = new Map<string, Promise<ConnectorEngineFactory>>()
  private readonly failures = new Map<string, string>()
  private readonly evaluate: ConnectorModuleEvaluator

  constructor(options?: { readonly evaluate?: ConnectorModuleEvaluator }) {
    this.evaluate = options?.evaluate ?? blobImportEvaluator
  }

  /**
   * Load a connector engine bundle and return its factory. Rejects on
   * failure (fetch / integrity / export shape / timeout) after recording
   * the reason — see `tryLoad` for the non-throwing form.
   */
  async load(descriptor: ConnectorEngineDescriptor): Promise<ConnectorEngineFactory> {
    const cached = this.cache.get(descriptor.id)
    if (cached) return cached.factory

    const inflight = this.pending.get(descriptor.id)
    if (inflight) return inflight

    const promise = this.doLoad(descriptor)
    this.pending.set(descriptor.id, promise)

    try {
      const factory = await promise
      this.cache.set(descriptor.id, { factory, loadedAt: Date.now() })
      this.failures.delete(descriptor.id)
      return factory
    } catch (err) {
      this.failures.set(descriptor.id, err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      this.pending.delete(descriptor.id)
    }
  }

  /**
   * Non-throwing load: `null` on failure, with the reason retrievable via
   * `getFailure(descriptor.id)`.
   */
  async tryLoad(descriptor: ConnectorEngineDescriptor): Promise<ConnectorEngineFactory | null> {
    try {
      return await this.load(descriptor)
    } catch {
      return null
    }
  }

  /** Whether the factory for an atom id is already cached. */
  isLoaded(atomId: string): boolean {
    return this.cache.has(atomId)
  }

  /** Last recorded failure reason for an atom id, or null. */
  getFailure(atomId: string): string | null {
    return this.failures.get(atomId) ?? null
  }

  /** Invalidate cache (and failure record) for one atom id or all. */
  invalidate(atomId?: string): void {
    if (atomId) {
      this.cache.delete(atomId)
      this.failures.delete(atomId)
    } else {
      this.cache.clear()
      this.failures.clear()
    }
  }

  private async doLoad(descriptor: ConnectorEngineDescriptor): Promise<ConnectorEngineFactory> {
    const fetchAndEvaluate = async (): Promise<ConnectorEngineModule> => {
      const res = await fetch(descriptor.bundleUrl, { credentials: 'omit' })
      if (!res.ok) {
        throw new Error(`Bundle fetch failed for ${descriptor.id}: ${res.status}`)
      }
      const bytes = await res.arrayBuffer()
      // Same law as block bundles: integrity is verified BEFORE evaluation.
      await verifyIntegrity(bytes, descriptor.integrity, descriptor.id)
      return this.evaluate(bytes, descriptor)
    }

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Module load timed out after ${LOAD_TIMEOUT_MS / 1000}s`)),
        LOAD_TIMEOUT_MS
      )
    )

    const mod = await Promise.race([fetchAndEvaluate(), timeoutPromise])

    const factory = mod.createConnector ?? mod.default
    if (typeof factory !== 'function') {
      throw new Error(
        `Module at ${descriptor.bundleUrl} does not export a connector factory ` +
          `(expected 'createConnector' or a default function export)`
      )
    }
    return factory
  }
}

/**
 * Create a loader with injectable evaluation (tests / non-browser hosts).
 */
export function createConnectorModuleLoader(options?: {
  readonly evaluate?: ConnectorModuleEvaluator
}): ConnectorModuleLoaderImpl {
  return new ConnectorModuleLoaderImpl(options)
}

/**
 * Singleton instance — mirrors `BlockModuleLoader`.
 */
export const ConnectorModuleLoader = new ConnectorModuleLoaderImpl()
