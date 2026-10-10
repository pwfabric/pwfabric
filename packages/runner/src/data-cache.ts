/**
 * Yesterday's rows while today's load.
 *
 * The runtime renderer accepts a `dataCache` and seeds a page's sources from
 * it on the first frame, then re-fetches (see
 * `@pwfabric/runtime` `SurfaceDataCache`). This is the
 * published app's copy of that cache: sessionStorage, scoped to the app,
 * bounded to the most recent entries, and never a reason for a page to fail —
 * a storage that refuses to write is treated as empty.
 *
 * sessionStorage on purpose: it lives as long as the tab, which is exactly
 * how long "I was just on that page" is true, and it is dropped with the
 * session the way the visitor's tokens are.
 */
import type { KeyValueStorage } from './pkce.js'

export interface DataCache {
  get(key: string): unknown
  set(key: string, value: unknown): void
  /**
   * Drop every entry of this app. Called on sign-out: the rows were read with
   * the previous visitor's credential and must not paint for the next one.
   */
  clear(): void
}

const DEFAULT_MAX_ENTRIES = 40

export function sessionDataCache(
  storage: KeyValueStorage,
  appId: string,
  options: { readonly maxEntries?: number } = {}
): DataCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const prefix = `pwapp_data:${appId}:`
  const indexKey = `pwapp_data_index:${appId}`

  const readIndex = (): string[] => {
    try {
      const raw = storage.getItem(indexKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  return {
    get(key) {
      try {
        const raw = storage.getItem(prefix + key)
        return raw === null ? undefined : (JSON.parse(raw) as unknown)
      } catch {
        return undefined
      }
    },
    set(key, value) {
      try {
        const index = readIndex().filter((k) => k !== key)
        index.push(key)
        while (index.length > maxEntries) {
          const evicted = index.shift()
          if (evicted !== undefined) storage.removeItem(prefix + evicted)
        }
        storage.setItem(prefix + key, JSON.stringify(value))
        storage.setItem(indexKey, JSON.stringify(index))
      } catch {
        // A full or refusing storage is an empty cache, not a broken page.
      }
    },
    clear() {
      // Each removal on its own: one refusal must not leave the rest behind.
      for (const key of readIndex()) {
        try {
          storage.removeItem(prefix + key)
        } catch {
          /* best effort */
        }
      }
      try {
        storage.removeItem(indexKey)
      } catch {
        /* best effort */
      }
    },
  }
}
