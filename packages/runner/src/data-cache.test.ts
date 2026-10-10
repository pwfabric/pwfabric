import { describe, expect, it, vi } from 'vitest'
import { sessionDataCache } from './data-cache.js'
import type { KeyValueStorage } from './pkce.js'

function memoryStorage(): KeyValueStorage & { readonly size: () => number } {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    size: () => map.size,
  }
}

describe('sessionDataCache — yesterday\'s rows while today\'s load', () => {
  it('round-trips a value through the storage as JSON', () => {
    const storage = memoryStorage()
    const cache = sessionDataCache(storage, 'app-1')
    cache.set('k1', [{ id: 1 }])
    expect(cache.get('k1')).toEqual([{ id: 1 }])
    expect(sessionDataCache(storage, 'app-1').get('k1')).toEqual([{ id: 1 }])
  })

  it('is scoped to the app, so two apps on one origin never read each other', () => {
    const storage = memoryStorage()
    sessionDataCache(storage, 'app-1').set('k1', 'one')
    expect(sessionDataCache(storage, 'app-2').get('k1')).toBeUndefined()
  })

  it('answers nothing for a missing or corrupt entry', () => {
    const storage = memoryStorage()
    const cache = sessionDataCache(storage, 'app-1')
    expect(cache.get('missing')).toBeUndefined()
    storage.setItem('pwapp_data:app-1:bad', '{not json')
    expect(cache.get('bad')).toBeUndefined()
  })

  it('keeps only the most recent entries, so the storage never fills up', () => {
    const storage = memoryStorage()
    const cache = sessionDataCache(storage, 'app-1', { maxEntries: 3 })
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('d')).toBe(4)
    expect(storage.size()).toBeLessThanOrEqual(4) // three entries + the index
  })

  it('swallows a storage that refuses to write, rather than breaking the page', () => {
    const storage = memoryStorage()
    storage.setItem = vi.fn(() => {
      throw new Error('QuotaExceededError')
    })
    const cache = sessionDataCache(storage, 'app-1')
    expect(() => cache.set('k', 'v')).not.toThrow()
    expect(cache.get('k')).toBeUndefined()
  })

  it("clear() drops every entry of this app — a signed-out visitor must not see the previous visitor's rows", () => {
    const storage = memoryStorage()
    const cache = sessionDataCache(storage, 'app-1')
    const other = sessionDataCache(storage, 'app-2')
    cache.set('a', 1)
    cache.set('b', 2)
    other.set('a', 'keep')
    cache.clear()
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
    expect(other.get('a')).toBe('keep')
    expect(storage.size()).toBe(2) // app-2's entry + its index
  })

  it('clear() on a refusing storage does not throw', () => {
    const storage = memoryStorage()
    storage.removeItem = vi.fn(() => {
      throw new Error('SecurityError')
    })
    const cache = sessionDataCache(storage, 'app-1')
    cache.set('a', 1)
    expect(() => cache.clear()).not.toThrow()
  })
})
