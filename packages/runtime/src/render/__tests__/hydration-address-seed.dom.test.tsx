// @vitest-environment jsdom
/**
 * ADDRESS SEED APPLIED AFTER HYDRATION (data-protocol §1.1 / pwapp-format §2.5).
 *
 * At phone width the runner uses the build's first frame. That frame was built
 * without any address seed (`?id=` etc.), so React hydrates the HTML with the
 * same state the build used: `initialState.id = ""`. The address seed arrives
 * later, as an `update()` call that passes a new surface with the
 * URL-seeded `initialState` (the post-hydration update in `hydrateFirstFrame`).
 *
 * Before the fix, `useState(initialState)` only initialized once, so the seed
 * never reached `surfaceState`. The record source stayed idle (`state.id = ""`
 * → `queryAsksForNothing`), `useNotFoundReport` fired on the LIVE address, and
 * the page went not-found before the record was ever requested.
 *
 * Two cases:
 *  - empty default (`initialState.id = ""`): cafe-menu dish, headphone product,
 *    conference session. At hydration: idle → no request. After update with real
 *    id: source becomes active → record is requested → record loads.
 *  - non-empty default (`initialState.id = "lead-article"`): design-magazine
 *    essay. At hydration: lead article fetched. After update with a different id:
 *    state switches, different record fetched.
 *
 * Also guards: when `address` is NOT provided to the hydrating render (run-app.ts
 * strips it for the hydrating render), `useNotFoundReport` must NOT fire and must
 * NOT set the `reported` flag — so once the real address arrives in the update it
 * can still fire when the record is genuinely missing.
 *
 * @module @pwfabric/runtime/render/__tests__/hydration-address-seed.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, act, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { SurfaceAddress } from '../address.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const L = DEFAULT_BLOCK_LAYOUT

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

type MemoryAddress = SurfaceAddress & { notFound: ReturnType<typeof vi.fn> }

function memoryAddress(initial = ''): MemoryAddress {
  let query = initial
  return {
    query: () => query,
    writeQuery(values) {
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

const Text = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="t">{String(props.content ?? '')}</div>
)
// A button that fires a setState action via context.onEvent (the data-bound path).
const Setter = ({
  props,
  context,
}: {
  props: Record<string, unknown>
  context: { onEvent?: (e: unknown) => void }
}) => (
  <button
    data-testid={String(props.testId ?? 'set')}
    onClick={() =>
      context.onEvent?.({
        type: 'click',
        canonicalType: 'block:click',
        surfaceId: 's',
        blockId: String(props.testId ?? 'set'),
        timestamp: Date.now(),
        payload: { action: { type: 'setState', key: String(props.stateKey), value: props.value } },
      })
    }
  >
    set
  </button>
)
const components: Partial<BlockComponentRegistry> = {
  text: Text as never,
  setter: Setter as never,
}

const DISHES = [
  { id: 'soup', name: 'Soup' },
  { id: 'cake', name: 'Cake' },
]

function entityFacade() {
  return {
    resolveBinding: vi.fn(async (_t: string, q?: { filter?: { field?: string; value?: unknown } }) => {
      const f = q?.filter
      const items =
        f?.field && f.value
          ? DISHES.filter((d) => (d as Record<string, unknown>)[f.field as string] === f.value)
          : DISHES
      return { items, total: items.length, offset: 0, limit: 50, hasMore: false }
    }),
  }
}

function surface(id: string): never {
  return {
    blocks: [
      {
        id: 't',
        type: 'text',
        layout: L,
        props: { content: '{{dish[0].name}}|idle={{__idle.dish}}|loading={{__loading.dish}}' },
      },
    ],
    capabilities: [
      {
        capability: 'platform/persistence',
        config: {
          dataSources: [
            {
              id: 'dish',
              kind: 'entity',
              entityType: 'Dish',
              notFoundWhenEmpty: true,
              query: { filter: { field: 'id', operator: 'eq', value: '{{state.id}}' } },
            },
          ],
          initialState: { id },
        },
      },
    ],
  } as never
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('address seed applied after hydration', () => {
  it('empty default id — seed arrives in update: record is requested and loads', async () => {
    const facade = entityFacade()
    // Phase 1: hydrating render — initialState.id = "" (no address seed yet).
    // No `address` prop: simulates the runner stripping it for the hydrating render.
    const { rerender } = render(
      <DataBoundSurfaceRenderer
        surface={surface('')}
        components={components}
        entityFacade={facade as never}
        loadingStrategy="immediate"
      />
    )
    // Source is idle (state.id = ""), no request made — and the page keeps its
    // loading frame: an idle record is never drawn (E-3, withRecordFrameHeld).
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('t').textContent).toBe('|idle=false|loading=true')
    expect(facade.resolveBinding).not.toHaveBeenCalled()

    // Phase 2: post-hydration update — initialState.id = "soup" (from ?id=soup).
    // `address` now provided: simulates the runner's onHydrated update call.
    const addr = memoryAddress('id=soup')
    await act(async () => {
      rerender(
        <DataBoundSurfaceRenderer
          surface={surface('soup')}
          components={components}
          entityFacade={facade as never}
          address={addr}
          loadingStrategy="immediate"
        />
      )
    })

    // After the seed lands, the record is fetched and shows.
    await waitFor(() => expect(screen.getByTestId('t').textContent).toMatch(/^Soup\|/))
    expect(addr.notFound).not.toHaveBeenCalled()
    expect(facade.resolveBinding).toHaveBeenCalled()
  })

  it('non-empty default id — seed from update replaces it: different record loads', async () => {
    const facade = entityFacade()
    // Phase 1: hydrating render — initialState.id = "soup" (lead item default).
    const { rerender } = render(
      <DataBoundSurfaceRenderer
        surface={surface('soup')}
        components={components}
        entityFacade={facade as never}
        loadingStrategy="immediate"
      />
    )
    await waitFor(() => expect(screen.getByTestId('t').textContent).toMatch(/^Soup\|/))

    // Phase 2: post-hydration update — initialState.id = "cake" (from ?id=cake).
    const addr = memoryAddress('id=cake')
    await act(async () => {
      rerender(
        <DataBoundSurfaceRenderer
          surface={surface('cake')}
          components={components}
          entityFacade={facade as never}
          address={addr}
          loadingStrategy="immediate"
        />
      )
    })

    await waitFor(() => expect(screen.getByTestId('t').textContent).toMatch(/^Cake\|/))
    expect(addr.notFound).not.toHaveBeenCalled()
  })

  it('no address during hydration: notFound NOT called, reported flag clear — fires on real address when record missing', async () => {
    // A source with no matching records — genuinely missing.
    const facade = {
      resolveBinding: vi.fn(async () => ({ items: [], total: 0, offset: 0, limit: 50, hasMore: false })),
    }
    const { rerender } = render(
      <DataBoundSurfaceRenderer
        surface={surface('')}
        components={components}
        entityFacade={facade as never}
        loadingStrategy="immediate"
        // No `address` prop — simulates the runner stripping it for the hydrating render.
      />
    )
    // Source is idle, held in the loading frame. No notFound should fire
    // (address is undefined → guard blocks it).
    await new Promise((r) => setTimeout(r, 20))
    expect(screen.getByTestId('t').textContent).toBe('|idle=false|loading=true')

    // Phase 2: update with real address and real id (record does not exist).
    const addr = memoryAddress('id=no-such-id')
    await act(async () => {
      rerender(
        <DataBoundSurfaceRenderer
          surface={surface('no-such-id')}
          components={components}
          entityFacade={facade as never}
          address={addr}
          loadingStrategy="immediate"
        />
      )
    })

    // The record is genuinely missing → notFound fires via the REAL address.
    await waitFor(() => expect(addr.notFound).toHaveBeenCalledTimes(1))
  })

  it('user-written state is not overridden by an initialState update', async () => {
    // The id key starts empty. The user fires a setState to 'cake'. THEN the
    // post-hydration update arrives with initialState.id = 'soup'. Because the
    // user already wrote 'cake', the seed ('soup') must NOT apply.
    function surfaceWithSetter(initialId: string): never {
      return {
        blocks: [
          { id: 't', type: 'text', layout: L, props: { content: '{{state.id}}' } },
          {
            id: 'set',
            type: 'setter',
            layout: L,
            props: { testId: 'set', stateKey: 'id', value: 'cake' },
          },
        ],
        capabilities: [
          {
            capability: 'platform/persistence',
            config: { initialState: { id: initialId } },
          },
        ],
      } as never
    }

    const { rerender } = render(
      <DataBoundSurfaceRenderer
        surface={surfaceWithSetter('')}
        components={components}
        loadingStrategy="immediate"
      />
    )
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe(''))

    // User writes id = "cake" via a setState action.
    await act(async () => {
      fireEvent.click(screen.getByTestId('set'))
    })
    await waitFor(() => expect(screen.getByTestId('t').textContent).toBe('cake'))

    // Post-hydration update: initialState.id = "soup" (the seed from the URL).
    // current['id'] = "cake" ≠ prev['id'] = "" → guard: do NOT apply.
    await act(async () => {
      rerender(
        <DataBoundSurfaceRenderer
          surface={surfaceWithSetter('soup')}
          components={components}
          loadingStrategy="immediate"
        />
      )
    })
    // User's value survives.
    expect(screen.getByTestId('t').textContent).toBe('cake')
  })
})
