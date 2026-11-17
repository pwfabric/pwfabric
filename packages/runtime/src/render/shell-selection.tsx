/**
 * Shell selection — the state a SPLIT shell runs on.
 *
 * WHY THIS IS IN THE RUNTIME AND NOT IN THE BLOCK. A split surface (list on the
 * left, detail on the right) has exactly one piece of state: which item is
 * selected. Kept inside the block it is invisible to everything else — the URL
 * does not move, so the page cannot be linked to, the browser Back button does
 * nothing, and a second block on the same surface (a header showing the
 * selected record's title, a toolbar acting on it) has no way to read it.
 *
 * So selection is a SURFACE-level fact with a URL projection:
 *
 *   ?<key>=<itemId>
 *
 * and this module is the single place that reads and writes it.
 *
 * THE QUERY IS THE PAGE'S, NOT THE DOCUMENT'S. It is read and written through
 * the host's address (address.ts): in a pwapp that is the route's own query —
 * `#/reference?endpoint=x` under the hash router — and the selection is also
 * PAGE STATE, `{{state.<key>}}`, so a header, a source or a "not found" note
 * can read it. Written to `location.search` it landed beside the route
 * (`/?endpoint=x#/reference`), where nothing on the page could read it.
 *
 * AN UNKNOWN SELECTION IS NONE. A block that knows its items passes their ids
 * (`ids`); an address naming an id that is not among them selects nothing —
 * the hook answers `undefined` and the state holds `null` — instead of quietly
 * selecting the first row, so the page can say the record is not there.
 *
 * THE URL IS THE SOURCE OF TRUTH when syncing is on. React state mirrors it
 * rather than the other way round, which is what makes a pasted link, a Back
 * press and a click on the list all land in the same place — three paths, one
 * rule.
 *
 * INERT HOSTS DO NOT NAVIGATE. An editor or preview canvas renders the same
 * block with `interactionMode: 'inert'`; there the selection stays in memory and
 * the host's own URL is never touched. That mirrors the existing rule for blocks
 * that navigate or write data.
 */
import * as React from 'react'
import { addressValue, documentAddress, SurfaceAddressContext, type SurfaceAddress } from './address.js'

// ============================================================
// STORE
// ============================================================

type Listener = () => void

export interface ShellSelectionStore {
  /** Current selection for a key, or undefined when nothing is selected. */
  get(key: string): string | undefined
  /** Select an item. Writes the URL when this store syncs. */
  set(key: string, id: string | undefined): void
  subscribe(listener: Listener): () => void
  readonly syncUrl: boolean
}

/**
 * Create a selection store.
 *
 * `syncUrl: false` gives an in-memory store with identical semantics — the same
 * hook, the same cross-block sharing, no address-bar side effects. `address`
 * is where a syncing store reads and writes; the document's own query when the
 * host gave none.
 */
