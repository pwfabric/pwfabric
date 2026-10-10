/**
 * Expression Evaluator Tests
 *
 * Tests for data binding expression evaluation
 *
 * @module @pwfabric/runtime/binding/__tests__/expression
 */

import { describe, it, expect } from 'vitest'
import {
  evaluateExpression,
  resolvePath,
  extractDependencies,
  isExpression,
  interpolate,
  createExpressionEvaluator,
  DEFAULT_BINDING_HELPERS,
  type BindingExpressionContext,
} from '../expression.js'

// ============================================================
// TEST DATA
// ============================================================

function createContext(overrides?: Partial<BindingExpressionContext>): BindingExpressionContext {
  return {
    data: {
      user: {
        name: 'John',
        age: 30,
        email: 'john@example.com',
        profile: {
          avatar: 'avatar.png',
          bio: 'Developer',
        },
      },
      items: [
        { id: 1, name: 'Apple', price: 1.5 },
        { id: 2, name: 'Banana', price: 0.75 },
        { id: 3, name: 'Orange', price: 2.0 },
      ],
      count: 5,
      enabled: true,
      tags: ['tag1', 'tag2', 'tag3'],
    },
    state: {
      selectedId: 2,
      filter: 'active',
      showDetails: false,
    },
    params: {
      id: '123',
      page: 1,
    },
    helpers: DEFAULT_BINDING_HELPERS,
    ...overrides,
  }
}

// ============================================================
// PATH RESOLUTION TESTS
// ============================================================

describe('resolvePath', () => {
  it('should resolve simple property', () => {
    const obj = { name: 'John' }
    expect(resolvePath(obj, 'name')).toBe('John')
  })

  it('should resolve nested property', () => {
    const obj = { user: { profile: { name: 'John' } } }
    expect(resolvePath(obj, 'user.profile.name')).toBe('John')
  })

  it('should resolve array index', () => {
    const obj = { items: ['a', 'b', 'c'] }
    expect(resolvePath(obj, 'items[0]')).toBe('a')
    expect(resolvePath(obj, 'items[1]')).toBe('b')
  })

  it('should resolve nested array access', () => {
    const obj = { users: [{ name: 'John' }, { name: 'Jane' }] }
    expect(resolvePath(obj, 'users[0].name')).toBe('John')
    expect(resolvePath(obj, 'users[1].name')).toBe('Jane')
  })

  it('should return undefined for missing properties', () => {
    const obj = { name: 'John' }
    expect(resolvePath(obj, 'missing')).toBeUndefined()
    expect(resolvePath(obj, 'user.name')).toBeUndefined()
  })

  it('should return undefined for null/undefined path', () => {
    expect(resolvePath({ name: 'John' }, '')).toBeUndefined()
    expect(resolvePath(null, 'name')).toBeUndefined()
    expect(resolvePath(undefined, 'name')).toBeUndefined()
  })
})

// ============================================================
// LITERAL EVALUATION TESTS
// ============================================================

describe('evaluateExpression - literals', () => {
  const context = createContext()

  it('should evaluate number literals', () => {
    expect(evaluateExpression('42', context)).toEqual({ success: true, value: 42 })
    expect(evaluateExpression('3.14', context)).toEqual({ success: true, value: 3.14 })
    expect(evaluateExpression('-10', context)).toEqual({ success: true, value: -10 })
  })

  it('should evaluate string literals', () => {
    expect(evaluateExpression("'hello'", context)).toEqual({
      success: true,
      value: 'hello',
    })
    expect(evaluateExpression('"world"', context)).toEqual({
      success: true,
      value: 'world',
    })
  })

  it('should evaluate boolean literals', () => {
    expect(evaluateExpression('true', context)).toEqual({ success: true, value: true })
    expect(evaluateExpression('false', context)).toEqual({ success: true, value: false })
  })

  it('should evaluate null/undefined literals', () => {
    expect(evaluateExpression('null', context)).toEqual({ success: true, value: null })
    expect(evaluateExpression('undefined', context)).toEqual({
      success: true,
      value: null,
    })
  })

  it('should evaluate empty expression', () => {
    expect(evaluateExpression('', context)).toEqual({ success: true, value: undefined })
    expect(evaluateExpression('   ', context)).toEqual({
      success: true,
      value: undefined,
    })
  })
})

// ============================================================
// VARIABLE ACCESS TESTS
// ============================================================

