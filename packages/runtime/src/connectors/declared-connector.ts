/**
 * build an engine from its DECLARATION.
 *
 * A REST engine is not a class. A class has a call signature, and a
 * hand-written engine that takes one options object where the runtime passes
 * two positional arguments ends up asking SharePoint for `lists/undefined`.
 * A declaration has no signature to get wrong.
 *
 * WHAT THIS MODULE IS ALLOWED TO KNOW: how to turn seven declared facts into
 * an `HttpEntityConnector`. It must not know a vendor's name, and the
 * placement test measures exactly that — no provider name anywhere in
 * `packages/runtime`. Everything SharePoint-shaped lives in the declaration,
 * which lives in the pack that ships the connector.
 *
 * WHAT THE BASE DOES NOT LEARN. `entityPathMapper` and `responseMapper` stay
 * plain functions on `HttpConnectorConfig`; this builds them. The pre-flight —
 * Graph cannot address a list before its site id is resolved — is handled by
 * constructing ONE base per resolved binding, so the mapper stays synchronous.
 * Making it asynchronous would teach a shared contract one vendor's
 * addressing dance.
 *
 * @module @pwfabric/runtime/connectors/declared-connector
 */

import type { EngineDeclaration } from '@pwfabric/contracts'

import { HttpEntityConnector } from '../entity/http-connector.js'
import type {
  ConnectorQueryResult,
  ConnectorResult,
  EntityConnector,
} from '../entity/connector.js'
import type { EntityInstanceId, EntityQuery, EntityTypeId } from '../entity/types.js'
import { applyEntityQuery } from '../entity/apply-query.js'

// ============================================================
// VALUE TRANSFORMS — a CLOSED registry
// ============================================================

/**
 * The only value transforms a declaration may name.
 *
 * CLOSED ON PURPOSE. A declaration carries a NAME, never a function — the
 * moment it could carry a function it would be a class again with extra steps,
 * and an AI-written declaration would regain the power to get something wrong.
 * An unknown name throws at construction (see `resolveTransform`) rather than
 * passing values through unchanged, because a silently skipped transform looks
 * exactly like a field the source never sent.
 *
 * These two are named for what they DO, not for who needs them: the runtime
 * must not learn a vendor's name.
 */
export const VALUE_TRANSFORMS: Readonly<Record<string, (value: unknown) => unknown>> = {
  /**
   * A field whose value is a JSON STRING describing a hosted file becomes the
   * absolute URL. Image/Thumbnail-typed columns serialise this way and a
   * consumer binding it into an `image` block needs a real URL.
   */
  'hosted-file-url': (value) => {
    if (typeof value !== 'string' || !value.startsWith('{')) return value
    try {
      const parsed = JSON.parse(value) as { serverUrl?: string; serverRelativeUrl?: string }
      return parsed.serverUrl && parsed.serverRelativeUrl
        ? `${parsed.serverUrl}${parsed.serverRelativeUrl}`
        : value
    } catch {
      return value
    }
  },
  /**
   * A numeric string becomes a number. Form data yields strings only, while
   * lookup-style columns are typed numeric by the API.
   */
  'numeric-string': (value) =>
    typeof value === 'string' && value !== '' && !Number.isNaN(Number(value)) ? Number(value) : value,
}

function resolveTransform(use: string): (value: unknown) => unknown {
  const fn = VALUE_TRANSFORMS[use]
  if (!fn) {
    throw new Error(
      `engine declaration names an unknown transform "${use}" — known: ${Object.keys(VALUE_TRANSFORMS).join(', ')}`
    )
  }
  return fn
}

// ============================================================
// TEMPLATE
// ============================================================

/** `{name}` substitution. An unbound placeholder is left visible, not blanked. */
function fill(template: string, bindings: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => bindings[key] ?? whole)
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, source)
}

// ============================================================
// THE ORIGIN — https, except an explicit http:// on loopback
// ============================================================

/** Hosts a declaration may reach over plain `http://`: the machine itself. */
function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')
}

/**
 * The origin a filled declared host resolves to.
 *
 * - no scheme or `https://` → `https://<host>` (unchanged since the first release);
 * - `http://` on a loopback host (`localhost`, `127.0.0.1`, `[::1]`,
 *   `*.localhost`) → kept as `http://<host>`, so a development server is reachable;
 * - `http://` anywhere else → `https://<host>`, as every release before
 *   this one did. It is never downgraded (the visitor's token must not cross
 *   the network in clear text), and published apps whose connection holds an
 *   `http://` address keep working the way they always have.
 */
