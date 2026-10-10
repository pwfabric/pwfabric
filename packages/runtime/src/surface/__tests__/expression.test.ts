/**
 * Expression Evaluator Tests
 *
 * Tests for expression evaluation
 */

import { describe, it, expect } from 'vitest'
import {
  evaluate,
  resolvePath,
  interpolate,
  createExpressionContext,
  DEFAULT_HELPERS,
} from '../expression.js'

describe('resolvePath', () => {
  it('should resolve simple paths', () => {
    const obj = { name: 'John', age: 30 }
    expect(resolvePath(obj, 'name')).toBe('John')
    expect(resolvePath(obj, 'age')).toBe(30)
  })

  it('should resolve nested paths', () => {
    const obj = { user: { profile: { name: 'John' } } }
    expect(resolvePath(obj, 'user.profile.name')).toBe('John')
  })

  it('should resolve array indices', () => {
    const obj = { items: ['a', 'b', 'c'] }
    expect(resolvePath(obj, 'items[0]')).toBe('a')
    expect(resolvePath(obj, 'items[2]')).toBe('c')
  })

  it('should return undefined for missing paths', () => {
    const obj = { name: 'John' }
    expect(resolvePath(obj, 'missing')).toBeUndefined()
    expect(resolvePath(obj, 'a.b.c')).toBeUndefined()
  })
})

describe('evaluate', () => {
  const context = createExpressionContext({
    name: 'John',
    count: 5,
    active: true,
    items: ['a', 'b', 'c'],
    user: { role: 'admin' },
  })

  describe('literals', () => {
    it('should evaluate string literals', () => {
      expect(evaluate("'hello'", context)).toEqual({ success: true, value: 'hello' })
      expect(evaluate('"world"', context)).toEqual({ success: true, value: 'world' })
    })

    it('should evaluate number literals', () => {
      expect(evaluate('42', context)).toEqual({ success: true, value: 42 })
      expect(evaluate('-3.14', context)).toEqual({ success: true, value: -3.14 })
    })

    it('should evaluate boolean literals', () => {
      expect(evaluate('true', context)).toEqual({ success: true, value: true })
      expect(evaluate('false', context)).toEqual({ success: true, value: false })
    })

    it('should evaluate null and undefined', () => {
      expect(evaluate('null', context)).toEqual({ success: true, value: null })
      expect(evaluate('undefined', context)).toEqual({ success: true, value: undefined })
    })
  })

  describe('path resolution', () => {
    it('should resolve simple variables', () => {
      expect(evaluate('name', context)).toEqual({ success: true, value: 'John' })
      expect(evaluate('count', context)).toEqual({ success: true, value: 5 })
    })

    it('should resolve nested paths', () => {
      expect(evaluate('user.role', context)).toEqual({ success: true, value: 'admin' })
    })
  })

  describe('comparisons', () => {
    it('should evaluate equality', () => {
      expect(evaluate("name === 'John'", context)).toEqual({ success: true, value: true })
      expect(evaluate("name !== 'Jane'", context)).toEqual({ success: true, value: true })
    })

    it('should evaluate numeric comparisons', () => {
      expect(evaluate('count > 3', context)).toEqual({ success: true, value: true })
      expect(evaluate('count < 10', context)).toEqual({ success: true, value: true })
      expect(evaluate('count >= 5', context)).toEqual({ success: true, value: true })
      expect(evaluate('count <= 5', context)).toEqual({ success: true, value: true })
    })
  })

  describe('logical operators', () => {
    it('should evaluate negation', () => {
      expect(evaluate('!active', context)).toEqual({ success: true, value: false })
      expect(evaluate('!false', context)).toEqual({ success: true, value: true })
    })

    it('should evaluate AND', () => {
      expect(evaluate('active && count > 0', context)).toEqual({ success: true, value: true })
    })

    it('should evaluate OR', () => {
      expect(evaluate('count < 0 || active', context)).toEqual({ success: true, value: true })
    })
  })

  describe('ternary', () => {
    it('should evaluate ternary expressions', () => {
      expect(evaluate("active ? 'yes' : 'no'", context)).toEqual({ success: true, value: 'yes' })
      expect(evaluate("!active ? 'yes' : 'no'", context)).toEqual({ success: true, value: 'no' })
    })
  })

  describe('helpers', () => {
    it('should call built-in helpers', () => {
      expect(evaluate('upper(name)', context)).toEqual({ success: true, value: 'JOHN' })
      expect(evaluate('length(items)', context)).toEqual({ success: true, value: 3 })
    })

    it('should fail for unknown helpers', () => {
      const result = evaluate('unknown()', context)
      expect(result.success).toBe(false)
    })
  })
})

