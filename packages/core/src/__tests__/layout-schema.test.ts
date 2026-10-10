/**
 * Block Layout Schema Tests
 *
 * `widthScope` — whether a block's width belongs to the measured container or
 * to the viewport. The contract's accept and REJECT surface is pinned here: a
 * check that one day says "viewport declared but the block does not reach the
 * edge" first needs the declaration itself to be narrow and verifiable.
 *
 * @module @pwfabric/core/__tests__/layout-schema
 */

import { describe, it, expect } from 'vitest'
import { blockLayoutSchema } from '../blocks/layout-schema.js'

describe('widthScope', () => {
  it('kirilma noktasi haritasi kabul eder', () => {
    const parsed = blockLayoutSchema.parse({
      span: { xs: 4 },
      widthScope: { xs: 'viewport', lg: 'container' },
    })
    expect(parsed.widthScope).toEqual({ xs: 'viewport', lg: 'container' })
  })

  it('alan olmadan gecerlidir — varsayilan container, beyan zorunlu degil', () => {
    const parsed = blockLayoutSchema.parse({ span: { xs: 4 } })
    expect(parsed.widthScope).toBeUndefined()
  })

  it('bilinmeyen kapsami reddeder', () => {
    expect(() =>
      blockLayoutSchema.parse({ span: { xs: 4 }, widthScope: { xs: 'full' } })
    ).toThrow()
  })

  it('bilinmeyen kirilma noktasini reddeder', () => {
    expect(() =>
      blockLayoutSchema.parse({ span: { xs: 4 }, widthScope: { xxl: 'viewport' } })
    ).toThrow()
  })

  it('alti kirilma noktasinin hepsini tasiyabilir', () => {
    const all = { xs: 'viewport', sm: 'viewport', md: 'container', lg: 'container', xl: 'container', '2xl': 'container' } as const
    const parsed = blockLayoutSchema.parse({ span: { xs: 4 }, widthScope: all })
    expect(parsed.widthScope).toEqual(all)
  })
})
