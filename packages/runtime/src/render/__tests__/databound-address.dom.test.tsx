// @vitest-environment jsdom
/**
 * A data-bound page and its address (render/address.ts, address-sync.ts).
 *
 *  1. URL STATE. A control writing `state.<key>` was seeded from the address
 *     but never wrote back, so a reload lost it. The keys a page declares in
 *     `urlState` are written to the host's address on change (replace, not
 *     push); undeclared keys never are.
 *  2. NOT FOUND. A `notFoundWhenEmpty` source that settles with no record
 *     tells the host's address, once; one that answers a row, or fails for
 *     another reason, does not.
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { SurfaceAddress } from '../address.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const L = DEFAULT_BLOCK_LAYOUT

type MemoryAddress = SurfaceAddress & {
  readonly writes: [Record<string, string | null>, string][]
  readonly notFound: ReturnType<typeof vi.fn>
}

function memoryAddress(initial = ''): MemoryAddress {
  let query = initial
  const writes: [Record<string, string | null>, string][] = []
  return {
    writes,
    query: () => query,
    writeQuery(values, how) {
      writes.push([{ ...values }, how])
      const q = new URLSearchParams(query)
      for (const [k, v] of Object.entries(values)) {
        if (v === null) q.delete(k)
        else q.set(k, v)
      }
      query = q.toString()
    },
    notFound: vi.fn(),
  }
}

const Setter = ({ props, context }: { props: Record<string, unknown>; context: { onEvent?: (e: unknown) => void } }) => (
  <button
    data-testid={String(props.testId)}
    onClick={() =>
      context.onEvent?.({
        type: 'click',
        canonicalType: 'block:click',
        surfaceId: 's',
        blockId: String(props.testId),
        timestamp: Date.now(),
        payload: { action: { type: 'setState', key: props.stateKey, value: props.value } },
      })
    }
  >
    set
  </button>
)
const Text = ({ props }: { props: Record<string, unknown> }) => <div data-testid="text">{String(props.content ?? '')}</div>
const components: Partial<BlockComponentRegistry> = { setter: Setter as never, text: Text as never }

function page(config: Record<string, unknown>, blocks: unknown[]): never {
  return { blocks, capabilities: [{ capability: 'platform/persistence', config }] } as never
}

describe('urlState', () => {
  it('writes a declared key to the address when it changes, replacing the entry', async () => {
    const address = memoryAddress('severity=low')
    render(
      <DataBoundSurfaceRenderer
        surface={page({ initialState: { severity: 'low', draft: '' }, urlState: ['severity'] }, [
          { id: 'a', type: 'setter', layout: L, props: { testId: 'high', stateKey: 'severity', value: 'high' } },
          { id: 'b', type: 'setter', layout: L, props: { testId: 'all', stateKey: 'severity', value: '' } },
          { id: 'c', type: 'setter', layout: L, props: { testId: 'draft', stateKey: 'draft', value: 'x' } },
          { id: 't', type: 'text', layout: L, props: { content: '{{state.severity}}' } },
        ])}
        components={components}
        address={address}
      />
    )
    // The first render holds what the address seeded: nothing is written.
    expect(address.writes).toEqual([])
    fireEvent.click(screen.getByTestId('high'))
    await waitFor(() => expect(address.writes).toEqual([[{ severity: 'high' }, 'replace']]))
    // An undeclared key stays out of the address.
    fireEvent.click(screen.getByTestId('draft'))
    // "All" ('') removes the key.
    fireEvent.click(screen.getByTestId('all'))
    await waitFor(() =>
      expect(address.writes).toEqual([
        [{ severity: 'high' }, 'replace'],
        [{ severity: null }, 'replace'],
      ])
    )
    expect(address.query()).toBe('')
  })

  it('an inert canvas never writes', async () => {
    const address = memoryAddress()
    render(
      <DataBoundSurfaceRenderer
        surface={page({ initialState: { tab: 'a' }, urlState: ['tab'] }, [
          { id: 'a', type: 'setter', layout: L, props: { testId: 'b', stateKey: 'tab', value: 'b' } },
        ])}
        components={components}
        address={address}
        interactionMode="inert"
      />
    )
    fireEvent.click(screen.getByTestId('b'))
    await new Promise((r) => setTimeout(r, 20))
    expect(address.writes).toEqual([])
  })
})

describe('notFoundWhenEmpty', () => {
  const source = (rows: unknown[]): Record<string, unknown> => ({ id: 'dish', kind: 'static', staticData: rows, notFoundWhenEmpty: true })

  it('a record source that settles with no row tells the address, once', async () => {
    const address = memoryAddress('id=nope')
    render(
      <DataBoundSurfaceRenderer
        surface={page({ dataSources: [source([])] }, [{ id: 't', type: 'text', layout: L, props: { content: '{{dish.0.name}}' } }])}
        components={components}
        address={address}
      />
    )
    await waitFor(() => expect(address.notFound).toHaveBeenCalledTimes(1))
  })

  it('a record source that finds its row does not', async () => {
    const address = memoryAddress('id=1')
    render(
      <DataBoundSurfaceRenderer
        surface={page({ dataSources: [source([{ name: 'Soup' }])] }, [{ id: 't', type: 'text', layout: L, props: { content: '{{dish.0.name}}' } }])}
        components={components}
        address={address}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text').textContent).toBe('Soup'))
    expect(address.notFound).not.toHaveBeenCalled()
  })

  it('a 404 is not found; a refused read is the source error, not not-found', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes('missing')
        ? new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'No such dish.' } }), { status: 404 })
        : new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'No.' } }), { status: 403 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const missing = memoryAddress()
    render(
      <DataBoundSurfaceRenderer
        surface={page({ dataSources: [{ id: 'dish', kind: 'rest', endpoint: 'https://api.example.com/missing', notFoundWhenEmpty: true }] }, [])}
        components={components}
        address={missing}
      />
    )
    await waitFor(() => expect(missing.notFound).toHaveBeenCalledTimes(1))
    cleanup()

    const refused = memoryAddress()
    render(
      <DataBoundSurfaceRenderer
        surface={page({ dataSources: [{ id: 'dish', kind: 'rest', endpoint: 'https://api.example.com/refused', notFoundWhenEmpty: true }] }, [
          { id: 't', type: 'text', layout: L, props: { content: '{{__errors.dish}}' } },
        ])}
        components={components}
        address={refused}
      />
    )
    await waitFor(() => expect(screen.getByTestId('text').textContent).not.toBe(''))
    await new Promise((r) => setTimeout(r, 20))
    expect(refused.notFound).not.toHaveBeenCalled()
  })
})
