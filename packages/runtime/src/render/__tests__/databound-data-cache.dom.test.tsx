// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — the host-provided data cache (stale-while-revalidate).
 *
 * A page the visitor has already seen should not come back empty while its
 * sources are re-fetched. When the host hands the renderer a `dataCache`, a
 * source whose key is present is seeded from it on the first frame and still
 * re-fetched; the fresh result replaces the seed and is written back.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-data-cache.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { dataSourceCacheKey, type SurfaceDataCache } from '../data-cache.js'
import type { BlockComponentRegistry } from '../types.js'
import type { SurfaceDataSourceDefinition } from '../data-binding-types.js'

afterEach(() => cleanup())

const L = DEFAULT_BLOCK_LAYOUT

const components: Partial<BlockComponentRegistry> = {
  table: (({ props }: { props: Record<string, unknown> }) => (
    <div data-testid="rows">
      {Array.isArray(props.data) ? props.data.map((r) => String((r as { id: unknown }).id)).join(',') : ''}
    </div>
  )) as never,
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

function facadeAnswering(items: unknown[], gate: Promise<void>) {
  return {
    resolveBinding: vi.fn(async () => {
      await gate
      return { items, total: items.length }
    }),
  } as never
}

const SOURCE: SurfaceDataSourceDefinition = { id: 'articles', kind: 'entity', entityType: 'Article' }

const surface = {
  id: 's',
  blocks: [{ id: 't', type: 'table', layout: L, props: { data: '{{articles}}' } }],
  capabilities: [{ capability: 'platform/persistence', config: { dataSources: [SOURCE] } }],
} as never

function memoryCache(seed: Record<string, unknown> = {}): SurfaceDataCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>(Object.entries(seed))
  return {
    store,
    get: (key) => store.get(key),
    set: (key, value) => void store.set(key, value),
  }
}

describe('dataSourceCacheKey', () => {
  it('is the same for the same source and the same resolved query', () => {
    const a = dataSourceCacheKey({ ...SOURCE, query: { filter: { day: '{{state.day}}' } } }, { day: 1 })
    const b = dataSourceCacheKey({ ...SOURCE, query: { filter: { day: '{{state.day}}' } } }, { day: 1 })
    expect(a).toBe(b)
  })

  it('differs when the resolved query differs, so page 2 never shows page 1', () => {
    const a = dataSourceCacheKey({ ...SOURCE, query: { pagination: { page: '{{state.page}}' } } }, { page: 1 })
    const b = dataSourceCacheKey({ ...SOURCE, query: { pagination: { page: '{{state.page}}' } } }, { page: 2 })
    expect(a).not.toBe(b)
  })

  it('ignores the fallback payload — sample rows are not part of what was fetched', () => {
    expect(dataSourceCacheKey({ ...SOURCE, fallback: [{ id: 'x' }] }, {})).toBe(dataSourceCacheKey(SOURCE, {}))
  })

  it('is nothing for state sources, which are never fetched', () => {
    expect(dataSourceCacheKey({ id: 'ui', kind: 'state' }, {})).toBeUndefined()
  })
})

describe('DataBoundSurfaceRenderer — dataCache', () => {
  it('seeds a cached source on the first frame, then replaces it with the fresh fetch and writes it back', async () => {
    const gate = deferred<void>()
    const cache = memoryCache({ [dataSourceCacheKey(SOURCE, {})!]: [{ id: 'cached-1' }, { id: 'cached-2' }] })
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components}
        loadingStrategy="immediate"
        dataCache={cache}
        entityFacade={facadeAnswering([{ id: 'fresh-1' }], gate.promise)}
      />
    )
    // First frame: yesterday's rows, not an empty table.
    expect(screen.getByTestId('rows').textContent).toBe('cached-1,cached-2')
    gate.resolve()
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('fresh-1'))
    expect(cache.store.get(dataSourceCacheKey(SOURCE, {})!)).toEqual([{ id: 'fresh-1' }])
  })

  it('without a cache hit nothing changes: empty until the fetch lands, then written', async () => {
    const gate = deferred<void>()
    const cache = memoryCache()
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components}
        loadingStrategy="immediate"
        dataCache={cache}
        entityFacade={facadeAnswering([{ id: 'fresh-1' }], gate.promise)}
      />
    )
    expect(screen.getByTestId('rows').textContent).toBe('')
    gate.resolve()
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('fresh-1'))
    expect(cache.store.size).toBe(1)
  })

  it('does not write a failed fetch over a good cache entry', async () => {
    const key = dataSourceCacheKey(SOURCE, {})!
    const cache = memoryCache({ [key]: [{ id: 'cached-1' }] })
    const facade = { resolveBinding: vi.fn(async () => { throw new Error('offline') }) } as never
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components}
        loadingStrategy="immediate"
        dataCache={cache}
        entityFacade={facade}
      />
    )
    await waitFor(() => expect((facade as { resolveBinding: ReturnType<typeof vi.fn> }).resolveBinding).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(cache.store.get(key)).toEqual([{ id: 'cached-1' }])
    // The seeded rows stay on screen rather than being wiped by the failure.
    expect(screen.getByTestId('rows').textContent).toBe('cached-1')
  })
})
