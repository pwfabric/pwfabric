/**
 * Entity Store
 *
 * Uniform CRUD and query interface backed by connectors.
 * The store handles validation and delegates persistence to connectors.
 *
 * @module @pwfabric/runtime/entity/store
 */

import type {
  EntityTypeId,
  EntityInstanceId,
  EntityQuery,
  EntityQueryResult,
  EntityMutationResult,
  EntityReadResult,
  EntityAggregate,
  EntityAggregateResult,
} from './types.js'
import { aggregateThrough } from './aggregate.js'
import type { EntityRegistry } from './registry.js'
import type { ConnectorRegistry } from './connector.js'
import type { SurfaceEventBus } from '@pwfabric/contracts'

// ============================================================
// ENTITY STORE INTERFACE
// ============================================================

/**
 * Entity store interface for CRUD operations
 */
export interface EntityStore {
  /**
   * Create a new entity instance
   */
  create(entityType: EntityTypeId, data: Record<string, unknown>): Promise<EntityMutationResult>

  /**
   * Read a single entity instance
   */
  read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<EntityReadResult>

  /**
   * Update an existing entity instance
   */
  update(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId,
    data: Record<string, unknown>
  ): Promise<EntityMutationResult>

  /**
   * Delete an entity instance
   */
  delete(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<EntityMutationResult>

  /**
   * Query entity instances
   */
  query(entityType: EntityTypeId, query: EntityQuery): Promise<EntityQueryResult>

  /**
   * One number over the collection. Server-side when the connector
   * can; otherwise the connector's rows are reduced in memory. REJECTS when
   * the number cannot be served — unlike `query`, whose honest failure is an
   * empty list, a counter's `0` would be a lie.
   *
   * OPTIONAL so a host-written `EntityStore` keeps compiling; the facade
   * lists and reduces through `query` when a store has none.
   */
  aggregate?(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<EntityAggregateResult>
}

// ============================================================
// DEFAULT ENTITY STORE
// ============================================================

/**
 * Default implementation of EntityStore.
 * Validates through the registry and delegates persistence to connectors.
 *
 * Accepts an optional SurfaceEventBus. When provided, successful
 * CRUD operations emit entity:created / entity:updated / entity:deleted events on
 * the bus so that the rest of the surface can react declaratively.
 *
 * The bus is surface-scoped — the caller injects the bus for a
 * specific surface, keeping the store surface-aware without making it globally coupled.
 */
/**
 * The id of a record a connector just created. A record service may answer
 * with the record itself (`{ id, … }`) or wrap it (`{ data: { id, … } }`, the
 * shape the data protocol specifies); both are read.
 */
function createdIdOf(body: Record<string, unknown> | undefined): EntityInstanceId {
  const own = body?.['id']
  if (typeof own === 'string' || typeof own === 'number') return String(own) as EntityInstanceId
  const inner = body?.['data']
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
    const id = (inner as Record<string, unknown>)['id']
    if (typeof id === 'string' || typeof id === 'number') return String(id) as EntityInstanceId
  }
  return '' as EntityInstanceId
}

export class DefaultEntityStore implements EntityStore {
  private readonly registry: EntityRegistry
  private readonly connectors: ConnectorRegistry
  private readonly eventBus: SurfaceEventBus | undefined

  constructor(registry: EntityRegistry, connectors: ConnectorRegistry, eventBus?: SurfaceEventBus) {
    this.registry = registry
    this.connectors = connectors
    this.eventBus = eventBus ?? undefined
  }

