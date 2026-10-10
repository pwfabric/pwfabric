/**
 * Data Source Management
 *
 * Data source registry and management for surfaces
 *
 * Provides:
 * - Static data sources (inline data)
 * - API data sources (REST endpoints)
 * - State data sources (from state module)
 * - Caching integration
 *
 * @module @pwfabric/runtime/binding/datasource
 */

import type { CacheProvider } from '../cache/types.js'
import type { StateStore } from '../state/types.js'

// ============================================================
// DATA SOURCE TYPES
// ============================================================

/**
 * Data source types
 */
export type DataSourceType = 'static' | 'api' | 'graphql' | 'state'

/**
 * Data source interface
 */
export interface DataSource<T = unknown> {
  /** Unique identifier for the data source */
  readonly id: string

  /** Type of data source */
  readonly type: DataSourceType

  /** Human-readable name */
  readonly name?: string | undefined

  /** Optional description */
  readonly description?: string | undefined

  /**
   * Fetch data from the source
   */
  fetch(params?: Record<string, unknown>): Promise<T>

  /**
   * Subscribe to data changes (if supported)
   * @returns Unsubscribe function, or undefined if not supported
   */
  subscribe?(listener: DataSourceListener<T>): () => void

  /**
   * Invalidate cached data (if caching is enabled)
   */
  invalidate?(): void

  /**
   * Check if the data source is loading
   */
  isLoading?(): boolean
}

/**
 * Listener for data source changes
 */
export type DataSourceListener<T> = (data: T) => void

// ============================================================
// DATA SOURCE CONFIGURATION
// ============================================================

/**
 * Base configuration for data sources
 */
export interface BaseDataSourceConfig {
  /** Unique identifier */
  readonly id: string

  /** Human-readable name */
  readonly name?: string | undefined

  /** Optional description */
  readonly description?: string | undefined

  /** Cache configuration */
  readonly cache?: DataSourceCacheConfig | undefined
}

/**
 * Cache configuration for data sources
 */
export interface DataSourceCacheConfig {
  /** Whether caching is enabled */
  readonly enabled: boolean

  /** Time-to-live in milliseconds */
  readonly ttl?: number

  /** Custom cache key */
  readonly key?: string
}

/**
 * Static data source configuration
 */
export interface StaticDataSourceConfig<T> extends BaseDataSourceConfig {
  readonly type: 'static'

  /** Static data */
  readonly data: T
}

/**
 * API data source configuration
 */
export interface ApiDataSourceConfig extends BaseDataSourceConfig {
  readonly type: 'api'

  /** API endpoint URL */
  readonly url: string

  /** HTTP method */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

  /** Request headers */
  readonly headers?: Record<string, string>

  /** Request body (for POST/PUT/PATCH) */
  readonly body?: unknown

  /** Query parameters */
  readonly query?: Record<string, string | number | boolean>

  /** Transform response data */
  readonly transform?: (data: unknown) => unknown

  /** Polling interval in milliseconds (0 = no polling) */
  readonly pollInterval?: number

  /** Retry configuration */
  readonly retry?: DataSourceRetryConfig
}

/**
 * GraphQL data source configuration
 */
export interface GraphQLDataSourceConfig extends BaseDataSourceConfig {
  readonly type: 'graphql'

  /** GraphQL endpoint URL */
  readonly url: string

  /** GraphQL query */
  readonly query: string

  /** GraphQL variables */
  readonly variables?: Record<string, unknown>

  /** Request headers */
  readonly headers?: Record<string, string>

  /** Transform response data */
  readonly transform?: (data: unknown) => unknown

  /** Polling interval in milliseconds (0 = no polling) */
  readonly pollInterval?: number
}

/**
 * State data source configuration
 */
export interface StateDataSourceConfig extends BaseDataSourceConfig {
  readonly type: 'state'

  /** State key to bind to */
  readonly stateKey: string

  /** Transform state data */
  readonly transform?: ((data: unknown) => unknown) | undefined
}

/**
 * Union of all data source configurations
 */
