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

function readFromUrl(key: string): string | undefined {
  if (typeof window === 'undefined') return undefined
  const value = new URLSearchParams(window.location.search).get(key)
  return value === null || value === '' ? undefined : value
}

/**
 * Create a selection store.
 *
 * `syncUrl: false` gives an in-memory store with identical semantics — the same
 * hook, the same cross-block sharing, no address-bar side effects.
 */
export function createShellSelectionStore(syncUrl: boolean): ShellSelectionStore {
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
      if (syncUrl) return readFromUrl(key) ?? memory.get(key)
      return memory.get(key)
    },
    set(key, id) {
      memory.set(key, id)
      if (syncUrl && typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        if (id === undefined) url.searchParams.delete(key)
        else url.searchParams.set(key, id)
        // pushState, not replaceState: selecting a record is a navigation the
        // user expects Back to undo. That is the whole point of putting it in
        // the URL rather than in a ref.
        if (url.href !== window.location.href) window.history.pushState({}, '', url)
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
  readonly children: React.ReactNode
}

export function ShellSelectionProvider({
  syncUrl = true,
  children,
}: ShellSelectionProviderProps): React.ReactElement {
  const store = React.useMemo(() => createShellSelectionStore(syncUrl), [syncUrl])
  return <ShellSelectionContext.Provider value={store}>{children}</ShellSelectionContext.Provider>
}

// ============================================================
// HOOK
// ============================================================

export interface ShellSelectionOptions {
  /** Selected when the URL carries nothing — normally the first list item. */
  readonly fallback?: string | undefined
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
  const wantsSync = options.syncUrl ?? provided?.syncUrl ?? true
  // A provider whose sync setting disagrees with this block's is not usable —
  // an inert block inside a live surface must not push history.
  const usable = provided && provided.syncUrl === wantsSync ? provided : null
  const fallbackStore = React.useMemo(
    () => (usable ? null : createShellSelectionStore(wantsSync)),
    [usable, wantsSync]
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

  return [selected ?? options.fallback, select] as const
}
