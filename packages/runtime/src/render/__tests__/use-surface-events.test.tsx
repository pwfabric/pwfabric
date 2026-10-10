/**
 * useSurfaceEvents and useSurfaceId Hook Tests
 *
 * /C: Exercises hook behaviour both with and without a
 * BehaviorSurfaceProvider in the tree.
 *
 * Uses renderToString for context-wiring tests (SSR-safe, no jsdom).
 * Uses inline bus logic for emit verification (no component needed).
 *
 * @module @pwfabric/runtime/render/__tests__/use-surface-events
 */

import { describe, it, expect, vi } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { BehaviorSurfaceProvider } from '../BehaviorSurfaceProvider.js'
import { SurfaceEventContext } from '../surface-event-context.js'
import { useSurfaceEvents } from '../hooks/useSurfaceEvents.js'
import { useSurfaceId } from '../hooks/useSurfaceId.js'
import { createSurfaceEventBus } from '../surface-event-bus.js'

// ============================================================
// CONSUMER COMPONENTS
// ============================================================

/**
 * Calls emit inside renderToString to verify it does not throw.
 * Renders nothing meaningful — just used to exercise the hook.
 */
function SafeEmitter({ onEmit }: { onEmit?: () => void }): React.ReactNode {
  const { emit } = useSurfaceEvents()
  // Calling emit in render (synchronous) is intentional for SSR test purposes.
  // In production code this would be in an event handler.
  emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId: 'test-surface' })
  onEmit?.()
  return <div data-rendered="true" />
}

/**
 * Reads surfaceId and exposes it as a data attribute.
 */
function SurfaceIdDisplay(): React.ReactNode {
  const id = useSurfaceId()
  return <div data-surface-id={id} />
}

/**
 * Exposes whether emit is a function via data attribute.
 */
function EmitTypeDisplay(): React.ReactNode {
  const { emit } = useSurfaceEvents()
  return <div data-emit-type={typeof emit} />
}

// ============================================================
// TESTS
// ============================================================

describe('useSurfaceEvents', () => {
  describe('without SurfaceEventContext provider', () => {
    it('emit is a function (no-op) — does not throw when called', () => {
      expect(() => renderToString(<SafeEmitter />)).not.toThrow()
    })

    it('emit returns a function type even outside provider', () => {
      const html = renderToString(<EmitTypeDisplay />)
      expect(html).toContain('data-emit-type="function"')
    })
  })

  describe('with SurfaceEventContext provider (direct context wiring)', () => {
    it('emit calls the bus when a real bus is provided via context', () => {
      const bus = createSurfaceEventBus()
      const handler = vi.fn()
      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handler)

      // Use context directly to wire a spy bus
      function EmitterWithBus(): React.ReactNode {
        const { emit } = useSurfaceEvents()
        emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId: 'ctx-surface' })
        return <div />
      }

      renderToString(
        <SurfaceEventContext.Provider value={bus}>
          <EmitterWithBus />
        </SurfaceEventContext.Provider>
      )

      expect(handler).toHaveBeenCalledOnce()
    })

    it('emit adds a numeric timestamp when forwarding to the bus', () => {
      const bus = createSurfaceEventBus()
      let receivedTimestamp: number | undefined

      bus.on(SURFACE_EVENTS.BLOCK_CLICK, (e) => {
        receivedTimestamp = e.timestamp
      })

      function EmitterWithBus(): React.ReactNode {
        const { emit } = useSurfaceEvents()
        emit({ type: SURFACE_EVENTS.BLOCK_CLICK, surfaceId: 'ts-surface' })
        return <div />
      }

      const before = Date.now()
      renderToString(
        <SurfaceEventContext.Provider value={bus}>
          <EmitterWithBus />
        </SurfaceEventContext.Provider>
      )
      const after = Date.now()

      expect(typeof receivedTimestamp).toBe('number')
      expect(receivedTimestamp).toBeGreaterThanOrEqual(before)
      expect(receivedTimestamp).toBeLessThanOrEqual(after)
    })
  })

  describe('with BehaviorSurfaceProvider', () => {
    it('emit is a function inside BehaviorSurfaceProvider', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="bp-surface">
          <EmitTypeDisplay />
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-emit-type="function"')
    })

    it('emit does not throw when called inside BehaviorSurfaceProvider', () => {
      expect(() =>
        renderToString(
          <BehaviorSurfaceProvider surfaceId="bp-surface">
            <SafeEmitter />
          </BehaviorSurfaceProvider>
        )
      ).not.toThrow()
    })
  })
})

describe('useSurfaceId', () => {
  describe('without BehaviorSurfaceProvider', () => {
    it('returns empty string when no SurfaceIdContext provider is in the tree', () => {
      const html = renderToString(<SurfaceIdDisplay />)
      expect(html).toContain('data-surface-id=""')
    })
  })

  describe('with BehaviorSurfaceProvider', () => {
    it('returns the surfaceId provided by BehaviorSurfaceProvider', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="my-surface-42">
          <SurfaceIdDisplay />
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-surface-id="my-surface-42"')
    })

    it('returns the correct id in nested providers (nearest wins)', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="outer">
          <BehaviorSurfaceProvider surfaceId="inner">
            <SurfaceIdDisplay />
          </BehaviorSurfaceProvider>
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-surface-id="inner"')
    })
  })
})
