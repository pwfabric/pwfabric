import { describe, expect, it } from 'vitest'
import {
  extractEntityTypes,
  buildEntityFacade,
  withDeclaredEngines,
  needsNoIdentity,
  mirrorDeclaredEngines,
  aliasConnector,
} from './entity-facade.js'

describe('extractEntityTypes', () => {
  /**
   * BOTH SPELLINGS OF THE CAPABILITY.
   *
   * Receipts spell the capability the short way or the long way. Both are
   * legitimate — the plan contract types the short form, the registry and the
   * pack's atoms use the long one — so accepting only the long one is blind
   * to real documents.
   */
  it('finds the data sources when the capability is spelled the short way', () => {
    const runtimeStub = {
      canonicalCapabilityId: (v: string) =>
        v === 'persistence' || v === 'platform/persistence' ? 'platform/persistence' : null,
    }
    const prev = (globalThis as Record<string, unknown>)['__pwfabric_runtime']
    ;(globalThis as Record<string, unknown>)['__pwfabric_runtime'] = runtimeStub
    try {
      const bindings = extractEntityTypes({
        capabilities: [
          {
            capability: 'persistence',
            config: { dataSources: [{ kind: 'entity', entityType: 'Urunler', connector: 'rest' }] },
          },
        ],
      } as never)
      expect(bindings).toEqual([{ entityType: 'Urunler', connector: 'rest' }])
    } finally {
      ;(globalThis as Record<string, unknown>)['__pwfabric_runtime'] = prev
    }
  })

  it('reads entity dataSources from platform/persistence', () => {
    const bindings = extractEntityTypes({
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [
              { kind: 'entity', entityType: 'Announcements' },
              { kind: 'entity', entityType: 'People', connector: 'graph-users' },
              { kind: 'api', entityType: 'Ignored' },
              { kind: 'entity' },
            ],
          },
        },
      ],
    })
    expect(bindings).toEqual([
      { entityType: 'Announcements', connector: 'graph-lists' },
      { entityType: 'People', connector: 'graph-users' },
    ])
  })

  it('resolves a WRITE binding through the source it names', () => {
    // A form names a SOURCE now, so its write type comes from the source list
    // rather than off the binding — which is what lets the same declaration
    // point at our store or at anyone else's endpoint.
    const bindings = extractEntityTypes({
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [
              { id: 'Ideas', kind: 'entity', entityType: 'Ideas' },
              { id: 'Todos', kind: 'entity', entityType: 'Todos', connector: 'graph-tasks' },
            ],
          },
        },
        {
          capability: 'platform/entities',
          config: { formBindings: [{ sourceId: 'Ideas' }, { sourceId: 'Todos' }] },
        },
      ],
    })
    expect(bindings).toEqual([
      { entityType: 'Ideas', connector: 'graph-lists' },
      { entityType: 'Todos', connector: 'graph-tasks' },
    ])
  })

  it('registers NOTHING for a form that writes to a rest source', () => {
    // That write goes over HTTP and needs no entity registration; registering
    // one would claim the store owns a collection it has never seen.
    const bindings = extractEntityTypes({
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [{ id: 'flow', kind: 'rest', endpoint: 'https://example.com/hook' }],
          },
        },
        {
          capability: 'platform/entities',
          config: { formBindings: [{ sourceId: 'flow' }] },
        },
      ],
    })
    expect(bindings).toEqual([])
  })

  it('dedupes on {connector, entityType} pairs', () => {
    const bindings = extractEntityTypes({
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [
              { kind: 'entity', entityType: 'Announcements' },
              { kind: 'entity', entityType: 'Announcements' },
            ],
          },
        },
        { capability: 'platform/entities', config: { formBindings: [{ entityType: 'Announcements' }] } },
      ],
    })
    expect(bindings).toEqual([{ entityType: 'Announcements', connector: 'graph-lists' }])
  })

  it('returns [] without capabilities', () => {
    expect(extractEntityTypes({})).toEqual([])
    expect(extractEntityTypes({ capabilities: [] })).toEqual([])
  })
})

/**
 * the facade serves BOTH engine forms.
 *
 * A facade that serves only declarations leaves the BUNDLED form out: an app
 * whose `graph-lists` engine is a bundle would be refused for want of a
 * declaration, and every panel would fall to the anon path behind one honest
 * warning — although the registry has already loaded and verified that module.
 */
