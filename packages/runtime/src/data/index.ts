/**
 * Data Module
 *
 * Data source resolution, fetch integration, and data binding
 *
 * Exports:
 * - Types: DataSourceDefinition, DataFetchResult, DataBinding, LiveDataBinding, etc.
 * - Service: DataService (renamed from DefaultDataCapability)
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
  // Backward-compatible alias
  DataCapability,
} from './types.js'

// Service implementation
export { DataService, createDataService } from './manager.js'

// Backward-compatible aliases
export { DefaultDataCapability, createDataCapability } from './manager.js'

// React context provider and hook
export {
  DataCapabilityProvider,
  useDataService,
  useOptionalDataService,
} from './DataCapabilityProvider.js'
export type { DataCapabilityProviderProps } from './DataCapabilityProvider.js'
