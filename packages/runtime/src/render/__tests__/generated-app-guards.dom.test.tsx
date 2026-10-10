// @vitest-environment jsdom
/**
 * Strict review of generated apps — the runtime half.
 *
 *  P4  Repeat clones got the surface default `gridColumn: span 12`. Inside the
 *      repeater's own grid (`repeat(auto-fit, minmax(…))`) a 12-column span
 *      puts every item on a row of its own, so every repeater wall was one
 *      column. The parent that
 *      expanded the repeat now owns its clones' layout.
 *  P2  `visibleWhen` was never evaluated on a static page: with no source,
 *      state or action the surface took the passthrough, so a brand logo
 *      gated on an empty value drew as "⊟ <name> logo" and a thank-you
 *      showed before any submit.
 *  P1  statusKeys must survive assembly. The runtime half is checked here: a binding that KEEPS its statusKeys shows the success
 *      toast after a real write. Green before and after — a guard, not a fix.
 *
 * Each case also shows the neighbouring behaviour
 * that must NOT change.
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { SurfaceRenderer } from '../renderer.js'
import { DataBoundSurfaceRenderer, surfaceNeedsDataBinding } from '../DataBoundSurfaceRenderer.js'
import { resolveBlockExpressions, isRepeatExpanded } from '../resolve-expressions.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponent, BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())

const L = DEFAULT_BLOCK_LAYOUT

/** The repeater's own grid, as foundation draws it in item-template mode. */
const Repeater: BlockComponent = ({ block, children }) => (
  <div
    data-repeater={block.id}
    style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))' }}
  >
    {children}
  </div>
)
const Card: BlockComponent = ({ props }) => <article data-card>{String(props.title ?? '')}</article>
const Box: BlockComponent = ({ children }) => <div data-box>{children}</div>
const Text: BlockComponent = ({ props }) => <p data-testid="text">{String(props.content ?? '')}</p>
const Image: BlockComponent = ({ props }) => <span data-image>⊟ {String(props.alt ?? '')}</span>

const components = { repeater: Repeater, card: Card, container: Box, text: Text, image: Image }

function wrapperStyle(html: string, id: string): string {
  const m = html.match(new RegExp('<div style="([^"]*)"[^>]*data-block-id="' + id + '"'))
  return m?.[1] ?? ''
}

const wall = (): Block[] => [
  {
    id: 'wall',
    type: 'repeater',
    layout: L,
    repeat: '{{state.items}}',
    props: { columns: 3 },
    children: [{ id: 'card', type: 'card', layout: L, props: { title: '{{item.t}}' } }],
  } as Block,
]
const items = [{ t: 'One' }, { t: 'Two' }, { t: 'Three' }]

function ssr(blocks: Block[], viewport: 'xs' | 'lg'): string {
  return renderToStaticMarkup(
    <SurfaceRenderer surface={{ id: 's', blocks } as never} components={components as never} viewport={viewport} />
  )
}

describe("a repeat owns its clones' layout", () => {
  it('clones carry no 12-column span into the repeater grid (desktop)', () => {
    const resolved = resolveBlockExpressions(wall(), { state: { items } })
    expect(isRepeatExpanded(resolved[0])).toBe(true)
    const html = ssr(resolved, 'lg')
    for (const i of [0, 1, 2]) {
      expect(wrapperStyle(html, `card--${i}`), `card--${i}`).not.toContain('grid-column')
    }
    // The repeater itself is still a surface grid item with its own span.
    expect(wrapperStyle(html, 'wall')).toContain('grid-column:span 12 / span 12')
  })

  it('clones carry no span on a phone either — the repeater grid falls back to one column itself', () => {
    const html = ssr(resolveBlockExpressions(wall(), { state: { items } }), 'xs')
    expect(wrapperStyle(html, 'card--0')).not.toContain('grid-column')
  })

  it('an authored span on the template does not break the wall', () => {
    const blocks = wall()
    ;(blocks[0]!.children![0] as { layout: unknown }).layout = { span: 12 }
    const html = ssr(resolveBlockExpressions(blocks, { state: { items } }), 'lg')
    expect(wrapperStyle(html, 'card--1')).not.toContain('grid-column')
  })

  it('control: the same children WITHOUT a repeat keep the default span', () => {
    const blocks: Block[] = [
      {
        id: 'wall',
        type: 'repeater',
        layout: L,
        props: {},
        children: [{ id: 'card', type: 'card', layout: L, props: { title: 'x' } }],
      } as Block,
    ]
    const resolved = resolveBlockExpressions(blocks, { state: {} })
    expect(isRepeatExpanded(resolved[0])).toBe(false)
    expect(wrapperStyle(ssr(resolved, 'lg'), 'card')).toContain('grid-column:span 12 / span 12')
  })

  it('the mark never reaches the surface document', () => {
    const resolved = resolveBlockExpressions(wall(), { state: { items } })
    expect(JSON.stringify(resolved)).not.toContain('repeatExpanded')
    expect(Object.keys(resolved[0]!)).not.toContain('repeat')
  })

  it('survives the real data-bound path', () => {
    const { container } = render(
      <DataBoundSurfaceRenderer
        surface={
          {
            id: 's',
            blocks: wall(),
            capabilities: [{ capability: 'platform/persistence', config: { initialState: { items } } }],
          } as never
        }
        components={components as never}
      />
    )
    const cards = container.querySelectorAll('[data-block-id^="card--"]')
    expect(cards.length).toBe(3)
    cards.forEach((el) => expect((el as HTMLElement).style.gridColumn).toBe(''))
  })
})

