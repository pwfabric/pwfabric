import { describe, expect, it } from 'vitest'
import type { AtomRef } from '@pwfabric/contracts'
import {
  atomManifestPath,
  blockPropDescriptors,
  blockPropsCatalog,
  blockTypeNames,
  checkBlockProps,
  checkReceiptBlockProps,
  isBinding,
  isTemplate,
  packFromRecord,
  type BlockPropsCatalog,
} from '../index.js'

const button = {
  id: 'control.button',
  kind: 'block',
  name: 'button',
  definition: {
    props: [
      { name: 'label', jsonSchema: { type: 'string' } },
      { name: 'size', jsonSchema: { type: 'string', enum: ['small', 'medium', 'large'] } },
      { name: 'href', jsonSchema: { oneOf: [{ type: 'string' }, { const: '' }] } },
      { name: 'disabled', jsonSchema: { type: 'boolean' } },
      { name: 'gap', jsonSchema: { type: 'number' } },
      { name: 'count', jsonSchema: { type: 'integer' } },
      { name: 'level', jsonSchema: { anyOf: [{ enum: [1, 2, 3] }, { type: 'string' }] } },
      { name: 'ratio', jsonSchema: { anyOf: [{ enum: ['16:9', '4:3'] }, { enum: ['1:1'] }] } },
      { name: 'items', jsonSchema: { type: 'array', items: { type: 'object' } } },
      { name: 'action', jsonSchema: { oneOf: [{ type: 'object', properties: { type: { const: 'refresh' } } }, { type: 'array' }] } },
      { name: 'free' },
      { name: 'nullable', jsonSchema: { type: ['string', 'null'] } },
      { name: 'both', jsonSchema: { allOf: [{ type: 'string' }, { enum: ['a', 'b'] }] } },
      { name: 'shape', jsonSchema: { type: 'object', const: { a: 1 } } },
      { name: 'whatever', jsonSchema: { description: 'anything' } },
      { name: 'code', bindable: false, jsonSchema: { type: 'string' } },
      { name: 'sample', bindable: false },
      { name: 'variant', bindable: false, jsonSchema: { enum: ['a', 'b'] } },
      { name: 'caption', bindable: true },
    ],
  },
}

const catalog: BlockPropsCatalog = new Map([
  ['button', { atomId: 'control.button', props: blockPropDescriptors(button) ?? [] }],
  ['section', { atomId: 'layout.section', props: [{ name: 'gap', jsonSchema: { type: 'number' } }] }],
])

const receipt = (blocks: unknown[]): unknown => ({ title: 'T', blocks })
const check = (props: Record<string, unknown>, type = 'button') =>
  checkReceiptBlockProps(receipt([{ id: 'b', type, props }]), catalog, 'app/surfaces/home.receipt.json')
const codes = (props: Record<string, unknown>): string[] => check(props).map((i) => i.code)

