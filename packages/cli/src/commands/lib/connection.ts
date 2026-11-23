/**
 * `pwf add connection <name>` — declare a connection to an outside API in
 * `app/definitions/connections.json` (definitions.md, connections.json; the
 * engine declaration of connector-manifest §3), and optionally a page source
 * that reads through it (data-protocol §2.2: an `entity` source naming the
 * connection as its `connector`).
 *
 * The app states WHERE the API is and the KIND of credential it takes, never
 * a credential: no key, token, password or header value is written, and an
 * origin that carries one (`user:pass@`, a query string) is refused. The key
 * itself is stored with whatever hosts the app.
 */
import { CommandFailure } from './failure.js'
import { UsageError } from './flags.js'
import { fileExists, isObject, readAppIdentity, readJsonObject, receiptRel, writeJsonFile, type JsonObject } from './app-files.js'

export const CONNECTIONS_FILE = 'app/definitions/connections.json'

/** The kinds of credential an engine declaration names (connector-manifest §3). */
export const CONNECTION_AUTH = ['bearer', 'api-key', 'basic', 'none'] as const
export type ConnectionAuth = (typeof CONNECTION_AUTH)[number]

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const SOURCE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const HEADER = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/
const FIELD_PATH = /^[A-Za-z0-9_$-]+(?:\.[A-Za-z0-9_$-]+)*$/
const LOOPBACK = (host: string): boolean => {
  const h = host.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')
}

export interface AddConnectionOptions {
  readonly name: string
  /** The API's address: `https://api.example.com/v1` (plain `http://` on a loopback host only). */
  readonly origin: string
  readonly auth: string
  /** With `api-key`: the header the host sends the key in. Never written to the app. */
  readonly header?: string
  /** Where the rows are in the API's answer (dotted path); default `data`. */
  readonly items?: string
  /** The row field that identifies a row; default `id`. */
  readonly id?: string
  /** With `source` and `path`: the page that reads through the connection. */
  readonly page?: string
  readonly source?: string
  /** The collection's path under the origin, `/bookings`. */
  readonly path?: string
}

export interface ConnectionAdded {
  readonly name: string
  readonly file: string
  /** The entry as written (or as it already stood, when `unchanged`). */
  readonly connection: JsonObject
  /** The same entry was declared already: the file was not touched. */
  readonly unchanged: boolean
  /** The page source written, when one was asked for. */
  readonly source?: { readonly page: string; readonly receipt: string; readonly id: string; readonly entityType: string }
  /** What to do next, line by line. */
  readonly next: readonly string[]
}

/** `config.baseUrl` for an origin: no scheme for https (the engine prepends it), the whole `http://…` on loopback. */
function baseUrlOf(origin: string): string {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    throw new UsageError(`--origin "${origin}" is not an address; give the API's https address, e.g. https://api.example.com/v1`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new CommandFailure('CONNECTION_SECRET', 'the origin carries a user name or password; a credential is never written to the app. Give the address alone and store the credential with the host that serves the app')
  }
  if (url.search !== '' || url.hash !== '') {
    throw new CommandFailure('CONNECTION_SECRET', 'the origin carries a query or fragment, where a key often hides; a credential is never written to the app. Give the address alone')
  }
  const loopback = LOOPBACK(url.hostname) || url.hostname === '[::1]'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new UsageError(`--origin must be an https address (plain http only on localhost): the engine sends a connection's requests over https`)
  }
  const rest = `${url.host}${url.pathname.replace(/\/+$/, '')}`
  return url.protocol === 'http:' ? `http://${rest}` : rest
}

/** The connection entry the options describe. */
export function connectionEntry(options: Pick<AddConnectionOptions, 'name' | 'origin' | 'auth' | 'items' | 'id'>): JsonObject {
  const items = options.items ?? 'data'
  const id = options.id ?? 'id'
  if (!FIELD_PATH.test(items)) throw new UsageError(`--items "${items}" is not a dotted path to the rows, e.g. data or payload.rows`)
  if (!FIELD_PATH.test(id)) throw new UsageError(`--id "${id}" is not a field name`)
  return {
    name: options.name,
    connector: 'rest',
    config: { baseUrl: baseUrlOf(options.origin), itemsPath: items, idField: id },
    engine: { host: '{baseUrl}', path: '/{entityType}', auth: { type: options.auth }, read: { items: '{itemsPath}', id: '{idField}', flatten: '*' } },
  }
}

