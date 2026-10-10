// @vitest-environment jsdom
/**
 * The seams a data-bound PATTERN needs:
 *
 *  1. `{{state.x}}` inside a connector source's `query` resolves against
 *     surface state and re-fetches when state changes (pagination /
 *     segmented-control controls drive the query, not just REST endpoints).
 *  2. A source with `fallback` binds the fallback payload when its connector
 *     is missing or fails, AND still reports `__errors.<id>` — sample data
 *     with an honest flag, not an empty table and not a crash.
 *  3. Behaviors declared in `platform/persistence.config.behaviors` execute
 *     without any host prop (a pack can ship its own controls).
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'
import type { ConnectorEngine, ConnectorEngineRegistry, ConnectorEngineStatus, SurfaceConnectionsValue } from '../../connectors/types.js'

afterEach(() => cleanup())

const L = DEFAULT_BLOCK_LAYOUT

function stubRegistry(entries: { [name: string]: { status: ConnectorEngineStatus; engine: ConnectorEngine | null } }): ConnectorEngineRegistry {
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

const TableBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="rows">{Array.isArray(props.data) ? props.data.map((r) => String((r as { id: unknown }).id)).join(',') : ''}</div>
)
const TextBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid={String(props.testId ?? 'text')}>{props.content === undefined || props.content === null ? '' : String(props.content)}</div>
)
// A control that dispatches a surface action through its event payload, the
// way pagination/segmented-control do (`payload.action`).
const NextButton = ({ context }: { context: { onEvent?: (e: unknown) => void } }) => (
  <button
    data-testid="next"
    onClick={() =>
      context.onEvent?.({
        type: 'click',
        canonicalType: 'block:click',
        surfaceId: 's',
        blockId: 'next',
        timestamp: Date.now(),
        payload: { action: { type: 'setState', key: 'page', value: 1 } },
      })
    }
  >
    next
  </button>
)
// A plain emitter with NO action payload — only a declared behavior can react.
const PlainButton = ({ context }: { context: { onEvent?: (e: unknown) => void } }) => (
  <button
    data-testid="plain"
    onClick={() => context.onEvent?.({ type: 'click', canonicalType: 'block:click', surfaceId: 's', blockId: 'plain', timestamp: Date.now() })}
  >
    plain
  </button>
)
const components: Partial<BlockComponentRegistry> = {
  table: TableBlock as never,
  text: TextBlock as never,
  'next-button': NextButton as never,
  'plain-button': PlainButton as never,
}

function surfaceWith(config: Record<string, unknown>, blocks: Record<string, unknown>[]) {
  return {
    id: 's',
    blocks: blocks.map((b) => ({ layout: L, props: {}, ...b })),
    capabilities: [{ capability: 'platform/persistence', required: true, config }],
  } as never
}

describe('{{state.x}} in a connector query', () => {
  it('resolves state into the query and re-queries when a control changes state', async () => {
    const engineQuery = vi.fn(async (_type: string, q: { pagination?: { offset: number } }) => {
      const offset = q.pagination?.offset ?? 0
      return {
        success: true as const,
        result: { items: [{ id: `p${offset}` }], total: 2, offset, limit: 1, hasMore: offset === 0 },
      }
    })
    const connections: SurfaceConnectionsValue = {
      connections: [{ name: 'graph-mail', connector: 'graph-mail', config: {} }],
      engines: stubRegistry({ 'graph-mail': { status: { state: 'ready' }, engine: { name: 'graph-mail', query: engineQuery as never } } }),
    }
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          {
            initialState: { page: 0 },
            dataSources: [
              {
                id: 'mail',
                kind: 'entity',
                entityType: 'Messages',
                connector: 'graph-mail',
                query: {
                  filter: { field: 'isRead', operator: 'eq', value: false },
                  pagination: { offset: '{{state.page}}', limit: 1 },
                },
              },
            ],
          },
          [
            { id: 't', type: 'table', props: { data: '{{mail}}' } },
            { id: 'next', type: 'next-button' },
          ]
        )}
        components={components as never}
        connections={connections}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('p0'))
    expect(engineQuery).toHaveBeenLastCalledWith('Messages', {
      filter: { field: 'isRead', operator: 'eq', value: false },
      pagination: { offset: 0, limit: 1 },
    })

    fireEvent.click(screen.getByTestId('next'))
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('p1'))
    expect(engineQuery).toHaveBeenLastCalledWith('Messages', expect.objectContaining({ pagination: { offset: 1, limit: 1 } }))
  })
})

describe('fallback payload', () => {
  const fallback = [{ id: 'sample-1' }, { id: 'sample-2' }]
  const blocks = [
    { id: 't', type: 'table', props: { data: '{{alerts}}' } },
    { id: 'e', type: 'text', props: { testId: 'err', content: '{{__errors.alerts}}' } },
  ]

  it('binds the fallback AND reports the error when the connector is not connected', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { dataSources: [{ id: 'alerts', kind: 'entity', entityType: 'SecurityAlerts', connector: 'graph-security', fallback }] },
          blocks
        )}
        components={components as never}
        connections={{ connections: [], engines: stubRegistry({}) }}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('sample-1,sample-2'))
    expect(screen.getByTestId('err').textContent).toMatch(/not connected/)
  })

  it('binds the fallback AND reports the error when the engine query fails', async () => {
    const engine: ConnectorEngine = { name: 'graph-security', query: async () => ({ success: false as const, error: 'HTTP 403 Forbidden' }) }
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          { dataSources: [{ id: 'alerts', kind: 'entity', entityType: 'SecurityAlerts', connector: 'graph-security', fallback }] },
          blocks
        )}
        components={components as never}
        connections={{
          connections: [{ name: 'graph-security', connector: 'graph-security', config: {} }],
          engines: stubRegistry({ 'graph-security': { status: { state: 'ready' }, engine } }),
        }}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('rows').textContent).toBe('sample-1,sample-2'))
    expect(screen.getByTestId('err').textContent).toBe('HTTP 403 Forbidden')
  })

  it('without a fallback the failure still yields an empty bind plus the error (unchanged law)', async () => {
    const engine: ConnectorEngine = { name: 'graph-security', query: async () => ({ success: false as const, error: 'boom' }) }
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith({ dataSources: [{ id: 'alerts', kind: 'entity', entityType: 'SecurityAlerts', connector: 'graph-security' }] }, blocks)}
        components={components as never}
        connections={{
          connections: [{ name: 'graph-security', connector: 'graph-security', config: {} }],
          engines: stubRegistry({ 'graph-security': { status: { state: 'ready' }, engine } }),
        }}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('err').textContent).toBe('boom'))
    expect(screen.getByTestId('rows').textContent).toBe('')
  })
})

describe('declared behaviors (platform/persistence.config.behaviors)', () => {
  it('execute with no host `behaviors` prop', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith(
          {
            initialState: { clicked: 'no' },
            dataSources: [{ id: 'st', kind: 'state' }],
            behaviors: [{ id: 'b1', event: 'block:click', targetBlockId: 'plain', actions: [{ type: 'setState', key: 'clicked', value: 'yes' }] }],
          },
          [
            { id: 'plain', type: 'plain-button' },
            { id: 'out', type: 'text', props: { testId: 'out', content: '{{state.clicked}}' } },
          ]
        )}
        components={components as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('no'))
    fireEvent.click(screen.getByTestId('plain'))
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('yes'))
  })
})