describe('evaluateExpression - variable access', () => {
  const context = createContext()

  it('should access data properties', () => {
    expect(evaluateExpression('data.user.name', context)).toEqual({
      success: true,
      value: 'John',
    })
    expect(evaluateExpression('data.count', context)).toEqual({
      success: true,
      value: 5,
    })
  })

  it('should access state properties', () => {
    expect(evaluateExpression('state.selectedId', context)).toEqual({
      success: true,
      value: 2,
    })
    expect(evaluateExpression('state.filter', context)).toEqual({
      success: true,
      value: 'active',
    })
  })

  it('should access params properties', () => {
    expect(evaluateExpression('params.id', context)).toEqual({
      success: true,
      value: '123',
    })
  })

  it('should support shorthand access (priority: params > state > data)', () => {
    // 'id' exists in params
    expect(evaluateExpression('id', context)).toEqual({
      success: true,
      value: '123',
    })

    // 'filter' exists in state
    expect(evaluateExpression('filter', context)).toEqual({
      success: true,
      value: 'active',
    })

    // 'user' exists in data
    const result = evaluateExpression('user', context)
    expect(result.success).toBe(true)
    if (result.success) {
      expect((result.value as Record<string, unknown>).name).toBe('John')
    }
  })

  it('should access array elements', () => {
    expect(evaluateExpression('data.items[0].name', context)).toEqual({
      success: true,
      value: 'Apple',
    })
    expect(evaluateExpression('data.tags[1]', context)).toEqual({
      success: true,
      value: 'tag2',
    })
  })

  it('should access nested properties', () => {
    expect(evaluateExpression('data.user.profile.avatar', context)).toEqual({
      success: true,
      value: 'avatar.png',
    })
  })
})

// ============================================================
// ARITHMETIC OPERATOR TESTS
// ============================================================

describe('evaluateExpression - arithmetic', () => {
  const context = createContext()

  it('should evaluate addition', () => {
    expect(evaluateExpression('1 + 2', context)).toEqual({ success: true, value: 3 })
    expect(evaluateExpression('data.count + 10', context)).toEqual({
      success: true,
      value: 15,
    })
  })

  it('should evaluate subtraction', () => {
    expect(evaluateExpression('10 - 3', context)).toEqual({ success: true, value: 7 })
    expect(evaluateExpression('data.count - 2', context)).toEqual({
      success: true,
      value: 3,
    })
  })

  it('should evaluate multiplication', () => {
    expect(evaluateExpression('3 * 4', context)).toEqual({ success: true, value: 12 })
    expect(evaluateExpression('data.items[0].price * 2', context)).toEqual({
      success: true,
      value: 3.0,
    })
  })

  it('should evaluate division', () => {
    expect(evaluateExpression('10 / 2', context)).toEqual({ success: true, value: 5 })
  })

  it('should evaluate modulo', () => {
    expect(evaluateExpression('10 % 3', context)).toEqual({ success: true, value: 1 })
  })

  it('should respect operator precedence', () => {
    expect(evaluateExpression('2 + 3 * 4', context)).toEqual({ success: true, value: 14 })
    expect(evaluateExpression('(2 + 3) * 4', context)).toEqual({
      success: true,
      value: 20,
    })
  })

  it('should handle string concatenation with +', () => {
    expect(evaluateExpression("'hello' + ' ' + 'world'", context)).toEqual({
      success: true,
      value: 'hello world',
    })
  })
})

// ============================================================
// COMPARISON OPERATOR TESTS
// ============================================================