  async create(
    entityType: EntityTypeId,
    data: Record<string, unknown>
  ): Promise<EntityMutationResult> {
    // Validate entity type exists
    if (!this.registry.has(entityType)) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `Entity type '${entityType}' is not registered`,
        },
      }
    }

    // Validate data against schema
    const validation = this.registry.validate(entityType, data)
    if (!validation.valid) {
      return {
        success: false,
        error: {
          type: 'validation',
          message: 'Validation failed',
          details: validation.errors,
        },
      }
    }

    // Resolve connector
    const connector = this.connectors.resolve(entityType)
    if (!connector) {
      return {
        success: false,
        error: {
          type: 'connector',
          message: `No connector found for entity type '${entityType}'`,
        },
      }
    }

    // Delegate to connector
    const result = await connector.create(entityType, validation.data)
    if (!result.success) {
      return {
        success: false,
        error: {
          type: 'connector',
          message: result.error,
        },
      }
    }

    const mutationResult: EntityMutationResult = {
      success: true,
      data: result.data,
      id: createdIdOf(result.data),
    }

    // emit entity:created on the surface-scoped bus
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'entity:created',
        surfaceId: 'system',
        payload: {
          entityType,
          instanceId: mutationResult.id,
          data: mutationResult.data,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      })
    }

    return mutationResult
  }

  async read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<EntityReadResult> {
    // Validate entity type exists
    if (!this.registry.has(entityType)) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `Entity type '${entityType}' is not registered`,
        },
      }
    }

    // Resolve connector
    const connector = this.connectors.resolve(entityType)
    if (!connector) {
      return {
        success: false,
        error: {
          type: 'connector',
          message: `No connector found for entity type '${entityType}'`,
        },
      }
    }

    // Delegate to connector
    const result = await connector.read(entityType, instanceId)
    if (!result.success) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: result.error,
        },
      }
    }

    return {
      success: true,
      data: result.data,
    }
  }

  async update(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId,
    data: Record<string, unknown>
  ): Promise<EntityMutationResult> {
    // Validate entity type exists
    if (!this.registry.has(entityType)) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `Entity type '${entityType}' is not registered`,
        },
      }
    }

    // Read existing record to merge with updates for validation
    const connector = this.connectors.resolve(entityType)
    if (!connector) {
      return {
        success: false,
        error: {
          type: 'connector',
          message: `No connector found for entity type '${entityType}'`,
        },
      }
    }

    const existing = await connector.read(entityType, instanceId)
    if (!existing.success) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: existing.error,
        },
      }
    }

    // Merge existing data with updates for full validation
    const merged = { ...existing.data, ...data }
    const validation = this.registry.validate(entityType, merged)
    if (!validation.valid) {
      return {
        success: false,
        error: {
          type: 'validation',
          message: 'Validation failed',
          details: validation.errors,
        },
      }
    }

    // Delegate to connector
    const result = await connector.update(entityType, instanceId, data)
    if (!result.success) {
      return {
        success: false,
        error: {
          type: 'connector',
          message: result.error,
        },
      }
    }

    const updateResult: EntityMutationResult = {
      success: true,
      data: result.data,
      id: instanceId,
    }

    // emit entity:updated on the surface-scoped bus
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'entity:updated',
        surfaceId: 'system',
        payload: {
          entityType,
          instanceId,
          data: updateResult.data,
          changeset: data,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      })
    }

    return updateResult
  }

  async delete(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId
  ): Promise<EntityMutationResult> {
    // Validate entity type exists
    if (!this.registry.has(entityType)) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `Entity type '${entityType}' is not registered`,
        },
      }
    }

    // Resolve connector
    const connector = this.connectors.resolve(entityType)
    if (!connector) {
      return {
        success: false,
        error: {
          type: 'connector',
          message: `No connector found for entity type '${entityType}'`,
        },
      }
    }

    // Delegate to connector
    const result = await connector.delete(entityType, instanceId)
    if (!result.success) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: result.error,
        },
      }
    }

    const deleteResult: EntityMutationResult = {
      success: true,
      data: result.data,
      id: instanceId,
    }

    // emit entity:deleted on the surface-scoped bus
    if (this.eventBus) {
      this.eventBus.emit({
        type: 'entity:deleted',
        surfaceId: 'system',
        payload: {
          entityType,
          instanceId,
          timestamp: Date.now(),
        },
        timestamp: Date.now(),
      })
    }

    return deleteResult
  }

  async query(entityType: EntityTypeId, query: EntityQuery): Promise<EntityQueryResult> {
    // Validate entity type exists
    if (!this.registry.has(entityType)) {
      return {
        items: [],
        total: 0,
        offset: 0,
        limit: query.pagination?.limit ?? 50,
        hasMore: false,
      }
    }

    // Resolve connector
    const connector = this.connectors.resolve(entityType)
    if (!connector) {
      return {
        items: [],
        total: 0,
        offset: 0,
        limit: query.pagination?.limit ?? 50,
        hasMore: false,
      }
    }

    // Delegate to connector
    const result = await connector.query(entityType, query)
    if (!result.success) {
      return {
        items: [],
        total: 0,
        offset: 0,
        limit: query.pagination?.limit ?? 50,
        hasMore: false,
      }
    }

    return result.result
  }

  async aggregate(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<EntityAggregateResult> {
    // NOT the same as query. An empty list is an honest answer to "could not
    // list"; `{ value: 0 }` is not an honest answer to "could not count" —
    // a 403 would read as "0 people are coming". Reject, and the renderer
    // binds `fallback` and `__errors.<id>` like any failed source.
    if (!this.registry.has(entityType)) {
      throw new Error(`Entity type '${String(entityType)}' is not registered`)
    }
    const connector = this.connectors.resolve(entityType)
    if (!connector) throw new Error(`No connector for entity type '${String(entityType)}'`)
    const result = await aggregateThrough(connector, entityType, aggregate)
    if (!result.success) throw new Error(result.error)
    return result.result
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create an entity store.
 *
 * Pass an optional `eventBus` to enable surface-scoped event
 * emission on successful CRUD operations (entity:created, entity:updated, entity:deleted).
 */
export function createEntityStore(
  registry: EntityRegistry,
  connectors: ConnectorRegistry,
  eventBus?: SurfaceEventBus
): EntityStore {
  return new DefaultEntityStore(registry, connectors, eventBus)
}
