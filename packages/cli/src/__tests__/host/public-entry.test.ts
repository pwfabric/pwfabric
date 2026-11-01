/**
 * `@pwfabric/cli/host` is a published entry: hosts other than `pwf dev`
 * import the access evaluator, the record store, the receipt rewrite and the
 * envelope addresses from it. This pins the entry to its source and checks
 * what it exports works as `pwf dev` uses it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import * as host from '../../host/index.js'
import {
  accessOf,
  authAddresses,
  HostError,
  readAuth,
  readEntities,
  RecordStore,
  rewriteEntitySources,
  type AuthDeclaration,
  type EntityDeclaration,
} from '../../host/index.js'
import { fixture } from './serve.js'

const pkgDir = fileURLToPath(new URL('../../../', import.meta.url))

describe('@pwfabric/cli/host', () => {
  it('is an export of the package, built from src/host/index.ts', () => {
    const pkg = JSON.parse(readFileSync(`${pkgDir}package.json`, 'utf8')) as {
      exports: Record<string, Record<string, string>>
    }
    expect(pkg.exports['./host']).toEqual({
      types: './dist/host/index.d.ts',
      import: './dist/host/index.js',
      default: './dist/host/index.js',
    })
    expect(existsSync(`${pkgDir}src/host/index.ts`)).toBe(true)
  })

  it('exports the building blocks', () => {
    expect(Object.keys(host).sort()).toEqual(
      [
        'DEFAULT_DEV_USER',
        'HostError',
        'RecordStore',
        'SESSION_COOKIE',
        'accessOf',
        'authAddresses',
        'createLocalHost',
        'parseRule',
        'readAuth',
        'readEntities',
        'readSeed',
        'rewriteEntitySources',
      ].sort()
    )
  })

  it('decides, stores and rewrites as the local host does', () => {
    const root = fixture('l-shop')
    const auth = readAuth(root) as AuthDeclaration
    const entities = readEntities(root)
    const entity = (id: string): EntityDeclaration => entities.find((e) => e.typeId === id)!
    const member = { id: 'm-1', email: 'm@example.com', displayName: 'M' }

    expect(accessOf(entity('Booking'), auth, { principal: undefined, roles: [] })).toMatchObject({ create: 'all', list: 'none', count: 'all' })
    expect(accessOf(entity('Order'), auth, { principal: member, roles: [] })).toMatchObject({ create: 'all', list: 'own', delete: 'none' })
    expect(accessOf(entity('Stock'), auth, { principal: member, roles: ['staff'] })).toMatchObject({ list: 'none', create: 'none' })

    const store = new RecordStore(root, { id: 'dev-user', email: 'dev@localhost', displayName: 'Developer' })
    const anon = { entity: entity('Order'), auth, caller: { principal: undefined } }
    expect(() => store.list(anon, new URLSearchParams())).toThrow(HostError)
    const mine = { entity: entity('Order'), auth, caller: { principal: member } }
    store.create(mine, { item: 'Tea' })
    expect(store.list(mine, new URLSearchParams()).data.map((r) => r.item)).toEqual(['Tea'])

    const receipt = { capabilities: [{ capability: 'persistence', config: { dataSources: [{ id: 'o', kind: 'entity', entityType: 'Order' }] } }] }
    expect(rewriteEntitySources(receipt, '/api', new Set(['Order']))).toEqual({
      capabilities: [
        {
          capability: 'persistence',
          config: { dataSources: [{ id: 'o', kind: 'rest', method: 'GET', endpoint: '/api/records/Order', authProviderRef: '/api', returns: 'data' }] },
        },
      ],
    })
    expect(authAddresses(auth, '/api')).toMatchObject({ loginUrl: '/api/login', apiBase: '/api' })
  })
})
