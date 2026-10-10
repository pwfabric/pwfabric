/**
 * Graph Resolver Types
 *
 * Types for Microsoft Graph data resolution
 *
 * @module @pwfabric/runtime/graph/types
 */

// ============================================================
// GRAPH QUERY TYPES
// ============================================================

/**
 * Graph resource type
 */
export type GraphResource =
  | 'me'
  | 'users'
  | 'groups'
  | 'sites'
  | 'drives'
  | 'teams'
  | 'channels'
  | 'messages'
  | 'events'
  | 'contacts'

/**
 * Graph query definition
 */
export interface GraphQuery {
  readonly resource: GraphResource | string
  readonly id?: string
  readonly select?: readonly string[]
  readonly expand?: readonly string[]
  readonly filter?: string
  readonly orderBy?: string
  readonly top?: number
  readonly skip?: number
}

/**
 * Graph batch request
 */
export interface GraphBatchRequest {
  readonly id: string
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  readonly url: string
  readonly body?: unknown
  readonly headers?: Record<string, string>
  readonly dependsOn?: readonly string[]
}

// ============================================================
// GRAPH RESPONSE TYPES
// ============================================================

/**
 * Graph response
 */
export interface GraphResponse<T = unknown> {
  readonly value?: T
  readonly '@odata.context'?: string
  readonly '@odata.count'?: number
  readonly '@odata.nextLink'?: string
}

/**
 * Graph collection response
 */
export interface GraphCollectionResponse<T> extends GraphResponse<T[]> {
  readonly value: T[]
}

/**
 * Graph batch response
 */
export interface GraphBatchResponse {
  readonly responses: readonly GraphBatchResponseItem[]
}

/**
 * Graph batch response item
 */
export interface GraphBatchResponseItem {
  readonly id: string
  readonly status: number
  readonly headers?: Record<string, string>
  readonly body?: unknown
}

// ============================================================
// GRAPH RESULT TYPES
// ============================================================

/**
 * Graph query result
 */
export type GraphResult<T> =
  | { readonly success: true; readonly data: T; readonly nextLink?: string }
  | { readonly success: false; readonly error: GraphError }

/**
 * Graph error
 */
export interface GraphError {
  readonly type:
    | 'network_error'
    | 'auth_error'
    | 'not_found'
    | 'forbidden'
    | 'rate_limited'
    | 'server_error'
  readonly message: string
  readonly code?: string
  readonly statusCode?: number
  readonly cause?: unknown
}

// ============================================================
// COMMON GRAPH ENTITIES
// ============================================================

/**
 * Graph user
 */
export interface GraphUser {
  readonly id: string
  readonly displayName?: string
  readonly mail?: string
  readonly userPrincipalName?: string
  readonly jobTitle?: string
  readonly department?: string
  readonly officeLocation?: string
}

/**
 * Graph group
 */
export interface GraphGroup {
  readonly id: string
  readonly displayName?: string
  readonly description?: string
  readonly mail?: string
  readonly groupTypes?: readonly string[]
}

/**
 * Graph drive item
 */
export interface GraphDriveItem {
  readonly id: string
  readonly name: string
  readonly webUrl?: string
  readonly size?: number
  readonly createdDateTime?: string
  readonly lastModifiedDateTime?: string
  readonly folder?: { childCount: number }
  readonly file?: { mimeType: string }
}
