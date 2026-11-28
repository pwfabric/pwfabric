import { describe, expect, it } from 'vitest'
import type { AssembleDiagnostic } from '../../dev/diagnostics.js'
import {
  CONNECTION_PAGE_SOURCES_INVALID,
  CONNECTION_PATH_UNDECLARED,
  CONNECTION_PATHS_UNDERIVED,
  CONNECTION_UNUSED,
  connectionEngineOf,
  withConnectionPaths,
  type ConnectionEngine,
} from '../../dev/connection-paths.js'

const REST: ConnectionEngine = { declared: { host: '{baseUrl}', path: '/{entityType}', auth: { type: 'bearer' }, read: { items: 'data', id: 'id' } } }
const shop = { name: 'shop', connector: 'rest', config: { baseUrl: 'https://api.shop.test/v1' } }
const page = (key: string, blocks: unknown[], sources: unknown[], formBindings: unknown[] = []) => ({
  path: `app/surfaces/${key}.receipt.json`,
  doc: { blocks, capabilities: [{ capability: 'platform/entities', config: { dataSources: sources, formBindings } }] },
})
const entity = (id: string, entityType: string, connector = 'shop') => ({ id, kind: 'entity', entityType, connector })

function run(connections: Record<string, unknown>[], pages: { path: string; doc: unknown }[], engine: ConnectionEngine | 'none' = REST, layout?: { path: string; doc: unknown }) {
  const d: AssembleDiagnostic[] = []
  const out = withConnectionPaths(connections, pages, layout, () => (engine === 'none' ? undefined : engine), d)
  return { out, d, sources: (out[0]!['config'] as Record<string, unknown>)['pageSources'] }
}

describe('each connection lists the paths its pages call', () => {
  it('a read source: its collection path, GET and HEAD (the prefix covers /<id>, /count, /aggregate)', () => {
    const { sources, d } = run([shop], [page('home', [], [entity('orders', 'orders')])])
    expect(sources).toEqual([{ path: 'orders', methods: ['GET', 'HEAD'] }])
    expect(d).toEqual([])
  })

  it('a write adds the verb the runtime sends: a form only creates (its method is a rest source’s), a write action creates or deletes', () => {
    const p = page('book', [{ id: 'b', type: 'button', props: { onClick: { type: 'write', sourceId: 'likes', op: 'delete', id: '1' } } }], [entity('bookings', 'bookings'), entity('likes', 'likes')], [{ formId: 'f', sourceId: 'bookings', method: 'PATCH' }])
    const { sources } = run([shop], [p])
    expect(sources).toEqual([
      { path: 'bookings', methods: ['GET', 'HEAD', 'POST'] },
      { path: 'likes', methods: ['DELETE', 'GET', 'HEAD'] },
    ])
  })

  it('an update grants nothing through a declared engine (it does not update)', () => {
    const p = page('p', [{ id: 'b', type: 'button', props: { onClick: { type: 'write', sourceId: 'o', op: 'update', id: '1' } } }], [entity('o', 'orders')])
    expect(run([shop], [p]).sources).toEqual([{ path: 'orders', methods: ['GET', 'HEAD'] }])
  })

  it('a form binding that names its own connector writes through that one', () => {
    const other = { name: 'other', config: { baseUrl: 'https://api.other.test' } }
    const d: AssembleDiagnostic[] = []
    const out = withConnectionPaths([shop, other], [page('p', [], [entity('b', 'bookings')], [{ formId: 'f', sourceId: 'b', connector: 'other' }])], undefined, () => REST, d)
    expect((out[0]!['config'] as Record<string, unknown>)['pageSources']).toEqual([{ path: 'bookings', methods: ['GET', 'HEAD'] }])
    expect((out[1]!['config'] as Record<string, unknown>)['pageSources']).toEqual([{ path: 'bookings', methods: ['POST'] }])
  })

  it('two sources that share an id each keep their path', () => {
    const p = page('p', [], [entity('x', 'orders'), entity('x', 'invoices')])
    expect(run([shop], [p]).sources).toEqual([{ path: 'invoices', methods: ['GET', 'HEAD'] }, { path: 'orders', methods: ['GET', 'HEAD'] }])
  })

  it('a layout source counts on every page, and a page may write to it', () => {
    const layout = { path: 'app/layout.receipt.json', doc: { capabilities: [{ config: { dataSources: [entity('cart', 'cart')] } }] } }
    const { sources } = run([shop], [page('p', [{ id: 'x', type: 'button', props: { action: { type: 'write', sourceId: 'cart', op: 'create' } } }], [])], REST, layout)
    expect(sources).toEqual([{ path: 'cart', methods: ['GET', 'HEAD', 'POST'] }])
  })

  it('an engine host under the baseUrl prefixes the path; a declared pre-flight is read with GET', () => {
    const graph: ConnectionEngine = { declared: { host: '{baseUrl}/sites/{site}', path: '/lists/{entityType}/items', resolve: { path: '/sites/{site}', field: 'id', as: 'siteId' } } }
    const { sources, d } = run([{ name: 'shop', config: { baseUrl: 'https://graph.test/v1.0', site: 'contoso' } }], [page('p', [], [entity('tasks', 'Tasks')])], graph)
    expect(d).toEqual([])
    expect(sources).toEqual([
      { path: 'sites/contoso/lists/Tasks/items', methods: ['GET', 'HEAD'] },
      { path: 'sites/contoso/sites/contoso', methods: ['GET', 'HEAD'] },
    ])
  })
})

