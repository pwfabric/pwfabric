/**
 * Dynamic Block Module Loader
 *
 * Loads third-party block ESM modules at runtime via dynamic import().
 * extends to first-party packs — the loader now SHA-256 hash
 * checks the bundle bytes against `descriptor.integrity` before evaluation
 * and discovers both the component and the BlockDefinition under stable
 * export names (`Component` + `definition`) emitted by the bundle wrapper.
 *
 * @module @pwfabric/runtime/render/dynamic-block-loader
 */

import type { BlockDefinition } from '@pwfabric/core'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import type { BlockComponent } from './types.js'

// ============================================================
// TYPES
// ============================================================

export interface LoadedAtom {
  readonly Component: BlockComponent
  readonly definition: BlockDefinition | null
}

interface CachedModule {
  readonly component: BlockComponent
  readonly definition: BlockDefinition | null
  readonly loadedAt: number
}

interface BlockModule {
  readonly default?: BlockComponent
  readonly component?: BlockComponent
  readonly render?: BlockComponent
  /** wrapper convention */
  readonly Component?: BlockComponent
  readonly definition?: BlockDefinition
}

// ============================================================
// MODULE LOADER
// ============================================================

/**
 * Singleton loader for dynamic block ESM modules.
 *
 * - Caches loaded modules by blockType
 * - Deduplicates concurrent requests for the same module
 * - Provides preload for fire-and-forget pre-fetching
 */
class BlockModuleLoaderImpl {
  private readonly cache = new Map<string, CachedModule>()
  private readonly pending = new Map<string, Promise<LoadedAtom>>()

  /**
   * Load a dynamic block module and return its component.
   */
  async load(descriptor: DynamicBlockDescriptor): Promise<BlockComponent> {
    const atom = await this.loadAtom(descriptor)
    return atom.Component
  }

  /**
   * load both the component and the BlockDefinition. Hash-checks
   * the bundle bytes against `descriptor.integrity` before evaluation.
   */
  async loadAtom(descriptor: DynamicBlockDescriptor): Promise<LoadedAtom> {
    // Check cache
    const cached = this.cache.get(descriptor.blockType)
    if (cached) return { Component: cached.component, definition: cached.definition }

    // Check pending (dedup concurrent requests)
    const inflight = this.pending.get(descriptor.blockType)
    if (inflight) return inflight

    const promise = this.doLoad(descriptor)
    this.pending.set(descriptor.blockType, promise)

    try {
      const atom = await promise
      this.cache.set(descriptor.blockType, {
        component: atom.Component,
        definition: atom.definition,
        loadedAt: Date.now(),
      })
      return atom
    } finally {
      this.pending.delete(descriptor.blockType)
    }
  }

  /**
   * Preload multiple block modules (fire-and-forget).
   */
  preload(descriptors: readonly DynamicBlockDescriptor[]): void {
    for (const descriptor of descriptors) {
      if (!this.cache.has(descriptor.blockType) && !this.pending.has(descriptor.blockType)) {
        this.loadAtom(descriptor).catch(() => {
          // Preload failure is non-fatal
        })
      }
    }
  }

  /**
   * Check if a block module is already loaded.
   */
  isLoaded(blockType: string): boolean {
    return this.cache.has(blockType)
  }

  /**
   * Synchronously get a cached block component, or null if not yet loaded.
   */
  getSync(blockType: string): BlockComponent | null {
    return this.cache.get(blockType)?.component ?? null
  }

  /**
   * Synchronously get the cached block definition, or null if not yet loaded
   * (or the bundle did not export one).
   */
  getDefinitionSync(blockType: string): BlockDefinition | null {
    return this.cache.get(blockType)?.definition ?? null
  }

  /**
   * Invalidate cache for a specific block type or all blocks.
   */
  invalidate(blockType?: string): void {
    if (blockType) {
      this.cache.delete(blockType)
    } else {
      this.cache.clear()
    }
  }

  private async doLoad(descriptor: DynamicBlockDescriptor): Promise<LoadedAtom> {
    const LOAD_TIMEOUT_MS = 10_000

    const fetchAndImport = async (): Promise<BlockModule> => {
      // integrity is required before evaluation. We fetch the
      // bundle, hash-verify the bytes against `descriptor.integrity`, and
      // only then create a Blob URL and feed it to `import()`. Skipping
      // this would let a CDN-side compromise execute attacker code under
      // our origin.
      const res = await fetch(descriptor.moduleUrl, { credentials: 'omit' })
      if (!res.ok) {
        throw new Error(`Bundle fetch failed for ${descriptor.blockType}: ${res.status}`)
      }
      const bytes = await res.arrayBuffer()
      await verifyIntegrity(bytes, descriptor.integrity, descriptor.blockType)

      const blob = new Blob([bytes], { type: 'text/javascript' })
      const blobUrl = URL.createObjectURL(blob)
      try {
        return (await import(/* webpackIgnore: true */ blobUrl)) as BlockModule
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
    }

    const loadPromise = fetchAndImport()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Module load timed out after ${LOAD_TIMEOUT_MS / 1000}s`)),
        LOAD_TIMEOUT_MS
      )
    )

    const mod = await Promise.race([loadPromise, timeoutPromise])

    // wrapper convention emits `Component` + `definition`.
    // Fall back to legacy export names so older bundles keep working.
    const component = mod.Component ?? mod.default ?? mod.component ?? mod.render
    if (!component || typeof component !== 'function') {
      throw new Error(`Module at ${descriptor.moduleUrl} does not export a valid block component`)
    }
    const definition: BlockDefinition | null =
      mod.definition && typeof mod.definition === 'object' ? mod.definition : null

    return { Component: component, definition }
  }
}

// ============================================================
// HASH VERIFICATION
// ============================================================

/**
 * SHA-256 verify the fetched bundle bytes against `descriptor.integrity`.
 *
 * Accepted formats:
 * - bare 64-char hex (the format `bundleHash` is stored in DB / listing
 *   metadata)
 * - SRI-style `sha256-<base64>` (allowed for forward-compat with W3C
 *   subresource-integrity strings)
 *
 * Empty / missing integrity is treated as a hard failure — this is a
 * security boundary, not a hint.
 *
 * Exported for unit tests; runtime callers should use `BlockModuleLoader.load`.
 */
export async function verifyIntegrity(
  bytes: ArrayBuffer,
  integrity: string,
  blockType: string
): Promise<void> {
  if (!integrity) {
    throw new Error(`Missing integrity for ${blockType}; refusing to evaluate bundle`)
  }
  const computed = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const computedHex = bytesToHex(computed)
  const expected = integrity.trim()

  if (/^[0-9a-f]{64}$/i.test(expected)) {
    if (computedHex.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Integrity check failed for ${blockType}`)
    }
    return
  }

  const sriMatch = /^sha256-(.+)$/i.exec(expected)
  if (sriMatch) {
    const expectedB64 = sriMatch[1] ?? ''
    const computedB64 = bytesToBase64(computed)
    if (expectedB64.replace(/=+$/, '') !== computedB64.replace(/=+$/, '')) {
      throw new Error(`Integrity check failed for ${blockType}`)
    }
    return
  }

  throw new Error(`Unrecognized integrity format for ${blockType}`)
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const v of bytes) {
    out += v.toString(16).padStart(2, '0')
  }
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (const v of bytes) {
    bin += String.fromCharCode(v)
  }
  return btoa(bin)
}

/**
 * Singleton instance
 */
export const BlockModuleLoader = new BlockModuleLoaderImpl()
