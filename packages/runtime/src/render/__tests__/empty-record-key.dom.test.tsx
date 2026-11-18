// @vitest-environment jsdom
/**
 * An empty record key asks for no record (data-protocol §1.1).
 *
 * `id eq {{state.id}}` with no `?id=` dropped its only constraint and listed
 * every record: a detail page opened on the first dish, and a
 * `notFoundWhenEmpty` source never reported itself missing (recordIsMissing
 * only knew a REST path value). An emptied value elsewhere — an "All" choice —
 * still widens the list.
 *
 * @module @pwfabric/runtime/render/__tests__/empty-record-key.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { queryAsksForNothing } from '../query-state.js'
import { dataSourceCacheKey } from '../data-cache.js'
import type { SurfaceAddress } from '../address.js'
import type { BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const DISHES = [
  { id: 'soup', name: 'Soup', category: 'starters', slug: 'soup' },
  { id: 'cake', name: 'Cake', category: 'desserts', slug: 'cake' },
]

const Text = ({ props }: { props: Record<string, unknown> }) => <div data-testid="t">{String(props.content ?? '')}</div>
const components: Partial<BlockComponentRegistry> = { text: Text as never }

function facade() {
  return {
    resolveBinding: vi.fn(async (_t: string, q?: { filter?: { field?: string; value?: unknown } }) => {
      const f = q?.filter
      const items = f?.field && f.value !== undefined ? DISHES.filter((d) => (d as Record<string, unknown>)[f.field as string] === f.value) : DISHES
      return { items, total: items.length, offset: 0, limit: 50, hasMore: false }
    }),
  }
}

function address(): SurfaceAddress & { notFound: ReturnType<typeof vi.fn> } {
  return { query: () => '', writeQuery: () => undefined, notFound: vi.fn() }
}

function page(source: Record<string, unknown>, state: Record<string, unknown>): never {
  return {
    id: 'dish',
    blocks: [
      { id: 't', type: 'text', layout: L, props: { content: 'rows={{dish.length}}|first={{dish[0].name}}|idle={{__idle.dish}}' } },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { dataSources: [source], initialState: state } }],
  } as never
}

const byId = { id: 'dish', kind: 'entity', entityType: 'Dish', query: { filter: { field: 'id', operator: 'eq', value: '{{state.id}}' } } }

describe('queryAsksForNothing', () => {
  const q = (filter: unknown) => ({ filter })
  const id = { field: 'id', operator: 'eq', value: '{{state.id}}' }
  it('an id equality resolving to nothing asks for nothing', () => {
    expect(queryAsksForNothing(q(id), { id: '' })).toBe(true)
    expect(queryAsksForNothing(q(id), { id: null })).toBe(true)
    expect(queryAsksForNothing(q(id), {})).toBe(true)
    expect(queryAsksForNothing(q(id), { id: 'soup' })).toBe(false)
    expect(queryAsksForNothing(q(id), { id: 0 })).toBe(false)
  })
  it('an emptied value on another field is still no constraint, unless the source is the page record', () => {
    const cat = { field: 'category', operator: 'eq', value: '{{state.category}}' }
    expect(queryAsksForNothing(q(cat), { category: '' })).toBe(false)
    expect(queryAsksForNothing(q(cat), { category: '' }, true)).toBe(true)
  })
  it('a literal value, another operator or no expression never asks for nothing', () => {
    expect(queryAsksForNothing(q({ field: 'id', operator: 'eq', value: '' }), {})).toBe(false)
    expect(queryAsksForNothing(q({ field: 'id', operator: 'contains', value: '{{state.id}}' }), {})).toBe(false)
  })
  it('combines through and / or', () => {
    const cat = { field: 'category', operator: 'eq', value: 'starters' }
    expect(queryAsksForNothing(q({ and: [cat, id] }), {})).toBe(true)
    expect(queryAsksForNothing(q({ or: [cat, id] }), {})).toBe(false)
    expect(queryAsksForNothing(q({ or: [id, { ...id, value: '{{state.other}}' }] }), {})).toBe(true)
  })
  it('an idle source has no cache key', () => {
    expect(dataSourceCacheKey(byId as never, { id: '' })).toBeUndefined()
    expect(dataSourceCacheKey(byId as never, { id: 'soup' })).toBeDefined()
  })
})

describe('an entity source with an empty record key', () => {
  it('is not fetched, binds no rows and is idle', async () => {
    const f = facade()
    render(<DataBoundSurfaceRenderer surface={page(byId, { id: '' })} components={components} entityFacade={f as never} />)
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('rows=|first=|idle=true'))
    expect(f.resolveBinding).not.toHaveBeenCalled()
  })

  it('a notFoundWhenEmpty source with an empty key tells the address', async () => {
    const a = address()
    render(
      <DataBoundSurfaceRenderer
        surface={page({ ...byId, notFoundWhenEmpty: true }, { id: '' })}
        components={components}
        entityFacade={facade() as never}
        address={a}
      />
    )
    await waitFor(() => expect(a.notFound).toHaveBeenCalledTimes(1))
  })

  it('a notFoundWhenEmpty source looked up by another key is idle too', async () => {
    const a = address()
    const bySlug = { ...byId, notFoundWhenEmpty: true, query: { filter: { field: 'slug', operator: 'eq', value: '{{state.slug}}' } } }
    render(<DataBoundSurfaceRenderer surface={page(bySlug, { slug: '' })} components={components} entityFacade={facade() as never} address={a} />)
    await waitFor(() => expect(a.notFound).toHaveBeenCalledTimes(1))
  })

  it('with a key it fetches that record', async () => {
    render(<DataBoundSurfaceRenderer surface={page(byId, { id: 'cake' })} components={components} entityFacade={facade() as never} />)
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('rows=1|first=Cake|idle=false'))
  })

  it('an "All" choice on a list filter still widens the list', async () => {
    const all = { id: 'dish', kind: 'entity', entityType: 'Dish', query: { filter: { field: 'category', operator: 'eq', value: '{{state.category}}' } } }
    render(<DataBoundSurfaceRenderer surface={page(all, { category: '' })} components={components} entityFacade={facade() as never} />)
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('rows=2|first=Soup|idle=false'))
  })

  it('the same holds for the rest read a host rewrites an own-records source into', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: DISHES }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const rest = { id: 'dish', kind: 'rest', method: 'GET', endpoint: 'http://localhost/api/records/Dish', returns: 'data', query: byId.query }
    render(<DataBoundSurfaceRenderer surface={page(rest, { id: '' })} components={components} />)
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('rows=|first=|idle=true'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
