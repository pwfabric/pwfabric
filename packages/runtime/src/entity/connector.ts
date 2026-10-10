/**
 * Entity Connector Interface
 *
 * Connector abstraction for entity data persistence and retrieval.
 * Follows the adapter pattern established by existing data source implementations.
 *
 * @module @pwfabric/runtime/entity/connector
 */

import type {
  EntityTypeId,
  EntityInstanceId,
  EntityQuery,
  EntityQueryResult,
  EntityAggregate,
  EntityAggregateResult,
} from './types.js'

// ============================================================
// CONNECTOR TYPES
// ============================================================

/**
 * Supported connector types
 */
export type EntityConnectorType = 'http' | 'database' | 'static' | 'custom'

/**
 * Result of a connector CRUD operation
 */
export type ConnectorResult =
  | { readonly success: true; readonly data: Record<string, unknown> }
  | { readonly success: false; readonly error: string }

/**
 * Result of a connector query operation
 */
export type ConnectorQueryResult =
  | { readonly success: true; readonly result: EntityQueryResult }
  | { readonly success: false; readonly error: string }

/**
 * Result of a connector aggregate operation
 */
export type ConnectorAggregateResult =
  | { readonly success: true; readonly result: EntityAggregateResult }
  | { readonly success: false; readonly error: string }

// ============================================================
// ENTITY CONNECTOR INTERFACE
// ============================================================

/**
 * Interface for entity data connectors.
 * Connectors handle actual data persistence and retrieval.
 */
export interface EntityConnector {
  /** Connector name for identification */
  readonly name: string

  /** Connector type */
  readonly type: EntityConnectorType

  /**
   * Create a new entity instance
   */
  create(entityType: EntityTypeId, data: Record<string, unknown>): Promise<ConnectorResult>

  /**
   * Read a single entity instance by id
   */
  read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult>

  /**
   * Update an existing entity instance
   */
  update(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId,
    data: Record<string, unknown>
  ): Promise<ConnectorResult>

  /**
   * Delete an entity instance
   */
  delete(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult>

  /**
   * Query entity instances with filter, sort, and pagination
   */
  query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult>

  /**
   * One number over the collection, server-side. OPTIONAL: a connector
   * that only lists is reduced in memory by `aggregateThrough` instead.
   */
  aggregate?(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<ConnectorAggregateResult>
}

// ============================================================
// CONNECTOR REGISTRY
// ============================================================

/**
 * Registry for entity connectors with per-entity-type binding support
 */
export interface ConnectorRegistry {
  /**
   * Register a connector by name
   */
  register(connector: EntityConnector): void

  /**
   * Get a connector by name
   */
  get(name: string): EntityConnector | undefined

  /**
   * Check if a connector is registered
   */
  has(name: string): boolean

  /**
   * Bind an entity type to a specific connector
   */
  bind(entityType: EntityTypeId, connectorName: string): void

  /**
   * Resolve the connector for an entity type.
   * Returns the bound connector, or the default connector if set.
   */
  resolve(entityType: EntityTypeId): EntityConnector | undefined

  /**
   * Set a default connector for unbound entity types
   */
  setDefault(connectorName: string): void

  /**
   * List all registered connector names
   */
  list(): readonly string[]

  /**
   * Remove a connector by name
   */
  unregister(name: string): boolean

  /**
   * Remove all connectors and bindings
   */
  clear(): void
}

// ============================================================
// IN-MEMORY CONNECTOR REGISTRY
// ============================================================

/**
 * In-memory implementation of ConnectorRegistry
 */
export class InMemoryConnectorRegistry implements ConnectorRegistry {
  private readonly connectors = new Map<string, EntityConnector>()
  private readonly bindings = new Map<EntityTypeId, string>()
  private defaultConnectorName: string | undefined

  register(connector: EntityConnector): void {
    if (!connector.name) {
      throw new Error('Connector must have a name')
    }

    if (this.connectors.has(connector.name)) {
      throw new Error(`Connector '${connector.name}' is already registered`)
    }

    this.connectors.set(connector.name, connector)
  }

  get(name: string): EntityConnector | undefined {
    return this.connectors.get(name)
  }

  has(name: string): boolean {
    return this.connectors.has(name)
  }

  bind(entityType: EntityTypeId, connectorName: string): void {
    if (!this.connectors.has(connectorName)) {
      throw new Error(`Connector '${connectorName}' is not registered`)
    }

    this.bindings.set(entityType, connectorName)
  }

  resolve(entityType: EntityTypeId): EntityConnector | undefined {
    // Check entity-specific binding first
    const boundName = this.bindings.get(entityType)
    if (boundName) {
      return this.connectors.get(boundName)
    }

    // Fall back to default
    if (this.defaultConnectorName) {
      return this.connectors.get(this.defaultConnectorName)
    }

    return undefined
  }

  setDefault(connectorName: string): void {
    if (!this.connectors.has(connectorName)) {
      throw new Error(`Connector '${connectorName}' is not registered`)
    }

    this.defaultConnectorName = connectorName
  }

  list(): readonly string[] {
    return Array.from(this.connectors.keys())
  }

  unregister(name: string): boolean {
    // Remove any bindings pointing to this connector
    for (const [entityType, boundName] of this.bindings) {
      if (boundName === name) {
        this.bindings.delete(entityType)
      }
    }

    // Clear default if it matches
    if (this.defaultConnectorName === name) {
      this.defaultConnectorName = undefined
    }

    return this.connectors.delete(name)
  }

  clear(): void {
    this.connectors.clear()
    this.bindings.clear()
    this.defaultConnectorName = undefined
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a connector registry
 */
export function createConnectorRegistry(): ConnectorRegistry {
  return new InMemoryConnectorRegistry()
}
