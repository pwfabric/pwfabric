import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { parseCsv, writeCsv, unguard } from '../../commands/lib/csv.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

const ENTITIES = {
  entities: [
    {
      typeId: 'Product',
      fields: [
        { name: 'name', type: 'text', required: true },
        { name: 'price', type: 'number', min: 0 },
        { name: 'inStock', type: 'boolean' },
        { name: 'kind', type: 'enum', values: ['bread', 'cake'] },
      ],
    },
  ],
}
const ID1 = '0b7d1c56-3f7e-4a52-9a0c-1f2e3d4c5b6a'
const ID2 = '1c8e2d67-4a8f-4b63-8b1d-2a3f4e5d6c7b'

async function app(): Promise<{ cwd: string; root: string }> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  const root = join(cwd, 'demo')
  await mkdir(join(root, 'app', 'definitions'), { recursive: true })
  await writeFile(join(root, 'app', 'definitions', 'entities.json'), JSON.stringify(ENTITIES))
  await writeFile(join(root, 'app', 'definitions', 'auth.json'), JSON.stringify({ access: { roles: [], rules: [{ subject: 'public', model: 'Product', rule: 'read' }] } }))
  return { cwd, root }
}
const content = async (root: string): Promise<Record<string, unknown>[]> => JSON.parse(await readFile(join(root, 'app', 'content', 'Product.json'), 'utf8')).data

describe('csv', () => {
  it('reads and writes RFC 4180, with the formula guard', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"line\nbreak",\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line\nbreak', '']])
    expect(writeCsv(['a', 'b'], [['=1+1', '-5'], ['x,y', 'q"']], [[true, false], [true, true]])).toBe('a,b\r\n\'=1+1,-5\r\n"x,y","q"""\r\n')
    expect(unguard("'=1+1")).toBe('=1+1')
    expect(unguard("'tis")).toBe("'tis")
    expect(() => parseCsv('"open')).toThrow(/not closed/)
  })
})

describe('pwf records', () => {
  it('imports CSV typed by the entity, gives each record a UUID, and exports it back', async () => {
    const { cwd, root } = await app()
    await writeFile(join(cwd, 'p.csv'), `id,name,price,inStock,kind\r\n${ID1},Sourdough,4.5,true,bread\r\n,"Cake, chocolate",12,false,cake\r\n`)
    const c = capture(root)
    expect(await main(['records', 'import', 'Product', '../p.csv'], c.io), c.text()).toBe(0)
    expect(c.out[0]).toBe('Imported 2 Product records into app/content/Product.json: 2 new, 0 replaced, 0 kept')
    const rows = await content(root)
    expect(rows[0]).toEqual({ id: ID1, name: 'Sourdough', price: 4.5, inStock: true, kind: 'bread' })
    expect(rows[1]).toMatchObject({ name: 'Cake, chocolate', price: 12, inStock: false })
    expect(rows[1]?.['id']).toMatch(/^[0-9a-f-]{36}$/)
    const v = capture(root)
    expect(await main(['validate'], v.io), v.text()).toBe(0)

    const out = capture(root)
    expect(await main(['records', 'export', 'Product', '--format', 'csv'], out.io)).toBe(0)
    expect(out.out[0]).toBe(`id,name,price,inStock,kind\r\n${ID1},Sourdough,4.5,true,bread\r\n${rows[1]?.['id']},"Cake, chocolate",12,false,cake`)
    await main(['records', 'export', 'Product', '--out', '../again.csv'], capture(root).io)
    // Exported and imported again with --replace: the same records.
    expect(await main(['records', 'import', 'Product', '../again.csv', '--replace'], capture(root).io)).toBe(0)
    expect(await content(root)).toEqual(rows)
  })

  it('merges by id without --replace, and replaces everything with it', async () => {
    const { cwd, root } = await app()
    await writeFile(join(cwd, 'a.json'), JSON.stringify([{ id: ID1, name: 'A' }, { id: ID2, name: 'B' }]))
    await writeFile(join(cwd, 'b.json'), JSON.stringify({ data: [{ id: ID2, name: 'B2' }] }))
    expect(await main(['records', 'import', 'Product', '../a.json'], capture(root).io)).toBe(0)
    const c = capture(root)
    expect(await main(['records', 'import', 'Product', '../b.json'], c.io)).toBe(0)
    expect(c.out[0]).toMatch(/0 new, 1 replaced, 1 kept/)
    expect((await content(root)).map((r) => r['name'])).toEqual(['A', 'B2'])
    expect(await main(['records', 'import', 'Product', '../b.json', '--replace'], capture(root).io)).toBe(0)
    expect((await content(root)).map((r) => r['name'])).toEqual(['B2'])
  })

  it('writes nothing when any record breaks its entity, naming each problem by row', async () => {
    const { cwd, root } = await app()
    await writeFile(join(cwd, 'bad.csv'), `name,price,inStock,colour\r\n,-1,yes,red\r\nOk,abc,true,\r\n`)
    const c = capture(root)
    expect(await main(['records', 'import', 'Product', '../bad.csv'], c.io)).toBe(1)
    const text = c.err.join('\n')
    expect(text).toMatch(/row 2: price: must be at least 0/)
    expect(text).toMatch(/row 2: inStock: must be true or false/)
    expect(text).toMatch(/row 2: colour: is not a field of Product/)
    expect(text).toMatch(/row 2: name: is required/)
    expect(text).toMatch(/row 3: price: must be a number/)
    expect(existsSync(join(root, 'app', 'content', 'Product.json'))).toBe(false)

    await writeFile(join(cwd, 'ids.json'), JSON.stringify([{ id: 'nope', name: 'x' }, { id: ID1, name: 'y' }, { id: ID1, name: 'z' }]))
    const ids = capture(root)
    expect(await main(['records', 'import', 'Product', '../ids.json'], ids.io)).toBe(1)
    expect(ids.err.join('\n')).toMatch(/record 1: id: must be a UUID/)
    expect(ids.err.join('\n')).toMatch(/record 3: id: .* is given twice/)
    const unknown = capture(root)
    expect(await main(['records', 'export', 'Order'], unknown.io)).toBe(1)
    expect(unknown.text()).toMatch(/Order is not an entity/)
  })

  it('guards formula cells on export', async () => {
    const { cwd, root } = await app()
    await writeFile(join(cwd, 'f.json'), JSON.stringify([{ id: ID1, name: '=HYPERLINK("http://x")', price: 1 }]))
    expect(await main(['records', 'import', 'Product', '../f.json'], capture(root).io)).toBe(0)
    const out = capture(root)
    expect(await main(['records', 'export', 'Product', '--format', 'csv'], out.io)).toBe(0)
    expect(out.out[0]?.split('\r\n')[1]).toBe(`${ID1},"'=HYPERLINK(""http://x"")",1,,`)
  })
})
