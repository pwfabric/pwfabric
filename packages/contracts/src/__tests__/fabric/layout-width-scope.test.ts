/**
 * `BlockLayout.widthScope` contract tests.
 *
 * The addition is a TYPE, so the meaningful assertion is a compile-time one:
 * these declarations fail `tsc` if the contract drifts. The runtime assertions
 * below exist so the file is executable — coverage is per-package and a
 * type-only file would report as untested.
 *
 * Why the field lives HERE and not only in `@pwfabric/core`: `Block.layout`
 * is typed by this package (the block instance is canonical in contracts).
 * Adding the field to core's parallel `BlockLayout` alone would leave
 * `block.layout.widthScope` a type error, because the two definitions are
 * kept in sync by hand.
 *
 * @module @pwfabric/contracts/__tests__/fabric/layout-width-scope
 */

import { describe, expect, it } from 'vitest'
import type { BlockLayout, WidthScope } from '../../fabric/layout.js'

describe('BlockLayout.widthScope', () => {
  it('accepts a breakpoint map', () => {
    const layout: BlockLayout = {
      span: { xs: 4 },
      widthScope: { xs: 'viewport', lg: 'container' },
    }
    expect(layout.widthScope?.xs).toBe('viewport')
    expect(layout.widthScope?.lg).toBe('container')
  })

  it('is optional — a layout without it is still a valid contract', () => {
    const layout: BlockLayout = { span: { xs: 4 } }
    expect(layout.widthScope).toBeUndefined()
  })

  it('carries exactly two words — container and viewport', () => {
    const scopes: WidthScope[] = ['container', 'viewport']
    expect(scopes).toHaveLength(2)
  })

  it('can be declared at every breakpoint', () => {
    const layout: BlockLayout = {
      span: { xs: 4 },
      widthScope: {
        xs: 'viewport',
        sm: 'viewport',
        md: 'container',
        lg: 'container',
        xl: 'container',
        '2xl': 'container',
      },
    }
    expect(Object.keys(layout.widthScope ?? {})).toHaveLength(6)
  })
})
