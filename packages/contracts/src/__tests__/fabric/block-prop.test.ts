import { describe, expect, it } from 'vitest'
import {
  applyBlockProps,
  checkPropValue,
  coercePropValue,
  propShapeProblems,
  type BlockPropDescriptor,
  type PropIssue,
  type PropShape,
} from '../../fabric/block-prop.js'
import * as root from '../../index.js'

const badge: BlockPropDescriptor[] = [
  { name: 'text', default: '', jsonSchema: { type: 'string' } },
  { name: 'variant', default: 'default', jsonSchema: { type: 'string', enum: ['default', 'primary'] } },
  { name: 'size', jsonSchema: { type: 'string', enum: ['sm', 'md'], default: 'md' } },
  { name: 'gap', default: 16, jsonSchema: { type: 'number', minimum: 0, maximum: 96 } },
  { name: 'rounded', default: false, jsonSchema: { type: 'boolean' } },
  { name: 'icon', jsonSchema: { type: 'string' } },
  { name: 'status', jsonSchema: { type: ['string', 'number', 'boolean'] } },
  {
    name: 'items',
    default: [],
    jsonSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, open: { type: 'boolean', default: false }, n: { type: 'integer' } },
        required: ['label'],
      },
    },
  },
  { name: 'variantMap', jsonSchema: { type: 'object', additionalProperties: { type: 'string', enum: ['default', 'primary'] } } },
]

describe('applyBlockProps — defaults', () => {
  it('fills every declared default the receipt leaves out (descriptor default first, then the shape default)', () => {
    const out = applyBlockProps({ text: 'Hi' }, badge)
    expect(out).toEqual({ text: 'Hi', variant: 'default', size: 'md', gap: 16, rounded: false, items: [] })
  })

  it('fills the defaults of missing members inside arrays of objects', () => {
    const out = applyBlockProps({ items: [{ label: 'A' }, { label: 'B', open: true }] }, badge)
    expect(out['items']).toEqual([{ label: 'A', open: false }, { label: 'B', open: true }])
  })

  it('returns the very same object when nothing changes (a renderer memoises on it)', () => {
    const props = { text: 'x', variant: 'primary', size: 'sm', gap: 8, rounded: true, items: [] }
    expect(applyBlockProps(props, badge)).toBe(props)
  })

  it('passes undeclared props through, and a block without descriptors untouched', () => {
    const props = { extra: 1 }
    expect(applyBlockProps(props, badge)['extra']).toBe(1)
    expect(applyBlockProps(props, undefined)).toBe(props)
  })

  it('treats a null on a prop that takes no null as missing', () => {
    expect(applyBlockProps({ variant: null }, badge)['variant']).toBe('default')
    const out = applyBlockProps({ icon: null }, badge)
    expect('icon' in out && out['icon'] === undefined).toBe(true)
  })
})

describe('applyBlockProps — coercion and invalid values', () => {
  it('coerces losslessly: numeric string to number, "true" to boolean, number to string', () => {
    const out = applyBlockProps({ gap: '24', rounded: 'true', text: 42 }, badge)
    expect(out['gap']).toBe(24)
    expect(out['rounded']).toBe(true)
    expect(out['text']).toBe('42')
  })

  it('replaces a value that does not fit with the default, and reports it — never throws', () => {
    const issues: PropIssue[] = []
    const out = applyBlockProps({ variant: 'loud', gap: 400, rounded: 'yes' }, badge, (i) => issues.push(i))
    expect(out['variant']).toBe('default')
    expect(out['gap']).toBe(16)
    expect(out['rounded']).toBe(false)
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual(['variant:enum', 'gap:maximum', 'rounded:type'])
  })

  it('keeps a bad value with no default as written (it reports it)', () => {
    const issues: PropIssue[] = []
    const out = applyBlockProps({ icon: { a: 1 } }, badge, (i) => issues.push(i))
    expect(out['icon']).toEqual({ a: 1 })
    expect(issues[0]?.code).toBe('type')
  })

  it('reports a required prop with no default that the receipt leaves out', () => {
    const issues: PropIssue[] = []
    applyBlockProps({}, [{ name: 'href', required: true, jsonSchema: { type: 'string' } }], (i) => issues.push(i))
    expect(issues).toEqual([{ path: 'href', code: 'required', message: 'href: is required' }])
  })

  it('a positive control: a fitting value draws no issue', () => {
    const issues: PropIssue[] = []
    applyBlockProps({ variant: 'primary', gap: 0, status: 3, variantMap: { a: 'primary' } }, badge, (i) => issues.push(i))
    expect(issues).toEqual([])
  })
})

