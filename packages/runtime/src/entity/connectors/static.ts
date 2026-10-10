/**
 * Static Entity Connector
 *
 * In-memory Map-based connector for prototyping and testing.
 * Supports filter, sort, and pagination operations.
 *
 * @module @pwfabric/runtime/entity/connectors/static
 */

import type {
  EntityTypeId,
  EntityInstanceId,
  EntityQuery,
  EntityFilter,
  EntitySortField,
} from '../types.js'
import type { EntityConnector, ConnectorResult, ConnectorQueryResult } from '../connector.js'

// ============================================================
// STATIC CONNECTOR
// ============================================================

/**
 * In-memory static connector for prototyping and testing.
 * Stores data in a Map keyed by entity type, then by instance id.
 */
export class StaticConnector implements EntityConnector {
  readonly name: string
  readonly type = 'static' as const

  private readonly store = new Map<EntityTypeId, Map<EntityInstanceId, Record<string, unknown>>>()
  private counter = 0

  constructor(name = 'static') {
    this.name = name
  }

  async create(entityType: EntityTypeId, data: Record<string, unknown>): Promise<ConnectorResult> {
    const typeStore = this.getOrCreateTypeStore(entityType)
    const id = this.generateId()
    const record = { ...data, id }

    typeStore.set(id, record)

    return { success: true, data: record }
  }

  async read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
    const typeStore = this.store.get(entityType)
    if (!typeStore) {
      return { success: false, error: `Entity type '${entityType}' has no data` }
    }

    const record = typeStore.get(instanceId)
    if (!record) {
      return { success: false, error: `Instance '${instanceId}' not found` }
    }