describe('interpolate', () => {
  const context = createExpressionContext({
    name: 'John',
    count: 5,
  })

  it('should interpolate expressions in strings', () => {
    expect(interpolate('Hello, {{name}}!', context)).toEqual({
      success: true,
      value: 'Hello, John!',
    })
  })

  it('should interpolate multiple expressions', () => {
    expect(interpolate('{{name}} has {{count}} items', context)).toEqual({
      success: true,
      value: 'John has 5 items',
    })
  })

  it('should handle missing values', () => {
    expect(interpolate('Hello, {{missing}}!', context)).toEqual({
      success: true,
      value: 'Hello, !',
    })
  })
})

describe('DEFAULT_HELPERS', () => {
  it('should have string helpers', () => {
    expect(DEFAULT_HELPERS.upper('hello')).toBe('HELLO')
    expect(DEFAULT_HELPERS.lower('HELLO')).toBe('hello')
    expect(DEFAULT_HELPERS.trim('  hi  ')).toBe('hi')
  })

  it('should have number helpers', () => {
    expect(DEFAULT_HELPERS.round(3.7)).toBe(4)
    expect(DEFAULT_HELPERS.floor(3.7)).toBe(3)
    expect(DEFAULT_HELPERS.ceil(3.2)).toBe(4)
  })

  it('should have array helpers', () => {
    expect(DEFAULT_HELPERS.first([1, 2, 3])).toBe(1)
    expect(DEFAULT_HELPERS.last([1, 2, 3])).toBe(3)
    expect(DEFAULT_HELPERS.isEmpty([])).toBe(true)
    expect(DEFAULT_HELPERS.isNotEmpty([1])).toBe(true)
  })

  it('should have type helpers', () => {
    expect(DEFAULT_HELPERS.isArray([1, 2])).toBe(true)
    expect(DEFAULT_HELPERS.isString('hello')).toBe(true)
    expect(DEFAULT_HELPERS.isNumber(42)).toBe(true)
  })
})

describe('helper parity with the binding evaluator', () => {
  it('folds a KPI with sumBy — the helper the binding set had and this one lacked', () => {
    const ctx = createExpressionContext({
      customers: [{ mrr: 100 }, { mrr: 250 }],
      'licensing-skus': [{ enabled: 5 }, { enabled: 7 }],
    })
    expect(evaluate("sumBy(customers,'mrr')", ctx)).toEqual({ success: true, value: 350 })
    // a hyphenated data-source id is a path, not a subtraction
    expect(evaluate("sumBy(licensing-skus,'enabled')", ctx)).toEqual({ success: true, value: 12 })
    expect(interpolate("${{sumBy(customers,'mrr')}}", ctx)).toEqual({ success: true, value: '$350' })
  })

  it('exposes every binding helper by name', () => {
    for (const name of ['sumBy', 'groupCount', 'min', 'max', 'join', 'currency', 'date']) {
      expect(typeof DEFAULT_HELPERS[name]).toBe('function')
    }
  })
})

/**
 * A list source binds as a list, so a one-record detail source arrives as
 * `[record]`. Dot paths read through a list of EXACTLY ONE; a longer list is
 * still a list. The binding evaluator carries the same rule (see its tests).
 */
describe('a list of one record reads by dot path', () => {
  const one = { product: [{ title: 'Muz', tags: ['a', 'b'], meta: { sku: 'M1' } }] }
  const two = { product: [{ title: 'Elma' }, { title: 'Armut' }] }

  it('continues a property read into the single element', () => {
    expect(resolvePath(one, 'product.title')).toBe('Muz')
    expect(resolvePath(one, 'product.meta.sku')).toBe('M1')
    expect(resolvePath(one, 'product.tags[1]')).toBe('b')
  })

  it('keeps index and length reads on the list itself', () => {
    expect(resolvePath(one, 'product[0].title')).toBe('Muz')
    expect(resolvePath(one, 'product.0.title')).toBe('Muz')
    expect(resolvePath(one, 'product.length')).toBe(1)
  })

  it('does not fall through a list of two or more', () => {
    expect(resolvePath(two, 'product.title')).toBeUndefined()
    expect(resolvePath(two, 'product[1].title')).toBe('Armut')
    expect(resolvePath(two, 'product.length')).toBe(2)
  })

  it('does not invent a field on a list of one scalar', () => {
    expect(resolvePath({ xs: ['a'] }, 'xs.title')).toBeUndefined()
  })

  it('renders through interpolate the way a block prop does', () => {
    const ctx = createExpressionContext(one)
    expect(interpolate('{{product.title}} · {{product.length}}', ctx)).toEqual({
      success: true,
      value: 'Muz · 1',
    })
    expect(interpolate('[{{product.title}}]', createExpressionContext(two))).toEqual({
      success: true,
      value: '[]',
    })
  })
})
