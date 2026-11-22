import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { main } from '../../index.js'
import { applyPattern, parseSlotValue } from '../../commands/lib/pattern-apply.js'
import { capture, FIXTURE_FOUNDATION, tempDir } from './helpers.js'

async function app(): Promise<string> {
  const cwd = await tempDir()
  expect(await main(['create', 'demo', '--foundation', FIXTURE_FOUNDATION], capture(cwd).io)).toBe(0)
  return join(cwd, 'demo')
}
const json = async (root: string, rel: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(root, ...rel.split('/')), 'utf8'))

/** The spec's own example (pattern-format §1), shortened. */
const RECORD_LIST = {
  name: 'record-list',
  role: 'band',
  body: 'dense',
  description: 'A list of records.',
  knowledge: { purpose: 'x', useCases: ['x'], composesWith: [], antiPatterns: ['x'] },
  placeholders: {
    '{{TITLE}}': 'heading.text',
    '{{ENTITY}}': 'the entity type',
    '{{TITLE_FIELD}}': { description: 'the row field shown', type: 'field' },
    '{{ROWS}}': 'fallback rows',
  },
  usesBlocks: ['section', 'heading', 'repeater', 'text'],
  dataSources: [{ id: 'records', kind: 'entity', entityType: '{{ENTITY}}', fallback: '{{ROWS}}' }],
  snippet: {
    id: '{{ID}}',
    type: 'section',
    props: {},
    children: [
      { id: '{{ID}}-h', type: 'heading', props: { text: '{{TITLE}}', level: 'h2' } },
      { id: '{{ID}}-list', type: 'repeater', repeat: '{{records}}', props: {}, children: [{ id: '{{ID}}-line', type: 'text', props: { content: '{{item.{{TITLE_FIELD}}}}' } }] },
    ],
  },
}
const FILLED = ['--slot', 'TITLE=Tickets', '--slot', 'ENTITY=Ticket', '--slot', 'TITLE_FIELD=subject', '--slot', 'ROWS=[]']

describe('applyPattern', () => {
  it('expands as pattern-format §4 shows', () => {
    const values = new Map<string, unknown>([
      ['TITLE', 'Open tickets'],
      ['ENTITY', 'Ticket'],
      ['TITLE_FIELD', 'subject'],
      ['ROWS', []],
    ])
    const applied = applyPattern(RECORD_LIST, 'tickets', values)
    const section = applied.blocks[0] as { id: string; children: { id: string; children?: { props: { content: string } }[] }[] }
    expect([section.id, ...section.children.map((c) => c.id)]).toEqual(['tickets', 'tickets-h', 'tickets-list'])
    expect(section.children[1]?.children?.[0]?.props.content).toBe('{{item.subject}}')
    expect(applied.capabilities).toEqual([{ capability: 'platform/persistence', config: { dataSources: [{ id: 'records', kind: 'entity', entityType: 'Ticket', fallback: [] }] } }])
  })

  it('reads slot values', () => {
    expect(parseSlotValue('ROWS=[]')).toEqual(['ROWS', []])
    expect(parseSlotValue('N=12')).toEqual(['N', 12])
    expect(parseSlotValue('TITLE=12 loaves')).toEqual(['TITLE', '12 loaves'])
    expect(parseSlotValue('TITLE=a=b')).toEqual(['TITLE', 'a=b'])
    expect(() => parseSlotValue('title=x')).toThrow(/upper-case/)
  })
})

