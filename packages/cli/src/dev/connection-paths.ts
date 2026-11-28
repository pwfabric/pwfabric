/**
 * The paths each connection may be called on (definitions.md, connections.json
 * `pageSources`), derived from what the app's pages call through it.
 *
 * A host that holds a connection's secret and calls the API on the app's behalf
 * (a secret-holding proxy) must refuse everything the app does not call: a
 * visitor could otherwise send the secret to any path of that host. The engine
 * is the one that knows those paths — it builds each request from the
 * connection's engine template — so every build writes them, per connection:
 *
 * - each `entity` source naming the connection reads `<template path>` with
 *   GET and HEAD; the path is a prefix, so it also covers `/<id>`, `/count`
 *   and `/aggregate`;
 * - a form binding or a `write` action on that source adds the write verb it
 *   sends: POST (create, a form's default), PUT or PATCH (a form's `method`,
 *   an update), DELETE;
 * - a declared pre-flight (`resolve.path`) is read with GET.
 *
 * A path the build cannot know — a template part resolved only at run time
 * (`resolve.as`, a query override), an `entityType` written as an expression, an
 * engine that is code — is an error naming the connection, unless the author
 * declares the connection's `pageSources` in connections.json; a declared list
 * is kept as written and must cover every path the build can derive. A
 * connection no source calls gets an empty list: a host refuses every path.
 *
 * @module @pwfabric/cli/dev/connection-paths
 */
import type { AssembleDiagnostic } from './diagnostics.js'
import { isRecord } from './sources.js'

export const CONNECTION_PATHS_UNDERIVED = 'CONNECTION_PATHS_UNDERIVED'
export const CONNECTION_PATH_UNDECLARED = 'CONNECTION_PATH_UNDECLARED'
export const CONNECTION_UNUSED = 'CONNECTION_UNUSED'
export const CONNECTION_PAGE_SOURCES_INVALID = 'CONNECTION_PAGE_SOURCES_INVALID'

const FILE = 'app/definitions/connections.json'
const READ = ['GET', 'HEAD']
const VERBS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** One path a connection may be called on, relative to its `baseUrl`, and the verbs allowed there. */
export interface ConnectionPathEntry {
  readonly path: string
  readonly methods: readonly string[]
}

/** How a connection's requests are built: a declaration the build can read, or code it cannot. */
export type ConnectionEngine = { readonly declared: Record<string, unknown> } | { readonly code: true }

/**
 * The engine that serves a connection, as the build and `pwf validate` both decide
 * it (one rule, so the two never disagree): the connection's own `engine`; else
 * its connector atom — code when an engine source sits beside the manifest (the
 * runtime then loads that module, whatever the manifest declares), else the
 * manifest's declaration; else none (nothing can call the connection).
 */
export function connectionEngineOf(
  connection: Record<string, unknown>,
  atom: { readonly manifest: unknown; readonly hasCode: boolean } | undefined
): ConnectionEngine | undefined {
  if (isRecord(connection['engine'])) return { declared: connection['engine'] }
  if (!atom) return undefined
  if (atom.hasCode) return { code: true }
  const manifest = atom.manifest
  return isRecord(manifest) && isRecord(manifest['engine']) ? { declared: manifest['engine'] } : undefined
}

/** A page or the layout, with the place its diagnostics point at. */
export interface ReceiptDoc {
  readonly path: string
  readonly doc: unknown
}

interface Use {
  readonly entityType: string
  readonly methods: Set<string>
  readonly where: string
  /** The string keys of the source's `query`: a declared engine rebinds a template value of that name per query. */
  readonly queryKeys: readonly string[]
}

/** `{name}` placeholders left in a template once `values` are filled in; an empty value is not a value. */
function fill(template: string, values: Readonly<Record<string, string>>): { text: string; open: string[] } {
  const open: string[] = []
  const text = template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, key: string) => {
    if (typeof values[key] === 'string' && values[key]!.trim() !== '') return values[key]!
    open.push(key)
    return m
  })
  return { text, open }
}

