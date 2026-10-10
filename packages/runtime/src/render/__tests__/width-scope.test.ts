/**
 * Width Scope Tests
 *
 * Grouping must KEEP SOURCE ORDER: a surface runs
 * `[navbar][body…][bottombar]`, and collecting `viewport`-scoped blocks into
 * one bucket would put the bottom bar next to the top bar. Consecutive
 * grouping keeps the order — three groups, three DOM siblings.
 *
 * @module @pwfabric/runtime/render/__tests__/width-scope
 */
import { describe, expect, it } from 'vitest'
import type { Block } from '@pwfabric/core'
import { chunkByWidthScope, resolveWidthScope } from '../width-scope.js'

const b = (id: string, scope?: Record<string, string>): Block =>
  ({
    id,
    type: 'section',
    props: {},
    ...(scope ? { layout: { span: { xs: 4 }, widthScope: scope } } : {}),
  }) as unknown as Block

describe('resolveWidthScope', () => {
  it('is container without a declaration', () => {
    expect(resolveWidthScope(b('x'), 'lg')).toBe('container')
  })

  it('applies the breakpoint cascade — an xs value holds for lg too', () => {
    expect(resolveWidthScope(b('x', { xs: 'viewport' }), 'lg')).toBe('viewport')
  })

  it('a larger breakpoint wins with its own value', () => {
    expect(resolveWidthScope(b('x', { xs: 'viewport', lg: 'container' }), 'lg')).toBe('container')
    expect(resolveWidthScope(b('x', { xs: 'viewport', lg: 'container' }), 'xs')).toBe('viewport')
  })
})

describe('chunkByWidthScope', () => {
  it('keeps source order — chrome, body, chrome become three groups', () => {
    const blocks = [b('nav', { xs: 'viewport' }), b('body'), b('bar', { xs: 'viewport' })]
    const chunks = chunkByWidthScope(blocks, 'lg')
    expect(chunks.map((c) => c.scope)).toEqual(['viewport', 'container', 'viewport'])
    expect(chunks.map((c) => c.blocks.map((x) => x.id))).toEqual([['nav'], ['body'], ['bar']])
  })

  it('groups consecutive blocks of the same scope together', () => {
    const blocks = [b('a'), b('b'), b('nav', { xs: 'viewport' })]
    const chunks = chunkByWidthScope(blocks, 'lg')
    expect(chunks.map((c) => c.scope)).toEqual(['container', 'viewport'])
    expect(chunks[0]?.blocks.map((x) => x.id)).toEqual(['a', 'b'])
  })

  it('returns an empty array for empty input', () => {
    expect(chunkByWidthScope([], 'lg')).toEqual([])
  })

  it('grouping changes with the breakpoint', () => {
    const blocks = [b('rail', { xs: 'viewport', lg: 'container' }), b('body')]
    expect(chunkByWidthScope(blocks, 'xs').map((c) => c.scope)).toEqual(['viewport', 'container'])
    expect(chunkByWidthScope(blocks, 'lg').map((c) => c.scope)).toEqual(['container'])
  })
})
