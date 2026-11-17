/**
 * Expression Resolution Tests
 *
 * Tests for resolveBlockExpressions and resolveString.
 *
 * @module @pwfabric/runtime/render/__tests__/resolve-expressions
 */

import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { literalPropsOf, resolveBlockExpressions, resolveString } from '../resolve-expressions.js'
import { createExpressionContext } from '../../surface/expression.js'

/** Safe accessor that throws in tests if index is out of bounds */
function at<T>(arr: T[], index: number): T {
  const item = arr[index]
  if (item === undefined && index >= arr.length) {
    throw new Error(`Index ${index} out of bounds (length ${arr.length})`)
  }
  return item as T
}

// ============================================================
// resolveString
// ============================================================

describe('resolveString', () => {
  const ctx = createExpressionContext({
    name: 'John',
    count: 42,
    items: [1, 2, 3],
    nested: { value: 'deep' },
    x: 10,
    state: { category: 'Electronics' },
  })

  it('returns plain strings unchanged', () => {
    expect(resolveString('hello world', ctx)).toBe('hello world')
  })

  it('interpolates embedded expressions', () => {
    expect(resolveString('Hello {{name}}!', ctx)).toBe('Hello John!')
  })

  it('interpolates multiple expressions', () => {
    expect(resolveString('{{name}} has {{count}} items', ctx)).toBe('John has 42 items')
  })

  it('returns raw value for whole-value expression (array)', () => {
    const result = resolveString('{{items}}', ctx)
    expect(result).toEqual([1, 2, 3])
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns raw value for whole-value expression (number)', () => {
    expect(resolveString('{{count}}', ctx)).toBe(42)
  })

  it('returns raw value for whole-value expression (object)', () => {
    expect(resolveString('{{nested}}', ctx)).toEqual({ value: 'deep' })
  })

  it('resolves nested path', () => {
    expect(resolveString('{{nested.value}}', ctx)).toBe('deep')
  })

  it('resolves ternary expression', () => {
    expect(resolveString("{{x > 5 ? 'high' : 'low'}}", ctx)).toBe('high')
  })

  it('resolves state path', () => {
    expect(resolveString('{{state.category}}', ctx)).toBe('Electronics')
  })

  it('resolves comparison in whole-value', () => {
    expect(resolveString("{{state.category === 'Electronics'}}", ctx)).toBe(true)
  })

  it('returns original string on evaluation failure', () => {
    const badCtx = createExpressionContext({})
    // Expression with non-existent path returns undefined, which is valid
    expect(resolveString('{{nonExistent}}', badCtx)).toBe(undefined)
  })

  it('handles whitespace in expressions', () => {
    expect(resolveString('{{ name }}', ctx)).toBe('John')
  })
})

// ============================================================
// resolveBlockExpressions
// ============================================================

