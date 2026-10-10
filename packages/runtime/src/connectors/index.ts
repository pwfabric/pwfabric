/**
 * Connector Engine Module
 *
 * Platform-side loading + registry for CONNECTOR/PROVIDER atom engines,
 * so platform-rendered surfaces can execute the same engines the runner
 * app runs from its bundled pack source.
 *
 * @module @pwfabric/runtime/connectors
 */

export type {
  ConnectorEngineKind,
  ConnectorEngineDescriptor,
  ConnectorAccessTokenHook,
  ConnectorEngineFactory,
  ConnectorEngineModule,
  ConnectorEngine,
  ConnectorConnectionBinding,
  ConnectorAccessTokenResolver,
  ConnectorEngineStatus,
  ConnectorEngineRegistry,
  SurfaceConnection,
  SurfaceConnectionsValue,
} from './types.js'

export {
  ConnectorModuleLoader,
  ConnectorModuleLoaderImpl,
  createConnectorModuleLoader,
  type ConnectorModuleEvaluator,
} from './module-loader.js'

export {
  DefaultConnectorEngineRegistry,
  createConnectorEngineRegistry,
} from './engine-registry.js'

// an engine built from its declaration; the runtime learns no vendor name.
export { createDeclaredConnector, VALUE_TRANSFORMS } from './declared-connector.js'
export type { DeclaredConnectorOptions } from './declared-connector.js'
