// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — an aggregate source binds `{ value }`, not a list.
 *
 * WHY THIS EXISTS. A counter page ("12 people are coming") had two bad
 * options: list the collection and count client-side (a 403 on an intake
 * collection; every RSVP name handed to a stranger on a public one), or hand-
 * write a `rest` source to `/count` whose base URL the runner never
 * injects. With `aggregate` on the source the renderer asks the facade for
 * the number and binds `{ fn, value, count }` — exempt from the "a list
 * source always binds as a list" wrap — so `{{records.value}}` is the number.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-aggregate.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, act } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'
import type {
  ConnectorEngine,
  ConnectorEngineRegistry,
  ConnectorEngineStatus,
  SurfaceConnectionsValue,
} from '../../connectors/types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="text-block">{String(props.content ?? '')}</p>
  )) as never,
}

function surfaceWith(
  source: Record<string, unknown>,
  content = 'n:{{records.value}}|c:{{records.count}}',
  initialState: Record<string, unknown> = {}
): never {
  const blocks: Block[] = [{ id: 'counter', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content } }]
  return {
    blocks,
    capabilities: [{ capability: 'platform/persistence', config: { dataSources: [source], initialState } }],
  } as never
}

function stubRegistry(entries: {
  [name: string]: { status: ConnectorEngineStatus; engine: ConnectorEngine | null }
}): ConnectorEngineRegistry {
  return {
    configure: () => undefined,
    register: () => undefined,
    resolve: async (name) => entries[name]?.engine ?? null,
    getStatus: (name) => entries[name]?.status ?? { state: 'unregistered' },
    setAccessTokenResolver: () => undefined,
    list: () => Object.keys(entries),
    clear: () => undefined,
  }
}

/** A button that emits a click, so a block `action` can write state. */
const Btn = ({ block, props }: { block: Block; props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() => emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}
    >
      {String(props.label ?? '')}
    </button>
  )
}

describe('an aggregate source refetches when the state its filter reads changes', () => {
  // The request key carried the resolved `query` but not the
  // resolved `aggregate`, so a segmented control writing `state.status`
  // left the counter on its first answer.
  it('a setState that changes {{state.status}} asks again with the new filter', async () => {
    const resolveAggregate = vi.fn(async (_t: string, agg: { filter?: { value?: unknown } }) => ({
      fn: 'count' as const,
      value: agg.filter?.value === 'no' ? 4 : 9,
      count: 0,
    }))
    const blocks: Block[] = [
      { id: 'counter', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content: 'n:{{records.value}}' } },
      {
        id: 'pick-no',
        type: 'button',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { label: 'No', action: { type: 'setState', key: 'status', value: 'no' } },
      },
    ]
    const surface = {
      blocks,
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            initialState: { status: 'yes' },
            dataSources: [
              {
                id: 'records',
                kind: 'entity',
                entityType: 'Rsvp',
                aggregate: { fn: 'count', filter: { field: 'status', operator: 'eq', value: '{{state.status}}' } },
              },
            ],
          },
        },
      ],
    } as never
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={{ ...components, button: Btn as never }}
        entityFacade={{ resolveAggregate, resolveBinding: vi.fn() } as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:9'))
    await act(async () => {
      screen.getByTestId('pick-no').click()
    })
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:4'))
    expect(resolveAggregate).toHaveBeenLastCalledWith('Rsvp', {
      fn: 'count',
      filter: { field: 'status', operator: 'eq', value: 'no' },
    })
  })
})