/** The `{name}` placeholders a template names. */
const placeholdersOf = (template: unknown): string[] =>
  typeof template === 'string' ? [...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((m) => m[1]!) : []

const trimSlashes = (p: string): string => p.replace(/^\/+/, '').replace(/\/+$/, '')
const bareAddress = (u: string): string => trimSlashes(u.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, ''))

/** Every `entity` source naming a connection, and the verbs its page writes to it with. */
function usesOf(receipts: readonly ReceiptDoc[], layout: ReceiptDoc | undefined): Map<string, Use[]> {
  const out = new Map<string, Use[]>()
  type Source = { connector: string; entityType: string; where: string; methods: Set<string>; queryKeys: string[] }
  // Every entity source naming a connection, by id; two sources may share an id, and each keeps its path.
  const sourcesIn = (doc: unknown, where: string): Map<string, Source[]> => {
    const found = new Map<string, Source[]>()
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(visit)
      if (!isRecord(v)) return
      if (v['kind'] === 'entity' && typeof v['connector'] === 'string' && typeof v['id'] === 'string') {
        const query = isRecord(v['query']) ? v['query'] : {}
        const queryKeys = Object.entries(query).filter(([, x]) => typeof x === 'string').map(([k]) => k)
        const list = found.get(v['id']) ?? []
        list.push({ connector: v['connector'], entityType: typeof v['entityType'] === 'string' ? v['entityType'] : '', where, methods: new Set(READ), queryKeys })
        found.set(v['id'], list)
      }
      for (const x of Object.values(v)) visit(x)
    }
    visit(doc)
    return found
  }
  // What a page writes, as the runtime sends it to an entity source (source-writer): a `write`
  // action's create / update / delete is POST / PATCH / DELETE; a form only creates (POST) — a
  // form's `method` is a `rest` source's — and a form binding may name its own connector.
  type Write = { sourceId: string; verb: string; connector?: string }
  const writesIn = (doc: unknown): Write[] => {
    const found: Write[] = []
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(visit)
      if (!isRecord(v)) return
      if (v['type'] === 'write' && typeof v['sourceId'] === 'string') {
        found.push({ sourceId: v['sourceId'], verb: v['op'] === 'delete' ? 'DELETE' : v['op'] === 'update' ? 'PATCH' : 'POST' })
      }
      if (Array.isArray(v['formBindings'])) {
        for (const b of v['formBindings']) {
          if (!isRecord(b) || typeof b['sourceId'] !== 'string') continue
          found.push({ sourceId: b['sourceId'], verb: 'POST', ...(typeof b['connector'] === 'string' && b['connector'] ? { connector: b['connector'] } : {}) })
        }
      }
      for (const x of Object.values(v)) visit(x)
    }
    visit(doc)
    return found
  }
  const layoutSources = layout ? sourcesIn(layout.doc, layout.path) : new Map<string, Source[]>()
  const all: Source[] = [...layoutSources.values()].flat()
  for (const r of [...receipts, ...(layout ? [layout] : [])]) {
    const own = r === layout ? layoutSources : sourcesIn(r.doc, r.path)
    if (r !== layout) all.push(...[...own.values()].flat())
    // A page writes to its own source, or to one the layout declares for every page.
    for (const w of writesIn(r.doc)) {
      for (const s of own.get(w.sourceId) ?? layoutSources.get(w.sourceId) ?? []) {
        // A form binding that names another connector writes through that one, to the same collection.
        if (w.connector && w.connector !== s.connector) all.push({ ...s, connector: w.connector, methods: new Set([w.verb]), where: r.path })
        else s.methods.add(w.verb)
      }
    }
  }
  for (const s of all) {
    const list = out.get(s.connector) ?? []
    list.push({ entityType: s.entityType, methods: s.methods, where: s.where, queryKeys: s.queryKeys })
    out.set(s.connector, list)
  }
  return out
}

