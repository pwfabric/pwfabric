/**
 * Entity Facade
 *
 * Facade that combines Registry, Store, ConnectorRegistry, and
 * EntityLifecycleEngine into a single facade for surface integration.
 *
 * Renamed from EntityCapability to EntityFacade to avoid collision
 * with the canonical Platform Capability interface.
 *
 * de-behaviorization: `behaviors` field renamed to `entityLifecycle`.
 * `behaviors` kept as deprecated accessor for one minor version.
 *
 * @module @pwfabric/runtime/entity/facade
 */

import type {
  EntityTypeId,
  EntityDefinition,
  EntityQuery,
  EntityQueryResult,
  EntityAggregate,
  EntityAggregateResult,
} from './types.js'
import type { EntityRegistry } from './registry.js'
import type { EntityStore } from './store.js'
import type { ConnectorRegistry } from './connector.js'
import type { EntityLifecycleEngine } from './behavior.js'

import { createEntityRegistry } from './registry.js'
import { createEntityStore } from './store.js'
import { createConnectorRegistry } from './connector.js'
import { createEntityLifecycleEngine } from './behavior.js'
import { aggregateThrough } from './aggregate.js'

// ============================================================
// ENTITY FACADE INTERFACE
// ============================================================

/**
 * Facade that provides unified access to the entity system
 */
export interface EntityFacade {
  /** Entity type registry */
  readonly registry: EntityRegistry

  /** Entity CRUD store */
  readonly store: EntityStore

  /** Connector registry for data source binding */
  readonly connectors: ConnectorRegistry

  /** Entity lifecycle engine for hook registration and execution (onCreate/onUpdate/onDelete/onRead) */
  readonly entityLifecycle: EntityLifecycleEngine

  /**
   * Convenience method to register an entity definition and bind it to a connector
   */
  registerEntity(definition: EntityDefinition, connectorName: string): void

  /**
   * Resolve a binding for Surface expression resolution.
   * Queries the entity store for the given entity type and query.
   */
  resolveBinding(entityType: EntityTypeId, query?: EntityQuery): Promise<EntityQueryResult>

  /**
   * Resolve an AGGREGATE source: one number over the collection.
   * Rejects when the number cannot be served (never answers a false 0).
   * OPTIONAL so a host facade built before this still type-checks; the
   * renderer lists and reduces in memory when it is absent.
   */
  resolveAggregate?(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<EntityAggregateResult>
}

// ============================================================
// DEFAULT ENTITY FACADE
// ============================================================

/**
 * Default implementation of EntityFacade
 */
export class DefaultEntityFacade implements EntityFacade {
  readonly registry: EntityRegistry
  readonly store: EntityStore
  readonly connectors: ConnectorRegistry
  readonly entityLifecycle: EntityLifecycleEngine

  constructor(
    registry: EntityRegistry,
    store: EntityStore,
    connectors: ConnectorRegistry,
    entityLifecycle: EntityLifecycleEngine
  ) {
    this.registry = registry
    this.store = store
    this.connectors = connectors
    this.entityLifecycle = entityLifecycle
  }

  registerEntity(definition: EntityDefinition, connectorName: string): void {
    // Register the entity definition
    this.registry.register(definition)

    // Bind entity type to connector
    this.connectors.bind(definition.id, connectorName)
  }

  async resolveBinding(entityType: EntityTypeId, query?: EntityQuery): Promise<EntityQueryResult> {
    return this.store.query(entityType, query ?? {})
  }

  async resolveAggregate(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<EntityAggregateResult> {
    if (typeof this.store.aggregate === 'function') return this.store.aggregate(entityType, aggregate)
    // A host store without `aggregate`: list through `query`, reduce here.
    const store = this.store
    const result = await aggregateThrough(
      { query: async (t, q) => ({ success: true, result: await store.query(t, q) }) },
      entityType,
      aggregate
    )
    if (!result.success) throw new Error(result.error)
    return result.result
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create an entity facade with all subsystems wired together
 */
export function createEntityFacade(options?: {
  registry?: EntityRegistry
  connectors?: ConnectorRegistry
  /** Primary option — entity lifecycle engine for hook registration */
  entityLifecycle?: EntityLifecycleEngine
}): EntityFacade {
  const registry = options?.registry ?? createEntityRegistry()
  const connectors = options?.connectors ?? createConnectorRegistry()
  const entityLifecycle =
    options?.entityLifecycle ?? createEntityLifecycleEngine()
  const store = createEntityStore(registry, connectors)

  return new DefaultEntityFacade(registry, store, connectors, entityLifecycle)
}
