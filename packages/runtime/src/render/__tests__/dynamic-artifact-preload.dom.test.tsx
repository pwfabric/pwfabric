// @vitest-environment jsdom
/**
 * Mounting the provider must not download every block in the world.
 *
 * `DynamicArtifactProvider` is typically mounted in a web app's root layout,
 * so it is on EVERY route — including pages that render a list and mount no
 * renderer at all. Preloading every descriptor it is handed on mount means
 * dozens of bundle requests, each one hashed with SHA-256 and imported as a
 * blob, for pages that render none of them.
 *
 * Lazy loading is the normal path: `DynamicBlockWrapper` asks the
 * loader for a descriptor when it renders one, and the loader caches and
 * de-dupes by block type. So the preload bought nothing a canvas could not ask
 * for itself — and these cases are what keep it asked for rather than assumed.
 *
 * @module @pwfabric/runtime/render/__tests__/dynamic-artifact-preload.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, waitFor } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import {
  DynamicArtifactProvider,
  preloadDynamicBlocks,
} from '../dynamic-artifact-context.js'
import { SurfaceRenderer } from '../renderer.js'
import type { RenderableSurface } from '../types.js'

vi.mock('../dynamic-block-loader.js', () => ({
  BlockModuleLoader: {
    preload: vi.fn(),
    load: vi.fn(async () => () => null),
    loadAtom: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(false),
    getSync: vi.fn().mockReturnValue(null),
    invalidate: vi.fn(),
  },
}))

const { BlockModuleLoader } = await import('../dynamic-block-loader.js')

function descriptor(blockType: string): DynamicBlockDescriptor {
  return {
    blockType,
    moduleUrl: `https://api.example.com/artifacts/mp/${blockType}/1.0.0/dist/bundle.mjs`,
    integrity: 'sha256-abc123',
    publisher: 'TestPub',
    publisherVerified: true,
    definition: {
      name: blockType,
      category: 'content',
      defaultProps: {},
      canHaveChildren: false,
      propertySchema: [],
    },
  }
}

const CATALOG = ['chart-a', 'chart-b', 'chart-c'].map(descriptor)

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
})

describe('DynamicArtifactProvider — the preload is asked for, not assumed', () => {
  it('downloads nothing when it is merely mounted', async () => {
    render(
      <DynamicArtifactProvider dynamicBlocks={CATALOG}>
        <div data-testid="page">a list page, rendering no blocks</div>
      </DynamicArtifactProvider>
    )
    // Effects have run by now; nothing asked for a bundle.
    await waitFor(() => expect(BlockModuleLoader.preload).not.toHaveBeenCalled())
    expect(BlockModuleLoader.load).not.toHaveBeenCalled()
  })

  it('downloads nothing while rendering on the server either', () => {
    renderToString(
      <DynamicArtifactProvider dynamicBlocks={CATALOG}>
        <div />
      </DynamicArtifactProvider>
    )
    expect(BlockModuleLoader.preload).not.toHaveBeenCalled()
  })

  it('preloads exactly the catalog it was given when a canvas opts in', async () => {
    render(
      <DynamicArtifactProvider dynamicBlocks={CATALOG} preload>
        <div />
      </DynamicArtifactProvider>
    )
    await waitFor(() => expect(BlockModuleLoader.preload).toHaveBeenCalledTimes(1))
    expect(BlockModuleLoader.preload).toHaveBeenCalledWith(CATALOG)
  })

  it('does not preload again on a re-render with the same descriptors', async () => {
    const { rerender } = render(
      <DynamicArtifactProvider dynamicBlocks={CATALOG} preload>
        <div data-testid="x">1</div>
      </DynamicArtifactProvider>
    )
    await waitFor(() => expect(BlockModuleLoader.preload).toHaveBeenCalledTimes(1))
    rerender(
      <DynamicArtifactProvider dynamicBlocks={CATALOG} preload>
        <div data-testid="x">2</div>
      </DynamicArtifactProvider>
    )
    expect(BlockModuleLoader.preload).toHaveBeenCalledTimes(1)
  })

  it('asks for nothing when opted in with no descriptors', async () => {
    render(
      <DynamicArtifactProvider preload>
        <div />
      </DynamicArtifactProvider>
    )
    await waitFor(() => expect(BlockModuleLoader.preload).not.toHaveBeenCalled())
  })
})

describe('preloadDynamicBlocks', () => {
  it('lets a canvas warm the catalog imperatively, when it knows it will render blocks', () => {
    preloadDynamicBlocks(CATALOG)
    expect(BlockModuleLoader.preload).toHaveBeenCalledWith(CATALOG)
  })

  it('is a no-op for an empty or absent catalog — no request, no throw', () => {
    preloadDynamicBlocks([])
    preloadDynamicBlocks(undefined)
    expect(BlockModuleLoader.preload).not.toHaveBeenCalled()
  })
})

describe('the lazy path still carries the load', () => {
  it('loads a block the moment a surface actually renders it', async () => {
    const surface: RenderableSurface = {
      blocks: [{ id: 'a-1', type: 'chart-a', layout: DEFAULT_BLOCK_LAYOUT, props: {} }],
    }
    render(
      <DynamicArtifactProvider dynamicBlocks={CATALOG}>
        <SurfaceRenderer surface={surface} components={{}} />
      </DynamicArtifactProvider>
    )
    // One block rendered, one bundle asked for — and only that one.
    await waitFor(() => expect(BlockModuleLoader.load).toHaveBeenCalledTimes(1))
    expect(
      (BlockModuleLoader.load as unknown as { mock: { calls: DynamicBlockDescriptor[][] } }).mock
        .calls[0]?.[0]?.blockType
    ).toBe('chart-a')
    expect(BlockModuleLoader.preload).not.toHaveBeenCalled()
  })
})
