// @vitest-environment jsdom
/**
 * Engine 3.0 — what the example apps found in the block contract.
 *
 * E11  A behavior on a block inside a `repeat` reads its row (`item`, `index`),
 *      as the block's props do: a per-row write (remove this line) is said in
 *      the receipt.
 * E7   A click dispatches the action the block rendered with — its manifest's
 *      default when the receipt leaves `action` out — not the raw receipt.
 *
 * @module @pwfabric/runtime/render/__tests__/engine-3-contract.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { SURFACE_EVENTS, type DynamicBlockDescriptor } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { DynamicArtifactProvider } from '../dynamic-artifact-context.js'
import { BlockModuleLoader } from '../dynamic-block-loader.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT

type P = { block: Block; props: Record<string, unknown>; children?: React.ReactNode }
const Text = ({ block, props }: P) => <div data-testid={block.id}>{String(props.text ?? '')}</div>
const Box = ({ block, children }: P) => <div data-testid={block.id}>{children}</div>
const Btn = ({ block }: P) => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={block.id}
      onClick={() => emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: block.id } as never)}
    >
      {block.id}
    </button>
  )
}
const components: Partial<BlockComponentRegistry> = { text: Text as never, button: Btn as never, box: Box as never }

const click = async (id: string): Promise<void> => {
  await act(async () => screen.getByTestId(id).click())
}

afterEach(() => {
  cleanup()
  BlockModuleLoader.invalidate()
})

describe('E11 a behavior on a repeated block reads its row', () => {
  const page = {
    id: 'cart',
    blocks: [
      {
        id: 'lines',
        type: 'box',
        layout: L,
        repeat: '{{state.lines}}',
        children: [{ id: 'remove', type: 'button', layout: L, props: {} }],
      },
      { id: 'out', type: 'text', layout: L, props: { text: 'removed={{state.removed}} at={{state.at}}' } },
    ],
    capabilities: [
      {
        capability: 'platform/persistence',
        config: {
          initialState: { lines: [{ id: 'l-1' }, { id: 'l-2' }, { id: 'l-3' }] },
          behaviors: [
            {
              id: 'b',
              event: 'block:click',
              targetBlockId: 'remove',
              actions: [
                { type: 'setState', key: 'removed', value: '{{item.id}}' },
                { type: 'setState', key: 'at', value: '{{index}}' },
              ],
            },
          ],
        },
      },
    ],
  } as never

  it('the second row’s button writes the second row', async () => {
    render(<DataBoundSurfaceRenderer surface={page} components={components} />)
    await click('remove--1')
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('removed=l-2 at=1'))
    await click('remove--2')
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('removed=l-3 at=2'))
  })

  it('outside a repeat there is no row: `item` does not resolve', async () => {
    const flat = {
      id: 'p',
      blocks: [
        { id: 'go', type: 'button', layout: L, props: {} },
        { id: 'out', type: 'text', layout: L, props: { text: 'v={{state.v}}' } },
      ],
      capabilities: [
        {
          capability: 'platform/persistence',
          config: {
            initialState: {},
            behaviors: [{ id: 'b', event: 'block:click', targetBlockId: 'go', actions: [{ type: 'setState', key: 'v', value: 'x{{item.id}}' }] }],
          },
        },
      ],
    } as never
    render(<DataBoundSurfaceRenderer surface={flat} components={components} />)
    await click('go')
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('v=x'))
  })
})

describe('E7 a click dispatches the action the block rendered with', () => {
  const descriptor = {
    blockType: 'button',
    moduleUrl: 'blocks/button.js',
    integrity: '0'.repeat(64),
    definition: {
      props: [{ name: 'action', jsonSchema: { type: 'object' }, default: { type: 'setState', key: 'hit', value: 'default' } }],
    },
  } as unknown as DynamicBlockDescriptor

  const page = {
    id: 'p',
    blocks: [
      { id: 'go', type: 'button', layout: L, props: {} },
      { id: 'out', type: 'text', layout: L, props: { text: 'hit={{state.hit}}' } },
    ],
    capabilities: [{ capability: 'platform/persistence', config: { initialState: { hit: 'no' } } }],
  } as never

  it('a button whose receipt leaves `action` out runs its declared default', async () => {
    BlockModuleLoader.register('button', { Component: Btn as never, definition: null })
    render(
      <DynamicArtifactProvider dynamicBlocks={[descriptor]}>
        <DataBoundSurfaceRenderer surface={page} components={components} />
      </DynamicArtifactProvider>
    )
    await click('go')
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('hit=default'))
  })
})

describe('E9 a file picked in a form is refused before sending, never dropped', () => {
  // The pack's form gathers its values without the file, as it does.
  const Form = ({ block }: P) => {
    const { emit } = useSurfaceEvents()
    const surfaceId = useSurfaceId()
    return (
      <form id={block.id} data-testid={block.id}>
        <input name="name" defaultValue="Ada" />
        <input type="file" name="logo" data-testid="logo" />
        <button
          type="button"
          data-testid="send"
          onClick={() =>
            emit({
              type: SURFACE_EVENTS.FORM_SUBMIT,
              surfaceId,
              blockId: block.id,
              payload: { values: { name: 'Ada' }, formId: block.id, timestamp: 0 },
            } as never)
          }
        />
      </form>
    )
  }
  const page = {
    id: 'settings',
    blocks: [
      { id: 'ws', type: 'form', layout: L, props: {} },
      { id: 'out', type: 'text', layout: L, props: { text: 'reason={{state.why}} fields={{join(state.which, \',\')}}' } },
    ],
    capabilities: [
      {
        capability: 'platform/persistence',
        config: { dataSources: [{ id: 'workspace', kind: 'rest', endpoint: '/api/workspace', method: 'GET' }] },
      },
      {
        capability: 'platform/entities',
        config: { formBindings: [{ formId: 'ws', sourceId: 'workspace', statusKeys: { reason: 'why', fields: 'which' } }] },
      },
    ],
  } as never

  it('the write fails with reason validation and the file control named; nothing is posted', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }))
    vi.stubGlobal('fetch', fetch as never)
    render(<DataBoundSurfaceRenderer surface={page} components={{ ...components, form: Form as never }} />)
    const input = (await screen.findByTestId('logo')) as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['x'], 'logo.png', { type: 'image/png' })] })
    const reads = fetch.mock.calls.length
    await click('send')
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('reason=validation fields=logo'))
    // Only the page's reads went out; no POST.
    expect(fetch.mock.calls.slice(reads).filter((c) => (c as unknown[])[1] && ((c as unknown[])[1] as { method?: string }).method === 'POST')).toEqual([])
    vi.unstubAllGlobals()
  })
})