describe('checkReceiptBlockProps', () => {
  it('accepts props that fit', () => {
    expect(
      check({
        label: 'Go',
        size: 'small',
        href: '',
        disabled: false,
        gap: 1.5,
        count: 3,
        level: 2,
        ratio: '1:1',
        items: [{ a: 1 }],
        action: { type: 'refresh' },
        free: { anything: true },
        nullable: null,
        both: 'a',
        shape: { a: 1 },
        whatever: 7,
      })
    ).toEqual([])
  })

  it('warns about a value outside an enum and names the allowed values', () => {
    const [issue] = check({ size: 'sm' })
    expect(issue).toMatchObject({ severity: 'warning', code: 'BLOCK_PROP_ENUM', path: 'app/surfaces/home.receipt.json' })
    expect(issue?.message).toContain('blocks[0] (button "b") sets size = "sm"')
    expect(issue?.message).toContain('"small", "medium", "large"')
  })

  it('warns about an enum miss inside anyOf, listing every branch', () => {
    const [issue] = check({ ratio: '16:5' })
    expect(issue?.code).toBe('BLOCK_PROP_ENUM')
    expect(issue?.message).toContain('"16:9", "4:3", "1:1"')
    expect(codes({ both: 'c' })).toEqual(['BLOCK_PROP_ENUM'])
    expect(codes({ shape: { a: 2 } })).toEqual(['BLOCK_PROP_ENUM'])
    expect(codes({ level: 4 })).toEqual(['BLOCK_PROP_ENUM'])
    expect(codes({ level: 4.5 })).toEqual(['BLOCK_PROP_ENUM'])
  })

  it('warns about a wrong JSON type', () => {
    expect(codes({ gap: '16' })).toEqual(['BLOCK_PROP_TYPE'])
    expect(codes({ count: 1.5 })).toEqual(['BLOCK_PROP_TYPE'])
    expect(codes({ disabled: 'yes' })).toEqual(['BLOCK_PROP_TYPE'])
    expect(codes({ items: {} })).toEqual(['BLOCK_PROP_TYPE'])
    expect(codes({ size: 3 })).toEqual(['BLOCK_PROP_TYPE'])
    expect(codes({ nullable: 1 })).toEqual(['BLOCK_PROP_TYPE'])
    expect(codes({ action: 'go' })).toEqual(['BLOCK_PROP_TYPE'])
    const [issue] = check({ gap: 1.5 }, 'section')
    expect(issue).toBeUndefined()
    expect(check({ label: 2.5 })[0]?.message).toContain('to a number (2.5); control.button expects string')
    expect(check({ label: 'x'.repeat(100) }).length).toBe(0)
    expect(check({ gap: 'x'.repeat(100) })[0]?.message).toContain('…')
  })

  it('warns about a value of the right type that breaks the rest of its shape, as the runtime reads it (BLOCK_PROP_SHAPE)', () => {
    // A member of a nested object: the runtime renders the default instead.
    expect(codes({ action: { type: 'navigate' } })).toEqual(['BLOCK_PROP_SHAPE'])
    // An array item that is not an object.
    expect(codes({ items: [{}, 3] })).toEqual(['BLOCK_PROP_SHAPE'])
    const [issue] = check({ items: [{}, 3] })
    expect(issue?.message).toContain('items[1]')
    // A binding anywhere in the value is left to the runtime.
    expect(codes({ items: [{}, '{{row}}'] })).toEqual([])
    // Positive control: a fitting nested value draws nothing.
    expect(codes({ items: [{}, {}] })).toEqual([])
  })

  it('warns about a prop the manifest does not declare', () => {
    const [issue] = check({ tone: 'loud', ghost: undefined })
    expect(issue?.code).toBe('BLOCK_PROP_UNKNOWN')
    expect(issue?.message).toContain('sets "tone", which control.button does not declare')
    expect(checkReceiptBlockProps(receipt([{ type: 'x', props: { a: 1 } }]), new Map([['x', { atomId: 'a.x', props: [] }]]), 'p')[0]?.message).toContain('its props: none')
  })

  it('skips bindings, whole or interpolated', () => {
    expect(check({ size: '{{state.size}}', gap: 'px {{ item.gap }}', count: '{{n}}' })).toEqual([])
    expect(isBinding('{{a}}')).toBe(true)
    expect(isBinding('a {{b}} c')).toBe(true)
    expect(isBinding('{a}')).toBe(false)
    expect(isBinding(3)).toBe(false)
  })

  it('warns about a template on a bindable: false prop, which renders as written', () => {
    const [issue, ...rest] = check({ code: 'x = {{state.x}}' })
    expect(rest).toEqual([])
    expect(issue).toMatchObject({ severity: 'warning', code: 'BLOCK_PROP_NOT_BINDABLE', path: 'app/surfaces/home.receipt.json' })
    expect(issue?.message).toBe(
      'blocks[0] (button "b") sets code to "x = {{state.x}}", but control.button declares code bindable: false; the {{…}} is not resolved and renders as written'
    )
  })

  it('finds a template nested in a bindable: false prop, and names where it is', () => {
    const [issue] = check({ sample: { lines: ['plain', { text: '{{ item.name }}' }] } })
    expect(issue?.code).toBe('BLOCK_PROP_NOT_BINDABLE')
    expect(issue?.message).toContain('sets sample.lines[1].text to "{{ item.name }}"')
    expect(check({ sample: [['{{a}}', '{{b}}']] })).toHaveLength(1)
  })

  it('leaves bindable props, literal values and non-templates alone', () => {
    expect(check({ caption: '{{a}}', label: '{{a}}', code: 'no braces', sample: { a: ['{a}', 3, null, true] } })).toEqual([])
    // Not a template for the runtime either: nothing between the braces, or a line break in an interpolation.
    expect(check({ code: '{{}}' })).toEqual([])
    expect(check({ code: 'a {{b\n}} c' })).toEqual([])
  })

  it('judges a bindable: false value as the literal it is', () => {
    expect(codes({ variant: '{{state.v}}' })).toEqual(['BLOCK_PROP_NOT_BINDABLE', 'BLOCK_PROP_ENUM'])
    expect(codes({ variant: 'a' })).toEqual([])
  })

  it('tells a template as the runtime does', () => {
    expect(isTemplate('{{a}}')).toBe(true)
    expect(isTemplate('a {{ b }} c')).toBe(true)
    expect(isTemplate('{{\n  a\n}}')).toBe(true)
    expect(isTemplate('{{}}')).toBe(false)
    expect(isTemplate('a {{b\n}} c')).toBe(false)
    expect(isTemplate('{a}')).toBe(false)
    expect(isTemplate(3)).toBe(false)
  })

  it('walks children and skips unknown types and nodes without props', () => {
    const issues = checkReceiptBlockProps(
      receipt([
        { type: 'mystery', props: { size: 'x' }, children: [{ id: 'c', type: 'button', props: { size: 'xl' } }] },
        { type: 'section' },
        'not a node',
        { type: 7, props: {} },
      ]),
      catalog,
      'r'
    )
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('blocks[0].children[0] (button "c") sets size = "xl"')])
    expect(checkReceiptBlockProps({ blocks: 'no' }, catalog, 'r')).toEqual([])
    expect(checkReceiptBlockProps(null, catalog, 'r')).toEqual([])
  })
})