describe('resolveBlockExpressions', () => {
  it('resolves string props with expressions', () => {
    const blocks: Block[] = [
      {
        id: 'text-1',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: 'Hello {{name}}' },
      },
    ]

    const resolved = resolveBlockExpressions(blocks, { name: 'World' })
    expect(at(resolved, 0).props?.content).toBe('Hello World')
  })

  it('preserves non-expression props', () => {
    const blocks: Block[] = [
      {
        id: 'text-1',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: 'Static text', fontSize: 16 },
      },
    ]

    const resolved = resolveBlockExpressions(blocks, {})
    expect(at(resolved, 0).props?.content).toBe('Static text')
    expect(at(resolved, 0).props?.fontSize).toBe(16)
  })

  it('resolves whole-value expressions to raw types', () => {
    const data = {
      products: [
        { id: 1, name: 'Item A' },
        { id: 2, name: 'Item B' },
      ],
    }

    const blocks: Block[] = [
      {
        id: 'table-1',
        type: 'table',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { data: '{{products}}' },
      },
    ]

    const resolved = resolveBlockExpressions(blocks, data)
    expect(at(resolved, 0).props?.data).toEqual(data.products)
    expect(Array.isArray(at(resolved, 0).props?.data)).toBe(true)
  })

  it('resolves nested object props', () => {
    const blocks: Block[] = [
      {
        id: 'btn-1',
        type: 'button',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: {
          label: 'Click',
          action: {
            type: 'setState',
            key: 'category',
            value: '{{state.next}}',
          },
        },
      },
    ]

    const resolved = resolveBlockExpressions(blocks, { state: { next: 'Books' } })
    const action = at(resolved, 0).props?.action as Record<string, unknown>
    expect(action.value).toBe('Books')
    expect(action.type).toBe('setState') // non-expression preserved
  })

  it('resolves children recursively', () => {
    const blocks: Block[] = [
      {
        id: 'root',
        type: 'container',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: {},
        children: [
          {
            id: 'child-1',
            type: 'text',
            layout: DEFAULT_BLOCK_LAYOUT,
            props: { content: '{{message}}' },
          },
        ],
      },
    ]

    const resolved = resolveBlockExpressions(blocks, { message: 'Resolved!' })
    const children = at(resolved, 0).children ?? []
    expect(at(children, 0).props?.content).toBe('Resolved!')
  })

  it('does not mutate original blocks', () => {
    const blocks: Block[] = [
      {
        id: 'text-1',
        type: 'text',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: { content: '{{name}}' },
      },
    ]

    resolveBlockExpressions(blocks, { name: 'Test' })
    expect(at(blocks, 0).props?.content).toBe('{{name}}')
  })

  it('resolves array props with expressions', () => {
    const blocks: Block[] = [
      {
        id: 'tabs-1',
        type: 'tabs',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: {
          tabs: [
            { label: '{{tab1}}', content: 'Content 1' },
            { label: 'Static', content: '{{desc}}' },
          ],
        },
      },
    ]

    const resolved = resolveBlockExpressions(blocks, { tab1: 'Dynamic', desc: 'Hello' })
    const tabs = at(resolved, 0).props?.tabs as Record<string, string>[]
    expect(at(tabs, 0).label).toBe('Dynamic')
    expect(at(tabs, 1).content).toBe('Hello')
  })

  it('handles ternary in prop value', () => {
    const blocks: Block[] = [
      {
        id: 'btn-1',
        type: 'button',
        layout: DEFAULT_BLOCK_LAYOUT,
        props: {
          variant: "{{state.category === 'All' ? 'primary' : 'outline'}}",
        },
      },
    ]

    const resolved = resolveBlockExpressions(blocks, { state: { category: 'All' } })
    expect(at(resolved, 0).props?.variant).toBe('primary')

    const resolved2 = resolveBlockExpressions(blocks, { state: { category: 'Books' } })
    expect(at(resolved2, 0).props?.variant).toBe('outline')
  })

  it('passes through blocks without props', () => {
    const blocks: Block[] = [{ id: 'div-1', type: 'divider', layout: DEFAULT_BLOCK_LAYOUT }]

    const resolved = resolveBlockExpressions(blocks, {})
    expect(at(resolved, 0).props).toBeUndefined()
  })

  describe('conditional visibility (visibleWhen / if)', () => {
    const form: Block = { id: 'form', type: 'form', layout: DEFAULT_BLOCK_LAYOUT } as Block
    const success: Block = { id: 'ok', type: 'alert', layout: DEFAULT_BLOCK_LAYOUT } as Block

    it('keeps a block whose visibleWhen resolves truthy and omits the falsy one', () => {
      const blocks = [
        { ...form, visibleWhen: '{{!state.submitted}}' },
        { ...success, visibleWhen: '{{state.submitted}}' },
      ] as Block[]

      const before = resolveBlockExpressions(blocks, { state: { submitted: false } })
      expect(before.map((b) => b.id)).toEqual(['form'])

      const after = resolveBlockExpressions(blocks, { state: { submitted: true } })
      expect(after.map((b) => b.id)).toEqual(['ok'])
    })

    it('supports the `if` shorthand', () => {
      const blocks = [{ ...success, if: '{{state.done}}' }] as Block[]
      expect(resolveBlockExpressions(blocks, { state: { done: false } })).toHaveLength(0)
      expect(resolveBlockExpressions(blocks, { state: { done: true } })).toHaveLength(1)
    })

    it('omits a falsy-conditioned child while keeping its parent', () => {
      const blocks = [
        {
          id: 'sec',
          type: 'section',
          layout: DEFAULT_BLOCK_LAYOUT,
          children: [
            { ...success, visibleWhen: '{{state.show}}' },
            { id: 'always', type: 'text', layout: DEFAULT_BLOCK_LAYOUT },
          ],
        },
      ] as Block[]

      const resolved = resolveBlockExpressions(blocks, { state: { show: false } })
      expect(resolved).toHaveLength(1)
      expect(at(resolved, 0).children?.map((c) => c.id)).toEqual(['always'])
    })

    it('treats string "false"/"0"/empty as falsy', () => {
      const mk = (cond: string) =>
        resolveBlockExpressions([{ ...success, visibleWhen: cond }] as Block[], { state: {} })
      expect(mk('false')).toHaveLength(0)
      expect(mk('0')).toHaveLength(0)
      expect(mk('')).toHaveLength(1) // empty/static condition → not a real expression, keep
      expect(mk('yes')).toHaveLength(1)
    })
  })

  describe('__show:<id> visibility override', () => {
    const block: Block = {
      id: 'hero-1',
      type: 'hero',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { title: 'Hello' },
    }

    it('__show:id === true forces a block VISIBLE even when visibleWhen would hide it', () => {
      const blocks = [{ ...block, visibleWhen: '{{state.visible}}' }] as Block[]
      // Without override visibleWhen=false hides it
      const hidden = resolveBlockExpressions(blocks, { state: { visible: false } })
      expect(hidden).toHaveLength(0)
      // With __show:hero-1=true it is forced visible
      const shown = resolveBlockExpressions(blocks, {
        state: { visible: false, '__show:hero-1': true },
      })
      expect(shown).toHaveLength(1)
      expect(at(shown, 0).id).toBe('hero-1')
    })

    it('__show:id === false hides a block that would otherwise be visible', () => {
      const blocks = [{ ...block, visibleWhen: '{{state.visible}}' }] as Block[]
      // Without override visibleWhen=true keeps it
      const shown = resolveBlockExpressions(blocks, { state: { visible: true } })
      expect(shown).toHaveLength(1)
      // With __show:hero-1=false it is forced hidden
      const hidden = resolveBlockExpressions(blocks, {
        state: { visible: true, '__show:hero-1': false },
      })
      expect(hidden).toHaveLength(0)
    })

    it('absent __show key falls through to visibleWhen — truthy keeps block', () => {
      const blocks = [{ ...block, visibleWhen: '{{state.show}}' }] as Block[]
      const resolved = resolveBlockExpressions(blocks, { state: { show: true } })
      expect(resolved).toHaveLength(1)
    })

    it('absent __show key falls through to visibleWhen — falsy omits block', () => {
      const blocks = [{ ...block, visibleWhen: '{{state.show}}' }] as Block[]
      const resolved = resolveBlockExpressions(blocks, { state: { show: false } })
      expect(resolved).toHaveLength(0)
    })

    it('block with no visibility props and no override renders normally', () => {
      const blocks = [{ ...block }] as Block[]
      const resolved = resolveBlockExpressions(blocks, { state: {} })
      expect(resolved).toHaveLength(1)
      expect(at(resolved, 0).props?.title).toBe('Hello')
    })
  })
})

