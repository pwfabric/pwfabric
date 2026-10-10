/**
 * PostgreSQL Entity Connector
 *
 * Database connector for entity data persistence using Drizzle ORM.
 * Implements the EntityConnector interface with PostgreSQL-specific query building.
 *
 * @module @pwfabric/runtime/entity/postgres-connector
 */

import type {
  EntityTypeId,
  EntityInstanceId,
  EntityQuery,
  EntityFilter,
  EntitySortField,
} from './types.js'
import type {
  EntityConnector,
  EntityConnectorType,
  ConnectorResult,
  ConnectorQueryResult,
} from './connector.js'

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * PostgreSQL connector configuration
 */
export interface PostgresConnectorConfig {
  /**
   * Database connection — either a connection string or a Drizzle db instance.
   * When a string, the connector will create its own connection.
   * When an object, it must implement the DatabaseAdapter interface.
   */
  readonly connection: string | DatabaseAdapter

  /** Optional table name prefix for multi-tenant isolation */
  readonly tablePrefix?: string

  /** Default page size for queries */
  readonly defaultPageSize?: number

  /** Maximum page size to prevent excessive queries */
  readonly maxPageSize?: number
}

/**
 * Minimal database adapter interface.
 * This abstracts over Drizzle ORM or any SQL-capable client.
 */
export interface DatabaseAdapter {
  execute(sql: string, params?: unknown[]): Promise<DatabaseResult>
}

/**
 * Result of a database query execution
 */
export interface DatabaseResult {
  readonly rows: Record<string, unknown>[]
  readonly rowCount: number
}

// ============================================================
// SQL BUILDER HELPERS
// ============================================================

function escapeIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

function buildFilterClause(
  filter: EntityFilter,
  params: unknown[],
  offset: number
): { sql: string; nextOffset: number } {
  const parts: string[] = []
  let currentOffset = offset

  if (filter.field && filter.operator) {
    const col = escapeIdentifier(filter.field)
    const paramIndex = currentOffset + 1
    currentOffset++

    switch (filter.operator) {
      case 'eq':
        parts.push(`${col} = $${paramIndex}`)
        params.push(filter.value)
        break
      case 'neq':
        parts.push(`${col} != $${paramIndex}`)
        params.push(filter.value)
        break
      case 'gt':
        parts.push(`${col} > $${paramIndex}`)
        params.push(filter.value)
        break
      case 'gte':
        parts.push(`${col} >= $${paramIndex}`)
        params.push(filter.value)
        break
      case 'lt':
        parts.push(`${col} < $${paramIndex}`)
        params.push(filter.value)
        break
      case 'lte':
        parts.push(`${col} <= $${paramIndex}`)
        params.push(filter.value)
        break
      case 'in':
        parts.push(`${col} = ANY($${paramIndex})`)
        params.push(filter.value)
        break
      case 'contains':
        parts.push(`${col} ILIKE $${paramIndex}`)
        params.push(`%${filter.value}%`)
        break
      case 'startsWith':
        parts.push(`${col} ILIKE $${paramIndex}`)
        params.push(`${filter.value}%`)
        break
    }
  }

  if (filter.and && filter.and.length > 0) {
    for (const sub of filter.and) {
      const result = buildFilterClause(sub, params, currentOffset)
      parts.push(result.sql)
      currentOffset = result.nextOffset
    }
  }

  if (filter.or && filter.or.length > 0) {
    const orParts: string[] = []
    for (const sub of filter.or) {
      const result = buildFilterClause(sub, params, currentOffset)
      orParts.push(result.sql)
      currentOffset = result.nextOffset
    }
    if (orParts.length > 0) {
      parts.push(`(${orParts.join(' OR ')})`)
    }
  }

  return {
    sql: parts.length > 0 ? parts.join(' AND ') : '1=1',
    nextOffset: currentOffset,
  }
}

function buildOrderClause(sort: readonly EntitySortField[]): string {
  if (sort.length === 0) return ''
  const parts = sort.map(
    (s) => `${escapeIdentifier(s.field)} ${s.direction === 'desc' ? 'DESC' : 'ASC'}`
  )
  return ` ORDER BY ${parts.join(', ')}`
}

// ============================================================
// POSTGRES ENTITY CONNECTOR
// ============================================================

/**
 * PostgreSQL connector for entity data operations.
 * Maps entity CRUD operations to SQL queries via a DatabaseAdapter.
 */
export class PostgresEntityConnector implements EntityConnector {
  readonly name: string
  readonly type: EntityConnectorType = 'database'