    return { success: true, data: { ...record } }
  }

  async update(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId,
    data: Record<string, unknown>
  ): Promise<ConnectorResult> {
    const typeStore = this.store.get(entityType)
    if (!typeStore) {
      return { success: false, error: `Entity type '${entityType}' has no data` }
    }

    const existing = typeStore.get(instanceId)
    if (!existing) {
      return { success: false, error: `Instance '${instanceId}' not found` }
    }

    const updated = { ...existing, ...data, id: instanceId }
    typeStore.set(instanceId, updated)

    return { success: true, data: updated }
  }

  async delete(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
    const typeStore = this.store.get(entityType)
    if (!typeStore) {
      return { success: false, error: `Entity type '${entityType}' has no data` }
    }

    const existing = typeStore.get(instanceId)
    if (!existing) {
      return { success: false, error: `Instance '${instanceId}' not found` }
    }

    typeStore.delete(instanceId)

    return { success: true, data: existing }
  }

  async query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult> {
    const typeStore = this.store.get(entityType)
    if (!typeStore) {
      return {
        success: true,
        result: {
          items: [],
          total: 0,
          offset: 0,
          limit: query.pagination?.limit ?? 50,
          hasMore: false,
        },
      }
    }

    let items = Array.from(typeStore.values())

    // Apply filters
    if (query.filter) {
      items = this.applyFilter(items, query.filter)
    }

    const total = items.length

    // Apply sort
    if (query.sort && query.sort.length > 0) {
      items = this.applySort(items, query.sort)
    }

    // Apply pagination
    const offset = query.pagination?.offset ?? 0
    const limit = query.pagination?.limit ?? 50
    const paginatedItems = items.slice(offset, offset + limit)

    return {
      success: true,
      result: {
        items: paginatedItems,
        total,
        offset,
        limit,
        hasMore: offset + limit < total,
      },
    }
  }

  /**
   * Seed data into the connector for testing
   */
  seed(entityType: EntityTypeId, records: Record<string, unknown>[]): void {
    const typeStore = this.getOrCreateTypeStore(entityType)
    for (const record of records) {
      const id = (record.id as EntityInstanceId) ?? this.generateId()
      typeStore.set(id, { ...record, id })
    }
  }

  /**
   * Clear all data from the connector
   */
  clear(): void {
    this.store.clear()
    this.counter = 0
  }

  /**
   * Clear data for a specific entity type
   */
  clearType(entityType: EntityTypeId): void {
    this.store.delete(entityType)
  }

  /**
   * Get the total count of records for an entity type
   */
  count(entityType: EntityTypeId): number {
    return this.store.get(entityType)?.size ?? 0
  }

  private getOrCreateTypeStore(
    entityType: EntityTypeId
  ): Map<EntityInstanceId, Record<string, unknown>> {
    let typeStore = this.store.get(entityType)
    if (!typeStore) {
      typeStore = new Map()
      this.store.set(entityType, typeStore)
    }
    return typeStore
  }

  private generateId(): EntityInstanceId {
    this.counter++
    return `inst_${this.counter}` as EntityInstanceId
  }

  private applyFilter(
    items: Record<string, unknown>[],
    filter: EntityFilter
  ): Record<string, unknown>[] {
    let result = items

    // Apply the main condition
    if (filter.field && filter.operator) {
      result = result.filter((item) => this.matchesCondition(item, filter))
    }

    // Apply AND conditions
    if (filter.and && filter.and.length > 0) {
      for (const andFilter of filter.and) {
        result = this.applyFilter(result, andFilter)
      }
    }

    // Apply OR conditions
    if (filter.or && filter.or.length > 0) {
      const orResults = new Set<Record<string, unknown>>()
      for (const orFilter of filter.or) {
        const orMatches = this.applyFilter(result, orFilter)
        for (const match of orMatches) {
          orResults.add(match)
        }
      }
      result = Array.from(orResults)
    }

    return result
  }

  private matchesCondition(item: Record<string, unknown>, filter: EntityFilter): boolean {
    const fieldValue = item[filter.field]
    const filterValue = filter.value

    switch (filter.operator) {
      case 'eq':
        return fieldValue === filterValue
      case 'neq':
        return fieldValue !== filterValue
      case 'gt':
        return typeof fieldValue === 'number' && typeof filterValue === 'number'
          ? fieldValue > filterValue
          : false
      case 'gte':
        return typeof fieldValue === 'number' && typeof filterValue === 'number'
          ? fieldValue >= filterValue
          : false
      case 'lt':
        return typeof fieldValue === 'number' && typeof filterValue === 'number'
          ? fieldValue < filterValue
          : false
      case 'lte':
        return typeof fieldValue === 'number' && typeof filterValue === 'number'
          ? fieldValue <= filterValue
          : false
      case 'in':
        return Array.isArray(filterValue) ? filterValue.includes(fieldValue) : false
      case 'contains':
        return typeof fieldValue === 'string' && typeof filterValue === 'string'
          ? fieldValue.includes(filterValue)
          : false
      case 'startsWith':
        return typeof fieldValue === 'string' && typeof filterValue === 'string'
          ? fieldValue.startsWith(filterValue)
          : false
      default:
        return false
    }
  }

  private applySort(
    items: Record<string, unknown>[],
    sortFields: readonly EntitySortField[]
  ): Record<string, unknown>[] {
    return [...items].sort((a, b) => {
      for (const sortField of sortFields) {
        const aVal = a[sortField.field]
        const bVal = b[sortField.field]

        let comparison = 0

        if (typeof aVal === 'string' && typeof bVal === 'string') {
          comparison = aVal.localeCompare(bVal)
        } else if (typeof aVal === 'number' && typeof bVal === 'number') {
          comparison = aVal - bVal
        } else if (aVal === undefined || aVal === null) {
          comparison = -1
        } else if (bVal === undefined || bVal === null) {
          comparison = 1
        }

        if (comparison !== 0) {
          return sortField.direction === 'desc' ? -comparison : comparison
        }
      }
      return 0
    })
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a static connector
 */
export function createStaticConnector(name?: string): StaticConnector {
  return new StaticConnector(name)
}
