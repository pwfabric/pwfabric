import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { addConnection } from '../../commands/lib/connection.js'
import { capture, FIXTURE_FOUNDATION, schemaErrors, SPEC_SCHEMAS_MISSING, tempDir } from './helpers.js'

async function app(): Promise<string> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return join(cwd, 'demo')
}
const json = async (root: string, rel: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(root, ...rel.split('/')), 'utf8'))
const FILE = 'app/definitions/connections.json'

describe('pwf add connection', () => {
  it('declares a connection to an outside API: where it is and the kind of credential, never a credential', async () => {
    const root = await app()
    const run = capture(root)
    expect(await main(['add', 'connection', 'shop', '--origin', 'https://api.example.com/v1', '--auth', 'bearer'], run.io)).toBe(0)
    const doc = await json(root, FILE)
    expect(doc).toEqual({
      connections: [
        {
          name: 'shop',
          connector: 'rest',
          config: { baseUrl: 'api.example.com/v1', itemsPath: 'data', idField: 'id' },
          engine: { host: '{baseUrl}', path: '/{entityType}', auth: { type: 'bearer' }, read: { items: '{itemsPath}', id: '{idField}', flatten: '*' } },
        },
      ],
    })
    if (!SPEC_SCHEMAS_MISSING) expect(schemaErrors('definitions.connections', doc)).toEqual([])
    expect(run.text()).toContain('Added connection shop')
    expect(run.text()).toContain('no secret is written')
    // The build carries it as declared: nothing in it looks like a credential.
    const check = capture(root)
    expect(await main(['validate'], check.io)).toBe(0)
    expect(check.text()).not.toContain('CREDENTIAL_DROPPED')
  })

  it('adds a page source that names the connection', async () => {
    const root = await app()
    const run = capture(root)
    expect(
      await main(
        ['add', 'connection', 'weather', '--origin', 'https://api.weather.example', '--auth', 'none', '--items', 'results', '--id', 'code', '--page', 'home', '--source', 'forecast', '--path', '/forecast'],
        run.io
      )
    ).toBe(0)
    const [conn] = (await json(root, FILE))['connections'] as Record<string, unknown>[]
    expect(conn).toMatchObject({ name: 'weather', config: { baseUrl: 'api.weather.example', itemsPath: 'results', idField: 'code' }, engine: { auth: { type: 'none' } } })
    const receipt = await json(root, 'app/surfaces/home.receipt.json')
    const caps = receipt['capabilities'] as { capability: string; config: { dataSources: unknown[] } }[]
    const persistence = caps.find((c) => c.capability === 'platform/persistence' || c.capability === 'persistence')
    expect(persistence?.config.dataSources).toContainEqual({ id: 'forecast', kind: 'entity', entityType: 'forecast', connector: 'weather' })
    // Never the app's own sign-in token.
    expect(JSON.stringify(receipt)).not.toContain('authProviderRef')
    expect(run.text()).toContain('{{forecast}}')
    // A second source on the same page joins the same capability.
    expect(await main(['add', 'connection', 'weather', '--origin', 'https://api.weather.example', '--auth', 'none', '--items', 'results', '--id', 'code', '--page', 'home', '--source', 'alerts', '--path', '/alerts'], capture(root).io)).toBe(0)
    const again = (await json(root, 'app/surfaces/home.receipt.json'))['capabilities'] as { capability: string; config: { dataSources: { id: string }[] } }[]
    expect(again.filter((c) => /persistence$/.test(c.capability))).toHaveLength(1)
    expect(again.find((c) => /persistence$/.test(c.capability))?.config.dataSources.map((s) => s.id)).toEqual(['forecast', 'alerts'])
    expect(((await json(root, FILE))['connections'] as unknown[]).length).toBe(1)
  })

  it('keeps the header name of an api-key out of the app: the key and where it goes are the host’s', async () => {
    const root = await app()
    const run = capture(root)
    expect(await main(['add', 'connection', 'crm', '--origin', 'https://crm.example.com', '--auth', 'api-key', '--header', 'X-Api-Key'], run.io)).toBe(0)
    const text = await readFile(join(root, ...FILE.split('/')), 'utf8')
    expect(JSON.parse(text).connections[0].engine.auth).toEqual({ type: 'api-key' })
    expect(text).not.toContain('X-Api-Key')
    expect(run.text()).toContain('header X-Api-Key')
  })

  it('keeps a loopback http origin for development and keeps the other connections', async () => {
    const root = await app()
    await writeFile(join(root, ...FILE.split('/')), JSON.stringify({ connections: ['legacy'] }))
    const added = await addConnection(root, { name: 'local', origin: 'http://localhost:8787/api', auth: 'none' })
    expect(added.connection['config']).toMatchObject({ baseUrl: 'http://localhost:8787/api' })
    expect(((await json(root, FILE))['connections'] as unknown[])[0]).toBe('legacy')
  })

  it('refuses what would put a secret in the app, or a shape the engine cannot read', async () => {
    const root = await app()
    const refused = async (argv: string[], said: string): Promise<void> => {
      const run = capture(root)
      expect(await main(['add', 'connection', ...argv], run.io)).not.toBe(0)
      expect(run.text()).toContain(said)
    }
    const code = (options: Partial<Parameters<typeof addConnection>[1]>): Promise<unknown> =>
      addConnection(root, { name: 'shop', origin: 'https://api.example.com', auth: 'none', ...options }).then(
        () => 'written',
        (e: { code?: string }) => e.code
      )
    expect(await code({ origin: 'https://user:pass@api.example.com', auth: 'basic' })).toBe('CONNECTION_SECRET')
    expect(await code({ origin: 'https://api.example.com/v1?api_key=abc', auth: 'api-key' })).toBe('CONNECTION_SECRET')
    expect(await code({ page: 'nope', source: 's', path: '/x' })).toBe('PAGE_NOT_FOUND')
    await refused(['shop', '--origin', 'https://user:pass@api.example.com', '--auth', 'basic'], 'never written')
    await refused(['shop', '--origin', 'http://api.example.com', '--auth', 'none'], 'https')
    await refused(['shop', '--origin', 'ftp://api.example.com', '--auth', 'none'], 'https')
    await refused(['shop', '--origin', 'https://api.example.com', '--auth', 'oauth'], 'bearer, api-key, basic or none')
    await refused(['shop', '--origin', 'https://api.example.com'], '--auth')
    await refused(['shop', '--auth', 'none'], '--origin')
    await refused(['sh op', '--origin', 'https://api.example.com', '--auth', 'none'], 'name')
    await refused(['shop', '--origin', 'https://api.example.com', '--auth', 'bearer', '--header', 'X-Key'], '--header')
    await refused(['shop', '--origin', 'https://api.example.com', '--auth', 'none', '--page', 'home'], '--page, --source and --path')
    await refused(['shop', '--origin', 'https://api.example.com', '--auth', 'none', '--page', 'home', '--source', 's', '--path', 'x'], 'starts with /')
    expect(existsSync(join(root, ...FILE.split('/')))).toBe(false)
    // A name taken by another declaration is not overwritten.
    expect(await main(['add', 'connection', 'shop', '--origin', 'https://api.example.com', '--auth', 'none'], capture(root).io)).toBe(0)
    expect(await code({ origin: 'https://other.example.com' })).toBe('CONNECTION_EXISTS')
    // A source id the page already has is refused.
    expect(await code({ page: 'home', source: 'items', path: '/items' })).toBe('written')
    expect(await code({ page: 'home', source: 'items', path: '/other' })).toBe('SOURCE_EXISTS')
  })
})
