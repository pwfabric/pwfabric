/**
 * What a data-bound page keeps in step with its address (see address.ts).
 *
 * URL STATE. A `select`, `segmented-control` or `tabs` block writing
 * `state.<key>` was SEEDED from the address (`?severity=high`), but a change
 * was never written back, so a reload, a shared link or Back lost it. The page
 * declares which keys live in its address — `urlState` in its persistence
 * config — and each change of one is written there, replacing the history
 * entry (a filter is not a navigation; Back leaves the page, not the filter).
 * Only declared keys: a page's state is otherwise its own, and an address is
 * not a place to carry every draft a form holds.
 *
 * NOT FOUND. A detail page's record source (`notFoundWhenEmpty`) that settles
 * with no record — a 404, no row, or not fetched because the value it needs is
 * empty — tells the host, which shows its not-found page at this address. Said
 * once per page: the host replaces the page.
 *
 * @module @pwfabric/runtime/render/address-sync
 */
import * as React from 'react'
import type { SurfaceAddress } from './address.js'
import type { BlockInteractionMode } from './types.js'
import type { SurfaceDataSourceDefinition } from './data-binding-types.js'

/** A state value as it is written into an address, or `null` when it removes the key. */
export function addressFormOf(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // A list or an object has no one address form; it is not written.
  return undefined
}

/** Writes the declared `urlState` keys back to the address whenever they change. */
export function useUrlStateSync(
  keys: readonly string[] | undefined,
  state: Readonly<Record<string, unknown>>,
  address: SurfaceAddress | undefined,
  interactionMode: BlockInteractionMode
): void {
  const watched = keys && keys.length > 0 ? keys : undefined
  // The values as last seen, so only a CHANGE is written: the first render
  // holds what the address seeded, and writing it back would be a no-op at
  // best and, for a key the address did not carry, an invented one.
  const seen = React.useRef<Record<string, string | null | undefined> | null>(null)
  const values = watched ? watched.map((k) => addressFormOf(state[k])) : []
  const signature = JSON.stringify(values)
  React.useEffect(() => {
    if (!watched || !address || interactionMode === 'inert') return
    const now: Record<string, string | null | undefined> = {}
    watched.forEach((k, i) => (now[k] = values[i]))
    const before = seen.current
    seen.current = now
    if (before === null) return
    const changed: Record<string, string | null> = {}
    for (const k of watched) {
      const v = now[k]
      if (v !== undefined && v !== before[k]) changed[k] = v
    }
    if (Object.keys(changed).length > 0) address.writeQuery(changed, 'replace')
    // `values` is captured through `signature`, the keys through their join.
  }, [signature, address, interactionMode, watched?.join('\n')])
}

const isEmptyRecord = (data: unknown): boolean =>
  data === undefined || data === null || (Array.isArray(data) && data.length === 0)

/**
 * Whether a record source has settled with no record. `expression` is the
 * page's expression context (`__loading`, `__notFound`, `__idle`, `__errors`
 * and the bound data by source id).
 */
export function recordIsMissing(id: string, expression: Readonly<Record<string, unknown>>): boolean | undefined {
  const flag = (name: string): unknown => (expression[name] as Record<string, unknown> | undefined)?.[id]
  if (flag('__loading') === true) return undefined
  if (flag('__notFound') === true || flag('__idle') === true) return true
  // A refused read or a server error is the source's error state, not "no such record".
  if (flag('__errors')) return false
  return isEmptyRecord(expression[id])
}

/** Tells the address, once, that the page's record is not there. */
export function useNotFoundReport(
  sources: readonly SurfaceDataSourceDefinition[],
  expression: Readonly<Record<string, unknown>>,
  address: SurfaceAddress | undefined,
  interactionMode: BlockInteractionMode
): void {
  const reported = React.useRef(false)
  const missing = sources.some((s) => s.notFoundWhenEmpty === true && recordIsMissing(s.id, expression) === true)
  React.useEffect(() => {
    if (!missing || reported.current || !address || interactionMode === 'inert') return
    reported.current = true
    address.notFound()
  }, [missing, address, interactionMode])
}
