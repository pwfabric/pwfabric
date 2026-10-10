/**
 * useInstalledAtoms — runtime hook for tenant-scoped pack atom registry
 *
 * Reads the host's installed-atoms endpoint, `GET /api/pwpacks/runtime/atoms?kind=...`,
 * and returns a `Map<atomId, InstalledAtomDescriptor>` plus loading/error
 * state. The dynamic-artifact provider plugs this into the existing
 * `BlockModuleLoader.import(bundleUrl)` flow.
 *
 * Surface atoms are NOT served by this hook — surfaces use the receipt
 * fork model. Only `block` + `capability` kinds.
 *
 * @module @pwfabric/runtime/hooks/useInstalledAtoms
 */

import { useEffect, useState } from 'react'

// ============================================================
// PUBLIC TYPES
// ============================================================

export type InstalledAtomKind = 'block' | 'capability'

/**
 * AI-readable knowledge for an atom, mirrored from the canonical
 * `AtomManifestKnowledge` contract. Re-declared here so
 * runtime consumers don't have to import the schema package just to read
 * the descriptor; the shape is stable.
 */
export interface InstalledAtomKnowledge {
  readonly purpose: string
  readonly useCases: readonly string[]
  readonly composesWith: readonly string[]
  readonly antiPatterns: readonly string[]
}

export interface InstalledAtomDescriptor {
  readonly atomId: string
  readonly kind: InstalledAtomKind
  readonly bundleUrl: string | null
  readonly bundleHash: string | null
  readonly contentHash: string | null
  readonly sourceListingId: string | null
  readonly installedAt: string
  /**
   * The installed atom's manifest payload. Includes the 4-field `knowledge`
   * block plus catalogue metadata (category, name, description, tags). May be
   * `null` for installs whose pack carried no manifest.json.
   */
  readonly manifest: AtomManifestPayload | null
}

export interface AtomBlockDefinitionMetadata {
  readonly props: readonly Record<string, unknown>[]
  readonly defaultProps: Readonly<Record<string, unknown>>
  readonly canHaveChildren: boolean
  readonly allowedParents?: readonly string[]
  readonly allowedChildren?: readonly string[]
}

export interface AtomManifestPayload {
  readonly id?: string
  readonly kind?: InstalledAtomKind
  readonly version?: string
  readonly name?: string
  readonly state?: string
  readonly category?: string
  readonly description?: string
  readonly tags?: readonly string[]
  readonly knowledge?: InstalledAtomKnowledge
  /**
   * per-block authoring metadata mirrored from the
   * pwpack manifest. Present on block atoms whose manifest carries a
   * `definition` block; absent for capabilities and legacy installs.
   */
  readonly definition?: AtomBlockDefinitionMetadata
}

export interface InstalledAtomsState {
  readonly atoms: ReadonlyMap<string, InstalledAtomDescriptor>
  readonly loading: boolean
  readonly error: Error | null
}

/**
 * Optional fetcher override. Defaults to `window.fetch` against
 * `/api/pwpacks/runtime/atoms`. Tests inject a stub; SSR may inject a
 * server-side direct DB resolver.
 */
export type InstalledAtomsFetcher = (
  worldId: string,
  kind: InstalledAtomKind
) => Promise<readonly InstalledAtomDescriptor[]>

// ============================================================
// DEFAULT FETCHER
// ============================================================

interface ApiResponse {
  readonly data: readonly InstalledAtomDescriptor[]
  readonly meta: { readonly total: number; readonly kind: string; readonly worldId: string }
}

async function defaultFetcher(
  _tenantId: string,
  kind: InstalledAtomKind
): Promise<readonly InstalledAtomDescriptor[]> {
  const res = await fetch(`/api/pwpacks/runtime/atoms?kind=${encodeURIComponent(kind)}`, {
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(`useInstalledAtoms: fetch failed (${res.status})`)
  }
  const body = (await res.json()) as ApiResponse
  return body.data
}

// ============================================================
// PURE STATE REDUCER (testable without React)
// ============================================================

/**
 * Build the InstalledAtomsState from a fetcher result. Exported so unit
 * tests can validate the pure reducer logic without mounting React.
 */
export function reduceFetchedAtoms(
  descriptors: readonly InstalledAtomDescriptor[]
): InstalledAtomsState {
  const map = new Map<string, InstalledAtomDescriptor>()
  for (const d of descriptors) {
    map.set(d.atomId, d)
  }
  return { atoms: map, loading: false, error: null }
}

/**
 * Build the InstalledAtomsState for a fetch failure.
 */
export function reduceFetchError(error: Error): InstalledAtomsState {
  return { atoms: new Map(), loading: false, error }
}

/**
 * The initial loading state — atoms empty, loading true, no error.
 */
export const INITIAL_INSTALLED_ATOMS_STATE: InstalledAtomsState = Object.freeze({
  atoms: new Map(),
  loading: true,
  error: null,
})

// ============================================================
// HOOK
// ============================================================

/**
 * Resolve the active workspace atoms for a tenant by kind. Returns a
 * `Map<atomId, InstalledAtomDescriptor>` plus loading + error state. The
 * map is empty until the first fetch settles; consumers should fall back
 * to a static registry (e.g. `defaultBlockComponents`) while loading.
 */
export function useInstalledAtoms(
  worldId: string,
  kind: InstalledAtomKind,
  fetcher: InstalledAtomsFetcher = defaultFetcher
): InstalledAtomsState {
  const [state, setState] = useState<InstalledAtomsState>({
    atoms: new Map(),
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    setState((prev) => ({ ...prev, loading: true, error: null }))

    fetcher(worldId, kind)
      .then((descriptors) => {
        if (cancelled) return
        const map = new Map<string, InstalledAtomDescriptor>()
        for (const d of descriptors) {
          map.set(d.atomId, d)
        }
        setState({ atoms: map, loading: false, error: null })
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({ atoms: new Map(), loading: false, error: err })
      })

    return () => {
      cancelled = true
    }
  }, [worldId, kind, fetcher])

  return state
}
