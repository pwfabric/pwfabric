// @vitest-environment jsdom
/**
 * Shell selection — the state a SPLIT shell runs on, and its URL projection.
 *
 * Three properties are load-bearing and each is asserted directly rather than
 * through a block: the URL is the source of truth, Back undoes a selection, and
 * an inert host never touches the address bar.
 *
 * @module @pwfabric/runtime/render/__tests__/shell-selection.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, act } from '@testing-library/react'
import {
  ShellSelectionProvider,
  createShellSelectionStore,
  useShellSelection,
} from '../shell-selection.js'
import type { SurfaceAddress } from '../address.js'

function Probe({ sel = 'sec', fallback }: { sel?: string; fallback?: string }): React.ReactElement {
  const [selected, select] = useShellSelection(sel, { fallback })
  return (
    <div>
      <span data-testid="value">{selected ?? '—'}</span>
      <button type="button" onClick={() => select('m2')}>
        select
      </button>
    </div>
  )
}

describe('useShellSelection', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })
  afterEach(cleanup)

  it('falls back when the URL carries nothing', () => {
    const { getByTestId } = render(
      <ShellSelectionProvider>
        <Probe fallback="m1" />
      </ShellSelectionProvider>
    )
    expect(getByTestId('value').textContent).toBe('m1')
  })

  it('reads the selection out of the URL, not the fallback', () => {
    window.history.replaceState({}, '', '/?sec=m3')
    const { getByTestId } = render(
      <ShellSelectionProvider>
        <Probe fallback="m1" />
      </ShellSelectionProvider>
    )
    expect(getByTestId('value').textContent).toBe('m3')
  })

  it('selecting writes the URL and pushes history, so Back undoes it', () => {
    const { getByText, getByTestId } = render(
      <ShellSelectionProvider>
        <Probe fallback="m1" />
      </ShellSelectionProvider>
    )
    const before = window.history.length
    act(() => {
      getByText('select').click()
    })
    expect(window.location.search).toBe('?sec=m2')
    expect(getByTestId('value').textContent).toBe('m2')
    // pushState, not replaceState — a selection is a navigation the user
    // expects Back to undo. That is the whole reason it lives in the URL.
    expect(window.history.length).toBe(before + 1)
  })

  it('two blocks reading the same key see the same selection', () => {
    const { getAllByTestId, getAllByText } = render(
      <ShellSelectionProvider>
        <Probe fallback="m1" />
        <Probe fallback="m1" />
      </ShellSelectionProvider>
    )
    act(() => {
      getAllByText('select')[0]!.click()
    })
    expect(getAllByTestId('value').map((n) => n.textContent)).toEqual(['m2', 'm2'])
  })

  it('an inert host selects without moving the address bar', () => {
    function InertProbe(): React.ReactElement {
      const [selected, select] = useShellSelection('sec', { fallback: 'm1', syncUrl: false })
      return (
        <div>
          <span data-testid="value">{selected}</span>
          <button type="button" onClick={() => select('m2')}>
            select
          </button>
        </div>
      )
    }
    const { getByText, getByTestId } = render(
      <ShellSelectionProvider syncUrl={false}>
        <InertProbe />
      </ShellSelectionProvider>
    )
    act(() => {
      getByText('select').click()
    })
    expect(getByTestId('value').textContent).toBe('m2')
    expect(window.location.search).toBe('')
  })

  it('an inert block inside a live surface still leaves the URL alone', () => {
    function InertProbe(): React.ReactElement {
      const [, select] = useShellSelection('sec', { syncUrl: false })
      return (
        <button type="button" onClick={() => select('m9')}>
          select
        </button>
      )
    }
    const { getByText } = render(
      <ShellSelectionProvider syncUrl>
        <InertProbe />
      </ShellSelectionProvider>
    )
    act(() => {
      getByText('select').click()
    })
    expect(window.location.search).toBe('')
  })

  it('works with no provider at all', () => {
    const { getByText, getByTestId } = render(<Probe fallback="m1" />)
    expect(getByTestId('value').textContent).toBe('m1')
    act(() => {
      getByText('select').click()
    })
    expect(getByTestId('value').textContent).toBe('m2')
  })

  it('an in-memory store keeps its own value and notifies subscribers', () => {
    const store = createShellSelectionStore(false)
    let seen = 0
    const stop = store.subscribe(() => {
      seen++
    })
    store.set('k', 'a')
    expect(store.get('k')).toBe('a')
    expect(seen).toBe(1)
    stop()
    store.set('k', 'b')
    expect(seen).toBe(1)
  })

  it('clearing a selection removes the parameter', () => {
    window.history.replaceState({}, '', '/?sec=m3')
    const store = createShellSelectionStore(true)
    store.set('sec', undefined)
    expect(window.location.search).toBe('')
    expect(store.get('sec')).toBeUndefined()
  })
})

/**
 * The selection lives in the PAGE'S address (the host's seam), is page state,
 * and an unknown selection is none.
 *
 * Under the hash router the page's query is inside the fragment
 * (`#/reference?endpoint=x`); written to `location.search` the selection sat
 * beside the route (`/?endpoint=x#/reference`), out of reach of the page.
 */
describe('useShellSelection — the page address', () => {
  function memoryAddress(initial = ''): SurfaceAddress & { writes: [Record<string, string | null>, string][] } {
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
      notFound() {},
    }
  }

  function Pick({ ids, fallback }: { ids?: string[]; fallback?: string }): React.ReactElement {
    const [selected, select] = useShellSelection('endpoint', { fallback, ids })
    return (
      <div>
        <span data-testid="value">{selected ?? 'none'}</span>
        <button type="button" onClick={() => select('refunds')}>
          select
        </button>
      </div>
    )
  }

  beforeEach(() => {
    window.history.replaceState({}, '', '/')
  })
  afterEach(cleanup)

  it('reads and writes the host address, never location.search', () => {
    const address = memoryAddress('endpoint=charges')
    const { getByTestId, getByText } = render(
      <ShellSelectionProvider address={address}>
        <Pick />
      </ShellSelectionProvider>
    )
    expect(getByTestId('value').textContent).toBe('charges')
    act(() => {
      getByText('select').click()
    })
    expect(address.writes).toEqual([[{ endpoint: 'refunds' }, 'push']])
    expect(getByTestId('value').textContent).toBe('refunds')
    expect(window.location.search).toBe('')
  })

  it('mirrors the selection shown into page state, null for none', () => {
    const seen: [string, string | null][] = []
    const mirror = (key: string, id: string | null): void => void seen.push([key, id])
    const { getByText, unmount } = render(
      <ShellSelectionProvider address={memoryAddress()} onSelection={mirror}>
        <Pick fallback="charges" ids={['charges', 'refunds']} />
      </ShellSelectionProvider>
    )
    expect(seen.at(-1)).toEqual(['endpoint', 'charges'])
    act(() => {
      getByText('select').click()
    })
    expect(seen.at(-1)).toEqual(['endpoint', 'refunds'])
    unmount()
  })

  it('an address naming an id the block does not have selects NONE, not the first row', () => {
    const seen: (string | null)[] = []
    const { getByTestId } = render(
      <ShellSelectionProvider address={memoryAddress('endpoint=nope')} onSelection={(_k, id) => void seen.push(id)}>
        <Pick fallback="charges" ids={['charges', 'refunds']} />
      </ShellSelectionProvider>
    )
    expect(getByTestId('value').textContent).toBe('none')
    expect(seen.at(-1)).toBeNull()
  })
})
