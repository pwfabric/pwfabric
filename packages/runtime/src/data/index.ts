/**
 * Data Module
 *
 * Data source resolution, fetch integration, and data binding
 *
 * Exports:
 * - Types: DataSourceDefinition, DataFetchResult, DataBinding, LiveDataBinding, etc.
 * - Service: DataService
 * - Provider: DataCapabilityProvider, useDataService
 * - Factory functions: createDataService
 *
 * @module @pwfabric/runtime/data
 */

// Types
export type {
  DataSourceKind,
  DataSourceDefinition,
  DataCacheConfig,
  DataRetryConfig,
  DataResolveContext,
  DataFetchOptions,
  DataFetchResult,
  DataFetchMetadata,
  DataFetchError,
  DataBinding,
  DataBindingState,
  LiveDataBinding,
  DataBindingListener,
  DataServiceConfig,
  DataServiceInterface,
} from './types.js'

// Service implementation
export { DataService, createDataService } from './manager.js'

// React context provider and hook
export {
  DataCapabilityProvider,
  useDataService,
  useOptionalDataService,
} from './DataCapabilityProvider.js'
export type { DataCapabilityProviderProps } from './DataCapabilityProvider.js'
