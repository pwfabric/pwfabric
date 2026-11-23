import { describe, expect, it } from 'vitest'
import {
  BLOCK_DEFAULT_COPY,
  ERROR_BOUND_AS_TEXT,
  blockMessagesOf,
  blockPropDescriptors,
  checkDefaultCopy,
  checkReceiptDefaultCopy,
  checkReceiptErrorsAsText,
  packFromRecord,
  placedBlockWords,
  type BlockPropsCatalog,
  type BlockSource,
} from '../index.js'

const copyButton = {
  id: 'control.copy-button',
  kind: 'block',
  definition: {
    props: [
      { name: 'value', jsonSchema: { type: 'string', default: '' } },
      { name: 'label', copy: true, default: 'Copy', jsonSchema: { type: 'string', default: 'Copy' } },
      { name: 'copiedLabel', copy: true, jsonSchema: { type: 'string', default: 'Copied' } },
      { name: 'hint', copy: true, jsonSchema: { type: 'string', default: '' } },
      { name: 'size', default: 'md', jsonSchema: { type: 'string', enum: ['sm', 'md'] } },
    ],
  },
}
const text = { id: 'text.text', kind: 'block', definition: { props: [{ name: 'text' }, { name: 'visibleWhen' }, { name: 'muted', jsonSchema: { type: 'boolean' } }] } }

const catalog: BlockPropsCatalog = new Map([
  ['copy-button', { atomId: 'control.copy-button', props: blockPropDescriptors(copyButton) ?? [] }],
  ['text', { atomId: 'text.text', props: blockPropDescriptors(text) ?? [] }],
])
const PATH = 'app/surfaces/home.receipt.json'

describe('BLOCK_DEFAULT_COPY', () => {
  it('warns for each copy prop with a non-empty default that the receipt leaves unset', () => {
    const issues = checkReceiptDefaultCopy({ blocks: [{ id: 'c', type: 'copy-button', props: { value: 'x' } }] }, catalog, PATH)
    expect(issues.map((i) => [i.code, i.severity])).toEqual([
      [BLOCK_DEFAULT_COPY, 'warning'],
      [BLOCK_DEFAULT_COPY, 'warning'],
    ])
    expect(issues[0]?.message).toContain('label')
    expect(issues[0]?.message).toContain('"Copy"')
    expect(issues[1]?.message).toContain('"Copied"')
  })

  it('is quiet when the receipt sets the prop, the default is empty, or the prop is not copy', () => {
    const set = { blocks: [{ id: 'c', type: 'copy-button', props: { label: 'Kopyala', copiedLabel: '{{t}}' } }] }
    expect(checkReceiptDefaultCopy(set, catalog, PATH)).toEqual([])
  })

  it('finds nested blocks, and reads every receipt of an app', () => {
    const receipt = { blocks: [{ id: 's', type: 'stack', children: [{ id: 'c', type: 'copy-button', props: { label: 'L' } }] }] }
    const app = packFromRecord({ [PATH]: JSON.stringify(receipt), 'app/surfaces/x.json': '{}' })
    const issues = checkDefaultCopy(app, catalog)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.message).toContain('blocks[0].children[0] (copy-button "c")')
  })
})

