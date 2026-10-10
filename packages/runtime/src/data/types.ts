import type { EntityQuery } from '../entity/types.js'
/**
 * Data Capability Types
 *
 * Data source resolution, fetch integration, and data binding for surfaces
 *
 * @module @pwfabric/runtime/data/types
 */

// ============================================================
// DATA SOURCE DEFINITION
// ============================================================

/**
 * Supported data source kinds
 */
export type DataSourceKind = 'rest' | 'graphql' | 'static' | 'state' | 'computed'

/**
 * Data source definition for capability resolution
 */
export interface DataSourceDefinition<T = unknown> {
  readonly id: string
  readonly kind: DataSourceKind
  readonly name?: string
  readonly endpoint?: string
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  readonly headers?: Readonly<Record<string, string>>
  readonly staticData?: T
  readonly stateKey?: string
  readonly compute?: (context: DataResolveContext) => T | Promise<T>
  readonly transform?: (raw: unknown) => T
  readonly cache?: DataCacheConfig
  readonly retry?: DataRetryConfig
  /**
   * the identity this source is called WITH, by name.
   *
   * Without it a `rest` source cannot read authenticated data at all — 403
   * anonymous, 401 without a bearer, CORS-blocked with cookies — so the only
   * answer to "read this API as me" would be to write an engine. Named here,
   * the data path attaches that identity's LIVE token at call time.
   *
   * A NAME, NEVER A VALUE. The ref is resolved per call against the running
   * app's auth bridge; no token is stored on the source and none is serialised
   * into a published bundle.
   */
  readonly authProviderRef?: string
  /**
   * The response property holding the list — `data`, `products`, or absent
   * when the body IS the array. Dotted paths allowed for a nested one.
   */
  readonly returns?: string
  /**
   * The source's own filter / sort / pagination, applied to the rows AFTER the
   * fetch. A REST endpoint does not speak the platform's query language — a
   * declared engine's foreign API answers 400 to `filter=` — so the query is
   * never sent; it is applied here, once, the same way for every kind.
   */
  readonly query?: EntityQuery
}

/**
 * Cache configuration for data sources
 */
export interface DataCacheConfig {
  readonly enabled: boolean
  readonly ttl?: number
  readonly key?: string
}

/**
 * Retry configuration for data sources
 */
export interface DataRetryConfig {
  readonly maxAttempts: number
  readonly baseDelay: number
  readonly exponentialBackoff?: boolean
}

// ============================================================
// DATA RESOLVE CONTEXT
// ============================================================

/**
 * Context provided during data resolution
 */
export interface DataResolveContext {
  readonly params: Readonly<Record<string, unknown>>
  readonly signal?: AbortSignal
  readonly getState?: (key: string) => unknown
}

// ============================================================
// DATA FETCH OPTIONS
// ============================================================

/**
 * Options for fetching data
 */
export interface DataFetchOptions {
  readonly params?: Readonly<Record<string, unknown>>
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: unknown
  /**
   * Overrides the source's own method for this call — a form writing to a
   * source it also reads from. The source declares how it is READ; a write is
   * a different verb against the same address.
   */
  readonly method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /**
   * Address ONE record of the collection the source reads: the request goes
   * to `<endpoint>/<recordId>`. A form updating the row it loaded needs this;
   * a PATCH to the collection path is a request nobody answers.
   */
  readonly recordId?: string
  readonly signal?: AbortSignal
  readonly skipCache?: boolean
  readonly timeout?: number
}

// ============================================================
// DATA FETCH RESULT
// ============================================================

/**
 * Result of a data fetch operation
 */
export type DataFetchResult<T> =
  | { readonly success: true; readonly data: T; readonly metadata: DataFetchMetadata }
  | { readonly success: false; readonly error: DataFetchError }

/**
 * Metadata about a successful data fetch
 */
