/**
 * Data Service (formerly Data Capability Manager)
 *
 * Default implementation of the data service
 *
 * Provides data source registration, resolution, fetch with caching,
 * and live data bindings for surfaces.
 *
 * @module @pwfabric/runtime/data/manager
 */

import { applyEntityQuery } from '../entity/apply-query.js'
import type {
  DataServiceInterface,
  DataServiceConfig,
  DataSourceDefinition,
  DataFetchOptions,
  DataFetchResult,
  DataFetchError,
  DataFetchMetadata,
  DataBinding,
  LiveDataBinding,
  DataBindingState,
  DataBindingListener,
  DataResolveContext,
} from './types.js'

// ============================================================
// CACHE ENTRY
// ============================================================

interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
}

// ============================================================
// DATA SERVICE
// ============================================================

/**
 * The list, out of whatever the endpoint wrapped it in.
 *
 * `returns` names the property holding the array — `data` for ours,
 * `products` for DummyJSON, absent when the body already IS the array. Three
 * shapes were in circulation and the binding context received whichever one
 * came back, so a block bound to a list could not take all three.
 *
 * A named path that is not there THROWS rather than yielding undefined: a
 * silently empty panel is the failure this field exists to end, and "the
 * endpoint answered, but not with what the plan said" is a sentence the user
 * can act on.
 */
function isPlatformOrigin(url: string, platformApiOrigin: string | undefined): boolean {
  if (!platformApiOrigin) return false
  try {
    // A relative endpoint is same-document, which is our own by definition.
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return true
    return new URL(url).origin === new URL(platformApiOrigin).origin
  } catch {
    return false
  }
}

/**
 * What a non-OK response says about itself: `{ error: { code, message } }`
 * when it is our API (or anyone keeping the same envelope), nothing when the
 * body is absent, not JSON, or not that shape. Never throws — a refusal
 * without a readable body is still a refusal with a status.
 */
async function readRefusal(response: Response): Promise<{ code?: string; message?: string }> {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } } | null
    const error = body?.error
    if (!error || typeof error !== 'object') return {}
    return {
      ...(typeof error.code === 'string' ? { code: error.code } : {}),
      ...(typeof error.message === 'string' && error.message ? { message: error.message } : {}),
    }
  } catch {
    return {}
  }
}

function pluck(body: unknown, path: string | undefined): unknown {
  if (!path) return body
  let node: unknown = body
  for (const key of path.split('.')) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new Error(`Response has no '${path}' — nothing at '${key}'`)
    }
    node = (node as Record<string, unknown>)[key]
  }
  if (node === undefined) throw new Error(`Response has no '${path}'`)
  return node
}

/**
 * What `returns` left behind: the body's top-level fields other than the one
 * the rows were plucked from. `{ products, total, skip, limit }` with
 * `returns: "products"` → `{ total, skip, limit }`; with `returns: "data.items"`
 * every top-level field except `data`.
 */
function envelopeOf(body: unknown, path: string | undefined): Record<string, unknown> | undefined {
  if (!path || !body || typeof body !== 'object' || Array.isArray(body)) return undefined
  const head = path.split('.')[0] ?? path
  const rest: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (k !== head) rest[k] = v
  }
  return rest
}

/** A REST answer on its way out of `executeFetch`: rows plus what came with them. */
class RestAnswer {
  constructor(
    readonly data: unknown,
    readonly status: number,
    readonly envelope: Record<string, unknown> | undefined
  ) {}
}

/**
 * Default implementation of the DataServiceInterface.
 *
 * Accepts optional DataServiceConfig for default cache TTL, retry, and timeout.
 */
export class DataService implements DataServiceInterface {
  private readonly sources = new Map<string, DataSourceDefinition>()
  private readonly cache = new Map<string, CacheEntry<unknown>>()
  private readonly bindings = new Map<string, DefaultLiveDataBinding<unknown>>()
  readonly config: DataServiceConfig

  constructor(config?: DataServiceConfig) {
    this.config = config ?? {}
  }

  registerSource<T>(definition: DataSourceDefinition<T>): void {
    if (this.sources.has(definition.id)) {
      throw new Error(`Data source '${definition.id}' is already registered`)
    }
    this.sources.set(definition.id, definition as DataSourceDefinition)
  }

  resolveDataSource(sourceId: string): DataSourceDefinition | undefined {
    return this.sources.get(sourceId)
  }

  hasSource(sourceId: string): boolean {
    return this.sources.has(sourceId)
  }

