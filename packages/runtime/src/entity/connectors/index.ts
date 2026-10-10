/**
 * Entity Connectors Module
 *
 * Connector implementations for entity data persistence.
 *
 * @module @pwfabric/runtime/entity/connectors
 */

export { StaticConnector, createStaticConnector } from './static.js'

// HTTP connector
export type { HttpAuthConfig, HttpRetryConfig, HttpConnectorConfig } from '../http-connector.js'
export { HttpEntityConnector, createHttpConnector } from '../http-connector.js'

// PostgreSQL connector
export type {
  PostgresConnectorConfig,
  DatabaseAdapter,
  DatabaseResult,
} from '../postgres-connector.js'
export { PostgresEntityConnector, createPostgresConnector } from '../postgres-connector.js'
