/**
 * Entity System Module
 *
 * Entity system for schema-based entity types, CRUD operations,
 * connectors, behaviors, and surface integration.
 *
 * Exports:
 * - Types: EntityTypeId, EntityInstanceId, EntityDefinition, EntityQuery, etc.
 * - Registry: EntityRegistry, InMemoryEntityRegistry, createEntityRegistry
 * - Store: EntityStore, DefaultEntityStore, createEntityStore
 * - Connectors: EntityConnector, ConnectorRegistry, StaticConnector
 * - Lifecycle: EntityLifecycleEngine, EntityLifecycleHook, createEntityLifecycleEngine
 * - Facade: EntityFacade, createEntityFacade
 *
 * @module @pwfabric/runtime/entity
 */

// Types
export type {
  EntityTypeId,
  EntityInstanceId,
  EntityFieldType,
  EntityFieldDefinition,
  EntityRelationType,
  EntityRelationDefinition,
  EntityDefinition,
  EntityQuery,
  EntityFilter,
  EntitySortField,
  EntityPagination,
  EntityQueryResult,
  EntityAggregateFn,
  EntityAggregate,
  EntityAggregateResult,
  EntityMutationResult,
  EntityReadResult,
  EntityOperationError,
  EntityValidationResult,
  EntityValidationError,
} from './types.js'

// Registry
export type { EntityRegistry } from './registry.js'
export { InMemoryEntityRegistry, createEntityRegistry } from './registry.js'

// Store
export type { EntityStore } from './store.js'
export { DefaultEntityStore, createEntityStore } from './store.js'

// Connectors
export type {
  EntityConnectorType,
  ConnectorResult,
  ConnectorQueryResult,
  ConnectorAggregateResult,
  EntityConnector,
  ConnectorRegistry,
} from './connector.js'
export { InMemoryConnectorRegistry, createConnectorRegistry } from './connector.js'

// Connector implementations
export { StaticConnector, createStaticConnector } from './connectors/index.js'

// HTTP Connector (REST API connector)
export type { HttpAuthConfig, HttpRetryConfig, HttpConnectorConfig } from './http-connector.js'
export { HttpEntityConnector, createHttpConnector } from './http-connector.js'

// PostgreSQL Connector (Database connector)
export type {
  PostgresConnectorConfig,
  DatabaseAdapter,
  DatabaseResult,
} from './postgres-connector.js'
export { PostgresEntityConnector, createPostgresConnector } from './postgres-connector.js'

// Lifecycle
export type {
  EntityLifecycleEngine,
  EntityLifecycleTransition,
  EntityLifecycleHook,
} from './behavior.js'
export { DefaultEntityLifecycleEngine, createEntityLifecycleEngine } from './behavior.js'

export type {
  EntityLifecycleEvent,
  EntityBehaviorContext,
  EntityGuard,
  EntityAction,
} from './behavior.js'

// Facade
export type { EntityFacade } from './facade.js'
export { DefaultEntityFacade, createEntityFacade } from './facade.js'

// EntityDataSource adapter for surface expression binding
export type { EntityDataSourceConfig, EntityDataSource } from './entity-datasource.js'
export { createEntityDataSource } from './entity-datasource.js'

// applyEntityQuery — the single in-memory applier for EntityQuery
// (filter → sort → pagination). Connectors call it on their result envelope.
export {
  aggregateEntities,
  applyEntityQuery,
  matchesEntityFilter,
  normalizeEntitySort,
  sortEntities,
} from './apply-query.js'

// aggregateThrough — one number from a connector/engine/facade: server-side
// when it has `aggregate`, its listed rows reduced in memory when it has not.
export type { AggregateSource } from './aggregate.js'
export { aggregateThrough } from './aggregate.js'