export type DataSourceConfig<T = unknown> =
  | StaticDataSourceConfig<T>
  | ApiDataSourceConfig
  | GraphQLDataSourceConfig
  | StateDataSourceConfig

/**
 * Retry configuration
 */
export interface DataSourceRetryConfig {
  /** Maximum number of retry attempts */
  readonly maxAttempts: number

  /** Delay between retries in milliseconds */
  readonly delay: number

  /** Whether to use exponential backoff */
  readonly exponentialBackoff?: boolean
}

// ============================================================
// STATIC DATA SOURCE
// ============================================================

/**
 * Static data source implementation
 */
export class StaticDataSource<T> implements DataSource<T> {
  readonly id: string
  readonly type: DataSourceType = 'static'
  readonly name: string | undefined
  readonly description: string | undefined
  private readonly data: T

  constructor(config: StaticDataSourceConfig<T>) {
    this.id = config.id
    this.name = config.name
    this.description = config.description
    this.data = config.data
  }

  async fetch(): Promise<T> {
    return this.data
  }

  isLoading(): boolean {
    return false
  }
}

// ============================================================
// API DATA SOURCE
// ============================================================

/**
 * API data source implementation with caching and polling support
 */
export class ApiDataSource<T = unknown> implements DataSource<T> {
  readonly id: string
  readonly type: DataSourceType = 'api'
  readonly name: string | undefined
  readonly description: string | undefined

  private readonly config: ApiDataSourceConfig
  private readonly cache: CacheProvider | undefined
  private readonly listeners = new Set<DataSourceListener<T>>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private loading = false
  private lastData: T | undefined

  constructor(config: ApiDataSourceConfig, cache?: CacheProvider) {
    this.id = config.id
    this.name = config.name
    this.description = config.description
    this.config = config
    this.cache = cache

    // Start polling if configured
    if (config.pollInterval && config.pollInterval > 0) {
      this.startPolling(config.pollInterval)
    }
  }

  async fetch(params?: Record<string, unknown>): Promise<T> {
    // Check cache first
    if (this.config.cache?.enabled && this.cache) {
      const cacheKey = this.getCacheKey(params)
      const cached = await this.cache.get<T>(cacheKey)
      if (cached !== undefined) {
        return cached
      }
    }

    this.loading = true

    try {
      const data = await this.fetchWithRetry(params)

      // Apply transform
      const transformed = this.config.transform ? (this.config.transform(data) as T) : (data as T)

      // Store in cache
      if (this.config.cache?.enabled && this.cache) {
        const cacheKey = this.getCacheKey(params)
        await this.cache.set(cacheKey, transformed, this.config.cache.ttl)
      }

      this.lastData = transformed
      this.notifyListeners(transformed)

      return transformed
    } finally {
      this.loading = false
    }
  }

  subscribe(listener: DataSourceListener<T>): () => void {
    this.listeners.add(listener)

    // Immediately notify with last data if available
    if (this.lastData !== undefined) {
      listener(this.lastData)
    }

    return () => {
      this.listeners.delete(listener)
    }
  }

  invalidate(): void {
    if (this.config.cache?.enabled && this.cache) {
      const cacheKey = this.getCacheKey()
      this.cache.delete(cacheKey)
    }
  }

  isLoading(): boolean {
    return this.loading
  }

