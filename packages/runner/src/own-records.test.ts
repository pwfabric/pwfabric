import { describe, expect, it } from 'vitest'
import { ownRecordsCapabilities, ownRecordsReceipt, ownRecordsSource } from './own-records.js'
import { extractEntityTypes } from './entity-facade.js'
import { ownApiBaseOf } from './api-base.js'
// The CLI's local host does the same rewrite for `pwf dev`. The two cannot
// share a module (runner.js ships as one browser file; the CLI's Node host must
// not load it), so this pins them to the same output. Read from source: the
// file is dependency-free, and importing it adds no package edge.
import { rewriteEntitySources } from '../../cli/src/host/receipts.js'

const BASE = '/_host'

const persistence = (dataSources: unknown[]): Record<string, unknown> => ({
  capability: 'platform/persistence',
  config: { dataSources },
})

describe('ownRecordsSource — a connector-less entity source reads the app\'s own records', () => {
  it('lists from <base>/records/<T>, carrying the base as its credential ref', () => {
    expect(
      ownRecordsSource(
        { id: 'Product', kind: 'entity', entityType: 'Product', query: { limit: 5 }, fallback: [] },
        BASE
      )
    ).toEqual({
      id: 'Product',
      kind: 'rest',
      method: 'GET',
      endpoint: '/_host/records/Product',
      authProviderRef: '/_host',
      returns: 'data',
      query: { limit: 5 },
      fallback: [],
    })
  })

  it('encodes the type into the path', () => {
    expect(ownRecordsSource({ kind: 'entity', entityType: 'a b' }, BASE)).toMatchObject({
      endpoint: '/_host/records/a%20b',
    })
  })

  it('a plain count goes to /count, anything else to /aggregate with its parameters', () => {
    expect(ownRecordsSource({ kind: 'entity', entityType: 'T', aggregate: { fn: 'count' } }, BASE)).toMatchObject({
      endpoint: '/_host/records/T/count',
    })
    expect(
      ownRecordsSource({ kind: 'entity', entityType: 'T', aggregate: { filter: { status: 'open' } } }, BASE)
    ).toMatchObject({
      endpoint: `/_host/records/T/count?filter=${encodeURIComponent('{"status":"open"}')}`,
    })
    expect(
      ownRecordsSource({ kind: 'entity', entityType: 'T', aggregate: { fn: 'sum', field: 'price' } }, BASE)
    ).toMatchObject({ endpoint: '/_host/records/T/aggregate?fn=sum&field=price' })
    expect(
      ownRecordsSource({ kind: 'entity', entityType: 'T', aggregate: { fn: 'count', field: 'x' } }, BASE)
    ).toMatchObject({ endpoint: '/_host/records/T/aggregate?fn=count&field=x' })
  })

  it('leaves a source that names a connector — graph-lists included — as written', () => {
    const named = { kind: 'entity', entityType: 'Announcements', connector: 'graph-lists' }
    expect(ownRecordsSource(named, BASE)).toBe(named)
  })

  it('leaves everything that is not a typed entity source alone', () => {
    const rest = { kind: 'rest', endpoint: 'https://x' }
    expect(ownRecordsSource(rest, BASE)).toBe(rest)
    const untyped = { kind: 'entity' }
    expect(ownRecordsSource(untyped, BASE)).toBe(untyped)
    expect(ownRecordsSource(null, BASE)).toBeNull()
    expect(ownRecordsSource('x', BASE)).toBe('x')
  })

  it('with a declared set, rewrites only those types', () => {
    const other = { kind: 'entity', entityType: 'Other' }
    expect(ownRecordsSource(other, BASE, new Set(['Product']))).toBe(other)
    expect(ownRecordsSource({ kind: 'entity', entityType: 'Product' }, BASE, new Set(['Product']))).toMatchObject({
      kind: 'rest',
    })
  })
})

