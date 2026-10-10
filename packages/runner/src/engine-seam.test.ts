/**
 * THE TWO DOCUMENTS THE ASSEMBLER WRITES, PUT BACK TOGETHER.
 *
 * Every unit in this chain had a test and the chain was still broken. The
 * assembler wrote a declared engine into `engines/manifest.json`; the facade
 * looked for it on the connection, as `def.engine`; and the only code holding
 * both documents turned the manifest into registry bindings carrying
 * `moduleUrl` and `integrity` and nothing else. Three green units, one dead
 * path — the symptom being a published app that drew every page and left
 * every panel empty.
 *
 * So this test starts from the FILES, in the exact shapes
 * `buildConnectionsDoc` and the engine-manifest loop emit, and asserts the only
 * thing anybody actually wanted: rows.
 *
 * @module @pwfabric/runner/engine-seam
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import * as runtime from '@pwfabric/runtime'

import {
  buildEntityFacade,
  extractEntityTypes,
  withDeclaredEngines,
  needsNoIdentity,
} from './entity-facade.js'

/** Verbatim from the first-party base pack's `RestConnector.knowledge.json`. */
const REST_ENGINE = {
  host: '{baseUrl}',
  path: '/{entityType}',
  auth: { type: 'none' as const },
  read: { items: '{itemsPath}', id: '{idField}', flatten: '*' },
}

/** As `buildConnectionsDoc` writes it: the address, never the credentials. */
const CONNECTIONS = {
  connections: [
    { name: 'rest', config: { baseUrl: 'api.example.com/v1', itemsPath: 'results', idField: 'ref' } },
  ],
}

/** As the engine-manifest loop writes it: declared engines carry no module. */
const MANIFEST = [
  { connection: 'rest', atomId: 'RestConnector', kind: 'connector' as const, engine: REST_ENGINE },
]

/** What `extractEntityTypes` reads — a capability naming its source. */
const RECEIPT = {
  capabilities: [
    {
      capability: 'platform/persistence',
      config: { dataSources: [{ kind: 'entity', entityType: 'products', connector: 'rest' }] },
    },
  ],
}

describe('a declared REST engine, from the published files to the rows', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reaches the facade and returns rows, with no session anywhere', async () => {
    // The runner resolves the runtime off the embed-seeded global rather than
    // importing it, because the import-map shims are a hand-maintained list.
    vi.stubGlobal('__pwfabric_runtime', runtime)
    let asked = ''
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        asked = String(url)
        return {
          ok: true,
          status: 200,
          json: async () => ({
            results: [
              { ref: 'p1', ad: 'Kalem', fiyat: 12 },
              { ref: 'p2', ad: 'Defter', fiyat: 40 },
            ],
          }),
        } as unknown as Response
      })
    )

    // The app has no door, so there is no bridge and no session. That used to
    // be the end of it: `bridge && session` was false and no facade was built.
    expect(needsNoIdentity(MANIFEST)).toBe(true)

    const facade = await buildEntityFacade(
      extractEntityTypes(RECEIPT),
      withDeclaredEngines(CONNECTIONS, MANIFEST),
      async () => null,
      undefined,
      null
    )
    expect(facade).toBeDefined()

    const res = await facade!.store.query('products' as never, {})
    expect(asked).toContain('https://api.example.com/v1/products')
    expect(res.items).toEqual([
      { id: 'p1', ref: 'p1', ad: 'Kalem', fiyat: 12 },
      { id: 'p2', ref: 'p2', ad: 'Defter', fiyat: 40 },
    ])
  })

  it('without the carry, the same files build no facade at all', async () => {
    // The measurement, kept as a test: this is what shipped. If someone removes
    // `withDeclaredEngines`, this passes and the one above fails — which is the
    // whole defect, stated twice so it cannot come back quietly.
    vi.stubGlobal('__pwfabric_runtime', runtime)
    vi.stubGlobal('fetch', vi.fn())

    const facade = await buildEntityFacade(
      extractEntityTypes(RECEIPT),
      CONNECTIONS,
      async () => null,
      undefined,
      null
    )
    expect(facade).toBeUndefined()
  })
})