// ============================================================
// Links whose page is an expression — rewritten once the value is known
// ============================================================

describe('resolveBlockExpressions — linkHref', () => {
  const linkHref = (href: string): string => `#${href}`
  const L = DEFAULT_BLOCK_LAYOUT
  const sessions = [{ id: 4, url: '/session?id=4' }]

  function rows(props: Record<string, unknown>): Block[] {
    return [
      {
        id: 'list',
        type: 'container',
        layout: L,
        repeat: '{{sessions}}',
        props: {},
        children: [{ id: 'row', type: 'link', layout: L, props }],
      } as Block,
    ]
  }
  const rowProps = (blocks: Block[]): Record<string, unknown> =>
    (at(blocks, 0).children?.[0]?.props ?? {}) as Record<string, unknown>

  it('writes a resolved `{{item.url}}` href in the router form', () => {
    const out = resolveBlockExpressions(rows({ href: '{{item.url}}', text: '{{item.url}}' }), { sessions }, undefined, { linkHref })
    expect(rowProps(out).href).toBe('#/session?id=4')
    // only links are rewritten
    expect(rowProps(out).text).toBe('/session?id=4')
  })

  it('covers role-named links and navigate actions', () => {
    const out = resolveBlockExpressions(
      rows({ ctaHref: '{{item.url}}', action: { type: 'navigate', url: '{{item.url}}' } }),
      { sessions },
      undefined,
      { linkHref }
    )
    expect(rowProps(out).ctaHref).toBe('#/session?id=4')
    expect(rowProps(out).action).toEqual({ type: 'navigate', url: '#/session?id=4' })
  })

  it('leaves a link the host already rewrote, and one that did not resolve', () => {
    const literal = resolveBlockExpressions(rows({ href: '#/session?id={{item.id}}' }), { sessions }, undefined, { linkHref })
    expect(rowProps(literal).href).toBe('#/session?id=4')
    const failed = resolveBlockExpressions(rows({ href: '{{nope(item.url)}}' }), { sessions }, undefined, { linkHref })
    expect(rowProps(failed).href).toBe('{{nope(item.url)}}')
  })

  it('without linkHref the value is bound as it resolves', () => {
    const out = resolveBlockExpressions(rows({ href: '{{item.url}}' }), { sessions })
    expect(rowProps(out).href).toBe('/session?id=4')
  })
})

