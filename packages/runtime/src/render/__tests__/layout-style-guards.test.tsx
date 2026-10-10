/**
 * Guards for four layout/style behaviours whose absence shows up as silent
 * page breakage:
 *
 *  1. Hoisted style keys (margin/flex/max-min-width) must NOT reach the
 *     component a second time — a marginTop used to apply on the wrapper AND
 *     the inner root (measured: -40% became -335px + -256px).
 *  2. Grid items get a default min-width:0 so nowrap/max-content children
 *     cannot leak intrinsic width into track sizing (measured: a marquee
 *     pushed the page 63px). Flex children keep min-width:auto — zeroing it
 *     there broke equal-distribution rows (a highlighted word stretched to
 *     half the row).
 *  3. The surface root ships overflow-x:clip — reference pages protect
 *     themselves with body{overflow-x:hidden}; a surface must not rely on
 *     its host for that.
 *  4. A child that EXPLICITLY declares layout.span keeps it inside a grid
 *     parent (parentOwnsLayout used to swallow it, forcing authors into
 *     unschema'd responsive-map gridColumn hacks).
 */
import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SurfaceRenderer } from '../renderer.js'
import type { BlockComponent } from '../types.js'

const StyleEcho: BlockComponent = ({ block }) => (
  <span data-echo style={(block.style ?? {}) as React.CSSProperties}>x</span>
)
const Box: BlockComponent = ({ children }) => <div data-box>{children}</div>

const Chip: BlockComponent = () => <span data-chip>chip</span>
Chip.sizing = 'intrinsic'

const components = { echo: StyleEcho, grid: Box, container: Box, chip: Chip }

function wrapperStyle(html: string, id: string): string {
  const m = html.match(new RegExp('<div style="([^"]*)"[^>]*data-block-id="' + id + '"'))
  return m?.[1] ?? ''
}

function render(blocks: unknown[]): string {
  return renderToStaticMarkup(
    <SurfaceRenderer
      surface={{ id: 's1', blocks } as never}
      components={components as never}
    />
  )
}

describe('hoisted-style stripping (double-margin fix)', () => {
  it('keeps hoisted keys on the wrapper and strips them from the component block', () => {
    const html = render([
      { id: 'a', type: 'echo', props: {}, style: { marginTop: '-40%', color: 'red' } },
    ])
    // wrapper carries the hoisted margin…
    expect(html).toContain('margin-top:-40%')
    // …and the inner element (the echo span) must NOT repeat it, while
    // non-hoisted keys still reach the component untouched.
    const inner = html.slice(html.indexOf('data-echo'))
    expect(inner).not.toContain('margin-top')
    expect(inner).toContain('color:red')
  })

  it('passes the block through untouched when no hoisted key is present', () => {
    const html = render([{ id: 'a', type: 'echo', props: {}, style: { color: 'blue' } }])
    const inner = html.slice(html.indexOf('data-echo'))
    expect(inner).toContain('color:blue')
  })
})

describe('grid-item min-width guard', () => {
  it('zeroes min-width on children of a grid parent', () => {
    const html = render([
      {
        id: 'g', type: 'grid', props: {},
        children: [{ id: 'c', type: 'echo', props: {} }],
      },
    ])
    expect(wrapperStyle(html, 'c')).toContain('min-width:0')
  })

  it('leaves flex children (container parent) at min-width:auto', () => {
    const html = render([
      {
        id: 'r', type: 'container', props: { direction: 'row' },
        children: [{ id: 'c', type: 'echo', props: {} }],
      },
    ])
    expect(wrapperStyle(html, 'c')).not.toContain('min-width:0')
  })
})

describe('surface-root horizontal overflow guard', () => {
  it('ships overflow-x:clip in the base CSS', () => {
    const html = render([{ id: 'a', type: 'echo', props: {} }])
    expect(html).toContain('[data-pw-surface]{overflow-x:clip}')
  })
})

describe('explicit layout.span inside a grid parent', () => {
  it('emits gridColumn for a child that declares span', () => {
    const html = render([
      {
        id: 'g', type: 'grid', props: {},
        children: [{ id: 'c', type: 'echo', props: {}, layout: { span: { xs: 7 } } }],
      },
    ])
    expect(wrapperStyle(html, 'c')).toContain('grid-column:span 7 / span 7')
  })

  it('still lets the grid own layout for span-less children', () => {
    const html = render([
      {
        id: 'g', type: 'grid', props: {},
        children: [{ id: 'c', type: 'echo', props: {} }],
      },
    ])
    expect(wrapperStyle(html, 'c')).not.toContain('grid-column')
  })
})

