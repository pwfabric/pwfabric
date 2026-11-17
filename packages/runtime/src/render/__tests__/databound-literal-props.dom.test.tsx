// @vitest-environment jsdom
/**
 * A prop the block's manifest declares `bindable: false` reaches the block as
 * written. The data-bound renderer reads the declarations from the descriptors
 * the host hands it (`blocks/manifest.json` → `DynamicArtifactProvider`), so a
 * code sample showing `{{state.x}}` shows those braces, while the same page's
 * bindable props resolve.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-literal-props.dom
 */
import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { DynamicArtifactProvider } from '../dynamic-artifact-context.js'
import { BlockModuleLoader } from '../dynamic-block-loader.js'
import type { BlockComponent } from '../types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const Code = (({ block, props }: { block: Block; props: Record<string, unknown> }) => (
  <pre data-testid={block.id} data-filename={String(props.filename ?? '')}>
    {String(props.code ?? '')}
  </pre>
)) as unknown as BlockComponent

const descriptor = (props?: DynamicBlockDescriptor['definition']['props']): DynamicBlockDescriptor => ({
  blockType: 'code',
  moduleUrl: 'blocks/code.00000000.mjs',
  integrity: '0'.repeat(64),
  publisher: 'test',
  publisherVerified: false,
  definition: props ? { name: 'code', props } : { name: 'code' },
})

const surface = {
  id: 'docs',
  blocks: [
    { id: 'sample', type: 'code', layout: DEFAULT_BLOCK_LAYOUT, props: { code: 'Hello {{state.x}}', filename: '{{state.x}}.ts' } },
  ],
  capabilities: [{ capability: 'platform/persistence', config: { initialState: { x: 'world' } } }],
} as never

function renderWith(d: DynamicBlockDescriptor): void {
  vi.spyOn(BlockModuleLoader, 'isLoaded').mockReturnValue(true)
  vi.spyOn(BlockModuleLoader, 'getSync').mockReturnValue(Code)
  vi.spyOn(BlockModuleLoader, 'load').mockResolvedValue(Code)
  render(
    <DynamicArtifactProvider dynamicBlocks={[d]}>
      <DataBoundSurfaceRenderer surface={surface} interactionMode="live" />
    </DynamicArtifactProvider>
  )
}

describe('data-bound renderer — bindable: false props', () => {
  it('renders a bindable:false prop with {{state.x}} as the literal; a bindable one resolves', async () => {
    renderWith(descriptor([{ name: 'code', bindable: false }, { name: 'filename' }]))
    await waitFor(() => expect(screen.queryByTestId('sample')).not.toBeNull())
    const el = screen.getByTestId('sample')
    expect(el.textContent).toBe('Hello {{state.x}}')
    expect(el.getAttribute('data-filename')).toBe('world.ts')
  })

  it('resolves every prop when the descriptor declares none', async () => {
    renderWith(descriptor())
    await waitFor(() => expect(screen.queryByTestId('sample')).not.toBeNull())
    expect(screen.getByTestId('sample').textContent).toBe('Hello world')
  })
})