describe('ownRecordsReceipt / ownRecordsCapabilities', () => {
  it('rewrites the persistence sources of either spelling and nothing else', () => {
    const receipt = {
      id: 'products',
      blocks: [],
      capabilities: [
        persistence([{ id: 'p', kind: 'entity', entityType: 'Product' }]),
        { capability: 'persistence', config: { dataSources: [{ id: 'q', kind: 'entity', entityType: 'Q' }] } },
        { capability: 'platform/entities', config: { formBindings: [{ sourceId: 'p' }] } },
        { capability: 'platform/persistence' },
        { capability: 'platform/persistence', config: { initialState: {} } },
      ],
    }
    const out = ownRecordsReceipt(receipt, BASE)
    expect(out).not.toBe(receipt)
    const caps = out.capabilities as Record<string, any>[]
    expect(caps[0]!.config.dataSources[0]).toMatchObject({ kind: 'rest', endpoint: '/_host/records/Product' })
    expect(caps[1]!.config.dataSources[0]).toMatchObject({ kind: 'rest', endpoint: '/_host/records/Q' })
    expect(caps[2]).toBe(receipt.capabilities[2])
    expect(caps[3]).toBe(receipt.capabilities[3])
    expect(caps[4]).toBe(receipt.capabilities[4])
    // non-mutating
    expect((receipt.capabilities[0] as any).config.dataSources[0].kind).toBe('entity')
  })

  it('returns the input when there are no capabilities', () => {
    const receipt = { blocks: [] }
    expect(ownRecordsReceipt(receipt, BASE)).toBe(receipt)
    expect(ownRecordsCapabilities(undefined, BASE)).toBeUndefined()
  })
})

describe('the runner\'s path for a connector-less entity source', () => {
  const receipt = {
    capabilities: [
      persistence([
        { id: 'Product', kind: 'entity', entityType: 'Product', fallback: [] },
        { id: 'News', kind: 'entity', entityType: 'News', connector: 'graph-lists' },
      ]),
    ],
  }

  it('with the app\'s own API base: served as rest from the records, and no facade binding', () => {
    const base = ownApiBaseOf({ apiBase: '/_host' })
    expect(base).toBe('/_host')
    const served = ownRecordsReceipt(receipt, base!)
    const sources = (served.capabilities[0] as any).config.dataSources
    expect(sources[0]).toEqual({
      id: 'Product',
      kind: 'rest',
      method: 'GET',
      endpoint: '/_host/records/Product',
      authProviderRef: '/_host',
      returns: 'data',
      fallback: [],
    })
    // The named graph-lists source is still served by the facade.
    expect(extractEntityTypes(served as never)).toEqual([{ entityType: 'News', connector: 'graph-lists' }])
  })

  it('without a base: left as an entity source that binds no connection, so it draws its fallback', () => {
    expect(ownApiBaseOf(null)).toBeNull()
    expect(extractEntityTypes(receipt as never)).toEqual([{ entityType: 'News', connector: 'graph-lists' }])
  })
})

describe('kept in step with the CLI local host (pwf dev)', () => {
  const receipt = {
    capabilities: [
      persistence([
        { id: 'a', kind: 'entity', entityType: 'Product', query: { limit: 2 } },
        { id: 'b', kind: 'entity', entityType: 'Product', aggregate: { fn: 'count' } },
        { id: 'c', kind: 'entity', entityType: 'Order', aggregate: { fn: 'avg', field: 'total', filter: { s: 1 } } },
        { id: 'd', kind: 'entity', entityType: 'Order', aggregate: { filter: { s: 2 } } },
        { id: 'e', kind: 'entity', entityType: 'News', connector: 'graph-lists' },
        { id: 'f', kind: 'entity', entityType: 'Undeclared' },
        { id: 'g', kind: 'rest', endpoint: '/x' },
      ]),
      { capability: 'platform/entities', config: {} },
    ],
  }
  const declared = new Set(['Product', 'Order', 'News'])

  it('produces the same receipt as rewriteEntitySources for the same inputs', () => {
    expect(ownRecordsReceipt(receipt, BASE, declared)).toEqual(rewriteEntitySources(receipt, BASE, declared))
  })
})
