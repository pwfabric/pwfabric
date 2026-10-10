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
