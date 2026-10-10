// @vitest-environment jsdom
/**
 * Width Scope Render Tests (DOM)
 *
 * The evidence in the DOM: the measure sits on an inner container, not the
 * root, and `viewport`-scoped blocks are SIBLINGS of that container. The
 * escape is placement, not a CSS trick (`100vw`) — `100vw` counts the
 * scrollbar and would bring back the horizontal overflow.
 *
 * @module @pwfabric/runtime/render/__tests__/width-scope-render
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import * as React from 'react'
import { SurfaceRenderer } from '../renderer.js'

// `useViewport` relies on matchMedia, which jsdom does not implement. A stub
// that never matches (`matches: false`) keeps the hook at its SSR fallback
// 'lg' — what these tests measure is PLACEMENT, not breakpoint behaviour.
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  })
})

const surface = {
  id: 's1',
  blocks: [
    {
      id: 'nav',
      type: 'section',
      props: {},
      layout: { span: { xs: 4 }, widthScope: { xs: 'viewport' } },
    },
    { id: 'body', type: 'section', props: {} },
  ],
} as never

describe('widthScope placement escape', () => {
  it('a viewport-scoped block is a SIBLING of the measured container, not its child', () => {
    const { container } = render(<SurfaceRenderer surface={surface} />)
    const root = container.querySelector('[data-pw-surface]') as HTMLElement
    const measure = root.querySelector('[data-pw-measure]') as HTMLElement
    const nav = root.querySelector('[data-block-id="nav"]') as HTMLElement
    expect(measure).not.toBeNull()
    expect(nav).not.toBeNull()
    expect(measure.contains(nav)).toBe(false)
  })

  it('the measure sits on the inner container, not the ROOT', () => {
    const { container } = render(<SurfaceRenderer surface={surface} />)
    const root = container.querySelector('[data-pw-surface]') as HTMLElement
    const measure = root.querySelector('[data-pw-measure]') as HTMLElement
    expect(root.style.maxWidth).toBe('')
    expect(measure.style.maxWidth).toBe('var(--pw-layout-container-max-width)')
    expect(measure.style.margin).toContain('auto')
  })

  it('stamps a viewport-scoped block for audits', () => {
    const { container } = render(<SurfaceRenderer surface={surface} />)
    const nav = container.querySelector('[data-block-id="nav"]') as HTMLElement
    expect(nav.getAttribute('data-pw-width-scope')).toBe('viewport')
  })

  it('a block without a declaration stays INSIDE the measured container and carries no stamp', () => {
    const { container } = render(<SurfaceRenderer surface={surface} />)
    const measure = container.querySelector('[data-pw-measure]') as HTMLElement
    const body = measure.querySelector('[data-block-id="body"]') as HTMLElement
    expect(body).not.toBeNull()
    expect(body.getAttribute('data-pw-width-scope')).toBeNull()
  })

  it('viewport-scoped chrome inside a row is not stretched to an equal column', () => {
    const rowSurface = {
      id: 's2',
      blocks: [
        {
          id: 'row',
          type: 'container',
          props: { direction: 'row' },
          children: [
            {
              id: 'rail',
              type: 'section',
              props: {},
              layout: { span: { xs: 4 }, widthScope: { xs: 'viewport' } },
            },
            { id: 'main', type: 'section', props: {} },
          ],
        },
      ],
    } as never
    const { container } = render(<SurfaceRenderer surface={rowSurface} />)
    const rail = container.querySelector('[data-block-id="rail"]') as HTMLElement
    expect(rail.style.flexGrow).toBe('0')
    expect(rail.style.flexBasis).toBe('auto')
  })

  it('does not export isShellBlock', async () => {
    const mod = await import('../index.js')
    expect('isShellBlock' in mod).toBe(false)
  })
})
