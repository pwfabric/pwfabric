// @vitest-environment jsdom
/**
 * Entity dataSources that name a `connector` route through the
 * host-provided ConnectorEngineRegistry; absent/unregistered engine keeps
 * today's default facade behavior, and a failed engine surfaces an honest
 * per-source error (`__errors.<id>`) instead of crashing or faking empty.
 * Also proves the SurfaceConnectionsContext plumb: blocks see the
 * connections context when the host provides it, null otherwise.
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceConnections } from '../connections-context.js'
import type { BlockComponentRegistry } from '../types.js'
import type {
  ConnectorEngine,
  ConnectorEngineRegistry,
  ConnectorEngineStatus,
  SurfaceConnectionsValue,
} from '../../connectors/types.js'

afterEach(() => cleanup())

// ============================================================
// FIXTURES
// ============================================================

const L = DEFAULT_BLOCK_LAYOUT

function makeSurface(dataSource: Record<string, unknown>) {
  return {
    id: 'connector-route',
    blocks: [
      { id: 'contacts-list', type: 'table', layout: L, props: { data: '{{contacts}}' } },
      { id: 'err', type: 'text', layout: L, props: { content: '{{__errors.contacts}}' } },
    ],
    capabilities: [
      {
        capability: 'platform/persistence',
        required: true,
        config: { dataSources: [dataSource], initialState: {} },
      },
    ],
  } as never
}

const TableBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="count">{Array.isArray(props.data) ? props.data.length : 0}</div>
)
const TextBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="err">{typeof props.content === 'string' ? props.content : ''}</div>
)
const components: Partial<BlockComponentRegistry> = {
  table: TableBlock as never,
  text: TextBlock as never,
}

/** Minimal hand-rolled registry stub — the renderer only calls getStatus/resolve. */
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

const facadeItems = [{ id: 'f1', name: 'FacadeAda' }]
function makeFacade() {
  const resolveBinding = vi.fn(async () => ({ items: [...facadeItems], total: 1 }))
  return { facade: { resolveBinding } as never, resolveBinding }
}

// ============================================================
// TESTS
// ============================================================

describe('entity dataSource connector routing', () => {
  it('routes through the registry engine when the connection is registered — facade untouched', async () => {
    const engineQuery = vi.fn(async () => ({
      success: true as const,
      result: {
        items: [{ id: '1' }, { id: '2' }, { id: '3' }],
        total: 3,
        offset: 0,
        limit: 3,
        hasMore: false,
      },
    }))
    const engine: ConnectorEngine = { name: 'graph-lists', query: engineQuery }
    const connections: SurfaceConnectionsValue = {
      connections: [{ name: 'graph-lists', connector: 'graph-lists', config: {} }],
      engines: stubRegistry({ 'graph-lists': { status: { state: 'ready' }, engine } }),
    }
    const { facade, resolveBinding } = makeFacade()

    render(
      <DataBoundSurfaceRenderer
        surface={makeSurface({ id: 'contacts', kind: 'entity', entityType: 'contact', connector: 'graph-lists' })}
        components={components as never}
        entityFacade={facade}
        connections={connections}
        interactionMode="live"
      />
    )

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('3'))
    expect(engineQuery).toHaveBeenCalledWith('contact', {})
    expect(resolveBinding).not.toHaveBeenCalled()
  })

  it('falls back to the default facade path when the connection is unregistered', async () => {
    const connections: SurfaceConnectionsValue = {
      connections: [],
      engines: stubRegistry({}),
    }
    const { facade, resolveBinding } = makeFacade()

    render(
      <DataBoundSurfaceRenderer
        surface={makeSurface({ id: 'contacts', kind: 'entity', entityType: 'contact', connector: 'graph-mail' })}
        components={components as never}
        entityFacade={facade}
        connections={connections}
        interactionMode="live"
      />
    )

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
    expect(resolveBinding).toHaveBeenCalled()
  })

  it('keeps today\'s behavior when no connections context is provided at all', async () => {
    const { facade, resolveBinding } = makeFacade()

    render(
      <DataBoundSurfaceRenderer
        surface={makeSurface({ id: 'contacts', kind: 'entity', entityType: 'contact', connector: 'graph-lists' })}
        components={components as never}
        entityFacade={facade}
        interactionMode="live"
      />
    )

    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
    expect(resolveBinding).toHaveBeenCalled()
  })

  it('surfaces a failed engine as an honest per-source error — no crash, no fake empty success', async () => {
    const connections: SurfaceConnectionsValue = {
      connections: [{ name: 'graph-lists', connector: 'graph-lists' }],
      engines: stubRegistry({
        'graph-lists': {
          status: { state: 'failed', reason: 'Integrity check failed for graph-lists' },
          engine: null,
        },
      }),
    }
    const { facade, resolveBinding } = makeFacade()

    render(
      <DataBoundSurfaceRenderer
        surface={makeSurface({ id: 'contacts', kind: 'entity', entityType: 'contact', connector: 'graph-lists' })}
        components={components as never}
        entityFacade={facade}
        connections={connections}
        interactionMode="live"
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('err').textContent).toContain('Integrity check failed')
    )
    // Registered-but-broken must NOT silently fall back to the default
    // facade — that would render data the surface author didn't wire.
    expect(resolveBinding).not.toHaveBeenCalled()
  })

  it('propagates an engine query error into __errors', async () => {
    const engine: ConnectorEngine = {
      query: async () => ({ success: false as const, error: 'Graph 403: insufficient scope' }),
    }
    const connections: SurfaceConnectionsValue = {
      connections: [{ name: 'graph-lists' }],
      engines: stubRegistry({ 'graph-lists': { status: { state: 'ready' }, engine } }),
    }

    render(
      <DataBoundSurfaceRenderer
        surface={makeSurface({ id: 'contacts', kind: 'entity', entityType: 'contact', connector: 'graph-lists' })}
        components={components as never}
        connections={connections}
        interactionMode="live"
      />
    )

    await waitFor(() => expect(screen.getByTestId('err').textContent).toContain('Graph 403'))
  })
})

describe('SurfaceConnectionsContext plumb', () => {
  const ProbeBlock = () => {
    const ctx = useSurfaceConnections()
    return <div data-testid="probe">{ctx ? ctx.connections.map((c) => c.name).join(',') : 'null'}</div>
  }
  const probeComponents: Partial<BlockComponentRegistry> = { text: ProbeBlock as never }
  const probeSurface = {
    id: 'probe',
    blocks: [{ id: 't', type: 'text', layout: L, props: {} }],
  } as never

  it('blocks see the connections context when the host provides it', async () => {
    const connections: SurfaceConnectionsValue = {
      connections: [
        { name: 'graph-lists', connector: 'graph-lists', config: { siteHostname: 'x' } },
        { name: 'graph-mail', connector: 'microsoft-graph' },
      ],
      engines: null,
    }

    render(
      <DataBoundSurfaceRenderer
        surface={probeSurface}
        components={probeComponents as never}
        connections={connections}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('probe').textContent).toBe('graph-lists,graph-mail')
    )
  })

  it('blocks see null when the host does not opt in (today\'s behavior)', async () => {
    render(<DataBoundSurfaceRenderer surface={probeSurface} components={probeComponents as never} />)

    await waitFor(() => expect(screen.getByTestId('probe').textContent).toBe('null'))
  })
})