describe('visibleWhen runs on static pages', () => {
  /** The shell brand band: an empty logo gated on its source, then the name as text. */
  const brandPage = (): Block[] => [
    {
      id: 'brand',
      type: 'container',
      layout: L,
      props: { direction: 'row' },
      children: [
        {
          id: 'brand-logo',
          type: 'image',
          layout: L,
          props: { src: '', alt: 'Usta Makas logo' },
          visibleWhen: '{{state.brandLogo}}',
        } as Block,
        { id: 'brand-name', type: 'text', layout: L, props: { content: 'Usta Makas' } },
      ],
    },
    {
      id: 'thanks',
      type: 'text',
      layout: L,
      props: { content: 'Thank you' },
      visibleWhen: '{{state.submitted}}',
    } as Block,
  ]

  it('a static page with a condition or a repeat takes the data-bound path', () => {
    expect(surfaceNeedsDataBinding({ blocks: brandPage() })).toBe(true)
    expect(
      surfaceNeedsDataBinding({
        blocks: [{ id: 'r', type: 'repeater', layout: L, repeat: '{{x}}', props: {}, children: [] } as Block],
      })
    ).toBe(true)
    // An empty condition is no condition — the page stays on the passthrough.
    expect(
      surfaceNeedsDataBinding({ blocks: [{ id: 't', type: 'text', layout: L, props: {}, visibleWhen: '  ' } as Block] })
    ).toBe(false)
  })

  it('hides the empty logo and the thank-you, keeps the text brand', () => {
    const { container } = render(
      <DataBoundSurfaceRenderer surface={{ id: 's', blocks: brandPage() }} components={components as never} />
    )
    expect(container.querySelector('[data-image]')).toBeNull()
    expect(screen.queryByText('Thank you')).toBeNull()
    expect(screen.getByText('Usta Makas')).toBeTruthy()
  })

  it('control: a logo whose condition holds still shows', () => {
    const blocks = brandPage()
    ;(blocks[0]!.children![0] as { visibleWhen: string }).visibleWhen = 'https://cdn.test/logo.png'
    const { container } = render(
      <DataBoundSurfaceRenderer surface={{ id: 's', blocks }} components={components as never} />
    )
    expect(container.querySelector('[data-image]')).not.toBeNull()
  })
})

describe('a binding that keeps statusKeys shows the success toast', () => {
  const fetchMock = vi.fn()
  const originalFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = originalFetch
    fetchMock.mockReset()
  })

  const FormBlock: BlockComponent = () => {
    const { emit } = useSurfaceEvents()
    const sid = useSurfaceId()
    return (
      <button
        data-testid="send"
        onClick={() =>
          emit({
            type: SURFACE_EVENTS.FORM_SUBMIT,
            surfaceId: sid,
            blockId: 'book',
            payload: { values: { name: 'Ada' }, formId: 'book', timestamp: 0 },
          } as never)
        }
      >
        Send
      </button>
    )
  }

  it('success state reaches the gated toast after the write answers', async () => {
    globalThis.fetch = fetchMock as never
    fetchMock.mockImplementation(async (_u: string, init?: RequestInit) => {
      const get = (init?.method ?? 'GET') === 'GET'
      return {
        ok: true,
        status: get ? 200 : 201,
        statusText: 'OK',
        json: async () => (get ? { data: [] } : { data: { id: 'r1', name: 'Ada' } }),
      }
    })
    const surface = {
      id: 'book-page',
      blocks: [
        { id: 'book', type: 'form', layout: L, props: {} },
        {
          id: 'toast',
          type: 'text',
          layout: L,
          props: { content: 'Your booking is confirmed' },
          visibleWhen: '{{state.submitted}}',
        },
      ],
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            dataSources: [
              { id: 'appts', kind: 'rest', endpoint: 'https://api.test/records/Appointment', method: 'GET', returns: 'data' },
            ],
          },
        },
        {
          capability: 'platform/entities',
          config: {
            formBindings: [
              {
                formId: 'book',
                sourceId: 'appts',
                method: 'POST',
                statusKeys: { loading: 'submitting', success: 'submitted', error: 'failed' },
              },
            ],
          },
        },
      ],
    } as never
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={{ ...components, form: FormBlock } as unknown as BlockComponentRegistry}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.getByTestId('send')).toBeTruthy())
    expect(screen.queryByText('Your booking is confirmed')).toBeNull()
    fireEvent.click(screen.getByTestId('send'))
    await waitFor(() => expect(screen.getByText('Your booking is confirmed')).toBeTruthy())
  })
})
