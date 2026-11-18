// @vitest-environment jsdom
/**
 * D1 — A REAL FAILURE BINDS NO ROWS (data-protocol §2.5), whatever was on
 * screen before.
 *
 * Three ways the rows of another moment survived next to `__errorCodes.<id>`:
 *  - a refresh of the same request that failed kept its last good answer;
 *  - rows seeded from the host's data cache (yesterday's) stayed when today's
 *    fetch failed — the conference session page and the m365 home showed a
 *    session or a list under a 500;
 *  - the entity store answered a failed connector query with an empty list,
 *    so the failure never reached the page at all.
 *
 * @module @pwfabric/runtime/render/__tests__/real-failure-binds-no-rows.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { dataSourceCacheKey, type SurfaceDataCache } from '../data-cache.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { createEntityFacade } from '../../entity/facade.js'
import type { EntityConnector } from '../../entity/connector.js'
import type { BlockComponentRegistry } from '../types.js'
import type { SurfaceDataSourceDefinition } from '../data-binding-types.js'

const L = DEFAULT_BLOCK_LAYOUT

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type P = { block: Block; props: Record<string, unknown> }
const Text = ({ block, props }: P) => <div data-testid={block.id}>{String(props.text ?? '')}</div>
const Btn = ({ block }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      data-testid={block.id}
      onClick={() =>
        emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)
      }
    >
      {block.id}
    </button>
  )
}
const components: Partial<BlockComponentRegistry> = { text: Text as never, button: Btn as never }

const probe: Block = {
  id: 'probe',
  type: 'text',
  layout: L,
  props: { text: 'first={{sessions[0].title}}|code={{__errorCodes.sessions}}' },
} as Block

function surface(source: SurfaceDataSourceDefinition, blocks: Block[] = [probe]): never {
  return {
    id: 'session',
    blocks,
    capabilities: [{ capability: 'platform/persistence', config: { dataSources: [source] } }],
  } as never
}

const textOf = (id: string): string => screen.getByTestId(id).textContent ?? ''

// What `pwf dev` makes of a connector-less entity source: a rest read of the host's records.
const SESSIONS: SurfaceDataSourceDefinition = {
  id: 'sessions',
  kind: 'rest',
  method: 'GET',
  returns: 'data',
  endpoint: 'http://localhost/api/records/Session',
} as SurfaceDataSourceDefinition

function serve(reply: () => { status: number; body: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = reply()
      return { ok: r.status >= 200 && r.status < 300, status: r.status, statusText: '', json: async () => r.body }
    }) as never
  )
}

describe('a real failure binds no rows', () => {
  it('a refresh of the same request that fails drops its last good answer', async () => {
    let status = 200
    serve(() => (status === 200 ? { status, body: { data: [{ title: 'Keynote' }] } } : { status, body: {} }))
    const refresh = { id: 'r', type: 'button', layout: L, props: { action: { type: 'refresh', sourceId: 'sessions' } } } as Block
    render(<DataBoundSurfaceRenderer surface={surface(SESSIONS, [probe, refresh])} components={components} interactionMode="live" />)
    await waitFor(() => expect(textOf('probe')).toBe('first=Keynote|code='))
    status = 500
    await act(async () => screen.getByTestId('r').click())
    await waitFor(() => expect(textOf('probe')).toContain('code=500'))
    expect(textOf('probe')).toBe('first=|code=500')
  })

  it("rows seeded from the data cache do not survive today's failure", async () => {
    serve(() => ({ status: 500, body: {} }))
    const key = dataSourceCacheKey(SESSIONS, {}) as string
    const store = new Map<string, unknown>([[key, [{ title: 'Yesterday' }]]])
    const cache: SurfaceDataCache = { get: (k) => store.get(k), set: (k, v) => void store.set(k, v) }
    render(
      <DataBoundSurfaceRenderer
        surface={surface(SESSIONS)}
        components={components}
        interactionMode="live"
        loadingStrategy="immediate"
        dataCache={cache}
      />
    )
    await waitFor(() => expect(textOf('probe')).toContain('code=500'))
    expect(textOf('probe')).toBe('first=|code=500')
  })

  it("an entity facade whose connector fails reports the failure, not an empty list", async () => {
    const failing: EntityConnector = {
      name: 'records',
      type: 'custom',
      create: async () => ({ success: false, error: 'x' }),
      read: async () => ({ success: false, error: 'x' }),
      update: async () => ({ success: false, error: 'x' }),
      delete: async () => ({ success: false, error: 'x' }),
      query: async () => ({ success: false, error: 'HTTP 503: Service Unavailable', code: 503 }),
    }
    const facade = createEntityFacade()
    facade.connectors.register(failing)
    facade.registerEntity(
      { id: 'Session' as never, name: 'Session', fields: [], relations: [], primaryKey: 'id', schema: {} as never },
      'records'
    )
    const source = { id: 'sessions', kind: 'entity', entityType: 'Session' } as SurfaceDataSourceDefinition
    render(
      <DataBoundSurfaceRenderer surface={surface(source)} components={components} interactionMode="live" entityFacade={facade} />
    )
    await waitFor(() => expect(textOf('probe')).toContain('code=503'))
    expect(textOf('probe')).toBe('first=|code=503')
  })
})
