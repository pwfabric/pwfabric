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
 * UNTIL THEN THE PAGE STAYS IN ITS LOADING FRAME (`withRecordFrameHeld`).
 * The empty answer used to be drawn first — the record's body collapsed, the
 * footer jumped up the screen — and only then did the host's not-found page
 * arrive in its place: a layout shift of 0.15–0.29 at phone width on every
 * unknown `?id=`. A record page is about its record, so until the record has
 * come (or the host has replaced the page) the page keeps the frame it loaded
 * in — the record AND every other source it fetches, so a list filtered by
 * the same unknown key does not settle empty and move the footer first. The
 * not-found page is then drawn where that frame stood.
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

/** Whether a `notFoundWhenEmpty` source of the page has settled with no record. */
export function pageRecordIsMissing(
  sources: readonly SurfaceDataSourceDefinition[] | undefined,
  expression: Readonly<Record<string, unknown>>
): boolean {
  return (sources ?? []).some((s) => s.notFoundWhenEmpty === true && recordIsMissing(s.id, expression) === true)
}

/** A source that settled without a request: idle, or refused for want of a session (data-protocol §2.6). */
function settledUnasked(id: string, expression: Readonly<Record<string, unknown>>): boolean {
  const flag = (name: string): unknown => (expression[name] as Record<string, unknown> | undefined)?.[id]
  return flag('__idle') === true || (flag('__errorCodes') === 401 && flag('__status') === null)
}

/** The kinds a page fetches; `static` and `state` are in its first frame already. */
const FETCHED = new Set(['rest', 'entity', 'graphql'])

/**
 * The page's expression context with its fetched sources shown as they were
 * while the page loaded — loading, no data, no status — while its RECORD
 * (a `notFoundWhenEmpty` source) holds the page back:
 *
 *  - the record is missing, and either the host will replace the page
 *    (`replaceable`: a host address in a live page) or it is idle (its key is
 *    empty: before the address seed reaches a hydrated page, or a page whose
 *    address names no record — either way never shown, pwapp-format §2.5);
 *  - the record is still loading with nothing to show, and the host will
 *    replace the page if it is missing.
 *
 * A source that settled without a request (idle, or refused for want of a
 * session) is in the page's first frame as it is, and stays so. An inert page
 * (`live` false) shows what its sources answered.
 */
export function withRecordFrameHeld(
  sources: readonly SurfaceDataSourceDefinition[] | undefined,
  expression: Readonly<Record<string, unknown>>,
  opts: { readonly live: boolean; readonly replaceable: boolean }
): Readonly<Record<string, unknown>> {
  if (!opts.live) return expression
  const all = sources ?? []
  const records = all.filter((s) => s.notFoundWhenEmpty === true)
  const flag = (name: string, id: string): unknown => (expression[name] as Record<string, unknown> | undefined)?.[id]
  const holds = records.some((s) => {
    const missing = recordIsMissing(s.id, expression)
    if (missing === true) return opts.replaceable || flag('__idle', s.id) === true
    if (missing === undefined) return opts.replaceable && (expression[s.id] === undefined || expression[s.id] === null)
    return false
  })
  if (!holds) return expression
  const held = all.filter((s) => FETCHED.has(s.kind) && !(s.notFoundWhenEmpty !== true && settledUnasked(s.id, expression)))
  if (held.length === 0) return expression
  const out: Record<string, unknown> = { ...expression }
  const flags = (name: string, value: unknown): void => {
    const map = { ...((expression[name] as Record<string, unknown> | undefined) ?? {}) }
    for (const s of held) map[s.id] = value
    out[name] = map
  }
  for (const s of held) delete out[s.id]
  flags('__loading', true)
  flags('__notFound', false)
  flags('__idle', false)
  flags('__status', null)
  flags('__errors', null)
  flags('__errorCodes', null)
  flags('__meta', null)
  out['__anyLoading'] = true
  const errors = out['__errors'] as Record<string, unknown>
  out['__anyError'] = Object.values(errors).some((v) => v !== null && v !== undefined)
  return out
}

/** Tells the address, once, that the page's record is not there. */
export function useNotFoundReport(
  sources: readonly SurfaceDataSourceDefinition[],
  expression: Readonly<Record<string, unknown>>,
  address: SurfaceAddress | undefined,
  interactionMode: BlockInteractionMode
): void {
  const reported = React.useRef(false)
  const missing = pageRecordIsMissing(sources, expression)
  React.useEffect(() => {
    if (!missing || reported.current || !address || interactionMode === 'inert') return
    reported.current = true
    address.notFound()
  }, [missing, address, interactionMode])
}
