/**
 * An `entity` source that names no `connector` reads THE APP'S OWN RECORDS of
 * its `entityType` (data-protocol §2.2).
 *
 * The runner serves such a source from the app's record endpoints whenever it
 * knows the app's own API base (`ownApiBaseOf(auth)`, see api-base.ts):
 *
 *   list       → { kind: "rest", method: "GET", endpoint: "<base>/records/<T>",
 *                  authProviderRef: "<base>", returns: "data", query? }
 *   aggregate  → the same, at "<base>/records/<T>/count" (a plain count) or
 *                "<base>/records/<T>/aggregate?fn=&field=&filter=", so the
 *                bound value is `{ fn, field?, value, count }` exactly as an
 *                entity aggregate binds it.
 *
 * `authProviderRef` equal to the base is what makes the runner attach the
 * visitor's session as a bearer token (session-protocol §7). Without a base
 * nothing is rewritten and no facade is built for the source: it draws its
 * `fallback`, as any unserved source does. A source that names a connector is
 * left as written — a connection is used only when a source names it.
 *
 * KEPT IN STEP WITH `@pwfabric/cli`'s local host (`src/host/receipts.ts`),
 * which does the same rewrite for `pwf dev`. The two cannot share a module:
 * the runner ships as ONE browser file (`runner.js`) and the CLI's Node host
 * must not load it. `own-records.test.ts` pins both to the same output.
 *
 * Pure and non-mutating.
 */

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

const isPersistence = (c: unknown): boolean =>
  isObject(c) && (c.capability === 'persistence' || c.capability === 'platform/persistence')

/**
 * One source, rewritten to the record endpoint when it is a connector-less
 * entity source. `declared`, when given, limits the rewrite to those entity
 * types (a host that knows the app's model); absent, every such source is
 * rewritten.
 */
export function ownRecordsSource(source: unknown, base: string, declared?: ReadonlySet<string>): unknown {
  if (!isObject(source) || source.kind !== 'entity') return source
  const type = source.entityType
  if (typeof type !== 'string' || !type) return source
  if (declared && !declared.has(type)) return source
  if (typeof source.connector === 'string' && source.connector) return source
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

/**
 * The capabilities of a surface, with every connector-less entity source of
 * its persistence capability reading from `base`. Returns the input itself
 * when there is nothing to rewrite.
 */
export function ownRecordsCapabilities<T>(capabilities: T, base: string, declared?: ReadonlySet<string>): T {
  if (!Array.isArray(capabilities)) return capabilities
  return capabilities.map((cap: unknown) => {
    if (!isPersistence(cap)) return cap
    const c = cap as Json
    const config = isObject(c.config) ? c.config : undefined
    if (!config || !Array.isArray(config.dataSources)) return cap
    return {
      ...c,
      config: { ...config, dataSources: config.dataSources.map((s) => ownRecordsSource(s, base, declared)) },
    }
  }) as T
}

/** A copy of `receipt` whose connector-less entity sources read from `base`. Non-mutating. */
export function ownRecordsReceipt<R extends { capabilities?: unknown }>(
  receipt: R,
  base: string,
  declared?: ReadonlySet<string>
): R {
  if (!Array.isArray(receipt.capabilities)) return receipt
  return { ...receipt, capabilities: ownRecordsCapabilities(receipt.capabilities, base, declared) }
}
