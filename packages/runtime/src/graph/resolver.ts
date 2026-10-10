/**
 * Graph Resolver
 *
 * Microsoft Graph data resolver
 *
 * @module @pwfabric/runtime/graph/resolver
 */

import type { AuthProvider } from '../auth/provider.js'
import type {
  GraphQuery,
  GraphResult,
  GraphError,
  GraphResponse,
  GraphCollectionResponse,
  GraphBatchRequest,
  GraphBatchResponse,
} from './types.js'

// ============================================================
// GRAPH RESOLVER
// ============================================================

/**
 * Graph resolver interface
 */
export interface GraphResolver {
  /**
   * Execute a Graph query
   */
  query<T>(query: GraphQuery): Promise<GraphResult<T>>

  /**
   * Get a single resource
   */
  get<T>(path: string): Promise<GraphResult<T>>

  /**
   * Get a collection
   */
  list<T>(path: string, query?: Partial<GraphQuery>): Promise<GraphResult<T[]>>

  /**
   * Execute batch requests
   */
  batch(requests: readonly GraphBatchRequest[]): Promise<GraphResult<GraphBatchResponse>>

  /**
   * Get current user
   */
  me<T>(): Promise<GraphResult<T>>
}

/**
 * Graph resolver configuration
 */
export interface GraphResolverConfig {
  readonly baseUrl?: string
  readonly version?: string
  readonly timeout?: number
}

// ============================================================
// RUNTIME GRAPH RESOLVER
// ============================================================

/**
 * Runtime Graph resolver implementation
 */
export class RuntimeGraphResolver implements GraphResolver {
  private readonly authProvider: AuthProvider
  private readonly config: Required<GraphResolverConfig>

  constructor(authProvider: AuthProvider, config: GraphResolverConfig = {}) {
    this.authProvider = authProvider
    this.config = {
      baseUrl: config.baseUrl ?? 'https://graph.microsoft.com',
      version: config.version ?? 'v1.0',
      timeout: config.timeout ?? 30000,
    }
  }

  async query<T>(query: GraphQuery): Promise<GraphResult<T>> {
    const url = this.buildUrl(query)
    return this.get<T>(url)
  }

  async get<T>(path: string): Promise<GraphResult<T>> {
    const tokenResult = await this.authProvider.acquireTokenSilent()
    if (!tokenResult.success) {
      return {
        success: false,
        error: {
          type: 'auth_error',
          message: tokenResult.error.message,
        },
      }
    }

    try {
      const fullUrl = path.startsWith('http')
        ? path
        : `${this.config.baseUrl}/${this.config.version}/${path}`

      const response = await this.fetch(fullUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenResult.token.accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        return this.handleError(response)
      }

      const data = (await response.json()) as GraphResponse<T>
      const result: GraphResult<T> = {
        success: true,
        data: (data.value ?? data) as T,
      }
      if (data['@odata.nextLink'] !== undefined) {
        return { ...result, nextLink: data['@odata.nextLink'] }
      }
      return result
    } catch (e) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: `Request failed: ${e}`,
          cause: e,
        },
      }
    }
  }

  async list<T>(path: string, query?: Partial<GraphQuery>): Promise<GraphResult<T[]>> {
    const url = query ? this.buildUrlWithParams(path, query) : path

    const tokenResult = await this.authProvider.acquireTokenSilent()
    if (!tokenResult.success) {
      return {
        success: false,
        error: {
          type: 'auth_error',
          message: tokenResult.error.message,
        },
      }
    }

    try {
      const fullUrl = url.startsWith('http')
        ? url
        : `${this.config.baseUrl}/${this.config.version}/${url}`

      const response = await this.fetch(fullUrl, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${tokenResult.token.accessToken}`,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        return this.handleError(response)
      }

      const data = (await response.json()) as GraphCollectionResponse<T>
      const result: GraphResult<T[]> = {
        success: true,
        data: data.value ?? [],
      }
      if (data['@odata.nextLink'] !== undefined) {
        return { ...result, nextLink: data['@odata.nextLink'] }
      }
      return result
    } catch (e) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: `Request failed: ${e}`,
          cause: e,
        },
      }
    }
  }

  async batch(requests: readonly GraphBatchRequest[]): Promise<GraphResult<GraphBatchResponse>> {
    const tokenResult = await this.authProvider.acquireTokenSilent()
    if (!tokenResult.success) {
      return {
        success: false,
        error: {
          type: 'auth_error',
          message: tokenResult.error.message,
        },
      }
    }

    try {
      const response = await this.fetch(`${this.config.baseUrl}/${this.config.version}/$batch`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenResult.token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ requests }),
      })

      if (!response.ok) {
        return this.handleError(response)
      }

      const data = (await response.json()) as GraphBatchResponse
      return { success: true, data }
    } catch (e) {
      return {
        success: false,
        error: {
          type: 'network_error',
          message: `Batch request failed: ${e}`,
          cause: e,
        },
      }
    }
  }

  async me<T>(): Promise<GraphResult<T>> {
    return this.get<T>('me')
  }

  private buildUrl(query: GraphQuery): string {
    let url = query.resource
    if (query.id) {
      url += `/${query.id}`
    }
    return this.buildUrlWithParams(url, query)
  }

  private buildUrlWithParams(baseUrl: string, query: Partial<GraphQuery>): string {
    const params = new URLSearchParams()

    if (query.select?.length) {
      params.set('$select', query.select.join(','))
    }
    if (query.expand?.length) {
      params.set('$expand', query.expand.join(','))
    }
    if (query.filter) {
      params.set('$filter', query.filter)
    }
    if (query.orderBy) {
      params.set('$orderby', query.orderBy)
    }
    if (query.top !== undefined) {
      params.set('$top', String(query.top))
    }
    if (query.skip !== undefined) {
      params.set('$skip', String(query.skip))
    }

    const queryString = params.toString()
    return queryString ? `${baseUrl}?${queryString}` : baseUrl
  }

  private async handleError<T>(response: Response): Promise<GraphResult<T>> {
    let errorType: GraphError['type'] = 'server_error'

    switch (response.status) {
      case 401:
        errorType = 'auth_error'
        break
      case 403:
        errorType = 'forbidden'
        break
      case 404:
        errorType = 'not_found'
        break
      case 429:
        errorType = 'rate_limited'
        break
    }

    let message = `HTTP ${response.status}`
    try {
      const error = (await response.json()) as { error?: { message?: string; code?: string } }
      if (error?.error?.message) {
        message = error.error.message
      }
    } catch {
      // Ignore JSON parse errors
    }

    return {
      success: false,
      error: {
        type: errorType,
        message,
        statusCode: response.status,
      },
    }
  }

  /**
   * Fetch wrapper for testability
   */
  protected fetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, {
      ...init,
      signal: AbortSignal.timeout(this.config.timeout),
    })
  }
}

/**
 * Create a Graph resolver
 */
export function createGraphResolver(
  authProvider: AuthProvider,
  config?: GraphResolverConfig
): GraphResolver {
  return new RuntimeGraphResolver(authProvider, config)
}
