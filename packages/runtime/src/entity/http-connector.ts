/**
 * HTTP Entity Connector
 *
 * REST API connector for entity data persistence and retrieval.
 * Implements the EntityConnector interface using fetch for HTTP communication.
 *
 * @module @pwfabric/runtime/entity/http-connector
 */

import { z } from 'zod'
import type {
  EntityTypeId,
  EntityInstanceId,
  EntityQuery,
  EntityAggregate,
  EntityAggregateResult,
} from './types.js'
import type {
  EntityConnector,
  EntityConnectorType,
  ConnectorResult,
  ConnectorQueryResult,
  ConnectorAggregateResult,
} from './connector.js'

// ============================================================
// CONFIGURATION
// ============================================================

/**
 * HTTP connector authentication configuration
 */
export interface HttpAuthConfig {
  readonly type: 'bearer' | 'api-key' | 'basic'
  /**
   * A fixed value, or a RESOLVER re-invoked on every request.
   *
   * A string or a resolver. A delegated PKCE token expires within about an
   * hour, so a fixed string cannot serve a session; an engine that needs a
   * live token passes a resolver instead of reimplementing the transport
   * (and losing retry, timeout and the result envelope on the way).
   *
   * A string is used as is; a resolver is awaited per request and its answer
   * is never cached here, which is the whole point.
   */
  readonly token?: string | (() => Promise<string | null>)
  readonly apiKey?: string
  readonly headerName?: string
  readonly username?: string
  readonly password?: string
}

/**
 * HTTP connector retry configuration
 */
export interface HttpRetryConfig {
  readonly maxRetries: number
  readonly baseDelay: number
  readonly maxDelay: number
  readonly retryableStatuses: readonly number[]
}

/**
 * HTTP connector configuration
 */
export interface HttpConnectorConfig {
  readonly baseUrl: string
  readonly headers?: Record<string, string>
  readonly timeout?: number
  readonly auth?: HttpAuthConfig
  /**
   * Fetch credentials mode. Set 'include' so cookie-authoritative APIs
   * receive the session cookie on cross-origin entity requests
   * the visitor facade has no bearer token to send.
   */
  readonly credentials?: RequestCredentials
  readonly retry?: HttpRetryConfig
  /**
   * Query parameters this API requires on every read.
   *
   * GENERIC, and the distinction matters because three vendor-shaped widenings
   * were proposed and reverted the same day. Azure wants `api-version`, plenty
   * of APIs want `format=json`, Graph wants `expand=fields`: "this endpoint
   * takes constant parameters" is a REST fact, not one provider's dance, and no
   * provider name appears here.
   *
   * It exists because the alternative is worse. A caller that put its constants
   * in `entityPathMapper` would produce `...?expand=fields?limit=50` the moment
   * a query carried pagination, and `...?expand=fields/1` on a delete — the URL
   * is assembled as `params ? url + '?' + params : url`.
   */
  readonly defaultQueryParams?: Readonly<Record<string, string>>
  readonly entityPathMapper?: (entityType: EntityTypeId) => string
  /**
   * Maps a vendor response body to the connector's query result shape
   * `entityPathMapper`'s response-side twin.
   *
   * `entityPathMapper` has always let a caller say how an entity type becomes a
   * URL path; nothing let it say how the answer comes back. So a vendor whose
   * body is its own shape — Graph replies `{ value: [{ id, fields }] }`, not
   * `{ items }` — could not use this class at all, and that was the other half
   * of why every Graph engine forked. Absent, the built-in shapes below apply
   * unchanged.
   */
  readonly responseMapper?: (raw: unknown) => { items: unknown[]; total?: number }
}

// ============================================================
// DEFAULTS
// ============================================================

const queryResponseSchema = z
  .object({
    items: z.array(z.unknown()).optional(),
    total: z.number().optional(),
    offset: z.number().optional(),
    limit: z.number().optional(),
  })
  .passthrough()

/**
 * `{ data: { fn, field?, value, count, numericCount? }, meta }` is how the
 * platform answers (`routes/app-records.ts`); a bare `{ value, count }` body
 * is accepted too. `value` is null when a numeric fn had nothing to reduce.
 */
const aggregateBodySchema = z
  .object({
    fn: z.enum(['count', 'sum', 'avg']).optional(),
    field: z.string().optional(),
    value: z.number().nullable().optional(),
    count: z.number().optional(),
  })
  .passthrough()

const DEFAULT_TIMEOUT = 30_000

const DEFAULT_RETRY: HttpRetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10_000,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
}

