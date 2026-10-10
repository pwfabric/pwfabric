/**
 * Surface Event Bus Unit Tests
 *
 * Pure factory function tests — no React, no mocks needed.
 * Covers: exact-match dispatch, wildcard dispatch, isolation, unsubscribe,
 * off(), multi-listener, and event descriptor shape.
 *
 * @module @pwfabric/runtime/render/__tests__/surface-event-bus
 */

import { describe, it, expect, vi } from 'vitest'
import { createSurfaceEventBus } from '../surface-event-bus.js'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import type { SurfaceEventDescriptor } from '@pwfabric/contracts'

// ============================================================
// HELPERS
// ============================================================

function makeEvent(overrides: Partial<SurfaceEventDescriptor> = {}): SurfaceEventDescriptor {
  return {
    type: SURFACE_EVENTS.BLOCK_CLICK,
    surfaceId: 'surface-1',
    timestamp: Date.now(),
    ...overrides,
  }
}

// ============================================================
// TESTS
// ============================================================

describe('createSurfaceEventBus', () => {
  describe('emit — exact-match dispatch', () => {
    it('calls a listener registered for the exact event type', () => {
      const bus = createSurfaceEventBus()
      const handler = vi.fn()

      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handler)
      const event = makeEvent()
      bus.emit(event)

      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(event)
    })

    it('does NOT call a listener registered for a different event type', () => {
      const bus = createSurfaceEventBus()
      const handler = vi.fn()

      bus.on(SURFACE_EVENTS.FORM_SUBMIT, handler)
      bus.emit(makeEvent({ type: SURFACE_EVENTS.BLOCK_CLICK }))

      expect(handler).not.toHaveBeenCalled()
    })

    it('does nothing when no listeners are registered (no throw)', () => {
      const bus = createSurfaceEventBus()
      expect(() => bus.emit(makeEvent())).not.toThrow()
    })
  })

  describe('emit — wildcard dispatch', () => {
    it('calls block:* wildcard listeners when block:click fires', () => {
      const bus = createSurfaceEventBus()
      const wildcard = vi.fn()

      bus.on('block:*', wildcard)
      const event = makeEvent({ type: SURFACE_EVENTS.BLOCK_CLICK })
      bus.emit(event)

      expect(wildcard).toHaveBeenCalledOnce()
      expect(wildcard).toHaveBeenCalledWith(event)
    })

    it('calls block:* wildcard listeners when block:hover fires', () => {
      const bus = createSurfaceEventBus()
      const wildcard = vi.fn()

      bus.on('block:*', wildcard)
      bus.emit(makeEvent({ type: SURFACE_EVENTS.BLOCK_HOVER }))

      expect(wildcard).toHaveBeenCalledOnce()
    })

    it('does NOT call form:* wildcard listeners when block:click fires', () => {
      const bus = createSurfaceEventBus()
      const formWildcard = vi.fn()

      bus.on('form:*', formWildcard)
      bus.emit(makeEvent({ type: SURFACE_EVENTS.BLOCK_CLICK }))

      expect(formWildcard).not.toHaveBeenCalled()
    })

    it('fires both exact-match and wildcard listeners for the same event', () => {
      const bus = createSurfaceEventBus()
      const exactHandler = vi.fn()
      const wildcardHandler = vi.fn()

      bus.on(SURFACE_EVENTS.BLOCK_CLICK, exactHandler)
      bus.on('block:*', wildcardHandler)
      bus.emit(makeEvent({ type: SURFACE_EVENTS.BLOCK_CLICK }))

      expect(exactHandler).toHaveBeenCalledOnce()
      expect(wildcardHandler).toHaveBeenCalledOnce()
    })
  })

  describe('on — unsubscribe', () => {
    it('returns an unsubscribe function that removes the listener', () => {
      const bus = createSurfaceEventBus()
      const handler = vi.fn()

      const unsubscribe = bus.on(SURFACE_EVENTS.BLOCK_CLICK, handler)
      unsubscribe()
      bus.emit(makeEvent())

      expect(handler).not.toHaveBeenCalled()
    })

    it('only removes the specific listener — other listeners remain active', () => {
      const bus = createSurfaceEventBus()
      const handlerA = vi.fn()
      const handlerB = vi.fn()

      const unsubA = bus.on(SURFACE_EVENTS.BLOCK_CLICK, handlerA)
      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handlerB)

      unsubA()
      bus.emit(makeEvent())

      expect(handlerA).not.toHaveBeenCalled()
      expect(handlerB).toHaveBeenCalledOnce()
    })
  })

  describe('off — imperative removal', () => {
    it('removes the listener so it no longer receives events', () => {
      const bus = createSurfaceEventBus()
      const handler = vi.fn()

      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handler)
      bus.off(SURFACE_EVENTS.BLOCK_CLICK, handler)
      bus.emit(makeEvent())

      expect(handler).not.toHaveBeenCalled()
    })

    it('does nothing when called for an event type with no listeners (no throw)', () => {
      const bus = createSurfaceEventBus()
      const handler = vi.fn()
      expect(() => bus.off(SURFACE_EVENTS.BLOCK_CLICK, handler)).not.toThrow()
    })
  })

  describe('multiple listeners', () => {
    it('calls all listeners registered for the same event', () => {
      const bus = createSurfaceEventBus()
      const handlerA = vi.fn()
      const handlerB = vi.fn()
      const handlerC = vi.fn()

      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handlerA)
      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handlerB)
      bus.on(SURFACE_EVENTS.BLOCK_CLICK, handlerC)

      bus.emit(makeEvent())

      expect(handlerA).toHaveBeenCalledOnce()
      expect(handlerB).toHaveBeenCalledOnce()
      expect(handlerC).toHaveBeenCalledOnce()
    })
  })

  describe('event descriptor shape', () => {
    it('listener receives the exact event descriptor that was emitted', () => {
      const bus = createSurfaceEventBus()
      let received: SurfaceEventDescriptor | undefined

      bus.on(SURFACE_EVENTS.BLOCK_CLICK, (e) => {
        received = e
      })

      const event = makeEvent({
        type: SURFACE_EVENTS.BLOCK_CLICK,
        surfaceId: 'surf-abc',
        blockId: 'block-xyz',
        timestamp: 1_700_000_000_000,
        payload: { x: 10, y: 20 },
      })
      bus.emit(event)

      expect(received).toBeDefined()
      expect(received?.type).toBe(SURFACE_EVENTS.BLOCK_CLICK)
      expect(received?.surfaceId).toBe('surf-abc')
      expect(received?.blockId).toBe('block-xyz')
      expect(received?.timestamp).toBe(1_700_000_000_000)
      expect(received?.payload).toEqual({ x: 10, y: 20 })
    })
  })

  describe('bus isolation', () => {
    it('two separate buses do not share listeners', () => {
      const busA = createSurfaceEventBus()
      const busB = createSurfaceEventBus()
      const handlerA = vi.fn()

      busA.on(SURFACE_EVENTS.BLOCK_CLICK, handlerA)
      busB.emit(makeEvent())

      expect(handlerA).not.toHaveBeenCalled()
    })
  })
})