describe('an aggregate entity source binds the number', () => {
  it('asks the facade to aggregate — never lists — and {{records.value}} is the number', async () => {
    const resolveAggregate = vi.fn(async () => ({ fn: 'count' as const, value: 12, count: 12 }))
    const resolveBinding = vi.fn(async () => ({ items: [{ id: 'leak' }], total: 1 }))
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith({ id: 'records', kind: 'entity', entityType: 'Rsvp', aggregate: { fn: 'count' } })}
        components={components}
        entityFacade={{ resolveAggregate, resolveBinding } as never}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:12|c:12'))
    expect(resolveAggregate).toHaveBeenCalledWith('Rsvp', { fn: 'count' })
    expect(resolveBinding).not.toHaveBeenCalled()
  })

  it('resolves {{state.x}} inside aggregate.filter against surface state', async () => {
    const resolveAggregate = vi.fn(async () => ({ fn: 'sum' as const, field: 'guests', value: 30, count: 10 }))
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          {
            id: 'records',
            kind: 'entity',
            entityType: 'Rsvp',
            aggregate: {
              fn: 'sum',
              field: 'guests',
              filter: { field: 'status', operator: 'eq', value: '{{state.status}}' },
            },
          },
          'n:{{records.value}}',
          { status: 'yes' }
        )}
        components={components}
        entityFacade={{ resolveAggregate, resolveBinding: vi.fn() } as never}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:30'))
    expect(resolveAggregate).toHaveBeenCalledWith('Rsvp', {
      fn: 'sum',
      field: 'guests',
      filter: { field: 'status', operator: 'eq', value: 'yes' },
    })
  })

  it('a host facade without resolveAggregate still gets a number: list, then reduce here', async () => {
    const resolveBinding = vi.fn(async () => ({
      items: [{ guests: 2 }, { guests: 3 }],
      total: 2,
      offset: 0,
      limit: 50,
      hasMore: false,
    }))
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { id: 'records', kind: 'entity', entityType: 'Rsvp', aggregate: { fn: 'sum', field: 'guests' } },
          'n:{{records.value}}'
        )}
        components={components}
        entityFacade={{ resolveBinding } as never}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:5'))
  })

  it('a connector engine that only lists is reduced the same way', async () => {
    const engine: ConnectorEngine = {
      name: 'graph-lists',
      query: vi.fn(async () => ({
        success: true as const,
        result: { items: [{ id: 1 }, { id: 2 }, { id: 3 }], total: 3, offset: 0, limit: 3, hasMore: false },
      })),
    }
    const connections: SurfaceConnectionsValue = {
      connections: [{ name: 'graph-lists', connector: 'graph-lists', config: {} }],
      engines: stubRegistry({ 'graph-lists': { status: { state: 'ready' }, engine } }),
    }
    const resolveBinding = vi.fn()
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { id: 'records', kind: 'entity', entityType: 'Rsvp', connector: 'graph-lists', aggregate: { fn: 'count' } },
          'n:{{records.value}}'
        )}
        components={components}
        entityFacade={{ resolveBinding } as never}
        connections={connections}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:3'))
    expect(resolveBinding).not.toHaveBeenCalled()
  })

  it('a facade that cannot serve the count binds fallback and reports the error — never a 0', async () => {
    const resolveAggregate = vi.fn(async () => {
      throw new Error('HTTP 403: RECORDS_NOT_PUBLIC')
    })
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { id: 'records', kind: 'entity', entityType: 'Rsvp', aggregate: { fn: 'count' }, fallback: { value: '—' } },
          'n:{{records.value}}|e:{{__errors.records}}'
        )}
        components={components}
        entityFacade={{ resolveAggregate, resolveBinding: vi.fn() } as never}
      />
    )
    await waitFor(() =>
      expect(screen.getByTestId('text-block').textContent).toBe('n:—|e:HTTP 403: RECORDS_NOT_PUBLIC')
    )
  })

  it('without a fallback the error is reported and value stays empty', async () => {
    const resolveAggregate = vi.fn(async () => {
      throw new Error('HTTP 400: INVALID_AGGREGATE')
    })
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { id: 'records', kind: 'entity', entityType: 'Rsvp', aggregate: { fn: 'count' } },
          'n:{{records.value}}|e:{{__errors.records}}'
        )}
        components={components}
        entityFacade={{ resolveAggregate, resolveBinding: vi.fn() } as never}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('n:|e:HTTP 400: INVALID_AGGREGATE'))
  })

  it('the list-wrap exemption is entity-only: a rest source carrying aggregate is still a list', async () => {
    // Only the entity branch reads `aggregate`; a rest source with the key
    // fetches its endpoint as always, so it must bind the way rest binds.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ value: 3 }) })) as never
    )
    try {
      render(
        <DataBoundSurfaceRenderer
          surface={surfaceWith(
            { id: 'records', kind: 'rest', endpoint: '/api/x', aggregate: { fn: 'count' } },
            'len:{{records.length}}|first:{{records[0].value}}'
          )}
          components={components}
        />
      )
      await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('len:1|first:3'))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a plain entity source is untouched — still a list', async () => {
    const resolveBinding = vi.fn(async () => ({ items: [{ name: 'elma' }], total: 1 }))
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { id: 'records', kind: 'entity', entityType: 'Rsvp' },
          'first:{{records[0].name}}|len:{{records.length}}'
        )}
        components={components}
        entityFacade={{ resolveBinding } as never}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text-block').textContent).toBe('first:elma|len:1'))
  })
})
