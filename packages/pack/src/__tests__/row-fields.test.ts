import { describe, expect, it } from 'vitest'
import { checkReceiptRowFields, checkRowFields, entityFieldSets, packFromRecord, rowFieldSets } from '../index.js'

const ENTITIES = new Map([['Product', ['name', 'price', 'tags']]])

const persistence = (dataSources: unknown[]) => [{ capability: 'platform/persistence', config: { dataSources } }]
const PRODUCTS = { id: 'products', kind: 'entity', entityType: 'Product' }

const page = (blocks: unknown[], dataSources: unknown[] = [PRODUCTS]) => ({ blocks, capabilities: persistence(dataSources) })
const check = (receipt: unknown) => checkReceiptRowFields(receipt, ENTITIES, 'app/surfaces/home.receipt.json', 'home')
const fields = (receipt: unknown) => check(receipt).map((i) => i.message.match(/reads field "([^"]+)"/)?.[1])

const repeater = (children: unknown[], repeat = '{{products}}') => ({ id: 'list', type: 'repeater', repeat, children })
const text = (id: string, content: string) => ({ id, type: 'text', props: { content } })

describe('rowFieldSets', () => {
  it('knows an entity source by its declared fields plus the record envelope', () => {
    expect(rowFieldSets(page([]), ENTITIES).get('products')).toEqual(['name', 'price', 'tags', 'id', 'entityType', 'createdAt', 'updatedAt'])
  })

  it('knows static rows and fallback rows by their keys', () => {
    const sets = rowFieldSets(
      page([], [
        { id: 'steps', kind: 'static', staticData: [{ label: 'One' }, { label: 'Two', done: true }] },
        { id: 'news', kind: 'rest', endpoint: 'https://x.test/news', fallback: [{ title: 'Sample' }] },
        { id: 'mixed', kind: 'entity', entityType: 'Product', fallback: [{ sample: 1 }] },
      ]),
      ENTITIES,
    )
    expect(sets.get('steps')).toEqual(['label', 'done'])
    expect(sets.get('news')).toEqual(['title'])
    expect(sets.get('mixed')).toEqual(['name', 'price', 'tags', 'id', 'entityType', 'createdAt', 'updatedAt', 'sample'])
  })

  it('knows nothing of rest, connector, aggregate, state or undeclared sources', () => {
    const sets = rowFieldSets(
      { capabilities: [{ capability: 'persistence', config: { dataSources: [
        { id: 'a', kind: 'rest', endpoint: 'https://x.test' },
        { id: 'b', kind: 'entity', entityType: 'Product', connector: 'graph-lists' },
        { id: 'c', kind: 'entity', entityType: 'Product', aggregate: { fn: 'count' } },
        { id: 'd', kind: 'state' },
        { id: 'e', kind: 'entity', entityType: 'Nope' },
        { id: 'f', kind: 'static', staticData: ['x', 'y'] },
        { id: 'g', kind: 'rest', fallback: [] },
        { kind: 'static', staticData: [{ a: 1 }] },
      ] } }] },
      ENTITIES,
    )
    expect([...sets.keys()]).toEqual([])
    expect(rowFieldSets({ blocks: [] }, ENTITIES).size).toBe(0)
    expect(rowFieldSets('nope', ENTITIES).size).toBe(0)
  })
})

