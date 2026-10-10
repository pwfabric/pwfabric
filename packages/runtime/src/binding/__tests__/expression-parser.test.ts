/**
 * The shared expression grammar — what both evaluators now parse,
 * and what they refuse. The binding evaluator (`evaluateExpression`) and the
 * block-prop evaluator (`surface/expression` → `evaluate`) run the same
 * tokenizer, parser and AST walk; only name resolution differs.
 *
 * @module @pwfabric/runtime/binding/__tests__/expression-parser
 */
import { describe, it, expect } from 'vitest'
import { evaluateExpression, evaluateWithScope, DEFAULT_BINDING_HELPERS } from '../expression.js'
import { evaluate, createExpressionContext } from '../../surface/expression.js'

const ctx = {
  data: { items: [1, 2, 3], user: { name: 'Ada' } },
  state: { page: 2, q: 'x' },
  params: { id: '7' },
  helpers: DEFAULT_BINDING_HELPERS,
}
const ok = (expr: string): unknown => {
  const r = evaluateExpression(expr, ctx)
  if (!r.success) throw new Error(r.error)
  return r.value
}
const fails = (expr: string): boolean => !evaluateExpression(expr, ctx).success

describe('shared grammar — arithmetic and precedence', () => {
  it('binary minus without spaces is subtraction in the binding evaluator', () => {
    // The old tokenizer read `5-3` as `5`, `-3` and returned 5.
    expect(ok('5-3')).toBe(2)
    expect(ok('10 - -2')).toBe(12)
    expect(ok('state.page-1')).toBe(1)
  })

  it('precedence: * before +, comparison before &&, && before ||', () => {
    expect(ok('1 + 2 * 3')).toBe(7)
    expect(ok('(1 + 2) * 3')).toBe(9)
    expect(ok('1 < 2 && 3 > 4 || true')).toBe(true)
    expect(ok('+"4" + 1')).toBe(5)
    expect(ok('-(2 + 3)')).toBe(-5)
    expect(ok('7 % 4 >= 3')).toBe(true)
    expect(ok('2 <= 1')).toBe(false)
    expect(ok("1 === 1 && 'a' !== 'b'")).toBe(true)
  })

  it('ternaries nest and array literals build arrays', () => {
    expect(ok("state.page > 1 ? state.page > 5 ? 'many' : 'some' : 'one'")).toBe('some')
    expect(ok('[1, state.page, "x"]')).toEqual([1, 2, 'x'])
    expect(ok('[]')).toEqual([])
    expect(ok('items[state.page]')).toBe(3)
  })

  it('&&, || and ?? short-circuit — the unevaluated side may even be invalid at runtime', () => {
    expect(ok('false && noSuchHelper(1)')).toBe(false)
    expect(ok('true || noSuchHelper(1)')).toBe(true)
    expect(ok("'set' ?? noSuchHelper(1)")).toBe('set')
    expect(ok('null ?? 3')).toBe(3)
    expect(ok("true ? 'a' : noSuchHelper(1)")).toBe('a')
  })

  it('names after a dot may be digits or keywords', () => {
    expect(ok('items.0')).toBe(1)
    const scope = { lookup: () => ({ default: 'd', null: 'n', 2: 'two' }), helper: () => undefined }
    expect(evaluateWithScope('x.default', scope)).toBe('d')
    expect(evaluateWithScope('x.null', scope)).toBe('n')
    expect(evaluateWithScope('x.2', scope)).toBe('two')
    expect(evaluateWithScope('   ', scope)).toBeUndefined()
  })

  it('string escapes', () => {
    expect(ok("'a\\nb'")).toBe('a\nb')
    expect(ok("'a\\tb'")).toBe('a\tb')
    expect(ok("'it\\'s'")).toBe("it's")
  })

  it('index access on objects and on nothing', () => {
    expect(ok("data['user']['name']")).toBe('Ada')
    expect(ok('data.missing[0]')).toBeUndefined()
    expect(ok("'abc'[0]")).toBeUndefined()
    expect(ok('data.user.name.nope')).toBeUndefined()
  })
})

describe('shared grammar — safe methods', () => {
  it('string, array and number methods on the allow-list run', () => {
    expect(ok("'Ada Lovelace'.split(' ').join('-')")).toBe('Ada-Lovelace')
    expect(ok("data.user.name.padStart(5, '*')")).toBe('**Ada')
    expect(ok('(3.14159).toFixed(2)')).toBe('3.14')
    expect(ok('items.slice(1).join(",")')).toBe('2,3')
    expect(ok('data.missing.toLowerCase()')).toBeUndefined()
  })

  it('anything else is refused', () => {
    expect(fails('data.user.hasOwnProperty("name")')).toBe(true)
    expect(fails('items.map(1)')).toBe(true)
    expect(fails("'x'.constructor")).toBe(false) // a member read, not a call: undefined
    expect(ok("'x'.constructor")).toBeUndefined()
    expect(fails("'x'.repeat(100000)")).toBe(true)
    expect(fails('(1)(2)')).toBe(true)
  })
})

describe('shared grammar — strict: a malformed expression is an error, not a partial value', () => {
  it.each([
    ['unknown character', 'state.page # 2'],
    ['assignment', 'state.page = 3'],
    ['trailing token', 'state.page state.q'],
    ['unterminated string', "'abc"],
    ['unclosed paren', '(1 + 2'],
    ['missing ternary colon', 'true ? 1'],
    ['missing property name', 'data.'],
    ['unclosed index', 'items[0'],
    ['unknown helper', 'nope(1)'],
    ['empty operand', '1 +'],
    ['leading-digit name', '1abc'],
  ])('%s: %s', (_why, expr) => {
    expect(fails(expr)).toBe(true)
  })

  it('a helper that throws is a failure', () => {
    const r = evaluateExpression('boom()', { ...ctx, helpers: { boom: () => { throw new Error('x') } } })
    expect(r.success).toBe(false)
  })
})

describe('the surface scope', () => {
  it('names resolve against data only; a call only against helpers', () => {
    const c = createExpressionContext({ upper: 'a-value', 'my-src': [{ n: 1 }] })
    // `upper` as a bare name is the data key; as a call it is the helper
    expect(evaluate('upper', c)).toEqual({ success: true, value: 'a-value' })
    expect(evaluate("upper('x')", c)).toEqual({ success: true, value: 'X' })
    expect(evaluate('my-src[0].n', c)).toEqual({ success: true, value: 1 })
  })

  it('reports why it failed', () => {
    const r = evaluate('a ~ b', createExpressionContext({}))
    expect(r.success).toBe(false)
    if (!r.success) expect(r.error).toContain('a ~ b')
  })

  it('the literal undefined stays undefined here, null in the binding evaluator', () => {
    expect(evaluate('undefined', createExpressionContext({}))).toEqual({ success: true, value: undefined })
    expect(ok('undefined')).toBeNull()
  })
})