describe('component-declared intrinsic sizing in a row', () => {
  it('gives a sizing:intrinsic block flex 0 0 auto instead of the equal share', () => {
    const html = render([
      {
        id: 'r', type: 'container', props: { direction: 'row' },
        children: [{ id: 'c', type: 'chip', props: {} }, { id: 't', type: 'echo', props: {} }],
      },
    ])
    expect(wrapperStyle(html, 'c')).toContain('flex-grow:0')
    expect(wrapperStyle(html, 'c')).toContain('flex-basis:auto')
    // the block beside it still takes the fluid share
    expect(wrapperStyle(html, 't')).toContain('flex-grow:1')
  })

  it('lets an authored flex hint on the instance win over the declaration', () => {
    const html = render([
      {
        id: 'r', type: 'container', props: { direction: 'row' },
        children: [{ id: 'c', type: 'chip', props: {}, style: { flex: '1 1 0' } }],
      },
    ])
    expect(wrapperStyle(html, 'c')).toContain('flex:1 1 0')
  })
})

describe('instance-declared fixed width in a row', () => {
  // An image is fluid by type (no `sizing` static), so only the instance can
  // say "I am 56px". That statement must keep the slot at 56px.
  const row = (child: Record<string, unknown>) =>
    render([
      {
        id: 'r', type: 'container', props: { direction: 'row' },
        children: [{ id: 'img', type: 'echo', ...child }, { id: 't', type: 'echo', props: {} }],
      },
    ])

  it('keeps a numeric props.width (image 56) at flex 0 0 auto', () => {
    const html = row({ props: { width: 56, height: 56 } })
    const s = wrapperStyle(html, 'img')
    expect(s).toContain('flex-grow:0')
    expect(s).toContain('flex-shrink:0')
    expect(s).toContain('flex-basis:auto')
    expect(s).not.toContain('flex-basis:0')
    // the text beside it takes the rest
    expect(wrapperStyle(html, 't')).toContain('flex-grow:1')
  })

  it('treats a px string width (props or style) as fixed too', () => {
    expect(wrapperStyle(row({ props: { width: '56px' } }), 'img')).toContain('flex-basis:auto')
    expect(wrapperStyle(row({ props: {}, style: { width: '56px' } }), 'img')).toContain('flex-basis:auto')
  })

  it('leaves a block without a width on the equal share', () => {
    const s = wrapperStyle(row({ props: {} }), 'img')
    expect(s).toContain('flex-grow:1')
    expect(s).toContain('flex-basis:0')
  })

  it('does not treat a relative width (100%, auto) as fixed', () => {
    expect(wrapperStyle(row({ props: { width: '100%' } }), 'img')).toContain('flex-grow:1')
    expect(wrapperStyle(row({ props: { width: 'auto' } }), 'img')).toContain('flex-grow:1')
  })

  it('lets an authored style.flex win over the fixed width', () => {
    const s = wrapperStyle(row({ props: { width: 56 }, style: { flex: '2 1 0' } }), 'img')
    expect(s).toContain('flex:2 1 0')
    expect(s).not.toContain('flex-basis:auto')
  })

  it('does not change a fixed-width block outside a row', () => {
    const html = render([
      {
        id: 'r', type: 'container', props: { direction: 'column' },
        children: [{ id: 'img', type: 'echo', props: { width: 56 } }],
      },
    ])
    expect(wrapperStyle(html, 'img')).not.toContain('flex-basis')
  })
})

// ============================================================
// ROW STACKING LAW — xs turns a fluid row into a column
// ============================================================
const PropsEcho: BlockComponent = ({ block, children }) => (
  <div data-dir={String((block.props as Record<string, unknown>).direction)} data-stacked={String((block.props as Record<string, unknown>).stackedFromRow ?? '')}>
    {children}
  </div>
)
const stackComponents = { container: PropsEcho, echo: StyleEcho, chip: Chip }
const L12 = { span: 12, order: 0 }
function rowSurface(props: Record<string, unknown>, kids: { type: string; span?: number }[]) {
  return {
    id: 's',
    blocks: [
      {
        id: 'row',
        type: 'container',
        layout: L12,
        props: { direction: 'row', ...props },
        children: kids.map((k, i) => ({ id: `k${i}`, type: k.type, layout: { span: k.span ?? 12, order: i }, props: {} })),
      },
    ],
  }
}
const renderAt = (surface: unknown, viewport: 'xs' | 'lg') =>
  renderToStaticMarkup(<SurfaceRenderer surface={surface as never} components={stackComponents as never} viewport={viewport} />)

