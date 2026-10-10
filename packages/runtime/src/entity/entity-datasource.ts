/**
 * Entity DataSource Adapter
 *
 * Wraps EntityStore.query() as a minimal DataSource-compatible
 * adapter so the surface expression system can resolve entity data via the
 * existing {{data.sourceName.field}} binding path.
 *
 * @module @pwfabric/runtime/entity/entity-datasource
 */

import type { EntityFacade } from './facade.js'
import type { EntityTypeId, EntityQuery, EntityQueryResult } from './types.js'

// ============================================================
// ENTITY DATA SOURCE
// ============================================================

/**
 * Configuration for an EntityDataSource instance.
 * Matches the `entity`-typed entry in a surface definition's dataSources array.
 */
export interface EntityDataSourceConfig {
  /** Unique identifier — matches the surface definition id used in expressions */
  readonly id: string
  /** Entity type to query (e.g. 'Employee', 'Product') */
  readonly entityType: EntityTypeId
  /** Optional query parameters (filter, sort, pagination) */
  readonly query?: EntityQuery
}

/**
 * Minimal DataSource-compatible adapter for entity queries.
 * fetch() delegates to EntityFacade.resolveBinding() and returns EntityQueryResult.
 * Results are accessible via {{data.sourceName.items}} / {{data.sourceName.total}}.
 */
export interface EntityDataSource {
  readonly id: string
  readonly type: 'entity'
  fetch(): Promise<EntityQueryResult>
}

/**
 * Creates an EntityDataSource that wraps EntityStore.query() for a specific
 * entity type. Register with the surface data context to make results
 * available in block expression props.
 *
 * @example
 * ```ts
 * const employeesSource = createEntityDataSource(facade, {
 *   id: 'employees',
 *   entityType: 'Employee',
 *   query: { sort: [{ field: 'name', direction: 'asc' }] },
 * })
 * const result = await employeesSource.fetch()
 * // result.items — array of employee records
 * ```
 */
export function createEntityDataSource(
  facade: EntityFacade,
  config: EntityDataSourceConfig
): EntityDataSource {
  return {
    id: config.id,
    type: 'entity',
    fetch: () => facade.resolveBinding(config.entityType, config.query),
  }
}