  async fetchData<T>(sourceId: string, options?: DataFetchOptions): Promise<DataFetchResult<T>> {
    const source = this.sources.get(sourceId)
    if (!source) {
      return {
        success: false,
        error: {
          type: 'not_found',
          message: `Data source '${sourceId}' not found`,
        },
      }
    }

    // A write is never answered from the read cache, and never fills it: the
    // record a POST returns is not the list a reader asked for.
    const isWrite = (options?.method ?? source.method ?? 'GET') !== 'GET'

    // Check cache
    if (!isWrite && !options?.skipCache && source.cache?.enabled) {
      const cacheKey = source.cache.key ?? `data:${sourceId}`
      const cached = this.getFromCache<T>(cacheKey)
      if (cached !== undefined) {
        return {
          success: true,
          data: cached,
          metadata: {
            duration: 0,
            fromCache: true,
            timestamp: Date.now(),
          },
        }
      }
    }

    const startTime = Date.now()

    try {
      const fetched = await this.executeFetch(source, options)
      // A REST answer carries its status and envelope beside the rows.
      const rawData = fetched instanceof RestAnswer ? fetched.data : fetched
      const data = source.transform ? source.transform(rawData) : rawData

      const duration = Date.now() - startTime
      const metadata: DataFetchMetadata = {
        duration,
        fromCache: false,
        timestamp: Date.now(),
        ...(fetched instanceof RestAnswer
          ? { status: fetched.status, ...(fetched.envelope ? { envelope: fetched.envelope } : {}) }
          : {}),
      }

      // Store in cache — use source-level TTL, fall back to service config, then default
      if (!isWrite && source.cache?.enabled) {
        const cacheKey = source.cache.key ?? `data:${sourceId}`
        const ttl =
          source.cache.ttl ??
          (this.config.defaultCacheTtl ? this.config.defaultCacheTtl * 1000 : 60_000)
        this.setCache(cacheKey, data, ttl)
      }

      return { success: true, data: data as T, metadata }
    } catch (err) {
      const duration = Date.now() - startTime
      const error = this.toFetchError(err, duration)
      return { success: false, error }
    }
  }

  bindData<T>(binding: DataBinding<T>): LiveDataBinding<T> {
    const liveBinding = new DefaultLiveDataBinding<T>(binding, this)
    this.bindings.set(binding.id, liveBinding as DefaultLiveDataBinding<unknown>)
    return liveBinding
  }

  unregisterSource(sourceId: string): boolean {
    if (!this.sources.has(sourceId)) {
      return false
    }
    this.sources.delete(sourceId)
    // Invalidate cache
    const cacheKey = `data:${sourceId}`
    this.cache.delete(cacheKey)
    return true
  }

  getSourceIds(): readonly string[] {
    return Array.from(this.sources.keys())
  }

  clear(): void {
    this.sources.clear()
    this.cache.clear()
    for (const binding of this.bindings.values()) {
      binding.dispose()
    }
    this.bindings.clear()
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private async executeFetch(
    source: DataSourceDefinition,
    options?: DataFetchOptions
  ): Promise<unknown> {
    switch (source.kind) {
      case 'static':
        return source.staticData

      case 'state': {
        const context: DataResolveContext = {
          params: options?.params ?? {},
          ...(options?.signal ? { signal: options.signal } : {}),
        }
        if (source.compute) {
          return source.compute(context)
        }
        return source.staticData
      }

      case 'computed': {
        if (!source.compute) {
          throw new Error(`Computed data source '${source.id}' has no compute function`)
        }
        const context: DataResolveContext = {
          params: options?.params ?? {},
          ...(options?.signal ? { signal: options.signal } : {}),
        }
        return source.compute(context)
      }

      case 'rest': {
        if (!source.endpoint) {
          throw new Error(`REST data source '${source.id}' has no endpoint`)
        }
        return this.fetchRest(source, options)
      }

      case 'graphql': {
        if (!source.endpoint) {
          throw new Error(`GraphQL data source '${source.id}' has no endpoint`)
        }
        return this.fetchRest(source, options)
      }

      default:
        throw new Error(`Unknown data source kind: ${source.kind}`)
    }
  }

  private async fetchRest(
    source: DataSourceDefinition,
    options?: DataFetchOptions
  ): Promise<unknown> {
    const collection = source.endpoint as string
    // One record of the collection, when the call names it. The source's
    // address is the collection; `<collection>/<id>` is how the platform (and
    // every REST API worth the name) addresses a row of it.
    const url =
      options?.recordId !== undefined
        ? `${collection.replace(/\/+$/, '')}/${encodeURIComponent(options.recordId)}`
        : collection
    // A write uses the same address with a different verb — the source says
    // how it is read, the call says what it is doing.
    const method = options?.method ?? source.method ?? 'GET'
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...source.headers,
      ...options?.headers,
    }

    // call it AS THE SIGNED-IN USER.
    //
    // Resolved per request and never cached: a delegated token expires within
    // the hour, and a value held here would be the beginning of a credential
    // living somewhere it can be serialised. A resolver that answers null
    // sends the request WITHOUT the header — the server's own 401 is a truer
    // error than a client-side guess, and it is what a panel's `errorWhen`
    // already renders.
    if (source.authProviderRef && this.config.getAccessToken) {
      const token = await this.config.getAccessToken(source.authProviderRef)
      if (token) headers['Authorization'] = `Bearer ${token}`
    }

    const timeout = options?.timeout ?? this.config.timeout

    const requestInit: RequestInit = {
      method,
      headers,
      // Explicit on both sides. Our own API authenticates by cookie and is
      // cross-origin from a published app, so it needs `include`; anyone
      // else's endpoint must never receive one, and leaving this to fetch's
      // `'same-origin'` default would be a decision nobody wrote down.
      credentials: isPlatformOrigin(url, this.config.platformApiOrigin) ? 'include' : 'omit',
      ...(options?.signal ? { signal: options.signal } : {}),
    }

    if (options?.body && method !== 'GET') {
      requestInit.body = JSON.stringify(options.body)
    }

    // Apply timeout if configured and no external signal provided
    if (timeout && !options?.signal) {
      requestInit.signal = AbortSignal.timeout(timeout)
    }

    const response = await fetch(url, requestInit)

    if (!response.ok) {
      // The server's own words travel with the refusal. Our API answers
      // `{ error: { code, message } }`; anyone else's body is read the same
      // way and ignored when it is not that shape. Before this the body was
      // dropped, and a form could only report "it failed" and guess why.
      const refusal = await readRefusal(response)
      const error = new Error(refusal.message ?? `HTTP ${response.status}: ${response.statusText}`)
      ;(error as Error & { status: number }).status = response.status
      if (refusal.code) (error as Error & { code: string }).code = refusal.code
      throw error
    }

    const body: unknown = await response.json()
    const rows = pluck(body, source.returns)
    // Filter / sort / pagination are not sent (the endpoint does not speak
    // them), so they are applied here: otherwise a REST source that declared
    // `filter: status eq open` would show every row.
    const data =
      source.query && Array.isArray(rows) ? applyEntityQuery(rows as Record<string, unknown>[], source.query).items : rows
    return new RestAnswer(data, response.status, envelopeOf(body, source.returns))
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    const elapsed = Date.now() - entry.timestamp
    if (elapsed > entry.ttl) {
      this.cache.delete(key)
      return undefined
    }

    return entry.data as T
  }