describe('checkPropValue', () => {
  const shape = (s: PropShape) => s
  it('types, unions and integer', () => {
    expect(checkPropValue(1.5, shape({ type: 'integer' }), 'n')[0]?.code).toBe('type')
    expect(checkPropValue(2, shape({ type: 'integer' }), 'n')).toEqual([])
    expect(checkPropValue(true, shape({ type: ['string', 'number'] }), 'u')[0]?.code).toBe('type')
    expect(checkPropValue('a', shape({ anyOf: [{ type: 'number' }, { type: 'string', enum: ['a'] }] }), 'x')).toEqual([])
    expect(checkPropValue('b', shape({ anyOf: [{ type: 'number' }, { type: 'string', enum: ['a'] }] }), 'x')[0]?.code).toBe('type')
  })

  it('string bounds, pattern and formats', () => {
    expect(checkPropValue('ab', { type: 'string', minLength: 3 }, 's')[0]?.code).toBe('minLength')
    expect(checkPropValue('abcd', { type: 'string', maxLength: 3 }, 's')[0]?.code).toBe('maxLength')
    expect(checkPropValue('x1', { type: 'string', pattern: '^[a-z]+$' }, 's')[0]?.code).toBe('pattern')
    expect(checkPropValue('nope', { type: 'string', format: 'email' }, 's')[0]?.code).toBe('format')
    expect(checkPropValue('a@b.co', { type: 'string', format: 'email' }, 's')).toEqual([])
    expect(checkPropValue('https://x.y/z', { type: 'string', format: 'url' }, 's')).toEqual([])
    expect(checkPropValue('2026-13-45', { type: 'string', format: 'date' }, 's')[0]?.code).toBe('format')
  })

  it('arrays and objects, with paths', () => {
    const items = badge.find((d) => d.name === 'items')?.jsonSchema
    const issues = checkPropValue([{ label: 'a' }, { n: 1.2 }], items, 'items')
    expect(issues.map((i) => `${i.path}:${i.code}`)).toEqual(['items[1].label:required', 'items[1].n:type'])
    expect(checkPropValue([1, 2, 3], { type: 'array', maxItems: 2 }, 'a')[0]?.code).toBe('maxItems')
    expect(checkPropValue({ a: 1 }, { type: 'object', properties: {}, additionalProperties: false }, 'o')[0]?.code).toBe('unknownMember')
  })
})

describe('coercePropValue', () => {
  it('leaves what cannot be brought to the shape as it is', () => {
    expect(coercePropValue('abc', { type: 'number' })).toBe('abc')
    expect(coercePropValue('', { type: 'number' })).toBe('')
    expect(coercePropValue('1.5', { type: 'integer' })).toBe('1.5')
  })
  it('coerces inside a union only to a branch that then fits', () => {
    expect(coercePropValue('12', { anyOf: [{ type: 'number' }, { type: 'boolean' }] })).toBe(12)
  })
})

describe('propShapeProblems', () => {
  it('names keywords the runtime does not read, bad types, bad patterns and a default that does not fit', () => {
    expect(propShapeProblems({ type: 'string', minimumLength: 2 }, 'p')).toEqual(['p: "minimumLength" is not a keyword a prop shape reads'])
    expect(propShapeProblems({ type: 'text' }, 'p')).toEqual(['p: type "text" is not a JSON type'])
    expect(propShapeProblems({ type: 'string', pattern: '(' }, 'p')[0]).toContain('not a valid RegExp')
    expect(propShapeProblems({ type: 'number', maximum: 4, default: 9 }, 'p')[0]).toContain('above the maximum')
    expect(propShapeProblems({ type: 'object', properties: { a: { type: 'string', enum: ['x'] } } }, 'p')).toEqual([])
  })
})

describe('the root exports the prop contract', () => {
  it('applyBlockProps and checkPropValue are reachable from @pwfabric/contracts', () => {
    expect(root.applyBlockProps).toBe(applyBlockProps)
    expect(root.checkPropValue).toBe(checkPropValue)
  })
})