  private readonly db: DatabaseAdapter
  private readonly tablePrefix: string
  private readonly defaultPageSize: number
  private readonly maxPageSize: number

  constructor(name: string, config: PostgresConnectorConfig) {
    this.name = name
    this.tablePrefix = config.tablePrefix ?? ''
    this.defaultPageSize = config.defaultPageSize ?? 50
    this.maxPageSize = config.maxPageSize ?? 1000

    if (typeof config.connection === 'string') {
      throw new Error(
        'String connection not yet supported. Pass a DatabaseAdapter instance. ' +
          'Use createDatabaseAdapter() from your Drizzle setup.'
      )
    }

    this.db = config.connection
  }

  private tableName(entityType: EntityTypeId): string {
    return escapeIdentifier(`${this.tablePrefix}${entityType}`)
  }

  async create(entityType: EntityTypeId, data: Record<string, unknown>): Promise<ConnectorResult> {
    try {
      const table = this.tableName(entityType)
      const keys = Object.keys(data)
      const cols = keys.map(escapeIdentifier).join(', ')
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ')
      const values = keys.map((k) => data[k])

      const sql = `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`
      const result = await this.db.execute(sql, values)

      if (result.rows.length === 0) {
        return { success: false, error: 'Insert returned no rows' }
      }

      return { success: true, data: result.rows[0] ?? {} }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
    try {
      const table = this.tableName(entityType)
      const sql = `SELECT * FROM ${table} WHERE "id" = $1 LIMIT 1`
      const result = await this.db.execute(sql, [instanceId])

      if (result.rows.length === 0) {
        return { success: false, error: `Entity ${entityType}/${instanceId} not found` }
      }

      return { success: true, data: result.rows[0] ?? {} }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async update(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId,
    data: Record<string, unknown>
  ): Promise<ConnectorResult> {
    try {
      const table = this.tableName(entityType)
      const keys = Object.keys(data)

      if (keys.length === 0) {
        return this.read(entityType, instanceId)
      }

      const setClauses = keys.map((key, i) => `${escapeIdentifier(key)} = $${i + 1}`)
      const values = [...keys.map((k) => data[k]), instanceId]

      const sql = `UPDATE ${table} SET ${setClauses.join(', ')} WHERE "id" = $${keys.length + 1} RETURNING *`
      const result = await this.db.execute(sql, values)

      if (result.rows.length === 0) {
        return { success: false, error: `Entity ${entityType}/${instanceId} not found` }
      }

      return { success: true, data: result.rows[0] ?? {} }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async delete(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
    try {
      const table = this.tableName(entityType)
      const sql = `DELETE FROM ${table} WHERE "id" = $1 RETURNING *`
      const result = await this.db.execute(sql, [instanceId])

      if (result.rows.length === 0) {
        return { success: false, error: `Entity ${entityType}/${instanceId} not found` }
      }

      return { success: true, data: result.rows[0] ?? {} }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult> {
    try {
      const table = this.tableName(entityType)
      const params: unknown[] = []
      let paramOffset = 0

      // WHERE clause
      let whereClause = ''
      if (query.filter) {
        const filterResult = buildFilterClause(query.filter, params, paramOffset)
        whereClause = ` WHERE ${filterResult.sql}`
        paramOffset = filterResult.nextOffset
      }

      // COUNT query
      const countSql = `SELECT COUNT(*) as count FROM ${table}${whereClause}`
      const countResult = await this.db.execute(countSql, [...params])
      const total = Number(countResult.rows[0]?.count ?? 0)

      // ORDER clause
      const orderClause = query.sort ? buildOrderClause(query.sort) : ''

      // PAGINATION
      const limit = Math.min(query.pagination?.limit ?? this.defaultPageSize, this.maxPageSize)
      const offset = query.pagination?.offset ?? 0
      paramOffset++
      const limitParam = `$${paramOffset}`
      params.push(limit)
      paramOffset++
      const offsetParam = `$${paramOffset}`
      params.push(offset)

      // DATA query
      const dataSql = `SELECT * FROM ${table}${whereClause}${orderClause} LIMIT ${limitParam} OFFSET ${offsetParam}`
      const dataResult = await this.db.execute(dataSql, params)

      return {
        success: true,
        result: {
          items: dataResult.rows,
          total,
          offset,
          limit,
          hasMore: total > offset + dataResult.rows.length,
        },
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a PostgreSQL entity connector
 */
export function createPostgresConnector(
  name: string,
  config: PostgresConnectorConfig
): PostgresEntityConnector {
  return new PostgresEntityConnector(name, config)
}