function checkOptions(options: AddConnectionOptions): void {
  if (!NAME.test(options.name)) throw new UsageError(`"${options.name}" is not a connection name: letters, digits, _ or -, starting with a letter`)
  if (!(CONNECTION_AUTH as readonly string[]).includes(options.auth)) {
    throw new UsageError(`--auth "${options.auth}" is not a kind of credential: bearer, api-key, basic or none`)
  }
  if (options.header !== undefined) {
    if (options.auth !== 'api-key') throw new UsageError('--header names the header an api-key goes in; it is for --auth api-key only')
    if (!HEADER.test(options.header)) throw new UsageError(`--header "${options.header}" is not a header name, e.g. X-Api-Key`)
  }
  const given = [options.page, options.source, options.path].filter((v) => v !== undefined).length
  if (given !== 0 && given !== 3) throw new UsageError('--page, --source and --path go together: the page, the id of its new source and the collection path')
  if (options.source !== undefined && !SOURCE_ID.test(options.source)) throw new UsageError(`--source "${options.source}" is not a source id: letters, digits, _ or -, starting with a letter`)
  if (options.path !== undefined && !/^\/[A-Za-z0-9._~\-/]*[A-Za-z0-9._~-]$/.test(options.path)) {
    throw new UsageError(`--path "${options.path}" is not a collection path: it starts with / and names the collection, e.g. /bookings (no query)`)
  }
}

const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** Adds a source to the page's persistence capability (long or short form), creating it when the page has none. */
function withSource(receipt: JsonObject, source: JsonObject, rel: string): JsonObject {
  const capabilities = Array.isArray(receipt['capabilities']) ? [...(receipt['capabilities'] as unknown[])] : []
  const at = capabilities.findIndex((c) => isObject(c) && (c['capability'] === 'platform/persistence' || c['capability'] === 'persistence'))
  const current = at >= 0 ? (capabilities[at] as JsonObject) : { capability: 'platform/persistence', config: {} }
  const config = isObject(current['config']) ? current['config'] : {}
  const sources = Array.isArray(config['dataSources']) ? (config['dataSources'] as unknown[]) : []
  if (sources.some((s) => isObject(s) && s['id'] === source['id'])) {
    throw new CommandFailure('SOURCE_EXISTS', `${rel} has a data source "${String(source['id'])}" already; choose another --source`)
  }
  const next = { ...current, config: { ...config, dataSources: [...sources, source] } }
  if (at >= 0) capabilities[at] = next
  else capabilities.push(next)
  return { ...receipt, capabilities }
}

/**
 * Declares the connection (unless the same one is declared) and, with
 * `page`/`source`/`path`, adds a source to that page that reads the
 * collection through it. Nothing is written when any part is refused.
 */
export async function addConnection(root: string, options: AddConnectionOptions): Promise<ConnectionAdded> {
  checkOptions(options)
  const entry = connectionEntry(options)
  await readAppIdentity(root, 'pwf add connection')
  const doc = (await readJsonObject(root, CONNECTIONS_FILE)) ?? { connections: [] }
  const list = Array.isArray(doc['connections']) ? [...(doc['connections'] as unknown[])] : []
  const existing = list.find((c) => (typeof c === 'string' ? c : isObject(c) ? c['name'] : undefined) === options.name)
  if (existing !== undefined && !sameJson(existing, entry)) {
    throw new CommandFailure('CONNECTION_EXISTS', `${CONNECTIONS_FILE} declares a connection "${options.name}" already, in another shape; edit it there or choose another name`)
  }
  let source: ConnectionAdded['source']
  let receipt: JsonObject | undefined
  if (options.page !== undefined && options.source !== undefined && options.path !== undefined) {
    const rel = receiptRel(options.page)
    if (!fileExists(root, rel)) throw new CommandFailure('PAGE_NOT_FOUND', `the app has no page "${options.page}" (${rel}); add it with pwf page add ${options.page}`)
    const entityType = options.path.replace(/^\/+/, '')
    receipt = withSource((await readJsonObject(root, rel)) ?? {}, { id: options.source, kind: 'entity', entityType, connector: options.name }, rel)
    source = { page: options.page, receipt: rel, id: options.source, entityType }
  }
  const unchanged = existing !== undefined
  if (!unchanged) await writeJsonFile(root, CONNECTIONS_FILE, { ...doc, connections: [...list, entry] })
  if (receipt && source) await writeJsonFile(root, source.receipt, receipt)
  const kind =
    options.auth === 'none'
      ? 'The API takes no credential: nothing to store.'
      : `The API takes ${options.auth === 'api-key' ? `an api-key${options.header ? ` in the header ${options.header}` : ''}` : `a ${options.auth} credential`}: no secret is written to the app; store it with the host that serves the app, for ${options.name}${options.header ? ` (header ${options.header})` : ''}.`
  const next = [
    kind,
    ...(source
      ? [`Bind the rows on ${source.page} with "{{${source.id}}}" (a repeat, or a block's items prop), and give the source a "fallback" to draw while nothing is connected.`]
      : [`Read it from a page with a source { "kind": "entity", "entityType": "<collection>", "connector": "${options.name}" }, or run this again with --page, --source and --path.`]),
    'Then run pwf validate.',
  ]
  return { name: options.name, file: CONNECTIONS_FILE, connection: (existing as JsonObject | undefined) ?? entry, unchanged, ...(source ? { source } : {}), next }
}