describe('ERROR_BOUND_AS_TEXT', () => {
  const page = (props: Record<string, unknown>, extra: Record<string, unknown> = {}): unknown => ({
    blocks: [{ id: 't', type: 'text', props }],
    ...extra,
  })
  const codes = (receipt: unknown): string[] => checkReceiptErrorsAsText(receipt, catalog, PATH).map((i) => i.code)

  it('warns when __errors.<id> is shown, whole or interpolated', () => {
    expect(codes(page({ text: '{{__errors.orders}}' }))).toEqual([ERROR_BOUND_AS_TEXT])
    expect(codes(page({ text: 'Failed: {{ __errors.orders }}' }))).toEqual([ERROR_BOUND_AS_TEXT])
    expect(codes(page({ items: [{ label: '{{__errors.orders}}' }] }))).toEqual([ERROR_BOUND_AS_TEXT])
  })

  it('warns when the state key of a statusKeys.reason or .detail is shown', () => {
    const caps = {
      capabilities: [{ config: { formBindings: [{ formId: 'f', statusKeys: { reason: 'why', detail: 'dev', error: 'failed' } }] } }],
    }
    expect(codes(page({ text: '{{state.why}}' }, caps))).toEqual([ERROR_BOUND_AS_TEXT])
    expect(codes(page({ text: '{{state.dev}}' }, caps))).toEqual([ERROR_BOUND_AS_TEXT])
    expect(codes(page({ text: '{{state.failed}}' }, caps))).toEqual([])
    expect(codes(page({ text: '{{state.why}}' }))).toEqual([])
  })

  it('is quiet when the code is branched on', () => {
    expect(codes(page({ visibleWhen: '{{__errors.orders}}', text: 'Could not load.' }))).toEqual([])
    expect(codes(page({ muted: '{{__errors.orders}}' }))).toEqual([])
    expect(codes(page({ text: "{{__errors.orders == 'forbidden' ? 'No access' : 'Try again'}}" }))).toEqual([])
    expect(codes(page({ text: '{{!__errors.orders}}' }))).toEqual([])
    expect(codes(page({ text: '{{__errorCodes.orders}}' }))).toEqual([])
  })
})

describe('the words placed blocks read of their own', () => {
  const navbar = { definition: { props: [{ name: 'links' }], messages: [{ id: 'ui.menu.open' }, { id: 'ui.menu.close' }, { id: 'ui.nav.main', prop: 'navLabel' }] } }
  const sources = (receipts: Record<string, unknown>): BlockSource[] => [
    {
      folder: packFromRecord(Object.fromEntries(Object.entries(receipts).map(([p, r]) => [p, JSON.stringify(r)]))),
      atoms: [],
    },
    {
      folder: packFromRecord({ 'atoms/blocks/layout/navbar/manifest.json': JSON.stringify(navbar), 'atoms/blocks/text/title/manifest.json': '{"definition":{"props":[]}}' }),
      atoms: [
        { kind: 'block', id: 'layout.navbar', relPath: 'atoms/blocks/layout/navbar/component.tsx' },
        { kind: 'block', id: 'text.title', relPath: 'atoms/blocks/text/title/component.tsx' },
      ],
      label: '.pwf/packs/foundation',
    },
  ]

  it('reads the declaration of a block manifest', () => {
    expect(blockMessagesOf(navbar)).toEqual([{ id: 'ui.menu.open' }, { id: 'ui.menu.close' }, { id: 'ui.nav.main', prop: 'navLabel' }])
    expect(blockMessagesOf({ definition: { messages: [{ id: 'nope' }, 'ui.x', { id: 'ui.ok', prop: 3 }] } })).toEqual([{ id: 'ui.ok' }])
    expect(blockMessagesOf({})).toEqual([])
  })

  it('lists each word a placed block reads, in pages and in the layout, unless the receipt sets the prop that replaces it', () => {
    const words = placedBlockWords(
      sources({
        'app/layout.receipt.json': { blocks: [{ id: 'bar', type: 'navbar', props: {} }, { id: 'slot', type: 'page' }] },
        'app/surfaces/home.receipt.json': { blocks: [{ id: 's', type: 'stack', children: [{ id: 'nav2', type: 'layout.navbar', props: { navLabel: 'Main' } }, { id: 't', type: 'title' }] }] },
      })
    )
    expect(words.map((w) => [w.id, w.path, w.atomId])).toEqual([
      ['ui.menu.open', 'app/layout.receipt.json', 'layout.navbar'],
      ['ui.menu.close', 'app/layout.receipt.json', 'layout.navbar'],
      ['ui.nav.main', 'app/layout.receipt.json', 'layout.navbar'],
      ['ui.menu.open', 'app/surfaces/home.receipt.json', 'layout.navbar'],
      ['ui.menu.close', 'app/surfaces/home.receipt.json', 'layout.navbar'],
    ])
    expect(words[0]?.block).toBe('blocks[0] (navbar "bar")')
  })

  it('reads nothing when no placed block declares a word', () => {
    expect(placedBlockWords(sources({ 'app/surfaces/home.receipt.json': { blocks: [{ id: 't', type: 'title' }] } }))).toEqual([])
    expect(placedBlockWords([])).toEqual([])
  })
})
