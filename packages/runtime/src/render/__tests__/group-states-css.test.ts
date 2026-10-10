/**
 * Group-hover CSS generation tests.
 *
 * Asserts that a descendant's `block.groupStates.hover` is emitted as a scoped
 * `[data-block-id="<root>"]:hover [data-block-id="<desc>"]{…}` rule with
 * camelCase→kebab `!important` declarations, keyed by the NEAREST `groupRoot`
 * ancestor; that a `groupStates` block with no `groupRoot` ancestor emits
 * nothing; that the innermost root wins; and that a plain block emits nothing.
 *
 * @module @pwfabric/runtime/render/__tests__/group-states-css
 */

import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { collectGroupStatesCss, blockGroupStatesCss } from '../group-states-css.js'

describe('group-states-css', () => {
  it('emits a scoped group-hover rule keyed by the groupRoot ancestor', () => {
    const tree: Block = {
      id: 'card',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      groupRoot: true,
      children: [
        {
          id: 'cta',
          type: 'button',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          groupStates: { hover: { transform: 'scale(1.05)', boxShadow: '0 0 4px' } },
        },
      ],
    }

    const css = collectGroupStatesCss([tree])

    expect(css).toBe(
      '[data-pw-surface] [data-block-id="card"]:hover [data-block-id="cta"]{' +
        'transform:scale(1.05) !important;box-shadow:0 0 4px !important}'
    )
    // camelCase → kebab
    expect(css).toContain('box-shadow:0 0 4px !important')
    // !important so it beats component inline defaults
    expect(css).toContain('transform:scale(1.05) !important')
  })

  it('blockGroupStatesCss builds the root:hover descendant selector directly', () => {
    const css = blockGroupStatesCss('root-1', 'desc-1', {
      hover: { backgroundColor: 'var(--pw-color-primary-subtle)' },
    })
    expect(css).toBe(
      '[data-pw-surface] [data-block-id="root-1"]:hover [data-block-id="desc-1"]{' +
        'background-color:var(--pw-color-primary-subtle) !important}'
    )
  })

  it('emits nothing for a groupStates block with no groupRoot ancestor', () => {
    const tree: Block = {
      id: 'plain-parent',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      children: [
        {
          id: 'orphan',
          type: 'button',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          groupStates: { hover: { transform: 'scale(1.05)' } },
        },
      ],
    }
    expect(collectGroupStatesCss([tree])).toBe('')
  })

  it('the nearest (innermost) groupRoot wins', () => {
    const tree: Block = {
      id: 'outer',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      groupRoot: true,
      children: [
        {
          id: 'inner',
          type: 'container',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          groupRoot: true,
          children: [
            {
              id: 'leaf',
              type: 'button',
              layout: DEFAULT_BLOCK_LAYOUT,
              props: {},
              groupStates: { hover: { opacity: '1' } },
            },
          ],
        },
      ],
    }
    const css = collectGroupStatesCss([tree])
    expect(css).toBe(
      '[data-pw-surface] [data-block-id="inner"]:hover [data-block-id="leaf"]{opacity:1 !important}'
    )
  })

  it('emits nothing for a block without groupStates', () => {
    const block: Block = {
      id: 'plain-1',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { content: 'hi' },
    }
    expect(collectGroupStatesCss([block])).toBe('')
  })

  it('skips an empty groupStates.hover record (zero bytes)', () => {
    const tree: Block = {
      id: 'root',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      groupRoot: true,
      children: [
        {
          id: 'child',
          type: 'button',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          groupStates: { hover: {} },
        },
      ],
    }
    expect(collectGroupStatesCss([tree])).toBe('')
  })
})