  /**
   * Stop polling and clean up
   */
  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    this.listeners.clear()
  }

  private async fetchWithRetry(params?: Record<string, unknown>): Promise<unknown> {
    const maxAttempts = this.config.retry?.maxAttempts ?? 1
    const delay = this.config.retry?.delay ?? 1000
    const exponential = this.config.retry?.exponentialBackoff ?? false

    let lastError: Error | undefined

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await this.doFetch(params)
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e))

        if (attempt < maxAttempts - 1) {
          const waitTime = exponential ? delay * Math.pow(2, attempt) : delay
          await new Promise((resolve) => setTimeout(resolve, waitTime))
        }
      }
    }

    throw lastError
  }

  private async doFetch(params?: Record<string, unknown>): Promise<unknown> {
    const originalUrl = this.config.url
    let url = originalUrl

    // Track which params are used in URL replacement
    const usedParams = new Set<string>()

    // Replace URL parameters
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (originalUrl.includes(`:${key}`) || originalUrl.includes(`{${key}}`)) {
          url = url.replace(`:${key}`, String(value))
          url = url.replace(`{${key}}`, String(value))
          usedParams.add(key)
        }
      }
    }

    // Build query string
    const queryParams = new URLSearchParams()
    if (this.config.query) {
      for (const [key, value] of Object.entries(this.config.query)) {
        queryParams.append(key, String(value))
      }
    }
    // Add remaining params (not used in URL replacement) to query string
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (!usedParams.has(key)) {
          queryParams.append(key, String(value))
        }
      }
    }
    const queryString = queryParams.toString()
    if (queryString) {
      url += (url.includes('?') ? '&' : '?') + queryString
    }

    const requestInit: RequestInit = {
      method: this.config.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
    }
    if (this.config.body) {
      requestInit.body = JSON.stringify(this.config.body)
    }
    const response = await fetch(url, requestInit)

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return response.json()
  }

  private getCacheKey(params?: Record<string, unknown>): string {
    if (this.config.cache?.key) {
      return this.config.cache.key
    }
    const paramsKey = params ? JSON.stringify(params) : ''
    return `datasource:${this.id}:${paramsKey}`
  }

  private startPolling(interval: number): void {
    this.pollTimer = setInterval(() => {
      this.fetch().catch(() => {
        // Polling errors are silently ignored
      })
    }, interval)
  }

  private notifyListeners(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data)
      } catch {
        // Swallow errors from listeners
      }
    }
  }
}

// ============================================================
// GRAPHQL DATA SOURCE
// ============================================================

/**
 * GraphQL data source implementation with polling and caching support
 */
export class GraphQLDataSource<T = unknown> implements DataSource<T> {
  readonly id: string
  readonly type: DataSourceType = 'graphql'
  readonly name: string | undefined
  readonly description: string | undefined

  private readonly config: GraphQLDataSourceConfig
  private readonly cache: CacheProvider | undefined
  private readonly listeners = new Set<DataSourceListener<T>>()
  private pollTimer: ReturnType<typeof setInterval> | undefined
  private loading = false
  private lastData: T | undefined

  constructor(config: GraphQLDataSourceConfig, cache?: CacheProvider) {
    this.id = config.id
    this.name = config.name
    this.description = config.description
    this.config = config
    this.cache = cache

    if (config.pollInterval && config.pollInterval > 0) {
      this.startPolling(config.pollInterval)
    }
  }

  async fetch(params?: Record<string, unknown>): Promise<T> {
    // Check cache first
    if (this.config.cache?.enabled && this.cache) {
      const cacheKey = this.getCacheKey(params)
      const cached = await this.cache.get<T>(cacheKey)
      if (cached !== undefined) {
        return cached
      }
    }

    this.loading = true

    try {
      const data = await this.executeQuery(params)

      // Apply transform
      const transformed = this.config.transform ? (this.config.transform(data) as T) : (data as T)

      // Store in cache
      if (this.config.cache?.enabled && this.cache) {
        const cacheKey = this.getCacheKey(params)
        await this.cache.set(cacheKey, transformed, this.config.cache.ttl)
      }

      this.lastData = transformed
      this.notifyListeners(transformed)

      return transformed
    } finally {
      this.loading = false
    }
  }

  subscribe(listener: DataSourceListener<T>): () => void {
    this.listeners.add(listener)

    if (this.lastData !== undefined) {
      listener(this.lastData)
    }

    return () => {
      this.listeners.delete(listener)
    }
  }

  invalidate(): void {
    if (this.config.cache?.enabled && this.cache) {
      const cacheKey = this.getCacheKey()
      this.cache.delete(cacheKey)
    }
  }

  isLoading(): boolean {
    return this.loading
  }

  dispose(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
    this.listeners.clear()
  }

