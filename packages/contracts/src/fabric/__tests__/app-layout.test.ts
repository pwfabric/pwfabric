import { describe, expect, it } from 'vitest'
import { assembleIntoLayout, layoutSlotProblems, PAGE_SLOT_TYPE } from '../app-layout.js'

const layout = {
  blocks: [
    { id: 'nav', type: 'navbar', props: { links: [] } },
    { id: 'main', type: 'section', children: [{ type: PAGE_SLOT_TYPE }] },
    { id: 'foot', type: 'footer', props: { text: '(c) Example' } },
  ],
}

const page = {
  title: 'About',
  blocks: [
    { id: 'intro', type: 'text', props: { content: 'About us' } },
    { id: 'more', type: 'text', props: { content: 'More' } },
  ],
}

const navMarks = (type: string): boolean => type === 'navbar'

describe('layoutSlotProblems (receipt §4, the page slot)', () => {
  it('accepts exactly one bare slot, at any depth', () => {
    expect(layoutSlotProblems(layout)).toEqual([])
    expect(layoutSlotProblems({ blocks: [{ type: PAGE_SLOT_TYPE, id: 'slot' }] })).toEqual([])
  })

  it('refuses no slot, two slots, a slot that carries more, and a slot inside a repeat', () => {
    expect(layoutSlotProblems({ blocks: [{ id: 'nav', type: 'navbar' }] })).toHaveLength(1)
    expect(layoutSlotProblems({ blocks: [{ type: PAGE_SLOT_TYPE }, { type: PAGE_SLOT_TYPE }] }).join()).toMatch(/2/)
    expect(layoutSlotProblems({ blocks: [{ type: PAGE_SLOT_TYPE, props: {} }] }).join()).toMatch(/props/)
    expect(
      layoutSlotProblems({ blocks: [{ id: 'r', type: 'repeater', repeat: '{{state.tabs}}', children: [{ type: PAGE_SLOT_TYPE }] }] }).join()
    ).toMatch(/repeat/)
    expect(layoutSlotProblems({ blocks: [{ id: 'nav', type: 'navbar' }, { type: PAGE_SLOT_TYPE, visibleWhen: '{{x}}' }] }).join()).toMatch(/visibleWhen/)
  })

  it('refuses a layout that is not a receipt', () => {
    expect(layoutSlotProblems('x')).toHaveLength(1)
    expect(layoutSlotProblems({})).toHaveLength(1)
  })
})

