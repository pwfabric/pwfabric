/**
 * The page's address, as the host that owns it exposes it to the renderer.
 *
 * Two things on a page live in its address: the state an author chose to keep
 * there (a filter, a tab, a selected record — `urlState`, see
 * data-protocol), and the selection of a split shell (shell-selection.tsx).
 * Both were read from and written to `location.search`. That is the wrong
 * place in a pwapp: under the hash router the page's query is the one INSIDE
 * the fragment (`#/reference?endpoint=x`), so the selection landed beside it
 * (`/?endpoint=x#/reference`), out of reach of the router, of the page's
 * state seed and of every expression.
 *
 * So the address is the HOST's, and the host hands the renderer this seam. A
 * pwapp runner answers with its router's query; a page embedded in someone
 * else's document has no router, and its address is the document's own
 * `location.search` (`documentAddress`).
 *
 * The same seam carries the one thing a page can say about its address that
 * only the host can act on: the address names a record the page does not have
 * (`notFound`). The host shows its not-found page there.
 *
 * @module @pwfabric/runtime/render/address
 */
import * as React from 'react'

export interface SurfaceAddress {
  /** The page's address query, without the leading `?`. */
  query(): string
  /**
   * Write keys into the page's address query, keeping every other key; a
   * `null` value removes its key. `push` adds a history entry (a selection
   * the reader expects Back to undo), `replace` does not (a filter, a tab).
   */
  writeQuery(values: Readonly<Record<string, string | null>>, how: 'push' | 'replace'): void
  /**
   * The page's record is not there (data-protocol `notFoundWhenEmpty`): the
   * host renders its not-found page in place of this one, at this address.
   */
  notFound(): void
}

/**
 * The address of a page embedded in a document that has no router: the
 * document's own `location.search`. It has no not-found page to show.
 */
export function documentAddress(): SurfaceAddress {
  return {
    query: () => (typeof window === 'undefined' ? '' : window.location.search.replace(/^\?/, '')),
    writeQuery(values, how) {
      if (typeof window === 'undefined') return
      const url = new URL(window.location.href)
      for (const [key, value] of Object.entries(values)) {
        if (value === null) url.searchParams.delete(key)
        else url.searchParams.set(key, value)
      }
      if (url.href === window.location.href) return
      if (how === 'push') window.history.pushState({}, '', url)
      else window.history.replaceState(window.history.state, '', url)
    },
    notFound() {},
  }
}

/** The address the surface's blocks read and write; `documentAddress()` when the host gave none. */
export const SurfaceAddressContext = React.createContext<SurfaceAddress | null>(null)

/** The value an address query holds for `key`, or undefined when absent or empty. */
export function addressValue(address: SurfaceAddress, key: string): string | undefined {
  const value = new URLSearchParams(address.query()).get(key)
  return value === null || value === '' ? undefined : value
}