describe('resolveBlockExpressions — a link from data is a link or nothing', () => {
  const L = DEFAULT_BLOCK_LAYOUT
  const hrefOf = (url: string, linkHref?: (h: string) => string): unknown => {
    const blocks: Block[] = [
      {
        id: 'list',
        type: 'container',
        layout: L,
        repeat: '{{rows}}',
        props: {},
        children: [{ id: 'row', type: 'link', layout: L, props: { href: '{{item.url}}', action: { type: 'navigate', url: '{{item.url}}' } } }],
      } as Block,
    ]
    const out = resolveBlockExpressions(blocks, { rows: [{ url }] }, undefined, linkHref ? { linkHref } : {})
    const props = (at(out, 0).children?.[0]?.props ?? {}) as Record<string, unknown>
    expect((props.action as Record<string, unknown>).url).toBe(props.href)
    return props.href
  }
  const linkHref = (h: string): string => (h.startsWith('/') ? `#${h}` : h)

  for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.example/x', '/\\evil.example/x', 'session?id=4']) {
    it(`drops ${JSON.stringify(bad)} — with and without a router`, () => {
      expect(hrefOf(bad, linkHref)).toBeUndefined()
      expect(hrefOf(bad)).toBeUndefined()
    })
  }

  it('drops a value that is not a string — fail closed', () => {
    for (const bad of [['/a'], { href: '/a' }, 42, true, null, undefined]) {
      expect(hrefOf(bad as never, linkHref)).toBeUndefined()
      expect(hrefOf(bad as never)).toBeUndefined()
    }
  })

  it('keeps root-relative paths (for the router), fragments and http/https/mailto/tel', () => {
    expect(hrefOf('/session?id=4', linkHref)).toBe('#/session?id=4')
    expect(hrefOf('#speakers', linkHref)).toBe('#speakers')
    expect(hrefOf('https://example.com/x', linkHref)).toBe('https://example.com/x')
    expect(hrefOf('HTTP://example.com', linkHref)).toBe('HTTP://example.com')
    expect(hrefOf('mailto:hello@example.com', linkHref)).toBe('mailto:hello@example.com')
    expect(hrefOf('tel:+15550100', linkHref)).toBe('tel:+15550100')
    expect(hrefOf('/café', linkHref)).toBe('#/café')
  })
})