// ============================================================
// HTTP ENTITY CONNECTOR
// ============================================================

/**
 * HTTP/REST connector for entity data operations.
 * Maps entity CRUD operations to standard REST API endpoints.
 */
export class HttpEntityConnector implements EntityConnector {
  readonly name: string
  readonly type: EntityConnectorType = 'http'

  private readonly config: Required<Pick<HttpConnectorConfig, 'baseUrl' | 'timeout'>> &
    HttpConnectorConfig

  constructor(name: string, config: HttpConnectorConfig) {
    this.name = name
    this.config = {
      ...config,
      timeout: config.timeout ?? DEFAULT_TIMEOUT,
    }
  }

  async create(entityType: EntityTypeId, data: Record<string, unknown>): Promise<ConnectorResult> {
    const url = this.buildUrl(entityType)
    return this.request('POST', url, data)
  }

  async read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
    const url = `${this.buildUrl(entityType)}/${instanceId}`
    return this.request('GET', url)
  }

  async update(
    entityType: EntityTypeId,
    instanceId: EntityInstanceId,
    data: Record<string, unknown>
  ): Promise<ConnectorResult> {
    const url = `${this.buildUrl(entityType)}/${instanceId}`
    return this.request('PATCH', url, data)
  }

  async delete(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
    const url = `${this.buildUrl(entityType)}/${instanceId}`
    return this.request('DELETE', url)
  }

  async query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult> {
    const url = this.buildUrl(entityType)
    const params = this.buildQueryParams(query)
    const fullUrl = params ? `${url}?${params}` : url

    const result = await this.request('GET', fullUrl)
    if (!result.success) {
      return { success: false, error: result.error }
    }

    // A vendor shape is mapped BEFORE the built-in schema runs — the mapper
    // exists precisely for bodies this schema would reject, so validating first
    // would refuse the very responses it was added to accept.
    if (this.config.responseMapper) {
      const mapped = this.config.responseMapper(result.data)
      const items = mapped.items as Record<string, unknown>[]
      const total = mapped.total ?? items.length
      const offset = query.pagination?.offset ?? 0
      return {
        success: true,
        result: {
          items,
          total,
          offset,
          limit: query.pagination?.limit ?? items.length,
          hasMore: total > offset + items.length,
        },
      }
    }

    const parsed = queryResponseSchema.safeParse(result.data)
    if (!parsed.success) {
      return { success: false, error: 'Invalid query response shape' }
    }
    const data = parsed.data as Record<string, unknown>

    // Accept both the connector contract ({items,total}) and the platform
    // entity-records envelope ({data:[...], meta:{total}}).
    const rawItems = ((data.items as unknown[]) ??
      (data.data as unknown[]) ??
      []) as Record<string, unknown>[]
    // Entity records store user fields under `.data` — flatten them to the top
    // level so expression/column bindings ({{id}}, column key 'name') resolve
    // against the fields, while keeping id/metadata available.
    const items = rawItems.map((r) =>
      r && typeof r === 'object' && r.data && typeof r.data === 'object'
        ? { ...r, ...(r.data as Record<string, unknown>) }
        : r
    )
    const meta = data.meta as Record<string, unknown> | undefined
    const total = (data.total as number) ?? (meta?.total as number) ?? items.length

    return {
      success: true,
      result: {
        items,
        total,
        offset: (data.offset as number) ?? query.pagination?.offset ?? 0,
        limit: (data.limit as number) ?? query.pagination?.limit ?? 50,
        hasMore: total > ((data.offset as number) ?? 0) + items.length,
      },
    }
  }

  /**
   * One number over the collection, computed by the server.
   *
   * `GET <base>/<type>/count[?filter=]` for a plain count and
   * `GET <base>/<type>/aggregate?fn=&field=&filter=` for the rest — the two
   * routes a host registers ahead of the read-one route.
   * Constants (`defaultQueryParams`) and `entityPathMapper` apply as on
   * every other read.
   */
  async aggregate(entityType: EntityTypeId, aggregate: EntityAggregate): Promise<ConnectorAggregateResult> {
    const plainCount = aggregate.fn === 'count' && !aggregate.field
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(this.config.defaultQueryParams ?? {})) params.set(k, v)
    if (!plainCount) {
      params.set('fn', aggregate.fn)
      if (aggregate.field) params.set('field', aggregate.field)
    }
    if (aggregate.filter) params.set('filter', JSON.stringify(aggregate.filter))
    const url = `${this.buildUrl(entityType)}/${plainCount ? 'count' : 'aggregate'}`
    const qs = params.toString()

    const result = await this.request('GET', qs ? `${url}?${qs}` : url)
    if (!result.success) return { success: false, error: result.error }

    const envelope = result.data
    const body = envelope.data && typeof envelope.data === 'object' ? envelope.data : envelope
    const parsed = aggregateBodySchema.safeParse(body)
    if (!parsed.success) return { success: false, error: 'Invalid aggregate response shape' }
    const d = parsed.data
    const field = d.field ?? aggregate.field
    const out: EntityAggregateResult = {
      fn: d.fn ?? aggregate.fn,
      ...(field ? { field } : {}),
      value: d.value ?? null,
      count: d.count ?? 0,
    }
    return { success: true, result: out }
  }

  // ============================================================
  // PRIVATE HELPERS
  // ============================================================

  private buildUrl(entityType: EntityTypeId): string {
    const path = this.config.entityPathMapper
      ? this.config.entityPathMapper(entityType)
      : `/${entityType}`
    return `${this.config.baseUrl}${path}`
  }

  private buildQueryParams(query: EntityQuery): string {
    const params = new URLSearchParams()

    // Constants first so a caller's own query can still override one.
    for (const [k, v] of Object.entries(this.config.defaultQueryParams ?? {})) {
      params.set(k, v)
    }

    if (query.pagination) {
      params.set('offset', String(query.pagination.offset))
      params.set('limit', String(query.pagination.limit))
    }

    if (query.sort && query.sort.length > 0) {
      params.set('sort', query.sort.map((s) => `${s.field}:${s.direction}`).join(','))
    }

    if (query.filter) {
      params.set('filter', JSON.stringify(query.filter))
    }

    if (query.include && query.include.length > 0) {
      params.set('include', query.include.join(','))
    }

    return params.toString()
  }

  private async buildHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...this.config.headers,
    }

    if (this.config.auth) {
      const authHeader = await this.resolveAuthHeader(this.config.auth)
      if (authHeader) {
        Object.assign(headers, authHeader)
      }
    }

    return headers
  }

  private async resolveAuthHeader(auth: HttpAuthConfig): Promise<Record<string, string> | null> {
    switch (auth.type) {
      case 'bearer': {
        // Resolved per request, never cached — a session-length token is the
        // reason this accepts a function at all. A resolver that answers null
        // yields NO header: the server's own 401 is a truer error than a
        // client-side guess, and the panel's errorWhen already renders it.
        const token = typeof auth.token === 'function' ? await auth.token() : auth.token
        return token ? { Authorization: `Bearer ${token}` } : null
      }
      case 'api-key':
        return auth.apiKey ? { [auth.headerName ?? 'X-API-Key']: auth.apiKey } : null
      case 'basic':
        if (auth.username && auth.password) {
          const encoded = btoa(`${auth.username}:${auth.password}`)
          return { Authorization: `Basic ${encoded}` }
        }
        return null
      default:
        return null
    }
  }

  private async request(
    method: string,
    url: string,
    body?: Record<string, unknown>
  ): Promise<ConnectorResult> {
    const retryConfig = this.config.retry ?? DEFAULT_RETRY
    let lastError = ''

    for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

        const response = await fetch(url, {
          method,
          headers: await this.buildHeaders(),
          body: body ? JSON.stringify(body) : null,
          signal: controller.signal,
          ...(this.config.credentials ? { credentials: this.config.credentials } : {}),
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          if (
            attempt < retryConfig.maxRetries &&
            retryConfig.retryableStatuses.includes(response.status)
          ) {
            const delay = Math.min(
              retryConfig.baseDelay * Math.pow(2, attempt),
              retryConfig.maxDelay
            )
            await this.sleep(delay)
            continue
          }

          const errorBody = await response.text().catch(() => '')
          lastError = `HTTP ${response.status}: ${errorBody || response.statusText}`
          return { success: false, error: lastError }
        }

        if (method === 'DELETE' && response.status === 204) {
          return { success: true, data: {} }
        }

        const jsonData = await response.json()
        const data = z.record(z.unknown()).parse(jsonData)
        return { success: true, data }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)

        if (attempt < retryConfig.maxRetries) {
          const delay = Math.min(retryConfig.baseDelay * Math.pow(2, attempt), retryConfig.maxDelay)
          await this.sleep(delay)
          continue
        }
      }
    }

    return { success: false, error: lastError }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create an HTTP entity connector
 */
export function createHttpConnector(
  name: string,
  config: HttpConnectorConfig
): HttpEntityConnector {
  return new HttpEntityConnector(name, config)
}
