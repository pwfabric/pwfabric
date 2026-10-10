/**
 * Pages, pointed at the local host's records.
 *
 * A receipt declares its data as `entity` sources; with no `connector` the
 * runner would look for a connection named `graph-lists` that a local app does
 * not have. A publisher that hosts the app's records MAY rewrite such a
 * source into a `rest` source against its record endpoints (data-protocol
 * §2.2), and that is what this does for every source whose `entityType` the
 * app declares:
 *
 *   list       → { kind: "rest", method: "GET", endpoint: "<base>/records/<T>",
 *                  authProviderRef: "<base>", returns: "data", query? }
 *   aggregate  → the same, at "<base>/records/<T>/count" (a plain count) or
 *                "<base>/records/<T>/aggregate?fn=&field=&filter=", so the
 *                bound value is `{ fn, field?, value, count }` exactly as an
 *                entity aggregate binds it.
 *
 * `authProviderRef` equal to the base is what makes the runner attach the
 * visitor's session as a bearer token (session-protocol §7). Sources that name
 * a connector, or a type the app does not declare, are left as written.
 */

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const isPersistence = (c: unknown): boolean =>
  isObject(c) && (c.capability === 'persistence' || c.capability === 'platform/persistence')

function rewriteSource(source: unknown, base: string, declared: ReadonlySet<string>): unknown {
  if (!isObject(source) || source.kind !== 'entity') return source
  const type = source.entityType
  if (typeof type !== 'string' || !declared.has(type) || (typeof source.connector === 'string' && source.connector)) {
    return source
  }
  const { entityType: _t, connector: _c, aggregate, ...rest } = source
  const collection = `${base}/records/${encodeURIComponent(type)}`
  let endpoint = collection
  if (isObject(aggregate)) {
    const fn = typeof aggregate.fn === 'string' ? aggregate.fn : 'count'
    const field = typeof aggregate.field === 'string' && aggregate.field ? aggregate.field : undefined
    const params = new URLSearchParams()
    if (fn !== 'count' || field) {
      params.set('fn', fn)
      if (field) params.set('field', field)
    }
    if (isObject(aggregate.filter)) params.set('filter', JSON.stringify(aggregate.filter))
    const route = fn === 'count' && !field ? 'count' : 'aggregate'
    const qs = params.toString()
    endpoint = `${collection}/${route}${qs ? `?${qs}` : ''}`
  }
  return { ...rest, kind: 'rest', method: 'GET', endpoint, authProviderRef: base, returns: 'data' }
}

/** A copy of `receipt` whose declared entity sources read from `base`. Non-mutating. */
export function rewriteEntitySources(receipt: Json, base: string, declared: ReadonlySet<string>): Json {
  const caps = receipt.capabilities
  if (!Array.isArray(caps)) return receipt
  return {
    ...receipt,
    capabilities: caps.map((cap) => {
      if (!isPersistence(cap)) return cap
      const c = cap as Json
      const config = isObject(c.config) ? c.config : undefined
      if (!config || !Array.isArray(config.dataSources)) return cap
      return {
        ...c,
        config: { ...config, dataSources: config.dataSources.map((s) => rewriteSource(s, base, declared)) },
      }
    }),
  }
}