function declaredOrigin(filledHost: string): { readonly origin: string } {
  const plain = /^http:\/\//i.exec(filledHost)
  if (!plain) return { origin: `https://${filledHost.replace(/^https?:\/\//i, '')}` }
  const rest = filledHost.slice(plain[0].length)
  let hostname = ''
  try {
    hostname = new URL(`http://${rest}`).hostname
  } catch {
    hostname = ''
  }
  if (hostname && isLoopbackHost(hostname)) return { origin: `http://${rest}` }
  return { origin: `https://${rest}` }
}

// ============================================================
// THE ENGINE
// ============================================================

export interface DeclaredConnectorOptions {
  /** Connection name — the engine reports it, and the registry keys on it. */
  readonly name: string
  readonly declaration: EngineDeclaration
  /** Per-connection config the declaration's templates draw on. */
  readonly config: Readonly<Record<string, unknown>>
  readonly getAccessToken: () => Promise<string | null>
}

export function createDeclaredConnector(options: DeclaredConnectorOptions): EntityConnector {
  const { name, declaration: d, config, getAccessToken } = options

  // Fail at construction, not at the first read: a declaration naming a
  // transform nobody implements is broken whether or not anyone calls it.
  const transforms = (d.transforms ?? []).map((t) => ({ field: t.field, fn: resolveTransform(t.use) }))

  const stringConfig: Record<string, string> = {}
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string') stringConfig[k] = v
  }

  /**
   * THE HOST IS A TEMPLATE — the one substitution a user-owned API cannot do
   * without, and the one this function used to compute before the config it
   * would have drawn on even existed.
   *
   * `graph.microsoft.com/v1.0` is a constant because Graph is one address for
   * everyone. A connection to the user's OWN API has no constant to state: the
   * address IS the thing the user supplies. `host: "{baseUrl}"` is how they
   * supply it, and the scheme is stripped after filling so a pasted
   * `https://api.example.com` and a bare `api.example.com` mean the same thing.
   *
   * An explicit `http://` survives ONLY for a loopback host — a development
   * server on `http://127.0.0.1:8787` is otherwise unreachable. Anywhere else
   * `http://` is upgraded to https, as before: see {@link declaredOrigin}.
   */
  const declared = declaredOrigin(fill(d.host, stringConfig))
  const origin = declared.origin

  /**
   * THE READ PATHS ARE TEMPLATES TOO — and that is what makes a generic REST
   * connection declarable rather than compiled.
   *
   * If `fill` reached only `resolve.path` and `path`, the RESPONSE SHAPE would
   * have to be hardcoded into the declaration: an API answering `{data:[…]}`
   * and one answering `{results:[…]}` would need two different atoms. Two
   * atoms that differ only in a string is code wearing a manifest, and the
   * declared-engine design's whole claim is that "a new API is a connection
   * record rather than code".
   *
   * `fill` on a string carrying no `{name}` returns that string, so a
   * declaration without templates behaves as a literal one. `graph-lists`
   * is the proof and has a test that says so.
   */
  const readItems = fill(d.read.items, stringConfig)
  const readId = fill(d.read.id, stringConfig)
  const readFlatten = d.read.flatten === undefined ? undefined : fill(d.read.flatten, stringConfig)

  const authHeaders = async (): Promise<Record<string, string>> => {
    if (d.auth.type !== 'bearer') return {}
    const token = await getAccessToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  /** Pre-flight, memoised per template result — the site id and its kin. */
  const bindings = new Map<string, Promise<Record<string, string>>>()
  function resolveBindings(extra: Readonly<Record<string, string>>): Promise<Record<string, string>> {
    const base = { ...stringConfig, ...extra }
    if (!d.resolve) return Promise.resolve(base)
    const url = origin + fill(d.resolve.path, base)
    let pending = bindings.get(url)
    if (!pending) {
      pending = authHeaders()
        .then((headers) => fetch(url, { headers }))
        .then((res) => res.json())
        .then((body: unknown) => {
          const value = readPath(body, d.resolve!.field)
          if (typeof value !== 'string') {
            throw new Error(`engine pre-flight ${url} carried no "${d.resolve!.field}"`)
          }
          return { ...base, [d.resolve!.as]: value }
        })
        .catch((err: unknown) => {
          bindings.delete(url)
          throw err
        })
      bindings.set(url, pending)
    }
    return pending
  }

  function applyTransforms(row: Record<string, unknown>): Record<string, unknown> {
    if (transforms.length === 0) return row
    const out = { ...row }
    for (const { field, fn } of transforms) {
      if (field in out) out[field] = fn(out[field])
    }
    return out
  }

  function mapRow(raw: unknown): Record<string, unknown> {
    const item = (raw ?? {}) as Record<string, unknown>
    const row: Record<string, unknown> = { id: readPath(item, readId) }
    for (const key of d.read.lift ?? []) {
      const v = readPath(item, key)
      if (v !== undefined) row[key] = v
    }
    /**
     * `flatten: "*"` means THE ITEM ITSELF IS THE BAG.
     *
     * `mapRow` starts from `{ id }` and only grows when `flatten` names a
     * nested bag. Graph's bag is `fields`; flat REST has no bag because the
     * item is already the row — so without this a plain REST read produced
     * rows carrying nothing but `id`, and the panels rendered empty for a
     * reason no warning named.
     *
     * `"*"` is spelled out rather than inferred from an absent `flatten`:
     * inferring it would silently change what every existing declaration
     * means, and a fallback nobody declared is how this family of bugs got
     * here. It is also not a valid `readPath`, so it can never collide with a
     * real path. The schema is untouched — it already accepts any non-empty
     * string, so contracts stay frozen.
     */
    const bag = readFlatten === '*' ? item : readFlatten ? readPath(item, readFlatten) : undefined
    if (bag && typeof bag === 'object') Object.assign(row, bag as Record<string, unknown>)
    return applyTransforms(row)
  }

  /** One base per resolved binding set — the site is already inside baseUrl. */
  const bases = new Map<string, Promise<HttpEntityConnector>>()
  function baseFor(extra: Readonly<Record<string, string>>): Promise<HttpEntityConnector> {
    const key = JSON.stringify(extra)
    let pending = bases.get(key)
    if (!pending) {
      pending = resolveBindings(extra)
        .then(
          (bound) =>
            new HttpEntityConnector(name, {
              baseUrl: origin,
              // Synchronous: every binding is already resolved into the string.
              entityPathMapper: (entityType) => fill(d.path, { ...bound, entityType: String(entityType) }),
              ...(d.params ? { defaultQueryParams: d.params } : {}),
              // `none` means no credential at all: the visitor's token must never reach
              // a host that did not ask for it, so no auth config is passed.
              ...(d.auth.type === 'none' ? {} : { auth: { type: d.auth.type, token: getAccessToken } }),
              responseMapper: (raw) => {
                const items = readPath(raw, readItems)
                return { items: Array.isArray(items) ? items.map(mapRow) : [] }
              },
            })
        )
        .catch((err: unknown) => {
          bases.delete(key)
          throw err
        })
      bases.set(key, pending)
    }
    return pending
  }

  /** A query may name its own binding overrides (e.g. a different site). */
  function overridesFrom(query: EntityQuery | undefined): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries((query ?? {}) as Record<string, unknown>)) {
      if (typeof v === 'string' && k in stringConfig) out[k] = v
    }
    return out
  }

  return {
    name,
    type: 'custom' as const,

    async query(entityType: EntityTypeId, query: EntityQuery): Promise<ConnectorQueryResult> {
      try {
        const base = await baseFor(overridesFrom(query))
        // A declared engine talks to a FOREIGN API. The base connector would
        // serialise the surface's query as the platform's own wire params —
        // `filter=<json>&sort=&limit=&offset=` — which mean nothing there:
        // Microsoft Graph answers 400 to any list read carrying `filter=`
        // (sort-only reads happen to pass, so half the pages would be live and
        // half fallback). Fetch with the declaration's own params only and apply the query
        // here, where every declared engine speaks the same query language.
        const res = await base.query(entityType, {})
        if (!res.success) return res
        return { success: true, result: applyEntityQuery(res.result.items, query) }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'engine query failed' }
      }
    },

    async read(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
      const result = await this.query(entityType, {})
      if (!result.success) return { success: false, error: result.error }
      const match = result.result.items.find((i) => (i as { id?: unknown }).id === instanceId)
      return match ? { success: true, data: match } : { success: false, error: 'Not found' }
    },

    async create(entityType: EntityTypeId, data: Record<string, unknown>): Promise<ConnectorResult> {
      try {
        const base = await baseFor({})
        // The wrap belongs to the LAYER: the base posts whatever it is handed,
        // and the declaration says what shape to hand it.
        const body = d.write?.bodyWrap ? { [d.write.bodyWrap]: applyTransforms(data) } : applyTransforms(data)
        const result = await base.create(entityType, body)
        return result.success ? { success: true, data: mapRow(result.data) } : result
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'engine create failed' }
      }
    },

    async update(): Promise<ConnectorResult> {
      return { success: false, error: 'declared engines do not support update yet' }
    },

    async delete(entityType: EntityTypeId, instanceId: EntityInstanceId): Promise<ConnectorResult> {
      try {
        const base = await baseFor({})
        return await base.delete(entityType, instanceId)
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'engine delete failed' }
      }
    },
  } as EntityConnector
}
