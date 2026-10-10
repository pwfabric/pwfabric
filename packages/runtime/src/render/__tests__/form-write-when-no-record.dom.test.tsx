// @vitest-environment jsdom
/**
 * A form bound to a record that does not exist must CREATE.
 *
 * An event app's Profile form binds `me` (→ Attendee) with
 * `method: 'PATCH'`. The assembler rewrites that entity source to a REST
 * source at `…/records/Attendee`; a writer that sent
 * `PATCH /records/Attendee` — the collection path, no id — would get 404
 * "Route not found", and with a static toast the page would say "Check the
 * highlighted fields" with nothing highlighted.
 *
 * This mounts the real data-bound path with a REST source, exactly as the
 * published app does, and checks:
 *   - no loaded record → POST to the collection
 *   - a loaded record  → PATCH to `<collection>/<id>`
 *   - a server 404/400 → its own message reaches `statusKeys.message`
 *   - the in-process facade path follows the same rule (update vs create)
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

const originalFetch = globalThis.fetch
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  globalThis.fetch = fetchMock as never
})
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

const VALUES = { name: 'Rivka Aslan', reminders: 'rsvp' }

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
          blockId: 'prof-form',
          payload: { values: VALUES, formId: 'prof-form', timestamp: 0 },
        } as never)
      }
    >
      Save profile
    </button>
  )
}

const components: Partial<BlockComponentRegistry> = {
  form: FormBlock as never,
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="msg">{String(props.content ?? '')}</p>
  )) as never,
}

const L = DEFAULT_BLOCK_LAYOUT
const ENDPOINT = 'https://api.test/api/app/w/p/records/Attendee'

function surface(method: 'PATCH' | 'POST' = 'PATCH') {
  return {
    id: 'profile',
    blocks: [
      { id: 'prof-form', type: 'form', layout: L, props: {} },
      { id: 'msg', type: 'text', layout: L, props: { content: '{{state.saveMessage}}' } },
    ],
    capabilities: [
      {
        capability: 'platform/persistence',
        required: true,
        config: {
          // What the assembler ships for an authored `kind: 'entity'` source.
          dataSources: [
            { id: 'me', kind: 'rest', entityType: 'Attendee', endpoint: ENDPOINT, method: 'GET', returns: 'data' },
          ],
          initialState: { saveMessage: '' },
        },
      },
      {
        capability: 'platform/entities',
        required: true,
        config: {
          formBindings: [
            {
              formId: 'prof-form',
              sourceId: 'me',
              method,
              statusKeys: { loading: 'submitting', success: 'submitted', error: 'failed', message: 'saveMessage' },
            },
          ],
        },
      },
    ],
  } as never
}

function answer(body: unknown, status = 200) {
  return {
    ok: status < 400,
    status,
    statusText: status === 404 ? 'Not Found' : status === 400 ? 'Bad Request' : 'OK',
    json: async () => body,
  }
}

/** The list GET the page issues on mount answers `records`; every later call is the write. */
function serve(records: unknown[], write: ReturnType<typeof answer>) {
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
    (init?.method ?? 'GET') === 'GET' ? answer({ data: records }) : write
  )
}

function writeCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method !== 'GET')
  if (!call) throw new Error('no write was sent')
  return call as [string, RequestInit]
}

async function mountAndSave(method: 'PATCH' | 'POST' = 'PATCH') {
  render(<DataBoundSurfaceRenderer surface={surface(method)} components={components as never} interactionMode="live" />)
  // Let the list load first — the write target is decided from what loaded.
  // A POST-only target nothing reads is never listed (write-only source).
  if (method !== 'POST') await waitFor(() => expect(fetchMock).toHaveBeenCalled())
  await waitFor(() => expect(screen.getByTestId('save')).toBeTruthy())
  fireEvent.click(screen.getByTestId('save'))
  await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => (i as RequestInit)?.method !== 'GET')).toBe(true))
}

describe('form write when the bound source has no record', () => {
  it('no loaded record → POST to the collection, never PATCH', async () => {
    serve([], answer({ data: { id: 'new-1', ...VALUES } }, 201))
    await mountAndSave('PATCH')
    const [url, init] = writeCall()
    expect(init.method).toBe('POST')
    expect(url).toBe(ENDPOINT)
    expect(JSON.parse(String(init.body))).toEqual(VALUES)
  })

  it('a loaded record → PATCH to <collection>/<id>', async () => {
    serve([{ id: 'att-7', name: 'Rivka' }], answer({ data: { id: 'att-7', ...VALUES } }))
    await mountAndSave('PATCH')
    const [url, init] = writeCall()
    expect(init.method).toBe('PATCH')
    expect(url).toBe(`${ENDPOINT}/att-7`)
  })

  it('a server 404 surfaces as its own message, not a field-validation one', async () => {
    serve([], answer({ error: { code: 'NOT_FOUND', message: 'Route not found' } }, 404))
    await mountAndSave('PATCH')
    await waitFor(() =>
      expect(screen.getByTestId('msg').textContent).toBe(
        'The server could not save this record (404): Route not found'
      )
    )
  })

  it('a server 400 validation refusal names the fields', async () => {
    serve([], answer({ error: { code: 'VALIDATION_FAILED', message: 'name: Required' } }, 400))
    await mountAndSave('POST')
    await waitFor(() => expect(screen.getByTestId('msg').textContent).toMatch(/^Check the highlighted fields/))
    expect(screen.getByTestId('msg').textContent).toContain('name: Required')
  })
})

describe('the in-process facade path follows the same rule', () => {
  function facadeSurface() {
    return {
      id: 'profile',
      blocks: [{ id: 'prof-form', type: 'form', layout: L, props: {} }],
      capabilities: [
        {
          capability: 'platform/persistence',
          required: true,
          config: { dataSources: [{ id: 'me', kind: 'entity', entityType: 'Attendee' }] },
        },
        {
          capability: 'platform/entities',
          required: true,
          config: { formBindings: [{ formId: 'prof-form', sourceId: 'me', method: 'PATCH' }] },
        },
      ],
    } as never
  }

  it('update when a record is loaded, create when none is', async () => {
    const create = vi.fn().mockResolvedValue({ success: true, data: { id: 'n1' }, id: 'n1' })
    const update = vi.fn().mockResolvedValue({ success: true, data: { id: 'att-7' }, id: 'att-7' })
    let items: Record<string, unknown>[] = [{ id: 'att-7', name: 'Rivka' }]
    const facade = {
      store: { create, update },
      resolveBinding: async () => ({ items, total: items.length }),
    } as never

    const { unmount } = render(
      <DataBoundSurfaceRenderer surface={facadeSurface()} components={components as never} entityFacade={facade} interactionMode="live" />
    )
    // Wait for the list to be bound before saving.
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.click(screen.getByTestId('save'))
    await waitFor(() => expect(update).toHaveBeenCalledWith('Attendee', 'att-7', VALUES))
    expect(create).not.toHaveBeenCalled()
    unmount()

    items = []
    render(
      <DataBoundSurfaceRenderer surface={facadeSurface()} components={components as never} entityFacade={facade} interactionMode="live" />
    )
    await new Promise((r) => setTimeout(r, 20))
    fireEvent.click(screen.getByTestId('save'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('Attendee', VALUES))
    expect(update).toHaveBeenCalledTimes(1)
  })
})