/** The author's own `pageSources`, read as the host reads them; undefined when none is written. */
function declaredOf(config: Record<string, unknown>, name: string, diagnostics: AssembleDiagnostic[]): ConnectionPathEntry[] | undefined {
  const raw = config['pageSources']
  if (raw === undefined) return undefined
  const bad = (why: string): undefined => {
    diagnostics.push({ severity: 'error', code: CONNECTION_PAGE_SOURCES_INVALID, message: `connection "${name}": pageSources ${why}`, path: FILE })
    return undefined
  }
  if (!Array.isArray(raw)) return bad('is not a list of { path, methods }')
  const out: ConnectionPathEntry[] = []
  for (const [i, s] of raw.entries()) {
    if (!isRecord(s) || typeof s['path'] !== 'string') return bad(`[${i}] has no path`)
    // An empty path ("" or "/") is the whole API: a list that allows it allows everything.
    if (trimSlashes(s['path'].trim()) === '') return bad(`[${i}] has an empty path, which would allow every path of the API; name the collection`)
    if (!Array.isArray(s['methods']) || s['methods'].length === 0) return bad(`[${i}] names no methods (e.g. ["GET", "HEAD"])`)
    const methods = s['methods'].map((m) => String(m).toUpperCase())
    const unknown = methods.filter((m) => !VERBS.has(m))
    if (unknown.length) return bad(`[${i}] names ${unknown.join(', ')}, which is not GET, HEAD, POST, PUT, PATCH or DELETE`)
    out.push({ path: trimSlashes(s['path'].trim()), methods })
  }
  return out
}

const covers = (list: readonly ConnectionPathEntry[], e: ConnectionPathEntry, verb: string): boolean =>
  list.some((s) => s.methods.includes(verb) && (s.path === '' || e.path === s.path || e.path.startsWith(`${s.path}/`)))

/**
 * The connections of `pwpack/connections.json`, each with its `config.pageSources`
 * — the author's own list when written, else the derived one — and the findings.
 */
