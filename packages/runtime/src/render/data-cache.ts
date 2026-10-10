/**
 * A host-provided cache for fetched source data — stale-while-revalidate.
 *
 * A page the visitor has already seen should not come back empty while its
 * sources are re-fetched. The renderer knows nothing about where the cache
 * lives (the published-app runner keeps it in sessionStorage, a host may keep
 * it in memory); it only asks for a value by key on the first frame and
 * writes the fresh result back after a successful fetch. A failed fetch never
 * writes, so a good entry is not replaced by nothing.
 *
 * @module @pwfabric/runtime/render/data-cache
 */
import type { SurfaceDataSourceDefinition } from './data-binding-types.js'
import { resolveQueryState } from './query-state.js'
import { endpointMissingPathValue, resolveEndpoint } from './endpoint.js'

export interface SurfaceDataCache {
  /** The last successful result for this key, or undefined. */
  get(key: string): unknown
  /** Remember a successful result. Must not throw on a full store. */
  set(key: string, value: unknown): void
}

/**
 * The key a source's fetched data is remembered under.
 *
 * Built from everything that decides WHAT is fetched — kind, id, resolved address,
 * entity type, connector, and the query with its `{{state.*}}` placeholders
 * resolved against the current state — so page 2 never answers as page 1.
 * The `fallback` payload is left out: sample rows are not part of what was
 * fetched. `state` and `static` sources are never fetched, so they have no
 * key.
 */
export function dataSourceCacheKey(
  source: SurfaceDataSourceDefinition,
  state: Readonly<Record<string, unknown>>
): string | undefined {
  if (source.kind === 'state' || source.kind === 'static') return undefined
  // An idle source (a required path value is empty) is not fetched either.
  if (source.kind === 'rest' && source.endpoint !== undefined && endpointMissingPathValue(source.endpoint, state)) {
    return undefined
  }
  const query = source.query ? resolveQueryState(source.query, state) : null
  const aggregate = source.aggregate ? resolveQueryState(source.aggregate, state) : null
  return JSON.stringify([
    source.kind,
    source.id,
    // The RESOLVED address, not the template: with the template every
    // `/products/{{state.id}}` shared one key, and `?id=13` opened on the
    // rows cached for 12 until the fetch landed.
    source.endpoint !== undefined ? resolveEndpoint(source.endpoint, state) : null,
    source.method ?? null,
    source.entityType ?? null,
    source.connector ?? null,
    source.returns ?? null,
    query,
    aggregate,
  ])
}