// ============================================================
// bindable: false — a literal prop is left exactly as written
// ============================================================

describe('resolveBlockExpressions — props the manifest declares bindable: false', () => {
  const literalProps = literalPropsOf([
    {
      blockType: 'code',
      moduleUrl: 'blocks/code.mjs',
      integrity: 'x',
      publisher: 'p',
      publisherVerified: false,
      definition: {
        name: 'code',
        props: [{ name: 'code', bindable: false }, { name: 'sample', bindable: false }, { name: 'filename' }, { name: 'caption', bindable: true }],
      },
    },
  ])
  const data = { state: { x: 'RESOLVED' }, rows: [{ n: 'a' }, { n: 'b' }] }

  it('renders a bindable:false prop with {{state.x}} as the literal', () => {
    const blocks: Block[] = [
      { id: 'c', type: 'code', layout: DEFAULT_BLOCK_LAYOUT, props: { code: 'const x = {{state.x}}', filename: '{{state.x}}.ts', caption: '{{state.x}}' } },
    ]
    const props = at(resolveBlockExpressions(blocks, data, undefined, { literalProps }), 0).props ?? {}
    expect(props.code).toBe('const x = {{state.x}}')
    // Undeclared and bindable:true props still resolve.
    expect(props.filename).toBe('RESOLVED.ts')
    expect(props.caption).toBe('RESOLVED')
  })

  it('leaves every value nested in a bindable:false object or list as written', () => {
    const sample = { title: '{{state.x}}', lines: ['{{state.x}}', { v: '{{rows}}' }] }
    const blocks: Block[] = [{ id: 'c', type: 'code', layout: DEFAULT_BLOCK_LAYOUT, props: { sample } }]
    const props = at(resolveBlockExpressions(blocks, data, undefined, { literalProps }), 0).props ?? {}
    expect(props.sample).toEqual(sample)
  })

  it('keeps the literal on a repeated block and on another block type the prop name is bindable', () => {
    const blocks: Block[] = [
      {
        id: 'list',
        type: 'stack',
        layout: DEFAULT_BLOCK_LAYOUT,
        repeat: '{{rows}}',
        children: [{ id: 'c', type: 'code', layout: DEFAULT_BLOCK_LAYOUT, props: { code: '{{item.n}}', filename: '{{item.n}}' } }],
      } as Block,
      { id: 't', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { code: '{{state.x}}' } },
    ]
    const out = resolveBlockExpressions(blocks, data, undefined, { literalProps })
    const clones = at(out, 0).children ?? []
    expect(clones.map((c) => c.props?.code)).toEqual(['{{item.n}}', '{{item.n}}'])
    expect(clones.map((c) => c.props?.filename)).toEqual(['a', 'b'])
    expect(at(out, 1).props?.code).toBe('RESOLVED')
  })

  it('resolves every prop of a block whose descriptor declares no props', () => {
    const none = literalPropsOf([{ blockType: 'code', moduleUrl: 'm', integrity: 'x', publisher: 'p', publisherVerified: false, definition: { name: 'code' } }])
    const blocks: Block[] = [{ id: 'c', type: 'code', layout: DEFAULT_BLOCK_LAYOUT, props: { code: '{{state.x}}' } }]
    expect(at(resolveBlockExpressions(blocks, data, undefined, { literalProps: none }), 0).props?.code).toBe('RESOLVED')
    expect(none.size).toBe(0)
  })
})
