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
  authDeclarationOf,
  entityDeclarationsOf,
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

  it('exports its package.json, so a host can read the version it runs', () => {
    // `import pkg from '@pwfabric/cli/package.json'` and
    // `require.resolve('@pwfabric/cli/package.json')` fail with
    // ERR_PACKAGE_PATH_NOT_EXPORTED unless the file is an export.
    const pkg = JSON.parse(readFileSync(`${pkgDir}package.json`, 'utf8')) as { exports: Record<string, unknown> }
    expect(pkg.exports['./package.json']).toBe('./package.json')
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
        'authDeclarationOf',
        'createLocalHost',
        'declaredRecordFields',
        'entityDeclarationsOf',
        'parseRule',
        'readAuth',
        'readEntities',
        'readSeed',
        'rewriteEntitySources',
        'withRecordFields',
        'withSessionSources',
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

  it('a host with no disk hands the store its declarations: no app folder is read', () => {
    const root = fixture('l-shop')
    // What a Worker holds: the parsed files, not a folder.
    const auth = authDeclarationOf(JSON.parse(readFileSync(`${root}/app/definitions/auth.json`, 'utf8'))) as AuthDeclaration
    const entities = entityDeclarationsOf(JSON.parse(readFileSync(`${root}/app/definitions/entities.json`, 'utf8')))
    expect(auth).toEqual(readAuth(root))
    expect(entities).toEqual(readEntities(root))
    const dev = { id: 'dev-user', email: 'dev@localhost', displayName: 'Developer' }
    const asked: string[] = []
    const store = new RecordStore(undefined, dev, { entities, seed: (typeId) => (typeId === 'Product' ? [{ id: 'p1', name: 'Tea' }] : []) })
    const product = { entity: entities.find((e) => e.typeId === 'Product')!, auth, caller: { principal: undefined } }
    expect(store.list(product, new URLSearchParams()).data.map((r) => r.name)).toEqual(['Tea'])
    // A relation's target is checked by the host's own callback.
    const line: EntityDeclaration = { typeId: 'Line', fields: [{ name: 'product', type: 'relation', required: true, targetTypeId: 'Product' }] }
    const lines = new RecordStore(undefined, dev, { entities: [line], relationReadable: (typeId, id) => (asked.push(`${typeId}/${id}`), id === 'p1') })
    const target = { entity: line, auth: undefined, caller: { principal: dev } }
    expect(lines.create(target, { product: 'p1' })).toMatchObject({ product: 'p1' })
    expect(() => lines.create(target, { product: 'p2' })).toThrow(HostError)
    expect(asked).toEqual(['Product/p1', 'Product/p2'])
    expect(() => new RecordStore(undefined, dev)).toThrow(/entity declarations/)

    // Read-only: who may write is answered first, then READ_ONLY.
    const readOnly = new RecordStore(undefined, dev, { entities, readOnly: true })
    const order = (principal?: typeof dev) => ({ entity: entities.find((e) => e.typeId === 'Order')!, auth, caller: { principal } })
    const codeOf = (f: () => unknown): string | undefined => {
      try {
        f()
        return undefined
      } catch (e) {
        return (e as HostError).code
      }
    }
    expect(codeOf(() => readOnly.create(order(), { item: 'Tea' }))).toBe('SIGN_IN_REQUIRED')
    expect(codeOf(() => readOnly.create(order(dev), { item: 'Tea' }))).toBe('READ_ONLY')
    expect(codeOf(() => readOnly.update(order(dev), 'nope', { item: 'Tea' }))).toBe('NOT_FOUND')
  })
})
