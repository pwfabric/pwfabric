/**
 * Conditional-state CSS generation tests.
 *
 * Asserts that `block.conditionalStates` is emitted as scoped
 * `[data-block-id]<selector>{…}` rules with camelCase→kebab `!important`
 * declarations, that malformed (non-suffix) selectors are skipped, and that a
 * block without `conditionalStates` emits nothing.
 *
 * @module @pwfabric/runtime/render/__tests__/conditional-states-css
 */

import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import {
  collectConditionalStatesCss,
  blockConditionalStatesCss,
} from '../conditional-states-css.js'

describe('conditional-states-css', () => {
  it('emits a scoped :disabled rule with camelCase→kebab !important decls', () => {
    const block: Block = {
      id: 'btn-1',
      type: 'button',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      conditionalStates: [
        { selector: ':disabled', style: { opacity: '0.5', backgroundColor: '#eee' } },
      ],
    }

    const css = collectConditionalStatesCss([block])

    expect(css).toBe(
      '[data-pw-surface] [data-block-id="btn-1"]:not([data-block-wrapper]):disabled{' +
        'opacity:0.5 !important;background-color:#eee !important}'
    )
    // camelCase keys converted to kebab-case
    expect(css).toContain('background-color:#eee !important')
    // declarations carry !important (must beat component inline defaults)
    expect(css).toContain('opacity:0.5 !important')
  })

  it('emits an attribute-selector rule ([aria-expanded="true"])', () => {
    const css = blockConditionalStatesCss('acc-1', [
      { selector: '[aria-expanded="true"]', style: { backgroundColor: 'var(--pw-color-primary-subtle)' } },
    ])
    expect(css).toBe(
      '[data-pw-surface] [data-block-id="acc-1"]:not([data-block-wrapper])[aria-expanded="true"]{' +
        'background-color:var(--pw-color-primary-subtle) !important}'
    )
  })

  it('skips malformed (bare) selectors so nothing leaks to the host page', () => {
    const block: Block = {
      id: 'x-1',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      conditionalStates: [
        { selector: 'div', style: { color: 'red' } }, // bare element → skipped
        { selector: '.global', style: { color: 'red' } }, // bare class → skipped
        { selector: '', style: { color: 'red' } }, // empty → skipped
        { selector: ':checked', style: { color: 'green' } }, // valid → kept
      ],
    }
    const css = collectConditionalStatesCss([block])
    expect(css).toBe('[data-pw-surface] [data-block-id="x-1"]:not([data-block-wrapper]):checked{color:green !important}')
    expect(css).not.toContain('div{')
    expect(css).not.toContain('.global')
  })

  it('accepts :has() and combinator suffixes', () => {
    const css = blockConditionalStatesCss('card-1', [
      { selector: ':has(> img)', style: { padding: '0' } },
    ])
    expect(css).toBe('[data-pw-surface] [data-block-id="card-1"]:not([data-block-wrapper]):has(> img){padding:0 !important}')
  })

  it('emits nothing for a block without conditionalStates', () => {
    const block: Block = {
      id: 'plain-1',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: { content: 'hi' },
    }
    expect(collectConditionalStatesCss([block])).toBe('')
  })

  it('recurses into children like the states path does', () => {
    const tree: Block = {
      id: 'parent',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      children: [
        {
          id: 'child-1',
          type: 'input',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          conditionalStates: [{ selector: ':invalid', style: { borderColor: 'red' } }],
        },
      ],
    }
    const css = collectConditionalStatesCss([tree])
    expect(css).toBe('[data-pw-surface] [data-block-id="child-1"]:not([data-block-wrapper]):invalid{border-color:red !important}')
  })

  it('skips entries with an empty style record (zero bytes)', () => {
    const block: Block = {
      id: 'empty-1',
      type: 'button',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      conditionalStates: [{ selector: ':disabled', style: {} }],
    }
    expect(collectConditionalStatesCss([block])).toBe('')
  })
})
