/**
 * useInstalledAtoms tests
 *
 * Pure-state reducer tests. The hook itself is React-only; integration
 * tests for the React mount + useEffect path live in `apps/web` (where
 * @testing-library/react is a direct dep). Here we test the reducer
 * helpers + the default fetch wrapper logic so the contract is locked.
 *
 * @module @pwfabric/runtime/hooks/__tests__/useInstalledAtoms
 */

import { describe, it, expect } from 'vitest'
import {
  reduceFetchedAtoms,
  reduceFetchError,
  INITIAL_INSTALLED_ATOMS_STATE,
  type InstalledAtomDescriptor,
} from '../useInstalledAtoms.js'

const DESCRIPTORS: readonly InstalledAtomDescriptor[] = [
  {
    atomId: 'control.button',
    kind: 'block',
    bundleUrl: 'https://cdn.local/button.bundle.mjs',
    bundleHash: 'a'.repeat(64),
    contentHash: null,
    sourceListingId: 'L1',
    installedAt: '2026-04-24T00:00:00.000Z',
  },
  {
    atomId: 'layout.container',
    kind: 'block',
    bundleUrl: 'https://cdn.local/container.bundle.mjs',
    bundleHash: 'b'.repeat(64),
    contentHash: null,
    sourceListingId: 'L1',
    installedAt: '2026-04-24T00:00:00.000Z',
  },
]

describe('useInstalledAtoms — pure reducers', () => {
  it('initial state: empty map, loading=true, no error', () => {
    expect(INITIAL_INSTALLED_ATOMS_STATE.loading).toBe(true)
    expect(INITIAL_INSTALLED_ATOMS_STATE.atoms.size).toBe(0)
    expect(INITIAL_INSTALLED_ATOMS_STATE.error).toBeNull()
  })

  it('reduceFetchedAtoms keys the map by atomId', () => {
    const state = reduceFetchedAtoms(DESCRIPTORS)
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.atoms.size).toBe(2)
    expect(state.atoms.get('control.button')?.bundleUrl).toBe('https://cdn.local/button.bundle.mjs')
    expect(state.atoms.get('layout.container')?.bundleHash).toBe('b'.repeat(64))
  })

  it('reduceFetchedAtoms returns an empty map for an empty fetch', () => {
    const state = reduceFetchedAtoms([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.atoms.size).toBe(0)
  })

  it('reduceFetchError carries the error and resets the atom map', () => {
    const err = new Error('catalog down')
    const state = reduceFetchError(err)
    expect(state.loading).toBe(false)
    expect(state.error).toBe(err)
    expect(state.atoms.size).toBe(0)
  })

  it('reduceFetchedAtoms collapses duplicate atomIds (last write wins)', () => {
    const first = DESCRIPTORS[0]
    if (!first) throw new Error('fixture invariant: DESCRIPTORS[0] missing')
    const dup: InstalledAtomDescriptor[] = [first, { ...first, bundleHash: 'c'.repeat(64) }]
    const state = reduceFetchedAtoms(dup)
    expect(state.atoms.size).toBe(1)
    expect(state.atoms.get('control.button')?.bundleHash).toBe('c'.repeat(64))
  })
})