describe('checkReceiptRowFields — repeat templates', () => {
  it('warns on a field the rows do not have, naming surface, block, source and known fields', () => {
    const issues = check(page([repeater([text('name', '{{item.title}}')])]))
    expect(issues).toEqual([
      {
        severity: 'warning',
        code: 'FIELD_UNKNOWN',
        path: 'app/surfaces/home.receipt.json',
        message:
          'surface "home", block "name" reads field "title" of source "products", whose rows have no such field (known: name, price, tags, id, entityType, createdAt, updatedAt); it renders empty',
      },
    ])
  })

  it('is silent on fields the rows have, envelope fields included', () => {
    const receipt = page([
      repeater([
        text('a', '{{item.name}} costs {{currency(item.price, "EUR")}}'),
        text('b', "{{item['id']}} {{item.tags.join(', ')}} {{item.createdAt}}"),
        { id: 'c', type: 'text', visibleWhen: '{{item.price > 0}}', props: { content: 'x', action: { type: 'setState', key: 'sel', value: '{{item.id}}' } } },
      ]),
    ])
    expect(check(receipt)).toEqual([])
  })

  it('reads bracket and hyphenated names, and ignores names inside string literals', () => {
    expect(fields(page([repeater([text('a', "{{item['Title']}} {{item.full-name}} {{'item.nope'}}")])]))).toEqual(['Title', 'full-name'])
  })

  it('checks a repeat over a slice of the source', () => {
    expect(fields(page([repeater([text('a', '{{item.nope}}')], '{{ products.slice(0, 3) }}')]))).toEqual(['nope'])
  })

  it('is silent when the field set is unknown', () => {
    const rest = { id: 'products', kind: 'rest', endpoint: 'https://x.test/p' }
    expect(check(page([repeater([text('a', '{{item.anything}}')])], [rest]))).toEqual([])
    expect(check(page([repeater([text('a', '{{item.anything}}')], '{{products.filter(x)}}')]))).toEqual([])
  })

  it('does not check {{item}} outside a repeat, nor the repeating block\'s own props', () => {
    const own = { id: 'list', type: 'repeater', repeat: '{{products}}', props: { emptyText: '{{item.nope}}' }, children: [text('a', '{{item.name}}')] }
    expect(check(page([text('a', '{{item.nope}}'), own]))).toEqual([])
  })

  it('scopes nested repeats: the inner item is unknown, the inner repeat expression is the outer row', () => {
    const inner = { id: 'reviews', type: 'container', repeat: '{{item.reviews}}', children: [text('stars', '{{item.stars}}')] }
    const issues = check(page([repeater([text('n', '{{item.name}}'), inner])]))
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('block "reviews" reads field "reviews"')])
  })

  it('switches item to the inner source when a nested repeat binds another known source', () => {
    const steps = { id: 'steps', kind: 'static', staticData: [{ label: 'One' }] }
    const inner = { id: 'inner', type: 'container', repeat: '{{steps}}', children: [text('l', '{{item.label}} {{item.name}}')] }
    expect(fields(page([repeater([inner])], [PRODUCTS, steps]))).toEqual(['name'])
  })

  it('skips a string that carries an unresolved slot', () => {
    expect(check(page([repeater([text('a', '{{item.nope}} {{HEADING}}')])]))).toEqual([])
    const faq = { id: 'FAQ', kind: 'static', staticData: [{ q: 'x' }] }
    expect(fields(page([repeater([text('a', '{{item.nope}}')], '{{FAQ}}')], [faq]))).toEqual(['nope'])
  })

  it('reports one read once per block, and names a block without an id by its place', () => {
    const issues = check(page([repeater([{ type: 'text', props: { a: '{{item.x}}', b: '{{item.x}}' } }])]))
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('block "text at blocks[0].children[0]"')
  })

  it('caps the list of known fields', () => {
    const wide = { id: 'wide', kind: 'static', staticData: [Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`f${i}`, i]))] }
    const [issue] = check(page([repeater([text('a', '{{item.nope}}')], '{{wide}}')], [wide]))
    expect(issue?.message).toContain('f11, … and 3 more)')
  })
})