describe('row stacking law (xs)', () => {
  it('a row with two fluid children renders as a column at xs and keeps the row at lg', () => {
    const s = rowSurface({}, [{ type: 'echo', span: 6 }, { type: 'echo', span: 6 }])
    expect(renderAt(s, 'xs')).toContain('data-dir="column"')
    expect(renderAt(s, 'xs')).toContain('data-stacked="true"')
    expect(renderAt(s, 'lg')).toContain('data-dir="row"')
  })
  it('stacked cells do not inherit column-mode partial-span widths', () => {
    const html = renderAt(rowSurface({}, [{ type: 'echo', span: 6 }, { type: 'echo', span: 6 }]), 'xs')
    expect(wrapperStyle(html, 'k0')).not.toMatch(/width:\s*50%/)
    expect(wrapperStyle(html, 'k0')).not.toMatch(/flex-basis/)
  })
  it('keepRow: true and wrap: true opt out', () => {
    expect(renderAt(rowSurface({ keepRow: true }, [{ type: 'echo' }, { type: 'echo' }]), 'xs')).toContain('data-dir="row"')
    expect(renderAt(rowSurface({ wrap: true }, [{ type: 'echo' }, { type: 'echo' }]), 'xs')).toContain('data-dir="row"')
  })
  it('a content row (intrinsic children, or one fluid child) keeps its direction', () => {
    expect(renderAt(rowSurface({}, [{ type: 'chip' }, { type: 'chip' }, { type: 'echo' }]), 'xs')).toContain('data-dir="row"')
    expect(renderAt(rowSurface({}, [{ type: 'echo' }]), 'xs')).toContain('data-dir="row"')
  })
})

// ============================================================
// AUTO-CENTRED MAX-WIDTH FILLS UP TO ITS MAX WIDTH (H3 L1)
// ============================================================
// At 1280 px a shell content column `{width:'100%', maxWidth,
// marginInline:'auto'}` inside a flex column got `margin: 0 auto` on its
// wrapper but no width — auto margins cancel `stretch`, the wrapper shrank
// to its content (307 px) and a two-pane layout stacked.
describe('auto-centred max-width wrapper', () => {
  const column = (child: Record<string, unknown>) => [
    { id: 'col', type: 'container', props: { direction: 'column' }, children: [child] },
  ]

  it('gives the wrapper width:100% alongside margin:0 auto and max-width', () => {
    const html = render(column({ id: 'c', type: 'echo', props: {}, style: { width: '100%', maxWidth: '1200px' } }))
    const style = wrapperStyle(html, 'c')
    expect(style).toContain('margin:0 auto')
    expect(style).toContain('max-width:1200px')
    expect(style).toMatch(/(^|;)width:100%/)
  })

  it('fills when the block declares no width at all', () => {
    const html = render(column({ id: 'c', type: 'echo', props: {}, style: { maxWidth: '640px' } }))
    expect(wrapperStyle(html, 'c')).toMatch(/(^|;)width:100%/)
  })

  it('leaves blocks that keep their own width shrink-wrapped', () => {
    // intrinsic block (button, badge)
    const chip = render(column({ id: 'c', type: 'chip', props: {}, style: { maxWidth: '200px' } }))
    expect(wrapperStyle(chip, 'c')).not.toMatch(/(^|;)width:/)
    // authored fixed width
    const fixed = render(column({ id: 'c', type: 'echo', props: {}, style: { width: '320px', maxWidth: '640px' } }))
    expect(wrapperStyle(fixed, 'c')).not.toMatch(/(^|;)width:/)
    // explicit margin — no auto-centre, no width
    const margined = render(column({ id: 'c', type: 'echo', props: {}, style: { maxWidth: '640px', margin: '0' } }))
    expect(wrapperStyle(margined, 'c')).not.toMatch(/(^|;)width:/)
    // row cell — its flex basis is its width
    const row = render([
      { id: 'r', type: 'container', props: { direction: 'row' }, children: [{ id: 'c', type: 'echo', props: {}, style: { maxWidth: '640px' } }] },
    ])
    expect(wrapperStyle(row, 'c')).not.toMatch(/(^|;)width:/)
  })
})