describe('assembleIntoLayout (receipt §4, assembling a page)', () => {
  it('puts the page blocks in place of the slot, in order, the slot itself not drawn', () => {
    const { receipt, problems } = assembleIntoLayout(layout, page, { currentHref: '/about' })
    expect(problems).toEqual([])
    expect(receipt.blocks.map((b) => b.id)).toEqual(['nav', 'main', 'foot'])
    expect(receipt.blocks[1]?.children?.map((b) => b.id)).toEqual(['intro', 'more'])
    expect(receipt.title).toBe('About')
  })

  it('puts them at the top level for a slot at the top level', () => {
    const { receipt } = assembleIntoLayout({ blocks: [{ id: 'nav', type: 'navbar' }, { type: PAGE_SLOT_TYPE }] }, page, { currentHref: '/about' })
    expect(receipt.blocks.map((b) => b.id)).toEqual(['nav', 'intro', 'more'])
  })

  it('draws a page that opts out, and every page without a layout, as it is', () => {
    const own = { ...page, layout: false }
    expect(assembleIntoLayout(layout, own, { currentHref: '/about' }).receipt).toBe(own)
    expect(assembleIntoLayout(undefined, page, { currentHref: '/about' }).receipt).toBe(page)
  })

  it('does not change the layout or the page it was handed', () => {
    const before = JSON.stringify(layout)
    assembleIntoLayout(layout, page, { currentHref: '/about', marksCurrent: navMarks })
    expect(JSON.stringify(layout)).toBe(before)
  })

  it('gives a layout block that marks the current page the page address, and keeps one the layout writes', () => {
    const marked = assembleIntoLayout(layout, page, { currentHref: '/about', marksCurrent: navMarks }).receipt
    expect(marked.blocks[0]?.props?.['activeHref']).toBe('/about')
    expect(marked.blocks[2]?.props?.['activeHref']).toBeUndefined()
    const written = { blocks: [{ id: 'nav', type: 'navbar', props: { activeHref: '/docs' } }, { type: PAGE_SLOT_TYPE }] }
    expect(assembleIntoLayout(written, page, { currentHref: '/about', marksCurrent: navMarks }).receipt.blocks[0]?.props?.['activeHref']).toBe('/docs')
    // The not-found page marks no item.
    expect(assembleIntoLayout(layout, page, { currentHref: '', marksCurrent: navMarks }).receipt.blocks[0]?.props?.['activeHref']).toBe('')
  })

  it('does not fill activeHref on the page blocks', () => {
    const withNav = { blocks: [{ id: 'pnav', type: 'navbar', props: {} }] }
    const r = assembleIntoLayout(layout, withNav, { currentHref: '/about', marksCurrent: navMarks }).receipt
    expect(r.blocks[1]?.children?.[0]?.props?.['activeHref']).toBeUndefined()
  })

  it('joins the capabilities: persistence sources and behaviors concatenated, initialState merged, others added unless the page binds them', () => {
    const l = {
      ...layout,
      capabilities: [
        { capability: 'platform/persistence', config: { dataSources: [{ id: 'Menu', kind: 'rest' }], behaviors: [{ id: 'b1' }], initialState: { open: false, tab: 'a' } } },
        { capability: 'platform/analytics', config: { from: 'layout' } },
        { capability: 'platform/search', config: { from: 'layout' } },
      ],
    }
    const p = {
      ...page,
      capabilities: [
        { capability: 'platform/persistence', config: { dataSources: [{ id: 'Product', kind: 'rest' }], behaviors: [{ id: 'b2' }], initialState: { tab: 'b' } } },
        { capability: 'platform/search', config: { from: 'page' } },
      ],
    }
    const { receipt, problems } = assembleIntoLayout(l, p, { currentHref: '/about' })
    expect(problems).toEqual([])
    const caps = receipt.capabilities ?? []
    const persistence = caps.find((c) => c.capability === 'platform/persistence')?.config as Record<string, unknown>
    expect((persistence['dataSources'] as { id: string }[]).map((s) => s.id)).toEqual(['Menu', 'Product'])
    expect((persistence['behaviors'] as { id: string }[]).map((s) => s.id)).toEqual(['b1', 'b2'])
    expect(persistence['initialState']).toEqual({ open: false, tab: 'b' })
    expect(caps.find((c) => c.capability === 'platform/analytics')?.config).toEqual({ from: 'layout' })
    expect(caps.filter((c) => c.capability === 'platform/search').map((c) => c.config)).toEqual([{ from: 'page' }])
  })

  it('reports a block id and a source id the page repeats, and never shares the source', () => {
    const l = {
      blocks: [{ id: 'intro', type: 'navbar' }, { type: PAGE_SLOT_TYPE }],
      capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'Product', kind: 'rest', endpoint: '/layout' }] } }],
    }
    const p = { ...page, capabilities: [{ capability: 'platform/persistence', config: { dataSources: [{ id: 'Product', kind: 'rest', endpoint: '/page' }] } }] }
    const { receipt, problems } = assembleIntoLayout(l, p, { currentHref: '/about' })
    expect(problems.map((x) => `${x.kind}:${x.id}`).sort()).toEqual(['block:intro', 'source:Product'])
    const sources = (receipt.capabilities?.[0]?.config as { dataSources: { endpoint: string }[] }).dataSources
    expect(sources.map((s) => s.endpoint)).toEqual(['/page'])
  })
})
