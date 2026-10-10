// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — interactionMode (ADR render-unification).
 *
 * Proves `interactionMode: 'inert'` (editor/preview embedding) does NOT start
 * data-source auto-refresh timers, while the default `live` mode does. Asserted
 * directly by spying on `setInterval` and matching the source's refreshInterval.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-interaction-mode.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const REFRESH_MS = 5000

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="text-block">{String(props.content ?? '')}</p>
  )) as never,
}

const block: Block = {
  id: 'text-1',
  type: 'text',
  layout: DEFAULT_BLOCK_LAYOUT,
  props: { content: 'Hi' },
}

// Surface with a platform/persistence data source that requests auto-refresh.
const surface = {
  blocks: [block],
  capabilities: [
    {
      capability: 'platform/persistence',
      config: {
        dataSources: [
          { id: 'items', kind: 'static', staticData: [1, 2, 3], refreshInterval: REFRESH_MS },
        ],
      },
    },
  ],
} as never

function intervalStartedForSource(spy: ReturnType<typeof vi.spyOn>): boolean {
  return spy.mock.calls.some((c) => c[1] === REFRESH_MS)
}

describe('DataBoundSurfaceRenderer — interactionMode', () => {
  it('live (default) starts the auto-refresh timer for a source with refreshInterval', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    render(<DataBoundSurfaceRenderer surface={surface} components={components} />)
    expect(intervalStartedForSource(spy)).toBe(true)
  })

  it('inert does NOT start the auto-refresh timer', () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    render(
      <DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="inert" />
    )
    expect(intervalStartedForSource(spy)).toBe(false)
  })
})
