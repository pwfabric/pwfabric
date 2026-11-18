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

// The PostgreSQL connector is a server's: `@pwfabric/runtime/entity/postgres`.