describe('evaluateExpression - comparisons', () => {
  const context = createContext()

  it('should evaluate strict equality', () => {
    expect(evaluateExpression('5 === 5', context)).toEqual({ success: true, value: true })
    expect(evaluateExpression("'5' === 5", context)).toEqual({
      success: true,
      value: false,
    })
  })

  it('should evaluate strict inequality', () => {
    expect(evaluateExpression('5 !== 3', context)).toEqual({ success: true, value: true })
  })

  it('should evaluate greater than', () => {
    expect(evaluateExpression('data.count > 3', context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression('data.count > 10', context)).toEqual({
      success: true,
      value: false,
    })
  })

  it('should evaluate less than', () => {
    expect(evaluateExpression('data.count < 10', context)).toEqual({
      success: true,
      value: true,
    })
  })

  it('should evaluate greater than or equal', () => {
    expect(evaluateExpression('data.count >= 5', context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression('data.count >= 6', context)).toEqual({
      success: true,
      value: false,
    })
  })

  it('should evaluate less than or equal', () => {
    expect(evaluateExpression('data.count <= 5', context)).toEqual({
      success: true,
      value: true,
    })
  })
})

// ============================================================
// LOGICAL OPERATOR TESTS
// ============================================================

describe('evaluateExpression - logical', () => {
  const context = createContext()

  it('should evaluate logical AND', () => {
    expect(evaluateExpression('true && true', context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression('true && false', context)).toEqual({
      success: true,
      value: false,
    })
    expect(evaluateExpression('data.enabled && data.count > 0', context)).toEqual({
      success: true,
      value: true,
    })
  })

  it('should evaluate logical OR', () => {
    expect(evaluateExpression('false || true', context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression('false || false', context)).toEqual({
      success: true,
      value: false,
    })
  })

  it('should evaluate negation', () => {
    expect(evaluateExpression('!true', context)).toEqual({ success: true, value: false })
    expect(evaluateExpression('!false', context)).toEqual({ success: true, value: true })
    expect(evaluateExpression('!data.enabled', context)).toEqual({
      success: true,
      value: false,
    })
  })

  it('should evaluate null coalescing', () => {
    expect(evaluateExpression('null ?? "default"', context)).toEqual({
      success: true,
      value: 'default',
    })
    expect(evaluateExpression("'value' ?? 'default'", context)).toEqual({
      success: true,
      value: 'value',
    })
  })
})

// ============================================================
// TERNARY OPERATOR TESTS
// ============================================================

describe('evaluateExpression - ternary', () => {
  const context = createContext()

  it('should evaluate ternary with true condition', () => {
    expect(evaluateExpression("true ? 'yes' : 'no'", context)).toEqual({
      success: true,
      value: 'yes',
    })
  })

  it('should evaluate ternary with false condition', () => {
    expect(evaluateExpression("false ? 'yes' : 'no'", context)).toEqual({
      success: true,
      value: 'no',
    })
  })

  it('should evaluate ternary with expression condition', () => {
    expect(evaluateExpression("data.count > 3 ? 'many' : 'few'", context)).toEqual({
      success: true,
      value: 'many',
    })
    expect(evaluateExpression("data.count > 10 ? 'many' : 'few'", context)).toEqual({
      success: true,
      value: 'few',
    })
  })

  it('should evaluate nested ternary', () => {
    expect(
      evaluateExpression("data.count > 10 ? 'many' : data.count > 3 ? 'some' : 'few'", context)
    ).toEqual({ success: true, value: 'some' })
  })
})

// ============================================================
// HELPER FUNCTION TESTS
// ============================================================

describe('evaluateExpression - helpers', () => {
  const context = createContext()

  it('should call string helpers', () => {
    expect(evaluateExpression("upper('hello')", context)).toEqual({
      success: true,
      value: 'HELLO',
    })
    expect(evaluateExpression("lower('HELLO')", context)).toEqual({
      success: true,
      value: 'hello',
    })
    expect(evaluateExpression("trim('  hello  ')", context)).toEqual({
      success: true,
      value: 'hello',
    })
  })

  it('should call number helpers', () => {
    expect(evaluateExpression('round(3.7)', context)).toEqual({
      success: true,
      value: 4,
    })
    expect(evaluateExpression('floor(3.7)', context)).toEqual({
      success: true,
      value: 3,
    })
    expect(evaluateExpression('ceil(3.2)', context)).toEqual({
      success: true,
      value: 4,
    })
    expect(evaluateExpression('abs(-5)', context)).toEqual({
      success: true,
      value: 5,
    })
  })

  it('should call array helpers', () => {
    expect(evaluateExpression('length(data.items)', context)).toEqual({
      success: true,
      value: 3,
    })
    const firstResult = evaluateExpression('first(data.items)', context)
    expect(firstResult.success).toBe(true)
    if (firstResult.success) {
      expect((firstResult.value as Record<string, unknown>).name).toBe('Apple')
    }
  })

  it('should call type check helpers', () => {
    expect(evaluateExpression('isArray(data.items)', context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression('isString(data.user.name)', context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression('isNumber(data.count)', context)).toEqual({
      success: true,
      value: true,
    })
  })

  it('should call isEmpty/isNotEmpty', () => {
    expect(evaluateExpression("isEmpty('')", context)).toEqual({
      success: true,
      value: true,
    })
    expect(evaluateExpression("isNotEmpty('hello')", context)).toEqual({
      success: true,
      value: true,
    })
  })
})

// ============================================================
// DEPENDENCY EXTRACTION TESTS
// ============================================================

describe('extractDependencies', () => {
  it('should extract data dependencies', () => {
    const deps = extractDependencies('data.user.name')
    expect(deps).toEqual([{ source: 'data', path: 'user.name' }])
  })

  it('should extract state dependencies', () => {
    const deps = extractDependencies('state.selectedId')
    expect(deps).toEqual([{ source: 'state', path: 'selectedId' }])
  })

  it('should extract params dependencies', () => {
    const deps = extractDependencies('params.id')
    expect(deps).toEqual([{ source: 'params', path: 'id' }])
  })

  it('should extract multiple dependencies', () => {
    const deps = extractDependencies(
      'data.user.name + " - " + state.filter + " (ID: " + params.id + ")"'
    )
    expect(deps).toHaveLength(3)
    expect(deps).toContainEqual({ source: 'data', path: 'user.name' })
    expect(deps).toContainEqual({ source: 'state', path: 'filter' })
    expect(deps).toContainEqual({ source: 'params', path: 'id' })
  })

  it('should handle array access in paths', () => {
    const deps = extractDependencies('data.items[0].name')
    expect(deps).toEqual([{ source: 'data', path: 'items[0].name' }])
  })

  it('should deduplicate dependencies', () => {
    const deps = extractDependencies('data.user.name + data.user.name')
    expect(deps).toHaveLength(1)
  })
})

// ============================================================
// INTERPOLATION TESTS
// ============================================================

describe('interpolate', () => {
  const context = createContext()

  it('should interpolate simple expressions', () => {
    expect(interpolate('Hello, {{data.user.name}}!', context)).toBe('Hello, John!')
  })

  it('should interpolate multiple expressions', () => {
    expect(interpolate('{{data.user.name}} is {{data.user.age}} years old', context)).toBe(
      'John is 30 years old'
    )
  })

  it('should handle expressions with operators', () => {
    expect(interpolate('Total: {{data.count * 2}}', context)).toBe('Total: 10')
  })

  it('should handle ternary in interpolation', () => {
    expect(interpolate("Status: {{data.enabled ? 'active' : 'inactive'}}", context)).toBe(
      'Status: active'
    )
  })

  it('should return empty string for null/undefined values', () => {
    expect(interpolate('Value: {{data.missing}}', context)).toBe('Value: ')
  })

  it('should leave non-expression text unchanged', () => {
    expect(interpolate('No expressions here', context)).toBe('No expressions here')
  })
})

// ============================================================
// IS EXPRESSION TESTS
// ============================================================

describe('isExpression', () => {
  it('should return true for strings with expression syntax', () => {
    expect(isExpression('{{user.name}}')).toBe(true)
    expect(isExpression('Hello, {{name}}!')).toBe(true)
  })

  it('should return false for strings without expression syntax', () => {
    expect(isExpression('Hello, world!')).toBe(false)
    expect(isExpression('')).toBe(false)
  })

  it('should return false for non-strings', () => {
    expect(isExpression(123)).toBe(false)
    expect(isExpression(null)).toBe(false)
    expect(isExpression(undefined)).toBe(false)
    expect(isExpression({ name: 'John' })).toBe(false)
  })
})

// ============================================================
// EXPRESSION EVALUATOR FACTORY TESTS
// ============================================================

describe('createExpressionEvaluator', () => {
  it('should create evaluator with default helpers', () => {
    const evaluator = createExpressionEvaluator()
    const context = createContext()

    expect(evaluator.evaluate("upper('test')", context)).toBe('TEST')
  })

  it('should create evaluator with custom helpers', () => {
    const evaluator = createExpressionEvaluator({
      double: (n: unknown) => Number(n) * 2,
    })
    const context = createContext()

    expect(evaluator.evaluate('double(5)', context)).toBe(10)
  })

  it('should support isExpression', () => {
    const evaluator = createExpressionEvaluator()

    expect(evaluator.isExpression('{{value}}')).toBe(true)
    expect(evaluator.isExpression('plain text')).toBe(false)
  })

  it('should support extractDependencies', () => {
    const evaluator = createExpressionEvaluator()

    const deps = evaluator.extractDependencies('data.user.name')
    expect(deps).toContainEqual({ source: 'data', path: 'user.name' })
  })

  it('should support interpolate', () => {
    const evaluator = createExpressionEvaluator()
    const context = createContext()

    expect(evaluator.interpolate('Hello, {{data.user.name}}!', context)).toBe('Hello, John!')
  })
})

// ============================================================
// EDGE CASE TESTS
// ============================================================

describe('evaluateExpression - edge cases', () => {
  const context = createContext()

  it('should handle parentheses correctly', () => {
    expect(evaluateExpression('(1 + 2) * 3', context)).toEqual({
      success: true,
      value: 9,
    })
    expect(evaluateExpression('((1 + 2) * (3 + 4))', context)).toEqual({
      success: true,
      value: 21,
    })
  })

  it('should handle array literals', () => {
    const result = evaluateExpression('[1, 2, 3]', context)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.value).toEqual([1, 2, 3])
    }
  })

  it('should handle chained method calls', () => {
    // Access property of result. A string's `.length` is readable since the
    // two evaluators share one parser; before, it was undefined.
    expect(evaluateExpression('data.user.name.length', context)).toEqual({
      success: true,
      value: 4,
    })
    // …and a safe method can be chained onto it.
    expect(evaluateExpression('data.user.name.toUpperCase().startsWith("JO")', context)).toEqual({
      success: true,
      value: true,
    })
  })

  it('should safely handle null/undefined access', () => {
    expect(evaluateExpression('data.missing.property', context)).toEqual({
      success: true,
      value: undefined,
    })
  })
})

describe('aggregate helpers — sumBy / groupCount', () => {
  const items = [
    { sku: 'E3', consumed: 40, severity: 'high' },
    { sku: 'E5', consumed: 12, severity: 'high' },
    { sku: 'F3', consumed: 'n/a', severity: 'low' },
    { sku: 'G1', consumed: 3, severity: null },
  ]
  it('sumBy folds a numeric field, skipping non-numeric values', () => {
    expect(DEFAULT_BINDING_HELPERS.sumBy?.(items, 'consumed')).toBe(55)
    expect(DEFAULT_BINDING_HELPERS.sumBy?.([1, 2, '3'])).toBe(6)
    expect(DEFAULT_BINDING_HELPERS.sumBy?.('not-a-list', 'x')).toBe(0)
  })
  it('groupCount counts per field value; nullish/empty bucket as "unknown"', () => {
    expect(DEFAULT_BINDING_HELPERS.groupCount?.(items, 'severity')).toEqual({ high: 2, low: 1, unknown: 1 })
    expect(DEFAULT_BINDING_HELPERS.groupCount?.(undefined, 'severity')).toEqual({})
  })
})

/**
 * Parity with surface/expression: a list of EXACTLY ONE record is read through
 * by a property access, both in `resolvePath` and in the expression parser's
 * member access. A longer list stays a list.
 */
describe('a list of one record reads by dot path', () => {
  const ctx = createContext({
    data: {
      product: [{ title: 'Muz', meta: { sku: 'M1' } }],
      pair: [{ title: 'Elma' }, { title: 'Armut' }],
    },
  })

  it('resolvePath continues into the single element', () => {
    expect(resolvePath(ctx.data, 'product.title')).toBe('Muz')
    expect(resolvePath(ctx.data, 'product.meta.sku')).toBe('M1')
    expect(resolvePath(ctx.data, 'product[0].title')).toBe('Muz')
    expect(resolvePath(ctx.data, 'product.length')).toBe(1)
    expect(resolvePath(ctx.data, 'pair.title')).toBeUndefined()
    expect(resolvePath(ctx.data, 'pair[1].title')).toBe('Armut')
  })

  it('member access in expressions follows the same rule', () => {
    expect(evaluateExpression('data.product.title', ctx)).toEqual({ success: true, value: 'Muz' })
    expect(evaluateExpression('data.product[0].title', ctx)).toEqual({
      success: true,
      value: 'Muz',
    })
    expect(evaluateExpression('data.product.length', ctx)).toEqual({ success: true, value: 1 })
    expect(evaluateExpression('data.pair.title', ctx)).toEqual({ success: true, value: undefined })
    expect(evaluateExpression('data.pair.length', ctx)).toEqual({ success: true, value: 2 })
  })

  it('interpolates a detail read', () => {
    expect(interpolate('{{data.product.title}} ({{data.product.meta.sku}})', ctx)).toBe(
      'Muz (M1)'
    )
    expect(interpolate('[{{data.pair.title}}]', ctx)).toBe('[]')
  })
})