describe('buildEntityFacade — declared and bundled', () => {
  const BINDINGS = [{ entityType: 'Adaylar', connector: 'graph-lists' }] as const
  const token = async () => 'tok'

  beforeEach(() => {
    ;(globalThis as { __pwfabric_runtime?: unknown }).__pwfabric_runtime = {
      createEntityFacade: () => {
        const registered: unknown[] = []
        return {
          registered,
          registry: { register: () => {} },
          connectors: { register: (c: unknown) => registered.push(c) },
          registerEntity: () => {},
        }
      },
      createDeclaredConnector: ({ name }: { name: string }) => ({ name, type: 'custom', query: async () => ({}) }),
    }
  })

  afterEach(() => {
    delete (globalThis as { __pwfabric_runtime?: unknown }).__pwfabric_runtime
  })

  it('asks the REGISTRY when the connection carries a bundled engine, not a declaration', async () => {
    const asked: string[] = []
    const engines = {
      resolve: async (connection: string) => {
        asked.push(connection)
        return { name: connection, type: 'custom', query: async () => ({}) }
      },
    }

    const facade = await buildEntityFacade(
      BINDINGS,
      { connections: [{ name: 'graph-lists', config: { siteHostname: 'x', sitePath: '/y' } }] } as never,
      token,
      undefined,
      engines
    )

    expect(asked).toEqual(['graph-lists'])
    expect(facade).toBeDefined()
  })

  it('builds from the DECLARATION when one is present, without touching the registry', async () => {
    const asked: string[] = []
    const engines = { resolve: async (c: string) => { asked.push(c); return null } }

    const facade = await buildEntityFacade(
      BINDINGS,
      {
        connections: [
          { name: 'graph-lists', config: {}, engine: { host: 'h', path: '/p', auth: { type: 'bearer' }, read: { items: 'value', id: 'id' } } },
        ],
      } as never,
      token,
      undefined,
      engines
    )

    expect(asked).toEqual([])
    expect(facade).toBeDefined()
  })

  it('with NEITHER form it degrades honestly rather than crashing', async () => {
    const facade = await buildEntityFacade(
      BINDINGS,
      { connections: [{ name: 'graph-lists', config: {} }] } as never,
      token,
      undefined,
      null
    )

    expect(facade).toBeUndefined()
  })
})

/**
 * THE SEAM WHERE A DECLARED ENGINE WAS BEING LOST.
 *
 * Three ends that must meet. The assembler writes a
 * declared engine into `engines/manifest.json` (the contract: "the engine travels IN
 * the manifest"). `buildEntityFacade` looks for it on the CONNECTION, as
 * `def.engine`. And `run-app` — the only place holding both documents — turned
 * the manifest into registry bindings; if those carry only `moduleUrl` and
 * `integrity`, the declaration reaches the browser and then stops.
 *
 * The visible symptom would be a connection that works everywhere except
 * where it matters: an editor shows rows, a connection test goes green — it
 * probes the ADDRESS, and the address really is reachable — and the published
 * app renders every page with empty panels and one console warning.
 */
describe('withDeclaredEngines', () => {
  const REST = { host: '{baseUrl}', path: '/{entityType}', auth: { type: 'none' } }

  it('carries a declared engine from the manifest onto its connection', () => {
    const merged = withDeclaredEngines({ connections: [{ name: 'rest', config: { baseUrl: 'x' } }] }, [
      { connection: 'rest', atomId: 'RestConnector', kind: 'connector', engine: REST },
    ])
    expect(merged?.connections?.[0]).toEqual({ name: 'rest', config: { baseUrl: 'x' }, engine: REST })
  })

  it('leaves a BUNDLED entry alone — the registry owns those, and owns loading them', () => {
    const doc = { connections: [{ name: 'graph-lists', config: {} }] }
    const merged = withDeclaredEngines(doc, [
      {
        connection: 'graph-lists',
        atomId: 'GraphListConnector',
        kind: 'connector',
        moduleUrl: 'engines/g.abc.mjs',
        integrity: 'sha256-x',
      },
    ])
    expect(merged?.connections?.[0]).not.toHaveProperty('engine')
  })

  it('does not overwrite an engine the connections doc already carries', () => {
    const own = { host: 'own.example', path: '/{entityType}', auth: { type: 'none' } }
    const merged = withDeclaredEngines({ connections: [{ name: 'rest', engine: own }] }, [
      { connection: 'rest', atomId: 'RestConnector', kind: 'connector', engine: REST },
    ])
    expect((merged?.connections?.[0] as { engine?: unknown }).engine).toBe(own)
  })

  it('names a manifest connection the connections doc never declared', () => {
    // Not silently invented: an engine with no connection has no config to
    // fill its templates, so adding one would produce a request to `{baseUrl}`.
    const merged = withDeclaredEngines({ connections: [] }, [
      { connection: 'ghost', atomId: 'RestConnector', kind: 'connector', engine: REST },
    ])
    expect(merged?.connections).toEqual([])
  })

  it('is the same document when there is no manifest', () => {
    const doc = { connections: [{ name: 'rest' }] }
    expect(withDeclaredEngines(doc, null)).toBe(doc)
    expect(withDeclaredEngines(doc, [])).toBe(doc)
  })
})

