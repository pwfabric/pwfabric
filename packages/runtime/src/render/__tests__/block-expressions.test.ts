/**
 * The block-prop / `visibleWhen` evaluator, on the shapes a generator
 * actually produces.
 *
 * N1  `{{a == 'x' && (b != 'y' || c)}}` could not be parsed: `resolveString`
 *     returned the raw template, a non-empty string, so the block was ALWAYS
 *     visible — the "no results" empty state showed next to the results and
 *     every menu filter did nothing. Parentheses, arithmetic and safe
 *     method calls now parse; a condition that still cannot be parsed hides
 *     the block instead of showing it.
 * N3  `join(item.allergens, ', ')` split its arguments on every comma, so the
 *     separator arrived as `""` and the list ran together ("glutenmilk").
 *  +  Pagination: `ceil(total / 20)` needed division, and `pages(total, size)`
 *     is the safe spelling (0 on a missing or zero size).
 *
 * @module @pwfabric/runtime/render/__tests__/block-expressions
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { resolveBlockExpressions, resolveString } from '../resolve-expressions.js'
import { createExpressionContext, evaluate } from '../../surface/expression.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const block = (id: string, extra: Partial<Block> & Record<string, unknown> = {}): Block =>
  ({ id, type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content: id }, ...extra }) as Block

const ids = (blocks: readonly Block[]): string[] => blocks.map((b) => b.id)

// A generated per-dish menu filter, verbatim.
const DISH_FILTER =
  "{{item.kategori == 'ana' && (state.veganFilter != 'evet' || item.vegan) && (state.spicyFilter != 'evet' || !item.acili)}}"
// A second generated menu filter, verbatim.
const MILD_FILTER = '{{(!state.veganOnly || item.vegan) && (!state.mildOnly || !item.acili)}}'

describe('parentheses, precedence and arithmetic in block expressions', () => {
  it('evaluates a generated per-dish filter instead of returning the raw template', () => {
    const on = (state: Record<string, unknown>, item: Record<string, unknown>): unknown =>
      resolveString(DISH_FILTER, createExpressionContext({ state, item }))

    const dish = { kategori: 'ana', vegan: false, acili: true }
    expect(on({ veganFilter: 'hayir', spicyFilter: 'hayir' }, dish)).toBe(true)
    expect(on({ veganFilter: 'evet', spicyFilter: 'hayir' }, dish)).toBe(false)
    expect(on({ veganFilter: 'hayir', spicyFilter: 'evet' }, dish)).toBe(false)
    expect(on({ veganFilter: 'hayir', spicyFilter: 'hayir' }, { ...dish, kategori: 'tatli' })).toBe(false)
  })

  it('evaluates a second generated filter', () => {
    const on = (state: Record<string, unknown>, item: Record<string, unknown>): unknown =>
      resolveString(MILD_FILTER, createExpressionContext({ state, item }))
    expect(on({ veganOnly: true, mildOnly: false }, { vegan: true, acili: true })).toBe(true)
    expect(on({ veganOnly: true, mildOnly: false }, { vegan: false, acili: false })).toBe(false)
    expect(on({ veganOnly: false, mildOnly: true }, { vegan: false, acili: true })).toBe(false)
  })

  it('a repeat template child filtered with parentheses keeps only matching rows', () => {
    const tree: Block[] = [
      block('menu', {
        type: 'container',
        repeat: '{{dishes}}',
        children: [block('dish', { visibleWhen: MILD_FILTER, props: { content: '{{item.ad}}' } })],
      } as never),
    ]
    const out = resolveBlockExpressions(tree, {
      state: { veganOnly: true, mildOnly: false },
      dishes: [
        { ad: 'Mercimek', vegan: true, acili: false },
        { ad: 'Kebap', vegan: false, acili: true },
        { ad: 'Humus', vegan: true, acili: true },
      ],
    })
    const kids = out[0]?.children ?? []
    expect(kids.map((k) => k.props?.content)).toEqual(['Mercimek', 'Humus'])
  })

  it('arithmetic works in props: ceil(total / 20), a * b, a - b, a % b', () => {
    const ctx = createExpressionContext({ products: { total: 194 }, state: { page: 3 } })
    expect(resolveString('{{ceil(products.total / 20)}}', ctx)).toBe(10)
    expect(resolveString('{{(state.page - 1) * 20}}', ctx)).toBe(40)
    expect(resolveString('{{products.total % 20}}', ctx)).toBe(14)
    expect(resolveString('Sayfa {{state.page}} / {{ceil(products.total / 20)}}', ctx)).toBe('Sayfa 3 / 10')
  })

  it('a hyphenated source id is still one name (no subtraction without spaces)', () => {
    const ctx = createExpressionContext({ 'hero-stats-data': [{ text: 'ok' }], a: 5, b: 2 })
    expect(resolveString('{{hero-stats-data.0.text}}', ctx)).toBe('ok')
    expect(resolveString('{{hero-stats-data[0].text}}', ctx)).toBe('ok')
    expect(resolveString('{{a - b}}', ctx)).toBe(3)
  })

  it('safe method calls on strings and arrays', () => {
    const ctx = createExpressionContext({ state: { q: 'Kebap' }, item: { ad: 'Adana Kebap', tags: ['a', 'b'] } })
    expect(resolveString('{{item.ad.toLowerCase().includes(state.q.toLowerCase())}}', ctx)).toBe(true)
    expect(resolveString('{{item.tags.includes("b")}}', ctx)).toBe(true)
    expect(resolveString('{{item.tags.join(" · ")}}', ctx)).toBe('a · b')
    expect(resolveString('{{item.ad.length}}', ctx)).toBe(11)
  })

  it('a method that is not on the safe list does not run', () => {
    const ctx = createExpressionContext({ item: { ad: 'x' } })
    const r = evaluate('item.ad.constructor("return 1")()', ctx)
    expect(r.success).toBe(false)
  })

  it('keeps the old literal / path / comparison behaviour', () => {
    const ctx = createExpressionContext({ user: { name: 'A' }, n: 0, items: [1, 2], state: { s: 'x' } })
    expect(resolveString('{{user.name}}', ctx)).toBe('A')
    expect(resolveString('{{items.0}}', ctx)).toBe(1)
    expect(resolveString('{{items[1]}}', ctx)).toBe(2)
    expect(resolveString("{{state.s === 'x' ? 'primary' : 'outline'}}", ctx)).toBe('primary')
    expect(resolveString('{{!n}}', ctx)).toBe(true)
    expect(resolveString('{{undefined}}', ctx)).toBe(undefined)
    expect(resolveString('{{null}}', ctx)).toBe(null)
    expect(resolveString('{{-3}}', ctx)).toBe(-3)
    expect(resolveString("{{'a' + 'b'}}", ctx)).toBe('ab')
  })
})

describe('an unparseable condition hides the block (fail closed)', () => {
  const cases = ['{{state.a = 1}}', '{{isEmpty(results}}', '{{noSuchHelper(state.a)}}', '{{state.a @@ 2}}']

  for (const cond of cases) {
    it(`visibleWhen ${cond} → hidden, with a warning`, () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      const out = resolveBlockExpressions([block('empty-state', { visibleWhen: cond } as never)], {
        state: { a: 1 },
        results: [],
      })
      expect(ids(out)).toEqual([])
      expect(warn).toHaveBeenCalled()
      expect(String(warn.mock.calls[0]?.[0])).toContain('empty-state')
    })
  }

  it('an unparseable placeholder inside a mixed condition string also hides', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const out = resolveBlockExpressions([block('b', { visibleWhen: 'x {{(state.a}}' } as never)], {
      state: { a: 1 },
    })
    expect(ids(out)).toEqual([])
  })

  it('a parseable condition that is truthy still shows', () => {
    const out = resolveBlockExpressions([block('b', { visibleWhen: '{{(state.a == 1) && !isEmpty(r)}}' } as never)], {
      state: { a: 1 },
      r: [1],
    })
    expect(ids(out)).toEqual(['b'])
  })
})

describe('a comma inside a helper string argument', () => {
  it("join(item.allergens, ', ') keeps its separator", () => {
    const ctx = createExpressionContext({ item: { allergens: ['gluten', 'milk'] } })
    expect(resolveString("Allergens: {{join(item.allergens, ', ')}}", ctx)).toBe('Allergens: gluten, milk')
    expect(resolveString("{{join(item.allergens, ', ')}}", ctx)).toBe('gluten, milk')
  })

  it('a ) inside a string argument does not close the call', () => {
    const ctx = createExpressionContext({ xs: ['a', 'b'] })
    expect(resolveString("{{join(xs, ') (')}}", ctx)).toBe('a) (b')
  })

  it('nested helper calls as arguments', () => {
    const ctx = createExpressionContext({ xs: ['b', 'a'], n: 2.345 })
    expect(resolveString("{{upper(join(xs, ', '))}}", ctx)).toBe('B, A')
    expect(resolveString('{{round(n, 2)}}', ctx)).toBe(2.35)
  })
})

describe('pagination — pages(total, size)', () => {
  const ctx = (products: unknown): ReturnType<typeof createExpressionContext> =>
    createExpressionContext({ __meta: { products } })

  it('ceil of total / size on the DummyJSON envelope', () => {
    expect(resolveString('{{pages(__meta.products.total, __meta.products.limit)}}', ctx({ total: 194, skip: 0, limit: 30 }))).toBe(7)
    expect(resolveString('{{pages(__meta.products.total, 20)}}', ctx({ total: 194 }))).toBe(10)
    expect(resolveString('{{pages(__meta.products.total, 20)}}', ctx({ total: 200 }))).toBe(10)
  })

  it('is safe on missing, zero, negative and non-numeric input', () => {
    expect(resolveString('{{pages(__meta.products.total, 20)}}', ctx(undefined))).toBe(0)
    expect(resolveString('{{pages(__meta.products.total, 0)}}', ctx({ total: 194 }))).toBe(0)
    expect(resolveString('{{pages(__meta.products.total, -5)}}', ctx({ total: 194 }))).toBe(0)
    expect(resolveString("{{pages('x', 20)}}", ctx({}))).toBe(0)
    expect(resolveString('{{pages(0, 20)}}', ctx({}))).toBe(0)
    expect(resolveString("{{pages('45', '20')}}", ctx({}))).toBe(3)
  })
})