describe('checkReceiptRowFields — field-mapping props', () => {
  const table = (columns: unknown[], extra: Record<string, unknown> = {}) => ({ id: 't', type: 'table', props: { data: '{{products}}', columns, ...extra } })

  it('checks *Field, *Key and columns[].key of a block that receives the rows whole', () => {
    const receipt = page([
      table([{ key: 'name', header: 'Name' }, { key: 'cost' }, { key: 'price', type: 'link', hrefKey: 'url' }], { rowAccentKey: 'data.color' }),
      { id: 'r', type: 'repeater', props: { items: '{{products}}', headingField: 'title', textField: 'name' } },
      { id: 's', type: 'select', props: { options: '{{products}}', labelKey: 'name', valueKey: 'id', stateKey: 'pick' } },
    ])
    expect(fields(receipt)).toEqual(['cost', 'url', 'data', 'title'])
  })

  it('ignores state keys, expressions and blocks bound to no or two known sources', () => {
    const steps = { id: 'steps', kind: 'static', staticData: [{ label: 'One' }] }
    const receipt = page(
      [
        { id: 'a', type: 'select', props: { options: '{{products}}', stateKey: 'x', searchStateKey: 'y', selectionKey: 'z', labelKey: '{{LABEL}}' } },
        { id: 'b', type: 'repeater', props: { headingField: 'nope' } },
        { id: 'c', type: 'repeater', props: { items: '{{products}}', other: '{{steps}}', headingField: 'nope' } },
        { id: 'd', type: 'repeater', props: { items: '{{item}}', headingField: 'nope' } },
        { id: 'e', type: 'table', props: { data: '{{products}}', columns: '{{state.cols}}', action: [{ type: 'setState', key: 'nope' }] } },
      ],
      [PRODUCTS, steps],
    )
    expect(check(receipt)).toEqual([])
  })
})

describe('checkReceiptRowFields — indexed and read-through reads', () => {
  it('checks src.0.f, src[0].f, src[0][\'f\'] and src.f anywhere on the page', () => {
    const receipt = page([
      text('a', '{{products.0.name}} {{products.0.nope1}}'),
      text('b', "{{products[0].nope2}} {{products[ 1 ]['nope3']}}"),
      text('c', '{{products.nope4}} {{products.length}} {{products.slice(0, 2)}} {{__loading.products}} {{state.products}}'),
      { id: 'd', type: 'text', visibleWhen: '{{products.0.price > 1}}', props: { content: '' } },
    ])
    expect(fields(receipt)).toEqual(['nope1', 'nope2', 'nope3', 'nope4'])
  })

  it('does not mistake a longer name for the source', () => {
    const receipt = page([text('a', '{{my-products.0.nope}} {{productsAll.0.nope}} {{x.products.nope}}')])
    expect(check(receipt)).toEqual([])
  })

  it('is silent for a receipt without blocks or known sources', () => {
    expect(check({ capabilities: persistence([PRODUCTS]) })).toEqual([])
    expect(check({ blocks: [text('a', '{{products.0.nope}}')] })).toEqual([])
    expect(check(page(['not a block', text('a', 'plain text')]))).toEqual([])
  })
})

describe('checkRowFields — a pack folder', () => {
  const receipt = (content: string) =>
    JSON.stringify(page([repeater([text('a', content)])]))

  it('reads entities.json and the collection\'s records in app/content and app/data', () => {
    const folder = packFromRecord({
      'app/definitions/entities.json': JSON.stringify({ entities: [{ typeId: 'Product', fields: [{ name: 'name' }, { type: 'text' }] }, { fields: [] }] }),
      'app/content/Product.json': JSON.stringify({ data: [{ id: 'x', sku: 'A1' }] }),
      'app/data/Product.jsonl': '{"note":"dev"}\n\nnot json\n',
      'app/surfaces/home.receipt.json': receipt('{{item.name}} {{item.sku}} {{item.note}} {{item.nope}}'),
      'app/surfaces/broken.receipt.json': '{ nope',
      'app/surfaces/nested/x.receipt.json': receipt('{{item.nope}}'),
    })
    expect(entityFieldSets(folder).get('Product')).toEqual(['name', 'id', 'sku', 'note'])
    const issues = checkRowFields(folder)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.path).toBe('app/surfaces/home.receipt.json')
    expect(issues[0]?.message).toContain('surface "home", block "a" reads field "nope"')
  })

  it('knows nothing without entities.json', () => {
    expect(checkRowFields(packFromRecord({ 'app/surfaces/home.receipt.json': receipt('{{item.nope}}') }))).toEqual([])
    expect(entityFieldSets(packFromRecord({ 'app/definitions/entities.json': '[]' })).size).toBe(0)
  })
})