describe('what the build cannot know is an error, naming the connection', () => {
  it('a template part resolved only at run time', () => {
    const graph: ConnectionEngine = { declared: { host: '{baseUrl}', path: '/sites/{siteId}/lists/{entityType}/items', resolve: { path: '/sites/root', field: 'id', as: 'siteId' } } }
    const { d } = run([shop], [page('p', [], [entity('tasks', 'Tasks')])], graph)
    expect(d.map((x) => x.code)).toEqual([CONNECTION_PATHS_UNDERIVED])
    expect(d[0]!.message).toContain('connection "shop"')
    expect(d[0]!.message).toContain('{siteId}')
  })
  it('an entityType written as an expression, and an engine that is code', () => {
    expect(run([shop], [page('p', [], [entity('x', '{{state.kind}}')])]).d.map((x) => x.code)).toEqual([CONNECTION_PATHS_UNDERIVED])
    expect(run([shop], [page('p', [], [entity('x', 'orders')])], { code: true }).d.map((x) => x.code)).toEqual([CONNECTION_PATHS_UNDERIVED])
  })
  it('an engine host that is not the baseUrl or under it', () => {
    const other: ConnectionEngine = { declared: { host: 'evil.test', path: '/{entityType}' } }
    expect(run([shop], [page('p', [], [entity('x', 'orders')])], other).d.map((x) => x.code)).toEqual([CONNECTION_PATHS_UNDERIVED])
  })
})

describe('the author may declare the paths', () => {
  const declared = { ...shop, config: { ...shop.config, pageSources: [{ path: 'sites', methods: ['GET'] }, { path: 'orders', methods: ['GET', 'HEAD'] }] } }
  it('a declared list is kept as written, and quiets what the build cannot derive', () => {
    const graph: ConnectionEngine = { declared: { host: '{baseUrl}', path: '/sites/{siteId}/{entityType}' } }
    const { sources, d } = run([declared], [page('p', [], [entity('x', 'orders')])], graph)
    expect(d).toEqual([])
    expect(sources).toEqual([{ path: 'sites', methods: ['GET'] }, { path: 'orders', methods: ['GET', 'HEAD'] }])
  })
  it('but must cover every path the build can derive', () => {
    const { d } = run([declared], [page('p', [], [entity('b', 'bookings')], [{ formId: 'f', sourceId: 'b' }])])
    expect(d.map((x) => x.code)).toEqual([CONNECTION_PATH_UNDECLARED])
    expect(d[0]!.message).toContain('/bookings with GET, HEAD, POST')
  })
})

describe('a connection no page calls allows nothing', () => {
  it('an empty list (a host refuses every path) and a warning', () => {
    const { sources, d } = run([shop], [page('p', [], [entity('x', 'orders', 'other')])])
    expect(sources).toEqual([])
    expect(d.map((x) => x.code)).toEqual([CONNECTION_UNUSED])
  })
  it('a connection with no engine at all draws nothing, so it lists nothing and is no error', () => {
    const { sources, d } = run([shop], [page('p', [], [entity('x', 'orders')])], 'none')
    expect(sources).toEqual([])
    expect(d).toEqual([])
  })
})

describe('nothing comes out wider than the app calls (review)', () => {
  it('an empty config value is not a value: the path is unknown, never the whole API', () => {
    const tpl: ConnectionEngine = { declared: { host: '{baseUrl}', path: '/{collection}' } }
    const { sources, d } = run([{ ...shop, config: { ...shop.config, collection: '' } }], [page('p', [], [entity('x', 'orders')])], tpl)
    expect(sources).toEqual([])
    expect(d.map((x) => x.code)).toEqual([CONNECTION_PATHS_UNDERIVED])
  })
  it('a template that fills to an empty path is an error, not an allow-all entry', () => {
    const { sources, d } = run([shop], [page('p', [], [entity('x', 'orders')])], { declared: { host: '{baseUrl}', path: '/' } })
    expect(sources).toEqual([])
    expect(d[0]!.message).toContain('whole API')
  })
  it('a declared "" or "/" path, or one with no methods, is refused', () => {
    for (const bad of [[{ path: '', methods: ['GET'] }], [{ path: '/', methods: ['GET'] }], [{ path: 'orders' }]]) {
      const { d } = run([{ ...shop, config: { ...shop.config, pageSources: bad } }], [page('p', [], [entity('x', 'orders')])])
      expect(d.map((x) => x.code)).toContain(CONNECTION_PAGE_SOURCES_INVALID)
    }
  })
  it('a source whose query rebinds a template value is unknown (the path changes per call)', () => {
    const tpl: ConnectionEngine = { declared: { host: '{baseUrl}', path: '/sites/{site}/{entityType}' } }
    const conn = { ...shop, config: { ...shop.config, site: 'main' } }
    const src = { ...entity('x', 'orders'), query: { site: '{{route.site}}' } }
    const { d } = run([conn], [page('p', [], [src])], tpl)
    expect(d.map((x) => x.code)).toEqual([CONNECTION_PATHS_UNDERIVED])
    // Positive control: without the query key the same source derives its path.
    expect(run([conn], [page('p', [], [entity('x', 'orders')])], tpl).sources).toEqual([{ path: 'sites/main/orders', methods: ['GET', 'HEAD'] }])
  })
})

describe('the build and pwf validate decide the engine by one rule', () => {
  const engine = { host: '{baseUrl}', path: '/{entityType}' }
  it('the connection’s own engine; else code beside the manifest; else the manifest’s declaration; else none', () => {
    expect(connectionEngineOf({ engine }, { manifest: {}, hasCode: true })).toEqual({ declared: engine })
    expect(connectionEngineOf({}, { manifest: { engine }, hasCode: true })).toEqual({ code: true })
    expect(connectionEngineOf({}, { manifest: { engine }, hasCode: false })).toEqual({ declared: engine })
    expect(connectionEngineOf({}, { manifest: {}, hasCode: false })).toBeUndefined()
    expect(connectionEngineOf({}, undefined)).toBeUndefined()
  })
})