export interface DataFetchMetadata {
  readonly duration: number
  readonly fromCache: boolean
  /** HTTP status of a `rest` / `graphql` answer. */
  readonly status?: number
  readonly timestamp: number
  /**
   * The rest of the response body when `returns` plucked the list out of it —
   * DummyJSON's `{ products, total, skip, limit }` gives
   * `{ total, skip, limit }`. Without it a paginated list could not know how
   * many rows exist. Absent when there is no `returns` or the body is not an
   * object.
   */
  readonly envelope?: Readonly<Record<string, unknown>>
}

/**
 * Error from a data fetch operation
 */
export interface DataFetchError {
  readonly type: 'network' | 'timeout' | 'validation' | 'transform' | 'not_found' | 'unknown'
  /**
   * The server's own message when its refusal carried one
   * (`{ error: { code, message } }`), else the HTTP status line.
   */
  readonly message: string
  readonly status?: number
  /** The server's error code (`NOT_FOUND`, `VALIDATION_FAILED`, …) when it sent one. */
  readonly code?: string
  readonly cause?: unknown
}

// ============================================================
// DATA BINDING
// ============================================================

/**
 * Binding between a data source and a surface element
 */
export interface DataBinding<T = unknown> {
  readonly id: string
  readonly sourceId: string
  readonly targetPath: string
  readonly transform?: (data: T) => unknown
  readonly autoRefresh?: boolean
}

/**
 * Data binding state
 */
export type DataBindingState = 'idle' | 'loading' | 'loaded' | 'error' | 'stale'

/**
 * Live data binding with current state and subscription
 */
export interface LiveDataBinding<T = unknown> {
  readonly binding: DataBinding<T>
  readonly state: DataBindingState
  readonly data: T | undefined
  readonly error: DataFetchError | undefined
  refresh(): Promise<DataFetchResult<T>>
  subscribe(listener: DataBindingListener<T>): () => void
}

/**
 * Listener for data binding changes
 */
export type DataBindingListener<T> = (data: T | undefined, state: DataBindingState) => void

// ============================================================
// DATA SERVICE CONFIG
// ============================================================

/**
 * Configuration for DataService instances.
 * Can be provided by the capability registry or directly.
 */
export interface DataServiceConfig {
  readonly defaultCacheTtl?: number
  readonly maxRetries?: number
  readonly timeout?: number
  /**
   * resolves the live token for a source's
   * `authProviderRef`. Supplied by the host (the runner hands over the same
   * PKCE bridge the engine registry is constructed with). Absent, every
   * request goes out unauthenticated, exactly as before.
   */
  readonly getAccessToken?: (ref?: string) => Promise<string | null>
  /**
   * The platform's own API origin — and ONLY requests to it carry credentials.
   *
   * The platform store is a REST resource like any other, so it goes through
   * the same engine; the one thing that differs is that it authenticates by
   * cookie. `credentials` is therefore decided by origin, never by default:
   * `'same-origin'` is what fetch does on its own, and a published app served
   * at `<slug>.apps.example.com` calling `api.example.com` is cross-origin, so
   * the default would silently drop the cookie. Absent, nothing is ever sent
   * anywhere — a cookie must never leak to a third party's endpoint.
   */
  readonly platformApiOrigin?: string
}

// ============================================================
// DATA SERVICE INTERFACE
// ============================================================

/**
 * Service interface for managing data sources and bindings.
 *
 * Renamed from DataCapability to avoid overloading "capability" —
 * this is a service, not a registry capability declaration.
 */
export interface DataServiceInterface {
  registerSource<T>(definition: DataSourceDefinition<T>): void
  resolveDataSource(sourceId: string): DataSourceDefinition | undefined
  hasSource(sourceId: string): boolean
  fetchData<T>(sourceId: string, options?: DataFetchOptions): Promise<DataFetchResult<T>>
  bindData<T>(binding: DataBinding<T>): LiveDataBinding<T>
  unregisterSource(sourceId: string): boolean
  getSourceIds(): readonly string[]
  clear(): void
}

/**
 * @deprecated Use DataServiceInterface instead
 */
export type DataCapability = DataServiceInterface