export function withConnectionPaths(
  connections: readonly Record<string, unknown>[],
  receipts: readonly ReceiptDoc[],
  layout: ReceiptDoc | undefined,
  engineOf: (name: string, connection: Record<string, unknown>) => ConnectionEngine | undefined,
  diagnostics: AssembleDiagnostic[]
): Record<string, unknown>[] {
  const uses = usesOf(receipts, layout)
  return connections.map((conn) => {
    const name = String(conn['name'])
    const config = isRecord(conn['config']) ? conn['config'] : {}
    const declared = declaredOf(config, name, diagnostics)
    const mine = uses.get(name) ?? []
    const derived = new Map<string, Set<string>>()
    const unknown: string[] = []
    const engine = engineOf(name, conn)
    if (mine.length > 0) {
      if (engine && 'code' in engine) {
        unknown.push('its engine is code, whose requests the build cannot read')
      } else if (engine) {
        const d = engine.declared
        const values = Object.fromEntries(Object.entries(config).filter((e): e is [string, string] => typeof e[1] === 'string'))
        const base = typeof config['baseUrl'] === 'string' ? bareAddress(config['baseUrl']) : ''
        const host = typeof d['host'] === 'string' ? fill(d['host'], values) : { text: '', open: ['host'] }
        const hostAt = bareAddress(host.text)
        // Paths are relative to the connection's baseUrl: the engine's host must be it, or under it.
        const prefix = host.open.length || !base ? null : hostAt === base ? '' : hostAt.startsWith(`${base}/`) ? hostAt.slice(base.length + 1) : null
        if (prefix === null) {
          unknown.push(`its engine host ${JSON.stringify(d['host'])} is not its baseUrl or a path under it`)
        } else {
          const at = (p: string): string => trimSlashes([prefix, trimSlashes(p)].filter(Boolean).join('/'))
          const add = (p: string, methods: Iterable<string>): void => {
            const set = derived.get(p) ?? new Set<string>()
            for (const m of methods) set.add(m)
            derived.set(p, set)
          }
          // The template values a source's query may rebind (declared-connector overridesFrom).
          const bound = new Set([...placeholdersOf(d['host']), ...placeholdersOf(d['path']), ...placeholdersOf(isRecord(d['resolve']) ? d['resolve']['path'] : undefined)])
          for (const u of mine) {
            if (!u.entityType || /\{\{/.test(u.entityType)) {
              unknown.push(`a source in ${u.where} names its entityType ${u.entityType ? `as an expression (${u.entityType})` : 'nowhere'}`)
              continue
            }
            const rebound = u.queryKeys.filter((k) => bound.has(k) && k in values)
            if (rebound.length) {
              unknown.push(`a source in ${u.where} sets ${rebound.map((k) => `{${k}}`).join(', ')} in its query, which changes the path per call`)
              continue
            }
            const p = typeof d['path'] === 'string' ? fill(d['path'], { ...values, entityType: u.entityType }) : { text: '', open: ['path'] }
            if (p.open.length) {
              unknown.push(`its path template ${JSON.stringify(d['path'])} has ${p.open.map((o) => `{${o}}`).join(', ')}, known only at run time`)
              continue
            }
            const path = at(p.text)
            // A path that comes out empty is the whole API: never allowed by derivation.
            if (path === '') {
              unknown.push(`its path template ${JSON.stringify(d['path'])} comes out empty for "${u.entityType}", which is the whole API`)
              continue
            }
            // A declared engine does not update (declared-connector), so an update sends nothing.
            add(path, [...u.methods].filter((m) => m !== 'PATCH'))
          }
          const resolve = isRecord(d['resolve']) && typeof d['resolve']['path'] === 'string' ? fill(d['resolve']['path'], values) : undefined
          if (resolve?.open.length) unknown.push(`its pre-flight path ${JSON.stringify((d['resolve'] as Record<string, unknown>)['path'])} has ${resolve.open.map((o) => `{${o}}`).join(', ')}, known only at run time`)
          else if (resolve && at(resolve.text) === '') unknown.push('its pre-flight path comes out empty, which is the whole API')
          else if (resolve) add(at(resolve.text), READ)
        }
      }
      // No engine at all: the runtime cannot call the connection, so there is nothing to allow.
    }
    const list: ConnectionPathEntry[] = [...derived.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([path, m]) => ({ path, methods: [...m].sort() }))
    if (declared) {
      for (const e of list) {
        const missing = e.methods.filter((m) => !covers(declared, e, m))
        if (missing.length) {
          diagnostics.push({
            severity: 'error',
            code: CONNECTION_PATH_UNDECLARED,
            message: `connection "${name}": the app calls /${e.path} with ${missing.join(', ')}, which its pageSources do not allow; add it to pageSources (or remove pageSources and let the build derive them)`,
            path: FILE,
          })
        }
      }
      return { ...conn, config: { ...config, pageSources: declared } }
    }
    if (unknown.length) {
      diagnostics.push({
        severity: 'error',
        code: CONNECTION_PATHS_UNDERIVED,
        message: `connection "${name}": the build cannot tell every path the app calls it on — ${[...new Set(unknown)].join('; ')}. Declare them in its config.pageSources ([{ "path": "items", "methods": ["GET"] }]) — a host refuses every path a connection does not list`,
        path: FILE,
      })
    }
    if (mine.length === 0) {
      diagnostics.push({
        severity: 'warning',
        code: CONNECTION_UNUSED,
        message: `connection "${name}": no page calls it, so it allows no path (a host refuses every call); remove it, or use it from a page`,
        path: FILE,
      })
    }
    return { ...conn, config: { ...config, pageSources: list } }
  })
}
