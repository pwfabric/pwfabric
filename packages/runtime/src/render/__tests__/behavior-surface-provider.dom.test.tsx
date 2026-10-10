// @vitest-environment jsdom
/**
 * BehaviorSurfaceProvider + BlockErrorBoundary — REAL DOM render tests.
 *
 * The sibling `behavior-surface-provider.test.tsx` and
 * `block-error-boundary.test.tsx` files use `react-dom/server`
 * `renderToString`, which never mounts the tree — so `useEffect`
 * lifecycle (the `surface:load` / `surface:unload` emissions) and the
 * unmount path are invisible to them.
 *
 * This file mounts the providers into a real jsdom DOM with
 * `@testing-library/react`, exercising:
 *  - effect-driven `surface:load` emission on mount
 *  - `surface:unload` emission on unmount
 *  - context propagation of the surfaceId + event bus to descendants
 *  - the error boundary catching a runtime crash in a mounted tree
 *
 * @module @pwfabric/runtime/render/__tests__/behavior-surface-provider.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import type { SurfaceEventDescriptor } from '@pwfabric/contracts'
import { BehaviorSurfaceProvider } from '../BehaviorSurfaceProvider.js'
import { BlockErrorBoundary } from '../BlockErrorBoundary.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import { SurfaceEventContext } from '../surface-event-context.js'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ============================================================
// A consumer block that reads context + emits events
// ============================================================

function ConsumerBlock(): React.ReactElement {
  const surfaceId = useSurfaceId()
  const { emit } = useSurfaceEvents()
  return (
    <button
      type="button"
      data-testid="consumer"
      data-surface-id={surfaceId}
      onClick={() =>
        emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId, blockId: 'consumer' })
      }
    >
      surface: {surfaceId}
    </button>
  )
}

// ============================================================
// LIFECYCLE — only observable in a mounted tree
// ============================================================

describe('BehaviorSurfaceProvider — mount lifecycle', () => {
  it('propagates the surfaceId to descendants via context', () => {
    render(
      <BehaviorSurfaceProvider surfaceId="srf-abc">
        <ConsumerBlock />
      </BehaviorSurfaceProvider>
    )

    const consumer = screen.getByTestId('consumer')
    expect(consumer.getAttribute('data-surface-id')).toBe('srf-abc')
    expect(consumer.textContent).toContain('srf-abc')
  })

  it('emits a surface:load event on mount and surface:unload on unmount', () => {
    const events: SurfaceEventDescriptor[] = []

    const { unmount } = render(
      <BehaviorSurfaceProvider surfaceId="srf-lifecycle">
        <EventTap eventTypes={['surface:load', 'surface:unload']} sink={events} />
      </BehaviorSurfaceProvider>
    )

    // surface:load is emitted inside the provider's mount effect.
    expect(events.some((e) => e.type === SURFACE_EVENTS.SURFACE_LOAD)).toBe(true)
    const loadEvent = events.find((e) => e.type === SURFACE_EVENTS.SURFACE_LOAD)
    expect(loadEvent?.surfaceId).toBe('srf-lifecycle')

    unmount()

    // surface:unload is emitted by the provider's effect cleanup.
    expect(events.some((e) => e.type === SURFACE_EVENTS.SURFACE_UNLOAD)).toBe(true)
  })

  it('routes a descendant click through the context-provided event bus', () => {
    const events: SurfaceEventDescriptor[] = []

    render(
      <BehaviorSurfaceProvider surfaceId="srf-click">
        <EventTap eventTypes={['block:click']} sink={events} />
        <ConsumerBlock />
      </BehaviorSurfaceProvider>
    )

    screen.getByTestId('consumer').click()

    const clickEvent = events.find((e) => e.type === SURFACE_EVENTS.BLOCK_CLICK)
    expect(clickEvent).toBeDefined()
    expect(clickEvent?.surfaceId).toBe('srf-click')
  })
})

/**
 * Test-only descendant that subscribes to the surface event bus (read
 * from context) and records matching events into the supplied sink.
 * Demonstrates that the bus instance is shared across the mounted
 * subtree via context.
 */
function EventTap({
  eventTypes,
  sink,
}: {
  eventTypes: readonly string[]
  sink: SurfaceEventDescriptor[]
}): null {
  const bus = React.useContext(SurfaceEventContext)
  React.useEffect(() => {
    if (!bus) return
    const unsubs = eventTypes.map((type) => bus.on(type, (event) => sink.push(event)))
    return () => unsubs.forEach((u) => u())
  }, [bus, eventTypes, sink])
  return null
}

// ============================================================
// BlockErrorBoundary — live error catching
// ============================================================

describe('BlockErrorBoundary — real DOM mount', () => {
  it('renders children unchanged when nothing throws', () => {
    render(
      <BlockErrorBoundary blockId="b1" blockType="text">
        <span data-testid="ok">healthy block</span>
      </BlockErrorBoundary>
    )

    expect(screen.getByTestId('ok').textContent).toBe('healthy block')
  })

  it('catches a thrown error and renders the fallback in the live tree', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    function Boom(): React.ReactElement {
      throw new Error('runtime crash in block')
    }

    const { container } = render(
      <BlockErrorBoundary blockId="crash-block" blockType="chart">
        <Boom />
      </BlockErrorBoundary>
    )

    const fallback = container.querySelector('[data-block-error="crash-block"]')
    expect(fallback).not.toBeNull()
    // Quiet-shape contract: no visible copy; type + message via attributes.
    expect(fallback?.getAttribute('data-block-error-type')).toBe('chart')
    expect(fallback?.getAttribute('title')).toContain('runtime crash in block')
    expect(fallback?.textContent).toBe('')

    errSpy.mockRestore()
  })
})
