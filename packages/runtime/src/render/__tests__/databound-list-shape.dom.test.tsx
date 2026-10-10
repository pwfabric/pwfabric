// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — a list source always binds as a list.
 *
 * WHY THIS EXISTS. Three response shapes were in circulation and the binding
 * context received whichever one came back: the entity path yields an array
 * (`result.items`), a REST endpoint yields whatever it wrapped its list in.
 * So `{{data.Product}}` was an array when the platform stored the model and an
 * object when a connection owned it — and swapping a model's owner silently
 * changed what every bound block received.
 *
 * `returns` says where the list is; this says the binding always gets one.
 *
 * `static` and `state` are the documented exceptions: they routinely carry a
 * scalar or a settings object, and wrapping those would break every shipped
 * surface that reads one field off them.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-list-shape.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="text-block">{String(props.content ?? '')}</p>
  )) as never,
}

/** Reads the first element, which only resolves when the binding is a list. */
const blocks: Block[] = [
  {
    id: 'first',
    type: 'text',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { content: 'first:{{rows[0].name}}' },
  },
]

function surfaceWith(source: Record<string, unknown>): never {
  return {
    blocks,
    capabilities: [
      { capability: 'platform/persistence', config: { dataSources: [source] } },
    ],
  } as never
}

function mockJson(body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })) as never
  )
}

describe('a list source binds as a list', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  it('a wrapped list and a bare list produce the identical binding', async () => {
    // Wrapped, the way our own endpoint answers.
    mockJson({ data: [{ name: 'elma' }] })
    const wrapped = render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith({
          id: 'rows',
          kind: 'rest',
          endpoint: '/api/x',
          returns: 'data',
        })}
        components={components}
      />
    )
    await waitFor(() => expect(screen.getByText('first:elma')).toBeTruthy())
    wrapped.unmount()
    cleanup()

    // Bare, the way a plain REST endpoint answers. Same binding, same block.
    mockJson([{ name: 'elma' }])
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith({ id: 'rows', kind: 'rest', endpoint: '/api/y' })}
        components={components}
      />
    )
    await waitFor(() => expect(screen.getByText('first:elma')).toBeTruthy())
  })

  it('wraps a single object so a list binding still resolves', async () => {
    // A detail endpoint answering with one record is still readable as a list
    // of one, rather than silently binding nothing.
    mockJson({ data: { name: 'muz' } })
    render(
      <DataBoundSurfaceRenderer
        surface={surfaceWith({
          id: 'rows',
          kind: 'rest',
          endpoint: '/api/one',
          returns: 'data',
        })}
        components={components}
      />
    )
    await waitFor(() => expect(screen.getByText('first:muz')).toBeTruthy())
  })

  it('leaves a static source alone — an object stays an object', async () => {
    // The documented exception. A static source carrying a settings object is
    // not a list, and wrapping it would break every shipped surface reading
    // one field off it.
    const scalar: Block[] = [
      {
        id: 'scalar',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: 'q:{{cfg.label}}' },
      },
    ]
    render(
      <DataBoundSurfaceRenderer
        surface={
          {
            blocks: scalar,
            capabilities: [
              {
                capability: 'platform/persistence',
                config: {
                  dataSources: [{ id: 'cfg', kind: 'static', staticData: { label: 'armut' } }],
                },
              },
            ],
          } as never
        }
        components={components}
      />
    )
    await waitFor(() => expect(screen.getByText('q:armut')).toBeTruthy())
  })
  /**
   * A DETAIL PAGE READS ITS ONE RECORD BY DOT PATH.
   *
   * The wrap above made `{{rows[0].name}}` work, but a detail page is authored
   * `{{product.title}}` — and a property read on an array finds nothing, so
   * a generated detail page would render blank (`dot:{{rows.name}}` → empty,
   * `idx:{{rows[0].name}}` → the name). A list of EXACTLY ONE is read through;
   * a longer list is still a list.
   */
  function probe(content: string): Block[] {
    return [{ id: 'probe', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content } }]
  }
  function restSurface(content: string): never {
    return {
      blocks: probe(content),
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [{ id: 'rows', kind: 'rest', endpoint: '/api/one', returns: 'data' }],
          },
        },
      ],
    } as never
  }

  it('a single-record rest source reads by dot path, index and length alike', async () => {
    mockJson({ data: { name: 'muz' } })
    render(
      <DataBoundSurfaceRenderer
        surface={restSurface('dot:{{rows.name}}|idx:{{rows[0].name}}|len:{{rows.length}}')}
        components={components}
      />
    )
    await waitFor(() => expect(screen.getByText('dot:muz|idx:muz|len:1')).toBeTruthy())
  })

  it('a two-record list does not fall through — its .name stays empty', async () => {
    mockJson({ data: [{ name: 'elma' }, { name: 'armut' }] })
    render(
      <DataBoundSurfaceRenderer
        surface={restSurface('dot:{{rows.name}}|idx:{{rows[1].name}}|len:{{rows.length}}')}
        components={components}
      />
    )
    await waitFor(() => expect(screen.getByText('dot:|idx:armut|len:2')).toBeTruthy())
  })
})