  private setCache(key: string, data: unknown, ttl: number): void {
    this.cache.set(key, { data, timestamp: Date.now(), ttl })
  }

  private toFetchError(err: unknown, _duration?: number): DataFetchError {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        return { type: 'timeout', message: 'Request was aborted', cause: err }
      }
      if (err.message.includes('timeout')) {
        return { type: 'timeout', message: err.message, cause: err }
      }
      const status = (err as Error & { status?: number }).status
      if (status) {
        const code = (err as Error & { code?: string }).code
        return {
          type: 'network',
          message: err.message,
          status,
          ...(code ? { code } : {}),
          cause: err,
        }
      }
      return { type: 'unknown', message: err.message, cause: err }
    }
    return { type: 'unknown', message: String(err), cause: err }
  }
}

// ============================================================
// DEFAULT LIVE DATA BINDING
// ============================================================

/**
 * Default live data binding implementation
 */
class DefaultLiveDataBinding<T> implements LiveDataBinding<T> {
  readonly binding: DataBinding<T>

  private _state: DataBindingState = 'idle'
  private _data: T | undefined = undefined
  private _error: DataFetchError | undefined = undefined
  private readonly listeners = new Set<DataBindingListener<T>>()
  private readonly service: DataService

  constructor(binding: DataBinding<T>, service: DataService) {
    this.binding = binding
    this.service = service
  }

  get state(): DataBindingState {
    return this._state
  }

  get data(): T | undefined {
    return this._data
  }

  get error(): DataFetchError | undefined {
    return this._error
  }

  async refresh(): Promise<DataFetchResult<T>> {
    this.updateState('loading', this._data, undefined)

    const result = await this.service.fetchData<T>(this.binding.sourceId)

    if (result.success) {
      const transformed = this.binding.transform
        ? (this.binding.transform(result.data) as T)
        : result.data
      this.updateState('loaded', transformed, undefined)
    } else {
      this.updateState('error', this._data, result.error)
    }

    return result
  }

  subscribe(listener: DataBindingListener<T>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  dispose(): void {
    this.listeners.clear()
    this._data = undefined
    this._error = undefined
    this._state = 'idle'
  }

  private updateState(
    state: DataBindingState,
    data: T | undefined,
    error: DataFetchError | undefined
  ): void {
    this._state = state
    this._data = data
    this._error = error
    this.notifyListeners()
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this._data, this._state)
      } catch {
        // Swallow listener errors to prevent cascading failures
      }
    }
  }
}

// ============================================================
// BACKWARD COMPATIBILITY
// ============================================================

/**
 * @deprecated Use DataService instead
 */
export const DefaultDataCapability = DataService

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a DataService instance with optional config
 */
export function createDataService(config?: DataServiceConfig): DataServiceInterface {
  return new DataService(config)
}

/**
 * @deprecated Use createDataService instead
 */
export function createDataCapability(): DataServiceInterface {
  return new DataService()
}
