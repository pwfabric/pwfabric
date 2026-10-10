/**
 * resolve-expressions — item-template expansion (`repeat` + {{item.*}} scope).
 *
 * A block carrying a block-level `repeat` expression treats its children as a
 * per-item template: the binding resolves to an array, the template subtree is
 * cloned per element with `item`/`index` in scope, and clone ids get a
 * `--<index>` suffix. Without `repeat` the resolver's output is byte-identical
 * to before (backward-compat locked here).
 *
 * @module @pwfabric/runtime/render/__tests__/resolve-expressions-repeat
 */

import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { resolveBlockExpressions } from '../resolve-expressions.js'

const L = DEFAULT_BLOCK_LAYOUT

const data = {
  announcements: [
    { Title: 'First announcement', Description: 'first description' },
    { Title: 'Second announcement', Description: 'second description' },
  ],
  state: {},
}

describe('resolve-expressions — repeat item-template', () => {
  it('expands children once per array element with {{item.*}} and {{index}} in scope', () => {
    const blocks: Block[] = [
      {
        id: 'list',
        type: 'repeater',
        layout: L,
        repeat: '{{announcements}}',
        props: {},
        children: [
          {
            id: 'row',
            type: 'container',
            layout: L,
            props: { direction: 'row' },
            children: [
              { id: 'row-h', type: 'heading', layout: L, props: { text: '{{item.Title}}' } },
              { id: 'row-t', type: 'text', layout: L, props: { content: '#{{index}}: {{item.Description}}' } },
            ],
          },
        ],
      } as never,
    ]

    const [out] = resolveBlockExpressions(blocks, data)
    expect(out).toBeDefined()
    // the repeat field does not leak into the output
    expect((out as { repeat?: unknown }).repeat).toBeUndefined()
    // 2 items × 1 template child = 2 clones
    expect(out!.children).toHaveLength(2)
    const [first, second] = out!.children!
    expect(first!.id).toBe('row--0')
    expect(second!.id).toBe('row--1')
    // inner ids carry the suffix too
    expect(first!.children![0]!.id).toBe('row-h--0')
    // {{item.*}} resolves per row
    expect(first!.children![0]!.props!.text).toBe('First announcement')
    expect(second!.children![0]!.props!.text).toBe('Second announcement')
    // {{index}} interpolation
    expect(first!.children![1]!.props!.content).toBe('#0: first description')
    expect(second!.children![1]!.props!.content).toBe('#1: second description')
  })

  it('expands to ZERO children while the binding is not (yet) an array — no raw template leak', () => {
    const blocks: Block[] = [
      {
        id: 'list',
        type: 'repeater',
        layout: L,
        repeat: '{{notLoadedYet}}',
        props: {},
        children: [{ id: 'row', type: 'text', layout: L, props: { content: '{{item.Title}}' } }],
      } as never,
    ]
    const [out] = resolveBlockExpressions(blocks, data)
    expect(out!.children).toHaveLength(0)
  })

  it('without repeat, output is byte-identical to the previous behavior', () => {
    const blocks: Block[] = [
      {
        id: 'plain',
        type: 'container',
        layout: L,
        props: { direction: 'column' },
        children: [
          { id: 'h', type: 'heading', layout: L, props: { text: '{{announcements[0].Title}}' } },
        ],
      },
    ]
    const [out] = resolveBlockExpressions(blocks, data)
    expect(out!.children).toHaveLength(1)
    expect(out!.children![0]!.id).toBe('h')
    expect(out!.children![0]!.props!.text).toBe('First announcement')
    // item/index keys are undefined outside a repeat
    const [probe] = resolveBlockExpressions(
      [{ id: 'p', type: 'text', layout: L, props: { content: '{{item.Title}}' } }],
      data
    )
    expect(probe!.props!.content).toBeUndefined()
  })
})