  private async executeQuery(params?: Record<string, unknown>): Promise<unknown> {
    // Merge config variables with runtime params
    const variables = { ...this.config.variables, ...params }

    const response = await fetch(this.config.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.config.headers,
      },
      body: JSON.stringify({
        query: this.config.query,
        variables: Object.keys(variables).length > 0 ? variables : undefined,
      }),
    })

    if (!response.ok) {
      throw new Error(`GraphQL HTTP ${response.status}: ${response.statusText}`)
    }

    const result = (await response.json()) as {
      data?: unknown
      errors?: { message: string }[]
    }

    if (result.errors && result.errors.length > 0) {
      const messages = result.errors.map((e) => e.message).join('; ')
      throw new Error(`GraphQL errors: ${messages}`)
    }

    return result.data
  }

  private getCacheKey(params?: Record<string, unknown>): string {
    if (this.config.cache?.key) {
      return this.config.cache.key
    }
    const paramsKey = params ? JSON.stringify(params) : ''
    return `datasource:graphql:${this.id}:${paramsKey}`
  }

  private startPolling(interval: number): void {
    this.pollTimer = setInterval(() => {
      this.fetch().catch(() => {
        // Polling errors are silently ignored
      })
    }, interval)
  }

  private notifyListeners(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data)
      } catch {
        // Swallow errors from listeners
      }
    }
  }
}

// ============================================================
// STATE DATA SOURCE
// ============================================================

/**
 * State data source implementation - binds to state store
 */
export class StateDataSource<T = unknown> implements DataSource<T> {
  readonly id: string
  readonly type: DataSourceType = 'state'
  readonly name: string | undefined
  readonly description: string | undefined

  private readonly config: StateDataSourceConfig
  private readonly stateStore: StateStore
  private readonly listeners = new Set<DataSourceListener<T>>()
  private unsubscribe: (() => void) | undefined

  constructor(config: StateDataSourceConfig, stateStore: StateStore) {
    this.id = config.id
    this.name = config.name
    this.description = config.description
    this.config = config
    this.stateStore = stateStore

    // Subscribe to state changes
    this.unsubscribe = stateStore.subscribe(config.stateKey, (value) => {
      const transformed = this.config.transform ? (this.config.transform(value) as T) : (value as T)
      this.notifyListeners(transformed)
    })
  }

  async fetch(): Promise<T> {
    const value = this.stateStore.get(this.config.stateKey)
    return this.config.transform ? (this.config.transform(value) as T) : (value as T)
  }

  subscribe(listener: DataSourceListener<T>): () => void {
    this.listeners.add(listener)

    // Immediately notify with current state
    const current = this.stateStore.get(this.config.stateKey)
    if (current !== undefined) {
      const transformed = this.config.transform
        ? (this.config.transform(current) as T)
        : (current as T)
      listener(transformed)
    }

    return () => {
      this.listeners.delete(listener)
    }
  }

  isLoading(): boolean {
    return false
  }

  /**
   * Clean up subscriptions
   */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe()
      this.unsubscribe = undefined
    }
    this.listeners.clear()
  }

  private notifyListeners(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data)
      } catch {
        // Swallow errors from listeners
      }
    }
  }
}

// ============================================================
// DATA SOURCE REGISTRY
// ============================================================

/**
 * Data source registry interface
 */
export interface DataSourceRegistry {
  /**
   * Register a data source
   */
  register<T>(source: DataSource<T>): void

  /**
   * Get a data source by ID
   */
  get<T>(id: string): DataSource<T> | undefined

  /**
   * Check if a data source exists
   */
  has(id: string): boolean

  /**
   * Fetch data from a source by ID
   */
  fetch<T>(id: string, params?: Record<string, unknown>): Promise<T>

  /**
   * Unregister a data source
   */
  unregister(id: string): boolean

  /**
   * Get all registered data source IDs
   */
  ids(): string[]

  /**
   * Clear all data sources
   */
  clear(): void
}

/**
 * In-memory data source registry implementation
 */
export class InMemoryDataSourceRegistry implements DataSourceRegistry {
  private readonly sources = new Map<string, DataSource>()

