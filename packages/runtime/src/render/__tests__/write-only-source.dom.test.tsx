// @vitest-environment jsdom
/**
 * A source a form only WRITES to is never fetched.
 *
 * An intake-only model (anonymous visitors may create, never list) was asked
 * for its rows on mount and again after every submit (the bridge's
 * refreshAll): `GET /_host/records/<model>` → 403 `RECORDS_NOT_PUBLIC` on every
 * visit, `__errors.records` set, while no block read the source at all.
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { writeOnlySourceIds } from '../write-only-sources.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT

const FormBlock = () => {
  const { emit } = useSurfaceEvents()
  const sid = useSurfaceId()
  return (
    <button
      data-testid="save"
      onClick={() =>
        emit({
          type: SURFACE_EVENTS.FORM_SUBMIT,
          surfaceId: sid,
          blockId: 'rsvp',
          payload: { values: { name: 'Ada' }, formId: 'rsvp', timestamp: 0 },
        } as never)
      }
    >
      Send
    </button>
  )
}
const TextBlock = ({ props }: { props: Record<string, unknown> }) => (
  <p data-testid={String(props.testId ?? 'msg')}>{String(props.content ?? '')}</p>
)
const components: Partial<BlockComponentRegistry> = { form: FormBlock as never, text: TextBlock as never }

function surface(source: Record<string, unknown>, extraBlocks: unknown[] = []) {
  return {
    id: 'rsvp-page',
    blocks: [
      { id: 'rsvp', type: 'form', layout: L, props: {} },
      { id: 'msg', type: 'text', layout: L, props: { content: '{{state.done}}' } },
      ...extraBlocks,
    ],
    capabilities: [
      { capability: 'platform/persistence', required: true, config: { dataSources: [source], initialState: { done: false } } },
      {
        capability: 'platform/entities',
        required: true,
        config: { formBindings: [{ formId: 'rsvp', sourceId: 'records', statusKeys: { success: 'done' } }] },
      },
    ],
  } as never
}

afterEach(() => cleanup())

describe('write-only form target (entity facade)', () => {
  it('never lists the source — not on mount, not after a submit', async () => {
    const resolveBinding = vi.fn(async () => ({ items: [], total: 0 }))
    const create = vi.fn(async () => ({ success: true, data: { id: 'n1' }, id: 'n1' }))
    const entityFacade = { store: { create }, resolveBinding } as never
    render(
      <DataBoundSurfaceRenderer
        surface={surface({ id: 'records', kind: 'entity', entityType: 'Rsvp' })}
        components={components as never}
        entityFacade={entityFacade}
        interactionMode="live"
      />
    )
    fireEvent.click(await screen.findByTestId('save'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Rsvp', { name: 'Ada' }))
    await waitFor(() => expect(screen.getByTestId('msg').textContent).toBe('true'))
    expect(resolveBinding).not.toHaveBeenCalled()
  })

  it('still lists the source when a block reads it', async () => {
    const resolveBinding = vi.fn(async () => ({ items: [], total: 0 }))
    const entityFacade = { store: { create: vi.fn() }, resolveBinding } as never
    render(
      <DataBoundSurfaceRenderer
        surface={surface({ id: 'records', kind: 'entity', entityType: 'Rsvp' }, [
          { id: 'n', type: 'text', layout: L, props: { testId: 'n', content: '{{records.length}}' } },
        ])}
        components={components as never}
        entityFacade={entityFacade}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(resolveBinding).toHaveBeenCalled())
  })
})

describe('write-only form target (rest)', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 201,
      statusText: 'Created',
      json: async () => ({ data: { id: 'n1' } }),
    }))
    globalThis.fetch = fetchMock as never
  })
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('sends only the POST — no list GET on mount or after the submit', async () => {
    const endpoint = 'https://api.test/_host/records/Rsvp'
    render(
      <DataBoundSurfaceRenderer
        surface={surface({ id: 'records', kind: 'rest', entityType: 'Rsvp', endpoint, method: 'GET', returns: 'data' })}
        components={components as never}
        interactionMode="live"
      />
    )
    fireEvent.click(await screen.findByTestId('save'))
    await waitFor(() => expect(screen.getByTestId('msg').textContent).toBe('true'))
    const methods = fetchMock.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method ?? 'GET')
    expect(methods).toEqual(['POST'])
    expect(fetchMock.mock.calls[0]?.[0]).toBe(endpoint)
  })
})

describe('writeOnlySourceIds', () => {
  const caps = (bindings: unknown[]) => [{ capability: 'platform/entities', config: { formBindings: bindings } }]
  const sources = [{ id: 'records' }, { id: 'other' }]

  it('names a POST target nothing references', () => {
    expect([
      ...writeOnlySourceIds({ blocks: [], dataSources: sources, capabilities: caps([{ sourceId: 'records' }]) }),
    ]).toEqual(['records'])
  })

  it('keeps a PATCH/PUT target fetched — the write needs the loaded record', () => {
    const ids = writeOnlySourceIds({
      blocks: [],
      dataSources: sources,
      capabilities: caps([{ sourceId: 'records', method: 'PATCH' }]),
    })
    expect(ids.size).toBe(0)
  })

  it('counts every kind of reference as a read', () => {
    const refs: unknown[][] = [
      [{ id: 'b', type: 'text', props: { content: '{{__errors.records}}' } }],
      [{ id: 'b', type: 'table', props: { source: 'records' } }],
      [{ id: 'b', type: 'button', props: { action: { type: 'refresh', sourceId: 'records' } } }],
    ]
    for (const blocks of refs) {
      const ids = writeOnlySourceIds({ blocks, dataSources: sources, capabilities: caps([{ sourceId: 'records' }]) })
      expect(ids.size).toBe(0)
    }
    const viaBehavior = writeOnlySourceIds({
      blocks: [],
      dataSources: sources,
      capabilities: caps([{ sourceId: 'records' }]),
      behaviors: [{ id: 'x', then: [{ type: 'refresh', sourceId: 'records' }] }],
    })
    expect(viaBehavior.size).toBe(0)
  })

  it('does not treat a longer identifier as a reference', () => {
    const blocks = [{ id: 'b', type: 'text', props: { content: '{{recordsTotal}}' } }]
    expect([
      ...writeOnlySourceIds({ blocks, dataSources: sources, capabilities: caps([{ sourceId: 'records' }]) }),
    ]).toEqual(['records'])
  })

  it('ignores a target that is not a declared source', () => {
    const ids = writeOnlySourceIds({ blocks: [], dataSources: sources, capabilities: caps([{ sourceId: 'missing' }]) })
    expect(ids.size).toBe(0)
  })
})