describe('blockPropDescriptors', () => {
  it('reads definition.props, else a top-level props, else nothing', () => {
    expect(blockPropDescriptors({ definition: { props: [{ name: 'a' }, { nope: 1 }, { name: '' }, null] } })).toEqual([{ name: 'a' }])
    expect(blockPropDescriptors({ props: [{ name: 'b' }] })).toEqual([{ name: 'b' }])
    expect(blockPropDescriptors({ definition: {} })).toBeUndefined()
    expect(blockPropDescriptors('x')).toBeUndefined()
  })
})

describe('blockTypeNames / atomManifestPath', () => {
  it('answers to the id, the manifest name and the short forms', () => {
    expect(blockTypeNames('control.button', { name: 'Button' })).toEqual(['control.button', 'Button', 'button'])
    expect(blockTypeNames('a.b.c')).toEqual(['a.b.c', 'b.c', 'c'])
    expect(blockTypeNames('solo', { name: '' })).toEqual(['solo'])
  })
  it('finds the manifest beside the entry', () => {
    expect(atomManifestPath({ relPath: 'atoms/blocks/control/button/component.tsx' })).toBe('atoms/blocks/control/button/manifest.json')
    expect(atomManifestPath({ relPath: 'atoms/x.json' })).toBe('atoms/x.json')
    expect(atomManifestPath({ relPath: 'component.tsx' })).toBe('manifest.json')
  })
})

describe('blockPropsCatalog + checkBlockProps', () => {
  const ref = (id: string, relPath: string): AtomRef => ({ kind: 'block', id, relPath })
  const manifest = (props: unknown[]): string => JSON.stringify({ definition: { props } })

  it('resolves the app first, then packs in order, and checks every receipt', () => {
    const app = packFromRecord({
      'atoms/blocks/custom/greeting/component.tsx': 'x',
      'atoms/blocks/custom/greeting/manifest.json': manifest([{ name: 'name', jsonSchema: { type: 'string' } }]),
      'app/surfaces/home.receipt.json': JSON.stringify(receipt([{ type: 'greeting', props: { name: 3 } }, { type: 'button', props: { size: 'sm' } }])),
      'app/surfaces/about.receipt.json': '﻿' + JSON.stringify(receipt([{ type: 'text', props: { tone: 1 } }])),
      'app/surfaces/broken.receipt.json': '{',
      'app/surfaces/nested/x.receipt.json': JSON.stringify(receipt([{ type: 'button', props: { size: 'sm' } }])),
    })
    const foundation = packFromRecord({
      'atoms/blocks/control/button/component.tsx': 'x',
      'atoms/blocks/control/button/manifest.json': JSON.stringify(button),
      'atoms/blocks/text/text/component.tsx': 'x',
      'atoms/blocks/text/text/manifest.json': manifest([{ name: 'content' }]),
      'atoms/blocks/custom/greeting/component.tsx': 'x',
      'atoms/blocks/custom/greeting/manifest.json': manifest([{ name: 'name', jsonSchema: { type: 'number' } }]),
      'atoms/blocks/legacy/plain/component.tsx': 'x',
      'atoms/blocks/legacy/plain/manifest.json': '{ nope',
    })
    const other = packFromRecord({ 'atoms/blocks/x/button/manifest.json': manifest([]) })
    const catalog = blockPropsCatalog([
      { folder: app, atoms: [ref('custom.greeting', 'atoms/blocks/custom/greeting/component.tsx')] },
      {
        folder: foundation,
        atoms: [
          ref('control.button', 'atoms/blocks/control/button/component.tsx'),
          ref('text.text', 'atoms/blocks/text/text/component.tsx'),
          ref('custom.greeting', 'atoms/blocks/custom/greeting/component.tsx'),
          ref('legacy.plain', 'atoms/blocks/legacy/plain/component.tsx'),
          { kind: 'capability', id: 'platform/x', relPath: 'atoms/capabilities/x/manifest.json' },
        ],
      },
      { folder: other, atoms: [ref('x.button', 'atoms/blocks/x/button/component.tsx')] },
    ])
    expect(catalog.get('greeting')?.props[0]?.jsonSchema).toEqual({ type: 'string' })
    expect(catalog.get('button')?.atomId).toBe('control.button')
    expect(catalog.has('plain')).toBe(false)
    const issues = checkBlockProps(app, catalog)
    expect(issues.map((i) => [i.path, i.code])).toEqual([
      ['app/surfaces/about.receipt.json', 'BLOCK_PROP_UNKNOWN'],
      ['app/surfaces/home.receipt.json', 'BLOCK_PROP_TYPE'],
      ['app/surfaces/home.receipt.json', 'BLOCK_PROP_ENUM'],
    ])
  })
})
