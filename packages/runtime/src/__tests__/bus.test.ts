/**
 * InMemoryEventBus Tests
 *
 * Event bus for fabric communication.
 *
 * @module @pwfabric/runtime/__tests__/bus
 */

import { describe, it, expect, vi } from 'vitest'
import { InMemoryEventBus, createEventBus } from '../bus.js'
import type { BaseEvent } from '@pwfabric/contracts'

// ============================================================
// HELPERS
// ============================================================

function makeEvent(type: string, overrides: Partial<BaseEvent> = {}): BaseEvent {
  return {
    id: 'evt-1',
    type,
    timestamp: Date.now(),
    source: { fabricId: 'fabric-1' as never },
    ...overrides,
  }
}

// ============================================================
// InMemoryEventBus
// ============================================================

describe('InMemoryEventBus', () => {
  describe('subscribe / emit', () => {
    it('calls subscriber when matching event emitted', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.subscribe(handler)

      const event = makeEvent('test.event')
      bus.emit(event)

      expect(handler).toHaveBeenCalledWith(event)
    })

    it('does not call subscriber after unsubscribe', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      const sub = bus.subscribe(handler)

      sub.unsubscribe()
      bus.emit(makeEvent('test.event'))

      expect(handler).not.toHaveBeenCalled()
    })

    it('filters events by type', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.subscribe(handler, { types: ['wanted.type'] })

      bus.emit(makeEvent('other.type'))
      expect(handler).not.toHaveBeenCalled()

      bus.emit(makeEvent('wanted.type'))
      expect(handler).toHaveBeenCalledOnce()
    })

    it('filters events by source fabricId', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.subscribe(handler, { sources: [{ fabricId: 'fabric-A' as never }] })

      bus.emit(makeEvent('test', { source: { fabricId: 'fabric-B' as never } }))
      expect(handler).not.toHaveBeenCalled()

      bus.emit(makeEvent('test', { source: { fabricId: 'fabric-A' as never } }))
      expect(handler).toHaveBeenCalledOnce()
    })

    it('filters events by source capabilityId', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.subscribe(handler, {
        sources: [{ capabilityId: 'cap-x' as never }],
      })

      bus.emit(makeEvent('test', { source: { capabilityId: 'cap-y' as never } }))
      expect(handler).not.toHaveBeenCalled()

      bus.emit(makeEvent('test', { source: { capabilityId: 'cap-x' as never } }))
      expect(handler).toHaveBeenCalledOnce()
    })

    it('filters events by source domainId', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.subscribe(handler, {
        sources: [{ domainId: 'domain-1' as never }],
      })

      bus.emit(makeEvent('test', { source: { domainId: 'domain-2' as never } }))
      expect(handler).not.toHaveBeenCalled()

      bus.emit(makeEvent('test', { source: { domainId: 'domain-1' as never } }))
      expect(handler).toHaveBeenCalledOnce()
    })

    it('swallows synchronous handler errors', () => {
      const bus = new InMemoryEventBus()
      bus.subscribe(() => {
        throw new Error('handler error')
      })
      expect(() => bus.emit(makeEvent('test'))).not.toThrow()
    })

    it('swallows async handler errors', async () => {
      const bus = new InMemoryEventBus()
      bus.subscribe(async () => {
        throw new Error('async error')
      })
      expect(() => bus.emit(makeEvent('test'))).not.toThrow()
      // Let promise settle
      await Promise.resolve()
    })
  })

  describe('on / off (typed)', () => {
    it('calls type-specific handler only for matching type', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.on('fabric.created', handler)

      bus.emit(makeEvent('fabric.started'))
      expect(handler).not.toHaveBeenCalled()

      bus.emit(makeEvent('fabric.created'))
      expect(handler).toHaveBeenCalledOnce()
    })

    it('unsubscribes type-specific handler', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      const sub = bus.on('fabric.created', handler)

      sub.unsubscribe()
      bus.emit(makeEvent('fabric.created'))
      expect(handler).not.toHaveBeenCalled()
    })

    it('cleans up type map when last handler unsubscribes', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      const sub = bus.on('fabric.started', handler)
      sub.unsubscribe()
      // No throw and count is 0
      expect(bus.subscriptionCount()).toBe(0)
    })
  })

  describe('once', () => {
    it('fires handler only once', () => {
      const bus = new InMemoryEventBus()
      const handler = vi.fn()
      bus.once('fabric.stopped', handler)

      bus.emit(makeEvent('fabric.stopped'))
      bus.emit(makeEvent('fabric.stopped'))

      expect(handler).toHaveBeenCalledOnce()
    })
  })

  describe('clear()', () => {
    it('removes all subscriptions', () => {
      const bus = new InMemoryEventBus()
      bus.subscribe(vi.fn())
      bus.on('fabric.created', vi.fn())
      bus.clear()
      expect(bus.subscriptionCount()).toBe(0)
    })
  })

  describe('subscriptionCount()', () => {
    it('returns 0 on new bus', () => {
      const bus = new InMemoryEventBus()
      expect(bus.subscriptionCount()).toBe(0)
    })

    it('counts all subscription types', () => {
      const bus = new InMemoryEventBus()
      bus.subscribe(vi.fn())
      bus.subscribe(vi.fn())
      bus.on('fabric.created', vi.fn())
      expect(bus.subscriptionCount()).toBe(3)
    })
  })
})

describe('createEventBus()', () => {
  it('returns an InMemoryEventBus instance', () => {
    const bus = createEventBus()
    expect(bus).toBeInstanceOf(InMemoryEventBus)
  })
})
