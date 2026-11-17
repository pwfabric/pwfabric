// @vitest-environment jsdom
/**
 * A per-record page title: a surface `title` may carry expressions.
 *
 * Every essay page was titled "Essay" and every dish page "Dish": the title
 * was taken as written. `{{dish.0.name}}` now resolves against the page scope
 * once the record has loaded, and the renderer reports it through `onTitle`.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-title.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT
const Text = ({ props }: { props: Record<string, unknown> }) => <p>{String(props.text ?? '')}</p>
const components: Partial<BlockComponentRegistry> = { text: Text as never }

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const dishPage = (title: string) =>
  ({
    id: 'dish',
    title,
    blocks: [{ id: 'h', type: 'text', layout: L, props: { text: '{{dish.0.name}}' } }],
    capabilities: [
      {
        capability: 'platform/persistence',
        config: {
          dataSources: [{ id: 'dish', kind: 'rest', endpoint: 'http://h/records/Dish', returns: 'data' }],
        },
      },
    ],
  }) as never

describe('a surface title with expressions', () => {
  it('reports nothing until the record has loaded, then its name', async () => {
    let answer: (v: unknown) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((resolve) => {
            answer = resolve
          })
      ) as never
    )
    const onTitle = vi.fn()
    render(
      <DataBoundSurfaceRenderer
        surface={dishPage('{{dish.0.name}}')}
        components={components}
        loadingStrategy="immediate"
        onTitle={onTitle}
      />
    )
    await waitFor(() => expect(onTitle).toHaveBeenCalled())
    expect(onTitle).toHaveBeenLastCalledWith(undefined)
    answer({ ok: true, status: 200, json: async () => ({ data: [{ id: 'd1', name: 'Granola' }] }) })
    await waitFor(() => expect(onTitle).toHaveBeenLastCalledWith('Granola'))
  })

  it('interpolates text around the expression', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'd1', name: 'Granola' }] }) })) as never
    )
    const onTitle = vi.fn()
    render(<DataBoundSurfaceRenderer surface={dishPage('{{dish.0.name}} · Menu')} components={components} onTitle={onTitle} />)
    await waitFor(() => expect(onTitle).toHaveBeenLastCalledWith('Granola · Menu'))
  })

  it('a literal title on a static page is reported as written', async () => {
    const onTitle = vi.fn()
    render(
      <DataBoundSurfaceRenderer
        surface={{ id: 'about', title: 'About', blocks: [{ id: 'h', type: 'text', layout: L, props: { text: 'x' } }] } as never}
        components={components}
        onTitle={onTitle}
      />
    )
    await waitFor(() => expect(onTitle).toHaveBeenLastCalledWith('About'))
  })
})

describe('a surface description with expressions', () => {
  it('reports the page’s description once its record has loaded, like the title', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: 'd1', name: 'Granola' }] }) })) as never
    )
    const onDescription = vi.fn()
    const surface = { ...(dishPage('Dish') as object), description: '{{dish.0.name}} with yoghurt and fruit.' } as never
    render(<DataBoundSurfaceRenderer surface={surface} components={components} onDescription={onDescription} />)
    await waitFor(() => expect(onDescription).toHaveBeenLastCalledWith('Granola with yoghurt and fruit.'))
  })

  it('reports a literal description of a page with nothing dynamic', async () => {
    const onDescription = vi.fn()
    const plain = { id: 'p', description: 'About us.', blocks: [{ id: 'h', type: 'text', layout: L, props: { text: 'Hi' } }] } as never
    render(<DataBoundSurfaceRenderer surface={plain} components={components} onDescription={onDescription} />)
    await waitFor(() => expect(onDescription).toHaveBeenLastCalledWith('About us.'))
  })
})
