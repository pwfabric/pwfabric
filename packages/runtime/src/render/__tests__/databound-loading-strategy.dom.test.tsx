// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — loadingStrategy.
 *
 * Proves the two initial-load behaviors:
 * - 'gate' (default): the block tree is withheld behind the
 *   `data-surface-loading` placeholder until the first fetch pass settles —
 *   the historical behavior, byte-identical for existing consumers.
 * - 'immediate': the block tree renders on the FIRST frame (static chrome
 *   visible at once); bindings to still-loading sources resolve to undefined
 *   and fill in when the fetch lands. Per-source `__loading.<id>` and
 *   `__anyLoading` expression keys report the in-flight state so blocks can
 *   drive skeletons.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-loading-strategy.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
})

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="text-block">{String(props.content ?? '')}</p>
  )) as never,
}

const blocks: Block[] = [
  {
    id: 'static-1',
    type: 'text',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { content: 'STATIC CHROME' },
  },
  {
    id: 'bound-1',
    type: 'text',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { content: '{{items[0]}}' },
  },
  {
    id: 'loading-flag',
    type: 'text',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { content: 'loading:{{__loading.items}} any:{{__anyLoading}} anyErr:{{__anyError}}' },
  },
]

const surface = {
  blocks,
  capabilities: [
    {
      capability: 'platform/persistence',
      config: {
        dataSources: [{ id: 'items', kind: 'static', staticData: ['REAL-VALUE'] }],
      },
    },
  ],
} as never

describe('DataBoundSurfaceRenderer — loadingStrategy', () => {
  it("default ('gate') withholds the tree behind data-surface-loading until the first fetch", async () => {
    const { container } = render(
      <DataBoundSurfaceRenderer surface={surface} components={components} />
    )
    // First frame: gate only, no blocks.
    expect(container.querySelector('[data-surface-loading]')).not.toBeNull()
    expect(screen.queryByText('STATIC CHROME')).toBeNull()
    // After the fetch settles the tree appears and the gate is gone.
    await waitFor(() => expect(screen.getByText('STATIC CHROME')).toBeTruthy())
    expect(container.querySelector('[data-surface-loading]')).toBeNull()
  })

  it("'immediate' renders the tree on the first frame and fills bindings in as sources land", async () => {
    const { container } = render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components}
        loadingStrategy="immediate"
      />
    )
    // First frame: no gate, static content already visible.
    expect(container.querySelector('[data-surface-loading]')).toBeNull()
    expect(screen.getByText('STATIC CHROME')).toBeTruthy()
    // Not-yet-fetched source reports loading via the expression context.
    expect(screen.getByText('loading:true any:true anyErr:false')).toBeTruthy()
    // When the fetch lands, the binding fills in and loading flags flip;
    // a healthy source reports no error.
    await waitFor(() => expect(screen.getByText('REAL-VALUE')).toBeTruthy())
    expect(screen.getByText('loading:false any:false anyErr:false')).toBeTruthy()
  })
})
