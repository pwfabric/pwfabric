/**
 * Analytics Capability Tracker Tests
 *
 * Tests for event tracking, page views, adapters, and buffering
 *
 * @module @pwfabric/runtime/analytics/__tests__/tracker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DefaultAnalyticsCapability,
  InMemoryAnalyticsAdapter,
  createAnalyticsCapability,
  createInMemoryAdapter,
} from '../tracker.js'
import type { AnalyticsAdapter } from '../types.js'

describe('DefaultAnalyticsCapability', () => {
  let analytics: DefaultAnalyticsCapability
  let adapter: InMemoryAnalyticsAdapter

  beforeEach(() => {
    analytics = new DefaultAnalyticsCapability()
    adapter = new InMemoryAnalyticsAdapter()
    analytics.addAdapter(adapter)
  })

  // ============================================================
  // ADAPTER MANAGEMENT
  // ============================================================

  describe('addAdapter', () => {
    it('should register an adapter', () => {
      expect(analytics.getAdapterNames()).toContain('in-memory')
    })

    it('should throw when registering duplicate adapter', () => {
      expect(() => analytics.addAdapter(adapter)).toThrow(
        "Analytics adapter 'in-memory' is already registered"
      )
    })

    it('should support multiple adapters', () => {
      const second = new InMemoryAnalyticsAdapter('second')
      analytics.addAdapter(second)

      expect(analytics.getAdapterNames()).toHaveLength(2)
    })
  })

  describe('removeAdapter', () => {
    it('should remove an existing adapter', () => {
      expect(analytics.removeAdapter('in-memory')).toBe(true)
      expect(analytics.getAdapterNames()).toHaveLength(0)
    })

    it('should return false for unknown adapter', () => {
      expect(analytics.removeAdapter('nonexistent')).toBe(false)
    })
  })

  // ============================================================
  // EVENT TRACKING
  // ============================================================

  describe('trackEvent', () => {
    it('should track an event through all adapters', () => {
      analytics.trackEvent({
        name: 'button_click',
        category: 'UI',
        label: 'submit',
        value: 1,
      })

      expect(adapter.events).toHaveLength(1)
      expect(adapter.events[0]?.name).toBe('button_click')
      expect(adapter.events[0]?.category).toBe('UI')
    })

    it('should enrich events with timestamp', () => {
      analytics.trackEvent({ name: 'test' })

      expect(adapter.events[0]?.timestamp).toBeGreaterThan(0)
    })

    it('should dispatch to multiple adapters', () => {
      const second = new InMemoryAnalyticsAdapter('second')
      analytics.addAdapter(second)

      analytics.trackEvent({ name: 'test' })

      expect(adapter.events).toHaveLength(1)
      expect(second.events).toHaveLength(1)
    })

    it('should not track when disabled', () => {
      analytics.setEnabled(false)

      analytics.trackEvent({ name: 'test' })

      expect(adapter.events).toHaveLength(0)
    })

    it('should swallow adapter errors gracefully', () => {
      const failingAdapter: AnalyticsAdapter = {
        name: 'failing',
        trackEvent: () => {
          throw new Error('Adapter failure')
        },
        trackPageView: vi.fn(),
        trackInteraction: vi.fn(),
      }
      analytics.addAdapter(failingAdapter)

      // Should not throw
      expect(() => analytics.trackEvent({ name: 'test' })).not.toThrow()
      // The working adapter should still receive the event
      expect(adapter.events).toHaveLength(1)
    })
  })

  // ============================================================
  // PAGE VIEW TRACKING
  // ============================================================

  describe('trackPageView', () => {
    it('should track a page view', () => {
      analytics.trackPageView({
        path: '/about',
        title: 'About Us',
        referrer: 'https://google.com',
      })

      expect(adapter.pageViews).toHaveLength(1)
      expect(adapter.pageViews[0]?.path).toBe('/about')
      expect(adapter.pageViews[0]?.title).toBe('About Us')
    })

    it('should enrich page views with timestamp', () => {
      analytics.trackPageView({ path: '/home' })

      expect(adapter.pageViews[0]?.timestamp).toBeGreaterThan(0)
    })

    it('should not track page views when disabled', () => {
      analytics.setEnabled(false)

      analytics.trackPageView({ path: '/home' })

      expect(adapter.pageViews).toHaveLength(0)
    })
  })

  // ============================================================
  // INTERACTION TRACKING
  // ============================================================

  describe('trackInteraction', () => {
    it('should track a user interaction', () => {
      analytics.trackInteraction({
        type: 'click',
        target: 'nav.menu-item',
        data: { item: 'home' },
      })

      expect(adapter.interactions).toHaveLength(1)
      expect(adapter.interactions[0]?.type).toBe('click')
      expect(adapter.interactions[0]?.target).toBe('nav.menu-item')
    })

    it('should track scroll interactions', () => {
      analytics.trackInteraction({
        type: 'scroll',
        target: 'page',
        data: { depth: 50 },
      })

      expect(adapter.interactions[0]?.type).toBe('scroll')
    })

    it('should not track interactions when disabled', () => {
      analytics.setEnabled(false)

      analytics.trackInteraction({ type: 'click', target: 'button' })

      expect(adapter.interactions).toHaveLength(0)
    })
  })

  // ============================================================
  // IDENTITY
  // ============================================================

  describe('identify', () => {
    it('should set user identity on all adapters', () => {
      analytics.identify('user-123', { plan: 'pro' })

      expect(adapter.getUserId()).toBe('user-123')
      expect(adapter.getUserTraits()).toEqual({ plan: 'pro' })
    })
  })

  describe('reset', () => {
    it('should reset identity on all adapters', () => {
      analytics.identify('user-123')
      analytics.reset()

      expect(adapter.getUserId()).toBeUndefined()
    })
  })

  // ============================================================
  // GLOBAL PROPERTIES
  // ============================================================

  describe('global properties', () => {
    it('should attach global properties to events', () => {
      const analyticsWithGlobals = new DefaultAnalyticsCapability({
        globalProperties: { app: 'pwfabric', version: '1.0.0' },
      })
      analyticsWithGlobals.addAdapter(adapter)

      analyticsWithGlobals.trackEvent({ name: 'test' })

      expect(adapter.events[0]?.properties).toEqual(
        expect.objectContaining({ app: 'pwfabric', version: '1.0.0' })
      )
    })

    it('should merge event properties with global properties', () => {
      const analyticsWithGlobals = new DefaultAnalyticsCapability({
        globalProperties: { app: 'pwfabric' },
      })
      analyticsWithGlobals.addAdapter(adapter)

      analyticsWithGlobals.trackEvent({
        name: 'test',
        properties: { custom: 'value' },
      })

      expect(adapter.events[0]?.properties).toEqual(
        expect.objectContaining({ app: 'pwfabric', custom: 'value' })
      )
    })
  })

  // ============================================================
  // EVENT FILTERING
  // ============================================================

  describe('event filtering', () => {
    it('should filter events with deny list', () => {
      const filtered = new DefaultAnalyticsCapability({
        denyList: ['debug_event', 'internal_event'],
      })
      filtered.addAdapter(adapter)

      filtered.trackEvent({ name: 'debug_event' })
      filtered.trackEvent({ name: 'user_action' })

      expect(adapter.events).toHaveLength(1)
      expect(adapter.events[0]?.name).toBe('user_action')
    })

    it('should filter events with allow list', () => {
      const filtered = new DefaultAnalyticsCapability({
        allowList: ['purchase', 'signup'],
      })
      filtered.addAdapter(adapter)

      filtered.trackEvent({ name: 'purchase' })
      filtered.trackEvent({ name: 'page_view' })
      filtered.trackEvent({ name: 'signup' })

      expect(adapter.events).toHaveLength(2)
    })
  })

  // ============================================================
  // EVENT BUFFERING
  // ============================================================

  describe('event buffering', () => {
    it('should buffer events when configured', () => {
      const buffered = new DefaultAnalyticsCapability({
        bufferEvents: true,
        maxBufferSize: 100,
      })
      buffered.addAdapter(adapter)

      buffered.trackEvent({ name: 'event1' })
      buffered.trackEvent({ name: 'event2' })

      // Events should be in buffer, not sent to adapter yet
      expect(buffered.getBuffer()).toHaveLength(2)
      expect(adapter.events).toHaveLength(0)
    })

    it('should flush buffer to adapters', async () => {
      const buffered = new DefaultAnalyticsCapability({
        bufferEvents: true,
      })
      buffered.addAdapter(adapter)

      buffered.trackEvent({ name: 'event1' })
      buffered.trackEvent({ name: 'event2' })

      await buffered.flush()

      expect(buffered.getBuffer()).toHaveLength(0)
      expect(adapter.events).toHaveLength(2)
    })

    it('should auto-flush when buffer reaches max size', () => {
      const buffered = new DefaultAnalyticsCapability({
        bufferEvents: true,
        maxBufferSize: 3,
      })
      buffered.addAdapter(adapter)

      buffered.trackEvent({ name: 'event1' })
      buffered.trackEvent({ name: 'event2' })
      buffered.trackEvent({ name: 'event3' })

      // After reaching max, buffer should have been flushed
      expect(adapter.events).toHaveLength(3)
    })
  })

  // ============================================================
  // ENABLE / DISABLE
  // ============================================================

  describe('enable/disable', () => {
    it('should report enabled state', () => {
      expect(analytics.isEnabled()).toBe(true)

      analytics.setEnabled(false)
      expect(analytics.isEnabled()).toBe(false)

      analytics.setEnabled(true)
      expect(analytics.isEnabled()).toBe(true)
    })

    it('should start disabled when configured', () => {
      const disabled = new DefaultAnalyticsCapability({ enabled: false })
      expect(disabled.isEnabled()).toBe(false)
    })
  })

  // ============================================================
  // CLEAR
  // ============================================================

  describe('clear', () => {
    it('should clear all adapters and buffer', () => {
      analytics.trackEvent({ name: 'test' })

      analytics.clear()

      expect(analytics.getAdapterNames()).toHaveLength(0)
      expect(analytics.getBuffer()).toHaveLength(0)
    })
  })

  describe('error swallowing', () => {
    it('swallows errors thrown by adapter.trackPageView', () => {
      const failingAdapter: AnalyticsAdapter = {
        name: 'fail-pageview',
        trackEvent: vi.fn(),
        trackPageView: () => {
          throw new Error('pageview error')
        },
        trackInteraction: vi.fn(),
      }
      analytics.addAdapter(failingAdapter)
      expect(() => analytics.trackPageView({ path: '/error' })).not.toThrow()
    })

    it('swallows errors thrown by adapter.trackInteraction', () => {
      const failingAdapter: AnalyticsAdapter = {
        name: 'fail-interaction',
        trackEvent: vi.fn(),
        trackPageView: vi.fn(),
        trackInteraction: () => {
          throw new Error('interaction error')
        },
      }
      analytics.addAdapter(failingAdapter)
      expect(() => analytics.trackInteraction({ type: 'click', target: 'btn' })).not.toThrow()
    })

    it('swallows errors thrown by adapter.identify', () => {
      const failingAdapter: AnalyticsAdapter = {
        name: 'fail-identify',
        trackEvent: vi.fn(),
        trackPageView: vi.fn(),
        trackInteraction: vi.fn(),
        identify: () => {
          throw new Error('identify error')
        },
      }
      analytics.addAdapter(failingAdapter)
      expect(() => analytics.identify('user-x')).not.toThrow()
    })

    it('swallows errors thrown by adapter.reset', () => {
      const failingAdapter: AnalyticsAdapter = {
        name: 'fail-reset',
        trackEvent: vi.fn(),
        trackPageView: vi.fn(),
        trackInteraction: vi.fn(),
        reset: () => {
          throw new Error('reset error')
        },
      }
      analytics.addAdapter(failingAdapter)
      expect(() => analytics.reset()).not.toThrow()
    })

    it('swallows errors thrown by adapter.trackEvent during flush', async () => {
      const failingAdapter: AnalyticsAdapter = {
        name: 'fail-flush',
        trackEvent: () => {
          throw new Error('flush trackEvent error')
        },
        trackPageView: vi.fn(),
        trackInteraction: vi.fn(),
      }
      // Use a buffered analytics instance and add failing adapter
      const buffered = new DefaultAnalyticsCapability({ bufferEvents: true })
      buffered.addAdapter(failingAdapter)
      buffered.trackEvent({ name: 'buffered-event' })
      await expect(buffered.flush()).resolves.not.toThrow()
    })
  })
})

// ============================================================
// IN-MEMORY ADAPTER TESTS
// ============================================================

describe('InMemoryAnalyticsAdapter', () => {
  it('should store events, page views, and interactions', () => {
    const adapter = new InMemoryAnalyticsAdapter()

    adapter.trackEvent({ name: 'test' })
    adapter.trackPageView({ path: '/home' })
    adapter.trackInteraction({ type: 'click', target: 'button' })

    expect(adapter.events).toHaveLength(1)
    expect(adapter.pageViews).toHaveLength(1)
    expect(adapter.interactions).toHaveLength(1)
  })

  it('should clear all stored data', () => {
    const adapter = new InMemoryAnalyticsAdapter()

    adapter.trackEvent({ name: 'test' })
    adapter.identify('user-1')

    adapter.clear()

    expect(adapter.events).toHaveLength(0)
    expect(adapter.getUserId()).toBeUndefined()
  })
})

// ============================================================
// FACTORY TESTS
// ============================================================

describe('createAnalyticsCapability', () => {
  it('should create a DefaultAnalyticsCapability instance', () => {
    const analytics = createAnalyticsCapability()
    expect(analytics).toBeInstanceOf(DefaultAnalyticsCapability)
  })
})

describe('createInMemoryAdapter', () => {
  it('should create an InMemoryAnalyticsAdapter', () => {
    const adapter = createInMemoryAdapter('test')
    expect(adapter).toBeInstanceOf(InMemoryAnalyticsAdapter)
    expect(adapter.name).toBe('test')
  })
})
