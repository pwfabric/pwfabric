// @vitest-environment jsdom
/**
 * A block the app GIVES the renderer gets its manifest's props exactly as a
 * block the runtime LOADS does.
 *
 * A block's definition is its descriptor (a `blocks/manifest.json` entry:
 * `definition.props`); its code is either given (`components[type]`, an app
 * that bundles its blocks) or loaded (`descriptor.moduleUrl`). Before this,
 * only a loaded block had its props applied: a given 3.x block got no
 * defaults, so one that reads `props.items.map` threw.
 */

import '../../__tests__/dom-test-setup.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import { SurfaceRenderer, BlockRenderer } from '../renderer.js'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { DynamicArtifactProvider } from '../dynamic-artifact-context.js'
import { BlockModuleLoader } from '../dynamic-block-loader.js'
import type { BlockComponent, BlockComponentRegistry } from '../types.js'

const L = DEFAULT_BLOCK_LAYOUT

/** A 3.x block: it reads its declared defaults and has no fallbacks of its own. */
const List: BlockComponent = ({ block, props }) => (
  <ul data-testid={block.id} data-size={String(props['size'])}>
    {(props['items'] as readonly string[]).map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
)

const descriptor: DynamicBlockDescriptor = {
  blockType: 'list',
  moduleUrl: 'blocks/list.mjs',
  integrity: '0'.repeat(64),
  publisher: 'example',
  publisherVerified: true,
  definition: {
    name: 'list',
    props: [
      { name: 'items', default: ['one', 'two'], jsonSchema: { type: 'array', items: { type: 'string' } } },
      { name: 'size', default: 'md', jsonSchema: { type: 'string', enum: ['sm', 'md', 'lg'] } },
      { name: 'code', bindable: false, jsonSchema: { type: 'string' } },
    ],
  },
}

const components: Partial<BlockComponentRegistry> = { list: List }
const surface = { blocks: [{ id: 'l', type: 'list', layout: L, props: {} }] } as never

afterEach(() => {
  cleanup()
  BlockModuleLoader.invalidate()
  vi.restoreAllMocks()
})

describe('a given block gets its manifest props', () => {
  it('SurfaceRenderer: the defaults are filled in and the block renders', () => {
    const load = vi.spyOn(BlockModuleLoader, 'load')
    render(
      <DynamicArtifactProvider dynamicBlocks={[descriptor]}>
        <SurfaceRenderer surface={surface} components={components} />
      </DynamicArtifactProvider>
    )
    const list = screen.getByTestId('l')
    expect(list.textContent).toBe('onetwo')
    expect(list.getAttribute('data-size')).toBe('md')
    // The code was given: the module the descriptor names is not loaded.
    expect(load).not.toHaveBeenCalled()
  })

  it('DataBoundSurfaceRenderer: the same rule, with values coerced and expressions resolved first', async () => {
    const page = {
      id: 'p',
      blocks: [{ id: 'l', type: 'list', layout: L, props: { size: '{{state.size}}', code: '{{literal}}' } }],
      capabilities: [{ capability: 'platform/persistence', config: { initialState: { size: 'lg' } } }],
    } as never
    const seen: Record<string, unknown>[] = []
    const Probe: BlockComponent = (p) => {
      seen.push(p.props as Record<string, unknown>)
      return <List {...p} />
    }
    render(
      <DynamicArtifactProvider dynamicBlocks={[descriptor]}>
        <DataBoundSurfaceRenderer surface={page} components={{ list: Probe }} />
      </DynamicArtifactProvider>
    )
    await waitFor(() => expect(screen.getByTestId('l').getAttribute('data-size')).toBe('lg'))
    expect(screen.getByTestId('l').textContent).toBe('onetwo')
    // `bindable: false` is read from the same descriptor: the template stays as written.
    expect(seen.at(-1)?.['code']).toBe('{{literal}}')
  })

  it('BlockRenderer: a single block reads the descriptors too', () => {
    render(
      <DynamicArtifactProvider dynamicBlocks={[descriptor]}>
        <BlockRenderer block={{ id: 'l', type: 'list', layout: L, props: { size: 'sm' } } as never} components={components} />
      </DynamicArtifactProvider>
    )
    expect(screen.getByTestId('l').textContent).toBe('onetwo')
    expect(screen.getByTestId('l').getAttribute('data-size')).toBe('sm')
  })

  it('a given block with no descriptor gets its props as written', () => {
    const seen: Record<string, unknown>[] = []
    const Probe: BlockComponent = ({ block, props }) => {
      seen.push(props as Record<string, unknown>)
      return <span data-testid={block.id} />
    }
    render(<SurfaceRenderer surface={{ blocks: [{ id: 'x', type: 'probe', layout: L, props: { a: 1 } }] } as never} components={{ probe: Probe }} />)
    expect(seen.at(-1)).toEqual({ a: 1 })
  })
})

describe('a loaded block is unchanged', () => {
  it('with no given component, the descriptor’s module is drawn with the same props applied', async () => {
    BlockModuleLoader.register('list', { Component: List, definition: null })
    render(
      <DynamicArtifactProvider dynamicBlocks={[descriptor]}>
        <SurfaceRenderer surface={surface} />
      </DynamicArtifactProvider>
    )
    const list = await screen.findByTestId('l')
    expect(list.textContent).toBe('onetwo')
    expect(list.getAttribute('data-size')).toBe('md')
    expect(list.closest('[data-dynamic-block]')?.getAttribute('data-dynamic-block')).toBe('list')
  })
})

describe('the exported surface', () => {
  it('the package root exports blockPropsForRender, as its types say, and it is the renderer’s own', async () => {
    const root = (await import('../../index.js')) as Record<string, unknown>
    const own = await import('../block-props.js')
    expect(root['blockPropsForRender']).toBe(own.blockPropsForRender)
    expect(typeof root['applyBlockProps']).toBe('function')
  })
})
