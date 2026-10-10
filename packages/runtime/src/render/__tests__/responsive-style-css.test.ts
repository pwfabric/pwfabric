/**
 * Per-prop responsive style CSS generation tests.
 *
 * Asserts that a `block.style` prop whose value is a per-breakpoint
 * `ResponsiveValue` map is emitted as scoped CSS — the base (smallest defined
 * breakpoint) as a non-media rule + larger breakpoints as `@media (min-width:<px>)`
 * rules (camelCase→kebab, correct px thresholds) — so ALL breakpoints live in the
 * stylesheet (never inline, which would beat @media). Flat string values emit
 * nothing, the walker recurses, and a block with no responsive value emits zero bytes.
 *
 * CARRIES THE HOISTING RULE ON THE SELECTOR: `[data-block-id]` matches both the
 * wrapper and the component root, so hoisted keys (margin/maxWidth/flex) are
 * written ONLY to `[data-block-wrapper]` and the rest ONLY to
 * `:not([data-block-wrapper])` — otherwise the value is applied twice.
 *
 * @module @pwfabric/runtime/render/__tests__/responsive-style-css
 */

import { describe, it, expect } from 'vitest'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import {
  collectResponsiveStyleCss,
  blockResponsiveStyleCss,
} from '../responsive-style-css.js'

describe('responsive-style-css', () => {
  it('emits per-breakpoint min-width media-query rules (camelCase→kebab, correct px)', () => {
    const block: Block = {
      id: 'sec-1',
      type: 'section',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      style: {
        // xs=8px is the base (inline); md (768px) + lg (1024px) → media queries.
        paddingTop: { xs: '8px', md: '24px', lg: '48px' },
      },
    }

    const css = collectResponsiveStyleCss([block])

    expect(css).toBe(
      // base (xs) is a NON-media scoped rule; md/lg override via @media.
      '[data-pw-surface] [data-block-id="sec-1"]:not([data-block-wrapper]){padding-top:8px !important}' +
        '@media (min-width:768px){[data-pw-surface] [data-block-id="sec-1"]:not([data-block-wrapper]){padding-top:24px !important}}' +
        '@media (min-width:1024px){[data-pw-surface] [data-block-id="sec-1"]:not([data-block-wrapper]){padding-top:48px !important}}'
    )
    // camelCase → kebab
    expect(css).toContain('padding-top:24px')
    // md threshold is 768px, lg is 1024px
    expect(css).toContain('@media (min-width:768px)')
    expect(css).toContain('@media (min-width:1024px)')
    // scoped under the surface root
    expect(css).toContain('[data-pw-surface] [data-block-id="sec-1"]')
  })

  it('emits the base/xs value as a non-media rule, not in a media query', () => {
    const css = blockResponsiveStyleCss('b1', {
      padding: { xs: '4px', lg: '32px' },
    })
    // No xs/0px min-width media rule; the base value is a plain scoped rule.
    expect(css).not.toContain('min-width:0px')
    expect(css).not.toContain('@media (min-width:0')
    expect(css).toBe(
      '[data-pw-surface] [data-block-id="b1"]:not([data-block-wrapper]){padding:4px !important}' +
        '@media (min-width:1024px){[data-pw-surface] [data-block-id="b1"]:not([data-block-wrapper]){padding:32px !important}}'
    )
  })

  it('emits no rule for a flat string style value', () => {
    const block: Block = {
      id: 'flat-1',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      style: { color: 'red', fontSize: '14px' },
    }
    expect(collectResponsiveStyleCss([block])).toBe('')
  })

  it('groups multiple props that share a breakpoint into one media rule', () => {
    const css = blockResponsiveStyleCss('g1', {
      paddingTop: { xs: '8px', md: '24px' },
      fontSize: { xs: '14px', md: '18px' },
    })
    expect(css).toBe(
      '[data-pw-surface] [data-block-id="g1"]:not([data-block-wrapper]){padding-top:8px !important;font-size:14px !important}' +
        '@media (min-width:768px){[data-pw-surface] [data-block-id="g1"]:not([data-block-wrapper]){padding-top:24px !important;font-size:18px !important}}'
    )
  })


  it('writes a hoisted key to the WRAPPER and the others to the COMPONENT ROOT', () => {
    const block: Block = {
      id: 'mix-1',
      type: 'section',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      style: {
        marginTop: { xs: '0', md: '-40%' }, // hoisted → wrapper
        padding: { xs: '4px', md: '24px' }, // not hoisted → component root
      },
    } as unknown as Block

    const css = collectResponsiveStyleCss([block])

    // The same value must not be written to TWO selectors at once.
    expect(css).toContain('[data-block-id="mix-1"][data-block-wrapper]{margin-top:0 !important}')
    expect(css).toContain('[data-block-id="mix-1"]:not([data-block-wrapper]){padding:4px !important}')
    expect(css).not.toContain('[data-block-id="mix-1"]{')
    expect(css).not.toContain('[data-block-wrapper]{padding')
    expect(css).not.toContain(':not([data-block-wrapper]){margin-top')
  })

  it('recurses into children', () => {
    const tree: Block = {
      id: 'parent',
      type: 'container',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
      children: [
        {
          id: 'child-1',
          type: 'text',
          layout: DEFAULT_BLOCK_LAYOUT,
          props: {},
          style: { marginTop: { xs: '0', sm: '12px' } },
        },
      ],
    }
    const css = collectResponsiveStyleCss([tree])
    expect(css).toBe(
      '[data-pw-surface] [data-block-id="child-1"][data-block-wrapper]{margin-top:0 !important}' +
        '@media (min-width:640px){[data-pw-surface] [data-block-id="child-1"][data-block-wrapper]{margin-top:12px !important}}'
    )
  })

  it('emits nothing for an empty block list', () => {
    expect(collectResponsiveStyleCss([])).toBe('')
  })

  it('emits nothing for a block with no style', () => {
    const block: Block = {
      id: 'nostyle',
      type: 'text',
      layout: DEFAULT_BLOCK_LAYOUT,
      props: {},
    }
    expect(collectResponsiveStyleCss([block])).toBe('')
  })
})