  register<T>(source: DataSource<T>): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Data source '${source.id}' is already registered`)
    }
    this.sources.set(source.id, source as DataSource)
  }

  get<T>(id: string): DataSource<T> | undefined {
    return this.sources.get(id) as DataSource<T> | undefined
  }

  has(id: string): boolean {
    return this.sources.has(id)
  }

  async fetch<T>(id: string, params?: Record<string, unknown>): Promise<T> {
    const source = this.sources.get(id)
    if (!source) {
      throw new Error(`Data source '${id}' not found`)
    }
    return source.fetch(params) as Promise<T>
  }

  unregister(id: string): boolean {
    const source = this.sources.get(id)
    if (source) {
      // Dispose if the source has a dispose method
      if ('dispose' in source && typeof source.dispose === 'function') {
        source.dispose()
      }
      return this.sources.delete(id)
    }
    return false
  }

  ids(): string[] {
    return Array.from(this.sources.keys())
  }

  clear(): void {
    // Dispose all sources
    for (const source of this.sources.values()) {
      if ('dispose' in source && typeof source.dispose === 'function') {
        source.dispose()
      }
    }
    this.sources.clear()
  }
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a data source registry
 */
export function createDataSourceRegistry(): DataSourceRegistry {
  return new InMemoryDataSourceRegistry()
}

/**
 * Create a data source from configuration
 */
export function createDataSource<T>(
  config: DataSourceConfig<T>,
  dependencies?: {
    cache?: CacheProvider
    stateStore?: StateStore
  }
): DataSource<T> {
  switch (config.type) {
    case 'static':
      return new StaticDataSource(config) as DataSource<T>

    case 'api':
      return new ApiDataSource(config, dependencies?.cache) as DataSource<T>

    case 'state':
      if (!dependencies?.stateStore) {
        throw new Error('State store is required for state data sources')
      }
      return new StateDataSource(config, dependencies.stateStore) as DataSource<T>

    case 'graphql':
      return new GraphQLDataSource(config, dependencies?.cache) as DataSource<T>

    default:
      throw new Error(`Unknown data source type: ${(config as DataSourceConfig).type}`)
  }
}

/**
 * Create a static data source
 */
export function createStaticDataSource<T>(
  id: string,
  data: T,
  options?: { name?: string; description?: string }
): DataSource<T> {
  const config: StaticDataSourceConfig<T> = {
    id,
    type: 'static',
    data,
  }
  if (options?.name !== undefined) {
    ;(config as { name: string }).name = options.name
  }
  if (options?.description !== undefined) {
    ;(config as { description: string }).description = options.description
  }
  return new StaticDataSource(config)
}

/**
 * Create an API data source
 */
export function createApiDataSource<T>(
  id: string,
  url: string,
  options?: Omit<ApiDataSourceConfig, 'id' | 'type' | 'url'>,
  cache?: CacheProvider
): DataSource<T> {
  return new ApiDataSource<T>(
    {
      id,
      type: 'api',
      url,
      ...options,
    },
    cache
  )
}

/**
 * Create a state data source
 */
export function createStateDataSource<T>(
  id: string,
  stateKey: string,
  stateStore: StateStore,
  options?: { name?: string; description?: string; transform?: (data: unknown) => T }
): DataSource<T> {
  const config: StateDataSourceConfig = {
    id,
    type: 'state',
    stateKey,
  }
  if (options?.name !== undefined) {
    ;(config as { name: string }).name = options.name
  }
  if (options?.description !== undefined) {
    ;(config as { description: string }).description = options.description
  }
  if (options?.transform !== undefined) {
    ;(config as { transform: (data: unknown) => unknown }).transform = options.transform
  }
  return new StateDataSource<T>(config, stateStore)
}

/**
 * Create a GraphQL data source
 */
export function createGraphQLDataSource<T>(
  id: string,
  url: string,
  query: string,
  options?: Omit<GraphQLDataSourceConfig, 'id' | 'type' | 'url' | 'query'>,
  cache?: CacheProvider
): DataSource<T> {
  return new GraphQLDataSource<T>(
    {
      id,
      type: 'graphql',
      url,
      query,
      ...options,
    },
    cache
  )
}