export function createShellSelectionStore(
  syncUrl: boolean,
  address: SurfaceAddress = documentAddress()
): ShellSelectionStore {
  const memory = new Map<string, string | undefined>()
  const listeners = new Set<Listener>()
  const emit = (): void => {
    for (const l of [...listeners]) l()
  }

  if (syncUrl && typeof window !== 'undefined') {
    window.addEventListener('popstate', emit)
  }

  return {
    syncUrl,
    get(key) {
      // URL first: a Back press changes the address without going through
      // `set`, so reading memory would serve a stale value.
      if (syncUrl) return addressValue(address, key) ?? memory.get(key)
      return memory.get(key)
    },
    set(key, id) {
      memory.set(key, id)
      if (syncUrl && addressValue(address, key) !== id) {
        // push, not replace: selecting a record is a navigation the user
        // expects Back to undo. That is the whole point of putting it in the
        // URL rather than in a ref.
        address.writeQuery({ [key]: id ?? null }, 'push')
      }
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// ============================================================
// CONTEXT
// ============================================================

export const ShellSelectionContext = React.createContext<ShellSelectionStore | null>(null)

export interface ShellSelectionProviderProps {
  /** Off for editor/preview canvases — selection works, the address bar does not move. */
  readonly syncUrl?: boolean
  /** Where the selection lives in the address (see address.ts); the document's query when absent. */
  readonly address?: SurfaceAddress | undefined
  /**
   * Told the selection a block shows for `key` — its id, or `null` for none —
   * so the surface can hold it as page state (`state.<key>`).
   */
  readonly onSelection?: ((key: string, id: string | null) => void) | undefined
  readonly children: React.ReactNode
}

/** The surface's selection mirror, for the hooks under a provider. */
const SelectionMirrorContext = React.createContext<((key: string, id: string | null) => void) | null>(null)

export function ShellSelectionProvider({
  syncUrl = true,
  address,
  onSelection,
  children,
}: ShellSelectionProviderProps): React.ReactElement {
  const store = React.useMemo(() => createShellSelectionStore(syncUrl, address), [syncUrl, address])
  return (
    <ShellSelectionContext.Provider value={store}>
      <SelectionMirrorContext.Provider value={onSelection ?? null}>{children}</SelectionMirrorContext.Provider>
    </ShellSelectionContext.Provider>
  )
}

// ============================================================
// HOOK
// ============================================================

export interface ShellSelectionOptions {
  /** Selected when the URL carries nothing — normally the first list item. */
  readonly fallback?: string | undefined
  /**
   * The ids the block can show. When given, a selection naming none of them
   * is NO selection (`undefined`; the state holds `null`) — the fallback is
   * for an address that names nothing, not for one that names a record the
   * block does not have.
   */
  readonly ids?: readonly string[] | undefined
  /**
   * Override the provider. A block rendered inert must not move the host's URL
   * even when the surrounding surface is live.
   */
  readonly syncUrl?: boolean
}

/**
 * Read and write the shell selection for `key`.
 *
 * Works with OR without a provider: with no `ShellSelectionProvider` above it,
 * the hook makes its own store, so a block dropped into a bare React tree keeps
 * behaving instead of throwing. The provider only widens the scope — one store
 * per surface means two blocks reading the same key see the same value.
 */
export function useShellSelection(
  key: string,
  options: ShellSelectionOptions = {}
): readonly [string | undefined, (id: string | undefined) => void] {
  const provided = React.useContext(ShellSelectionContext)
  const mirror = React.useContext(SelectionMirrorContext)
  const pageAddress = React.useContext(SurfaceAddressContext)
  const wantsSync = options.syncUrl ?? provided?.syncUrl ?? true
  // A provider whose sync setting disagrees with this block's is not usable —
  // an inert block inside a live surface must not push history.
  const usable = provided && provided.syncUrl === wantsSync ? provided : null
  const fallbackStore = React.useMemo(
    () => (usable ? null : createShellSelectionStore(wantsSync, pageAddress ?? undefined)),
    [usable, wantsSync, pageAddress]
  )
  const store = usable ?? (fallbackStore as ShellSelectionStore)

  const subscribe = React.useCallback((l: Listener) => store.subscribe(l), [store])
  const selected = React.useSyncExternalStore(
    subscribe,
    () => store.get(key),
    // Server render: no URL, no memory — the fallback is the honest answer.
    () => undefined
  )

  const select = React.useCallback(
    (id: string | undefined) => {
      store.set(key, id)
    },
    [store, key]
  )

  const ids = options.ids
  const shown =
    selected === undefined ? options.fallback : ids === undefined || ids.includes(selected) ? selected : undefined

  // The selection as page state. Only the provider's own store is mirrored: a
  // block whose sync disagrees with the surface's keeps its selection private.
  const mirrorTo = usable ? mirror : null
  React.useEffect(() => {
    mirrorTo?.(key, shown ?? null)
  }, [mirrorTo, key, shown])

  return [shown, select] as const
}
