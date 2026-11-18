// @vitest-environment jsdom
/**
 * Engine 2.2 — actions and writes.
 *
 * #5   A behavior's actions passed as written: `navigate` to
 *      `/dish?id={{state.dish}}` went to the braces, a `setState` value
 *      `{{state.count + 1}}` wrote the string. Resolved at dispatch now.
 * #14  A form binding's `successRedirect` was followed as written, so
 *      `/confirmation?id={{result.id}}` could not carry the new order.
 * #18  The `write` action: create, update or delete one record, page state
 *      driven like a form's, every source fetched again afterwards.
 * D1   A failed write's reason is a code (`statusKeys.reason`), never a
 *      sentence; the server's words go to `statusKeys.detail`.
 *
 * @module @pwfabric/runtime/render/__tests__/actions-resolve-and-write.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT

type P = { block: Block; props: Record<string, unknown> }
const Text = ({ block, props }: P) => <div data-testid={block.id}>{String(props.text ?? '')}</div>
const Btn = ({ block }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() => emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}
    >
      {block.id}
    </button>
  )
}
const Form = ({ block }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() =>
        emit({
          type: SURFACE_EVENTS.FORM_SUBMIT,
          surfaceId,
          blockId: block.id,
          payload: { values: { name: 'Ada' }, formId: block.id, timestamp: 0 },
        } as never)
      }
    >
      submit
    </button>
  )
}
const components: Partial<BlockComponentRegistry> = { text: Text as never, button: Btn as never, form: Form as never }
const text = (id: string, t: string): Block => ({ id, type: 'text', layout: L, props: { text: t } }) as Block
const button = (id: string, action?: unknown): Block =>
  ({ id, type: 'button', layout: L, props: action === undefined ? {} : { action } }) as Block

const click = async (id: string): Promise<void> => {
  await act(async () => screen.getByTestId(id).click())
}

let assign: ReturnType<typeof vi.fn>
const originalLocation = window.location
beforeEach(() => {
  assign = vi.fn()
  Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, assign } })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
})

// ============================================================
// #5 — behavior actions are resolved
// ============================================================

describe('#5 a behavior action is resolved against the page when it fires', () => {
  const page = (actions: unknown[]) =>
    ({
      id: 'p',
      blocks: [button('go'), text('out', 'count={{state.count}} next={{state.next}}')],
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            initialState: { count: 2, dish: 'd-7' },
            behaviors: [{ id: 'b', event: 'block:click', targetBlockId: 'go', actions }],
          },
        },
      ],
    }) as never

  it('a setState value reads state — the number, not the braces', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={page([
          { type: 'setState', key: 'next', value: '{{state.count + 1}}' },
        ])}
        components={components}
      />
    )
    await click('go')
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('count=2 next=3'))
  })

  it('a navigate url reads state', async () => {
    render(
      <DataBoundSurfaceRenderer surface={page([{ type: 'navigate', url: '#/dish?id={{state.dish}}' }])} components={components} />
    )
    await click('go')
    expect(assign).toHaveBeenCalledWith('#/dish?id=d-7')
  })

  it('a navigate url whose page is an expression is a checked data link, in the router form', async () => {
    const onNavigateAction = vi.fn(() => false)
    render(
      <DataBoundSurfaceRenderer
        surface={
          {
            id: 'p',
            blocks: [button('go')],
            capabilities: [
              {
                capability: 'platform/persistence',
                config: {
                  initialState: { to: '/dish?id=4', bad: 'javascript:alert(1)' },
                  behaviors: [
                    { id: 'b', event: 'block:click', targetBlockId: 'go', actions: [{ type: 'navigate', url: '{{state.to}}' }, { type: 'navigate', url: '{{state.bad}}' }] },
                  ],
                },
              },
            ],
          } as never
        }
        components={components}
        onNavigateAction={onNavigateAction}
        linkHref={(href) => `#${href}`}
      />
    )
    await click('go')
    expect(assign).toHaveBeenCalledTimes(1)
    expect(assign).toHaveBeenCalledWith('#/dish?id=4')
  })
})

// ============================================================
// #14 — successRedirect is resolved after the write
// ============================================================

describe('#14 a form binding successRedirect is resolved with the written record', () => {
  it('goes to /confirmation?id=<the new id>', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'POST'
          ? { ok: true, status: 201, json: async () => ({ data: { id: 'ord-42', name: 'Ada' } }) }
          : { ok: true, status: 200, json: async () => ({ data: [] }) }
      ) as never
    )
    render(
      <DataBoundSurfaceRenderer
        surface={
          {
            id: 'checkout',
            blocks: [{ id: 'pay', type: 'form', layout: L, props: {} }],
            capabilities: [
              {
                capability: 'platform/persistence',
                config: {
                  dataSources: [{ id: 'orders', kind: 'rest', endpoint: 'http://h/records/Order', returns: 'data' }],
                  initialState: { finish: 'sand' },
                },
              },
              {
                capability: 'platform/entities',
                config: {
                  formBindings: [
                    { formId: 'pay', sourceId: 'orders', successRedirect: '#/confirmation?id={{result.id}}&finish={{state.finish}}' },
                  ],
                },
              },
            ],
          } as never
        }
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('pay')).not.toBeNull())
    await click('pay')
    await waitFor(() => expect(assign).toHaveBeenCalledWith('#/confirmation?id=ord-42&finish=sand'))
  })
})

// ============================================================
// #18 — the write action
// ============================================================

describe('#18 the write action', () => {
  type Row = Record<string, unknown>
  let rows: Row[]
  let requests: { method: string; url: string; body?: unknown }[]
  let refuse: number | null

  beforeEach(() => {
    rows = [{ id: 'l1', session: 's1' }]
    requests = []
    refuse = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        requests.push({ method, url, ...(body !== undefined ? { body } : {}) })
        if (refuse !== null && method !== 'GET') {
          return {
            ok: false,
            status: refuse,
            statusText: 'Forbidden',
            json: async () => ({ error: { code: 'FORBIDDEN', message: 'You may not create Like records.' } }),
          }
        }
        if (method === 'POST') {
          const row = { id: `l${rows.length + 1}`, ...body }
          rows.push(row)
          return { ok: true, status: 201, json: async () => ({ data: row }) }
        }
        if (method === 'PATCH') {
          const id = url.split('/').pop()
          const row = rows.find((r) => r.id === id)!
          Object.assign(row, body)
          return { ok: true, status: 200, json: async () => ({ data: row }) }
        }
        if (method === 'DELETE') {
          const id = url.split('/').pop()
          rows = rows.filter((r) => r.id !== id)
          return { ok: true, status: 200, json: async () => ({ data: { id, deleted: true } }) }
        }
        return { ok: true, status: 200, json: async () => ({ data: rows.map((r) => ({ ...r })) }) }
      }) as never
    )
  })

  const page = (blocks: Block[]) =>
    ({
      id: 'likes',
      blocks: [...blocks, text('n', 'likes={{length(likes)}} first={{likes[0].session}} sent={{state.sent}} err={{state.failed}} reason={{state.why}} detail={{state.detail}}')],
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [{ id: 'likes', kind: 'rest', endpoint: 'http://h/records/Like', returns: 'data' }],
            initialState: { session: 's9' },
          },
        },
      ],
    }) as never
  const keys = { success: 'sent', error: 'failed', reason: 'why', detail: 'detail' }

  it('creates a record with resolved values, then the bound list shows it', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={page([button('like', { type: 'write', sourceId: 'likes', op: 'create', values: { session: '{{state.session}}' }, statusKeys: keys })])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('likes=1'))
    await click('like')
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('likes=2'))
    expect(screen.getByTestId('n').textContent).toContain('sent=true')
    expect(requests).toContainEqual({ method: 'POST', url: 'http://h/records/Like', body: { session: 's9' } })
  })

  it('updates the record it names', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={page([button('edit', { type: 'write', sourceId: 'likes', op: 'update', id: '{{likes[0].id}}', values: { session: 's2' } })])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('first=s1'))
    await click('edit')
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('first=s2'))
    expect(requests).toContainEqual({ method: 'PATCH', url: 'http://h/records/Like/l1', body: { session: 's2' } })
  })

  it('deletes the record it names', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={page([button('unlike', { type: 'write', sourceId: 'likes', op: 'delete', id: 'l1' })])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('likes=1'))
    await click('unlike')
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('likes=0'))
    expect(requests.some((r) => r.method === 'DELETE' && r.url === 'http://h/records/Like/l1')).toBe(true)
  })

  it('a refused write sets the error keys — a reason code, the server words as detail — and refreshes nothing', async () => {
    refuse = 403
    render(
      <DataBoundSurfaceRenderer
        surface={page([button('like', { type: 'write', sourceId: 'likes', op: 'create', values: { session: 's9' }, statusKeys: keys })])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('likes=1'))
    const before = requests.filter((r) => r.method === 'GET').length
    await click('like')
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('err=true'))
    expect(screen.getByTestId('n').textContent).toContain('reason=forbidden ')
    expect(screen.getByTestId('n').textContent).toContain('detail=403 FORBIDDEN: You may not create Like records.')
    expect(requests.filter((r) => r.method === 'GET').length).toBe(before)
  })

  it('an update without an id does not write', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={page([button('edit', { type: 'write', sourceId: 'likes', op: 'update', values: { session: 's2' }, statusKeys: keys })])}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('likes=1'))
    await click('edit')
    await waitFor(() => expect(screen.getByTestId('n').textContent).toContain('err=true'))
    expect(requests.some((r) => r.method !== 'GET')).toBe(false)
  })
})
