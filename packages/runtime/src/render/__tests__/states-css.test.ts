/**
 * Interaction-state CSS generation tests.
 *
 * Asserts that `block.states` is emitted as scoped
 * `[data-block-id]<pseudo>{…}` rules with camelCase→kebab declarations, and
 * that a block without `states` emits nothing.
 *
 * @module @pwfabric/runtime/render/__tests__/states-css
 */

import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { collectStatesCss, blockStatesCss } from '../states-css.js'

describe('states-css', () => {
  it('emits a scoped :hover rule with camelCase→kebab decls', () => {
    const block: Block = {
      id: 'btn-1',
      type: 'button',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      states: {
        hover: {
          backgroundColor: 'var(--pw-color-primary-subtle)',
          borderRadius: '8px',
        },
      },
    }

    const css = collectStatesCss([block])

    expect(css).toBe(
      '[data-pw-surface] [data-block-id="btn-1"]:not([data-block-wrapper]):hover{' +
        'background-color:var(--pw-color-primary-subtle);border-radius:8px}'
    )
    // camelCase keys are converted to kebab-case
    expect(css).toContain('background-color:var(--pw-color-primary-subtle)')
    expect(css).toContain('border-radius:8px')
    // pseudo-class is present and scoped under the surface root
    expect(css).toContain('[data-pw-surface] [data-block-id="btn-1"]:not([data-block-wrapper]):hover{')
  })

  it('emits :hover, :active and :focus-visible (focus → :focus-visible)', () => {
    const block: Block = {
      id: 'card-1',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      states: {
        hover: { boxShadow: 'var(--pw-shadow-card)' },
        active: { transform: 'scale(0.98)' },
        focus: { outlineColor: 'var(--pw-focus-ring-color)' },
      },
    }

    const css = blockStatesCss('card-1', block.states!)

    expect(css).toContain('[data-pw-surface] [data-block-id="card-1"]:not([data-block-wrapper]):hover{box-shadow:var(--pw-shadow-card)}')
    expect(css).toContain('[data-pw-surface] [data-block-id="card-1"]:not([data-block-wrapper]):active{transform:scale(0.98)}')
    // `focus` maps to `:focus-visible`, never bare `:focus`
    expect(css).toContain('[data-pw-surface] [data-block-id="card-1"]:not([data-block-wrapper]):focus-visible{outline-color:var(--pw-focus-ring-color)}')
    expect(css).not.toContain(':focus{')
  })

  it('emits nothing for a block without states', () => {
    const block: Block = {
      id: 'plain-1',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { content: 'hi' },
    }

    expect(collectStatesCss([block])).toBe('')
  })

  it('recurses into children like the visibility path does', () => {
    const tree: Block = {
      id: 'parent',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      children: [
        {
          id: 'child-1',
          type: 'button',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          states: { hover: { color: 'red' } },
        },
      ],
    }

    const css = collectStatesCss([tree])
    expect(css).toBe('[data-pw-surface] [data-block-id="child-1"]:not([data-block-wrapper]):hover{color:red}')
  })

  it('skips empty state records (zero bytes)', () => {
    const block: Block = {
      id: 'empty-1',
      type: 'button',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      states: { hover: {} },
    }
    expect(collectStatesCss([block])).toBe('')
  })
})