/**
 * AN APP THAT NEEDS NO IDENTITY MUST NOT BE GATED ON ONE.
 *
 * `run-app` built the facade only when `bridge && session` — a PKCE bridge AND
 * a live sign-in. That is right for Microsoft Graph, which cannot answer
 * without a delegated token. It is wrong for a public API, and a public API is
 * exactly what a plain REST connection usually is: the app has no door, so
 * there is no bridge, so there was no data path at all.
 *
 * The engine already states which it is. `auth.type === 'none'` is a
 * declaration, not a guess.
 */
describe('needsNoIdentity', () => {
  it('is true when a declared engine states it needs no identity', () => {
    expect(
      needsNoIdentity([
        {
          connection: 'rest',
          atomId: 'RestConnector',
          kind: 'connector',
          engine: { host: '{baseUrl}', path: '/x', auth: { type: 'none' } },
        },
      ])
    ).toBe(true)
  })

  it('is false when every declared engine wants a token', () => {
    expect(
      needsNoIdentity([
        {
          connection: 'graph',
          atomId: 'G',
          kind: 'connector',
          engine: { host: 'graph.microsoft.com/v1.0', path: '/x', auth: { type: 'bearer' } },
        },
      ])
    ).toBe(false)
  })

  it('is false for a BUNDLED engine — a module has not told us what it needs', () => {
    expect(
      needsNoIdentity([
        { connection: 'g', atomId: 'G', kind: 'connector', moduleUrl: 'engines/g.mjs', integrity: 'x' },
      ])
    ).toBe(false)
  })

  it('is false for no manifest at all', () => {
    expect(needsNoIdentity(null)).toBe(false)
    expect(needsNoIdentity([])).toBe(false)
  })
})

describe('mirrorDeclaredEngines — the registry learns what the facade built', () => {
  function fakeRegistry(known: readonly string[] = []) {
    const entries = new Map<string, unknown>(known.map((k) => [k, { bundled: true }]))
    return {
      entries,
      getStatus: (name: string) => ({ state: entries.has(name) ? 'ready' : 'unregistered' }),
      register: (name: string, engine: never) => {
        entries.set(name, engine)
      },
    }
  }
  const declared = { name: 'graph-lists', query: async () => ({ success: true, result: { items: [] } }) }

  it('registers a declared engine the registry has never heard of', () => {
    const registry = fakeRegistry()
    const cache = new Map([['graph-lists', declared as never]])
    expect(mirrorDeclaredEngines(registry, cache)).toEqual(['graph-lists'])
    expect(registry.entries.get('graph-lists')).toBe(declared)
  })

  it('leaves a bundled engine the registry already serves alone', () => {
    const registry = fakeRegistry(['graph-lists'])
    const cache = new Map([['graph-lists', declared as never]])
    expect(mirrorDeclaredEngines(registry, cache)).toEqual([])
    expect(registry.entries.get('graph-lists')).toEqual({ bundled: true })
  })

  it('is a no-op without a registry (open data, no bridge)', () => {
    const cache = new Map([['graph-lists', declared as never]])
    expect(mirrorDeclaredEngines(null, cache)).toEqual([])
    expect(mirrorDeclaredEngines(undefined, cache)).toEqual([])
  })
})

describe('aliasConnector — a bundled engine is addressed by its CONNECTION name', () => {
  const calls: string[] = []
  const engine = {
    name: 'graph',
    type: 'custom' as const,
    create: async (t: string) => { calls.push('create:' + t); return { success: true as const, data: {} } },
    read: async (t: string, i: string) => { calls.push('read:' + t + ':' + i); return { success: true as const, data: {} } },
    update: async (t: string, i: string) => { calls.push('update:' + t + ':' + i); return { success: true as const, data: {} } },
    delete: async (t: string, i: string) => { calls.push('delete:' + t + ':' + i); return { success: true as const, data: {} } },
    query: async (t: string) => { calls.push('query:' + t); return { success: true as const, result: { items: [], total: 0, offset: 0, limit: 0, hasMore: false } } },
  }

  it('answers to the connection name and delegates every operation', async () => {
    const aliased = aliasConnector(engine as never, 'graph-users')
    expect(aliased.name).toBe('graph-users')
    expect(aliased.type).toBe('custom')
    await aliased.query('Employees' as never, {})
    await aliased.read('Employees' as never, '1' as never)
    await aliased.create('Employees' as never, {})
    await aliased.update('Employees' as never, '1' as never, {})
    await aliased.delete('Employees' as never, '1' as never)
    expect(calls).toEqual(['query:Employees', 'read:Employees:1', 'create:Employees', 'update:Employees:1', 'delete:Employees:1'])
  })

  it('passes a same-named engine through untouched', () => {
    expect(aliasConnector(engine as never, 'graph')).toBe(engine)
  })
})