describe('pwf page add', () => {
  it('writes an empty page, appends it to the order and to the plan that lists pages', async () => {
    const root = await app()
    expect(await main(['page', 'add', 'docs/intro', '--title', 'Introduction', '--layout', 'false'], capture(root).io)).toBe(0)
    expect(await json(root, 'app/surfaces/docs/intro.receipt.json')).toEqual({ title: 'Introduction', layout: false, blocks: [] })
    expect(((await json(root, 'pwpack.json'))['app'] as { surfaceOrder: string[] }).surfaceOrder).toEqual(['home', 'docs/intro'])
    const surfaces = (await json(root, 'app/plan.json'))['surfaces'] as Record<string, unknown>[]
    expect(surfaces.at(-1)).toMatchObject({ key: 'docs/intro', name: 'Introduction', isEntry: false, status: 'applied' })
    expect(await main(['validate'], capture(root).io)).toBe(0)

    const again = capture(root)
    expect(await main(['page', 'add', 'docs/intro'], again.io)).toBe(1)
    expect(again.text()).toMatch(/exists already/)
    expect(await main(['page', 'add', 'Docs'], capture(root).io)).toBe(2)
    expect(await main(['page', 'add', 'assets/x'], capture(root).io)).toBe(1)
  })

  it('leaves the plan alone when it lists no pages', async () => {
    const root = await app()
    const plan = await json(root, 'app/plan.json')
    delete plan['surfaces']
    await writeFile(join(root, 'app', 'plan.json'), JSON.stringify(plan))
    expect(await main(['page', 'add', 'about'], capture(root).io)).toBe(0)
    expect((await json(root, 'app/plan.json'))['surfaces']).toBeUndefined()
  })

  it('builds a page from a pattern, and names every slot it lacks', async () => {
    const root = await app()
    await mkdir(join(root, 'atoms', 'patterns'), { recursive: true })
    await writeFile(join(root, 'atoms', 'patterns', 'record-list.json'), JSON.stringify(RECORD_LIST))
    const lacking = capture(root)
    expect(await main(['page', 'add', 'tickets', '--pattern', 'record-list', '--slot', 'TITLE=Tickets'], lacking.io)).toBe(1)
    expect(lacking.err).toContain('  TITLE_FIELD: the row field shown (field)')
    expect(lacking.err).toContain('  ENTITY: the entity type')
    expect(existsSync(join(root, 'app', 'surfaces', 'tickets.receipt.json'))).toBe(false)

    const c = capture(root)
    expect(await main(['page', 'add', 'tickets', '--pattern', 'record-list', ...FILLED], c.io)).toBe(0)
    expect(c.out[1]).toMatch(/the pattern record-list from atoms\/patterns\/record-list\.json/)
    const receipt = await json(root, 'app/surfaces/tickets.receipt.json')
    expect((receipt['blocks'] as { id: string }[])[0]?.id).toBe('tickets')
    expect(receipt['capabilities']).toHaveLength(1)
  })

  it('finds a pattern in a pinned pack, and refuses an unknown one', async () => {
    const root = await app()
    const pin = ((await json(root, 'pwpack.json'))['packs'] as { id: string; version: string }[])[0] as { id: string; version: string }
    const dir = join(root, '.pwf', 'packs', ...`${pin.id}@${pin.version}`.split('/'), 'atoms', 'patterns')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'record-list.json'), JSON.stringify(RECORD_LIST))
    const c = capture(root)
    expect(await main(['page', 'add', 'list', '--pattern', `${pin.id}/record-list`, ...FILLED], c.io)).toBe(0)
    expect(c.out[1]).toContain(`from ${pin.id}@${pin.version}`)
    const none = capture(root)
    expect(await main(['page', 'add', 'x', '--pattern', 'no-such'], none.io)).toBe(1)
    expect(none.text()).toMatch(/no pattern "no-such"/)
  })

  it('takes per-locale paths in an app with locales and refuses a conflicting one', async () => {
    const root = await app()
    expect(await main(['page', 'add', 'pricing', '--path', 'de=preise'], capture(root).io)).toBe(2)
    expect(await main(['locale', 'add', 'de'], capture(root).io)).toBe(0)
    expect(await main(['page', 'add', 'pricing', '--path', 'de=preise'], capture(root).io)).toBe(0)
    expect((await json(root, 'app/surfaces/pricing.receipt.json'))['path']).toEqual({ de: 'preise' })
    const clash = capture(root)
    expect(await main(['page', 'add', 'prices', '--path', 'de=preise'], clash.io)).toBe(1)
    expect(clash.text()).toMatch(/share the address "de\/preise\/"/)
    const prefix = capture(root)
    expect(await main(['page', 'add', 'de/about'], prefix.io)).toBe(1)
    expect(prefix.text()).toMatch(/starts with a locale prefix/)
    expect(await main(['page', 'add', 'home.de'], capture(root).io)).toBe(1)
  })
})
