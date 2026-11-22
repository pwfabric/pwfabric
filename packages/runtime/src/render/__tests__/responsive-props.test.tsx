/**
 * Breakpoint-valued props: resolved for the breakpoint drawn at, before the
 * block and the renderer's layout read them.
 */
import { describe, expect, it } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Block } from '@pwfabric/core'
import { SurfaceRenderer } from '../renderer.js'
import { isBreakpointMap, resolveResponsiveProps } from '../responsive-props.js'
import type { BlockComponent } from '../types.js'

const block = (props: Record<string, unknown>): Block => ({ id: 'c', type: 'container', props }) as unknown as Block

describe('resolveResponsiveProps', () => {
  it('resolves a breakpoint map mobile first', () => {
    const b = block({ direction: { xs: 'column', md: 'row' }, gap: 8 })
    expect(resolveResponsiveProps(b, 'xs').props).toEqual({ direction: 'column', gap: 8 })
    expect(resolveResponsiveProps(b, 'sm').props).toEqual({ direction: 'column', gap: 8 })
    expect(resolveResponsiveProps(b, 'lg').props).toEqual({ direction: 'row', gap: 8 })
  })

  it('leaves out a prop no breakpoint up to the one drawn at names', () => {
    expect(resolveResponsiveProps(block({ direction: { md: 'row' } }), 'xs').props).toEqual({})
  })

  it('keeps the block when no prop is a map, and an object a prop declares as an object', () => {
    const plain = block({ direction: 'row', style: { color: 'red' } })
    expect(resolveResponsiveProps(plain, 'md')).toBe(plain)
    const declared = block({ sizes: { xs: 1, md: 2 } })
    expect(resolveResponsiveProps(declared, 'md', [{ name: 'sizes', jsonSchema: { type: 'object' } }] as never)).toBe(declared)
    expect(isBreakpointMap({ xs: 1, other: 2 })).toBe(false)
    expect(isBreakpointMap({})).toBe(false)
  })
})

describe('a container with direction { xs: column, md: row }', () => {
  const Row: BlockComponent = ({ props, children }) => (
    <div data-row style={{ display: 'flex', flexDirection: props.direction as React.CSSProperties['flexDirection'] }}>
      {children}
    </div>
  )
  const Cell: BlockComponent = () => <p>cell</p>
  const draw = (viewport: 'xs' | 'md'): string =>
    renderToStaticMarkup(
      <SurfaceRenderer
        surface={{
          id: 's',
          blocks: [
            {
              id: 'c',
              type: 'container',
              props: { direction: { xs: 'column', md: 'row' } },
              children: [
                { id: 'a', type: 'cell', props: {} },
                { id: 'b', type: 'cell', props: {} },
              ],
            },
          ],
        } as never}
        components={{ container: Row, cell: Cell } as never}
        viewport={viewport}
      />
    )

  it('is a column on a phone and a row from md, the cells sharing the row', () => {
    expect(draw('xs')).toContain('flex-direction:column')
    const md = draw('md')
    expect(md).toContain('flex-direction:row')
    // The renderer's own row rule reads the resolved direction: equal cells.
    expect(md).toContain('flex-grow:1')
  })
})
