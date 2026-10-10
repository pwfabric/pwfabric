/**
 * aggregateThrough — one number from whatever can answer.
 *
 * The platform connector asks the server (`HttpEntityConnector.aggregate`).
 * Everything else — the static connector, a declared engine, a host facade
 * that predates `resolveAggregate` — only lists. Rather than make every one
 * of them grow an aggregate, the store and the renderer go through here: a
 * source with `aggregate` is asked, a source without is queried with the
 * aggregate's filter and reduced in memory (`aggregateEntities`). The
 * fallback reduces the rows the query RETURNS — a paginated list connector
 * counts its first page — which is why the platform path is server-side.
 *
 * @module @pwfabric/runtime/entity/aggregate
 */
import { aggregateEntities } from './apply-query.js'
import type { ConnectorAggregateResult, ConnectorQueryResult } from './connector.js'
import type { EntityAggregate, EntityQuery, EntityTypeId } from './types.js'

/** The least a source needs: `query`, and `aggregate` when it has one. */
export interface AggregateSource {
  query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult>
  aggregate?(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<ConnectorAggregateResult>
}

export async function aggregateThrough(
  source: AggregateSource,
  entityType: EntityTypeId,
  aggregate: EntityAggregate
): Promise<ConnectorAggregateResult> {
  if (typeof source.aggregate === 'function') return source.aggregate(entityType, aggregate)
  const res = await source.query(entityType, aggregate.filter ? { filter: aggregate.filter } : {})
  if (!res.success) return res
  return { success: true, result: aggregateEntities(res.result.items, aggregate) }
}
