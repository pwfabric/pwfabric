/**
 * Graph Module
 *
 * Microsoft Graph data resolution
 *
 * @module @pwfabric/runtime/graph
 */

// Types
export type {
  GraphResource,
  GraphQuery,
  GraphBatchRequest,
  GraphResponse,
  GraphCollectionResponse,
  GraphBatchResponse,
  GraphBatchResponseItem,
  GraphResult,
  GraphError,
  GraphUser,
  GraphGroup,
  GraphDriveItem,
} from './types.js'

// Resolver
export type { GraphResolver, GraphResolverConfig } from './resolver.js'
export { RuntimeGraphResolver, createGraphResolver } from './resolver.js'
