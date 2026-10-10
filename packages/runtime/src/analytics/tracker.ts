/**
 * Analytics Capability Implementation
 *
 * Provider-agnostic event tracking via adapter pattern
 *
 * @module @pwfabric/runtime/analytics/tracker
 */

import type {
  AnalyticsCapability,
  AnalyticsAdapter,
  AnalyticsEvent,
  PageViewEvent,
  InteractionEvent,
  AnalyticsConfig,
} from './types.js'

// ============================================================
// DEFAULT ANALYTICS CAPABILITY
// ============================================================

/**
 * Default analytics capability implementation
 *
 * Dispatches events to all registered adapters. Supports
 * event buffering, global properties, and allow/deny lists.
 */
export class DefaultAnalyticsCapability implements AnalyticsCapability {
  private readonly adapters = new Map<string, AnalyticsAdapter>()
  private readonly buffer: AnalyticsEvent[] = []
  private readonly config: Required<AnalyticsConfig>
  private enabled: boolean

  constructor(config: AnalyticsConfig = {}) {
    this.enabled = config.enabled ?? true
    this.config = {
      enabled: this.enabled,
      bufferEvents: config.bufferEvents ?? false,
      maxBufferSize: config.maxBufferSize ?? 100,
      globalProperties: config.globalProperties ?? {},
      allowList: config.allowList ?? [],
      denyList: config.denyList ?? [],
    }
  }

  addAdapter(adapter: AnalyticsAdapter): void {
    if (this.adapters.has(adapter.name)) {
      throw new Error(`Analytics adapter '${adapter.name}' is already registered`)
    }
    this.adapters.set(adapter.name, adapter)
  }

  removeAdapter(name: string): boolean {
    return this.adapters.delete(name)
  }

  trackEvent(event: AnalyticsEvent): void {
    if (!this.enabled) return
    if (!this.isEventAllowed(event.name)) return

    const enriched = this.enrichEvent(event)

    if (this.config.bufferEvents) {
      this.buffer.push(enriched)
      if (this.buffer.length >= this.config.maxBufferSize) {
        void this.flush()
      }
      return
    }

    for (const adapter of this.adapters.values()) {
      try {
        adapter.trackEvent(enriched)
      } catch {
        // Swallow adapter errors to prevent one adapter from breaking others
      }
    }
  }

  trackPageView(event: PageViewEvent): void {
    if (!this.enabled) return

    const enriched: PageViewEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
      properties: {
        ...this.config.globalProperties,
        ...event.properties,
      },
    }

    for (const adapter of this.adapters.values()) {
      try {
        adapter.trackPageView(enriched)
      } catch {
        // Swallow adapter errors
      }
    }
  }

  trackInteraction(event: InteractionEvent): void {
    if (!this.enabled) return

    const enriched: InteractionEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
    }

    for (const adapter of this.adapters.values()) {
      try {
        adapter.trackInteraction(enriched)
      } catch {
        // Swallow adapter errors
      }
    }
  }

  identify(userId: string, traits?: Readonly<Record<string, unknown>>): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.identify?.(userId, traits)
      } catch {
        // Swallow adapter errors
      }
    }
  }

  reset(): void {
    for (const adapter of this.adapters.values()) {
      try {
        adapter.reset?.()
      } catch {
        // Swallow adapter errors
      }
    }
  }

  async flush(): Promise<void> {
    // Flush buffered events
    const events = [...this.buffer]
    this.buffer.length = 0

    for (const event of events) {
      for (const adapter of this.adapters.values()) {
        try {
          adapter.trackEvent(event)
        } catch {
          // Swallow adapter errors
        }
      }
    }

    // Call flush on each adapter
    const flushPromises: Promise<void>[] = []
    for (const adapter of this.adapters.values()) {
      if (adapter.flush) {
        flushPromises.push(
          adapter.flush().catch(() => {
            // Swallow flush errors
          })
        )
      }
    }

    await Promise.all(flushPromises)
  }

  getAdapterNames(): readonly string[] {
    return Array.from(this.adapters.keys())
  }

  isEnabled(): boolean {
    return this.enabled
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  getBuffer(): readonly AnalyticsEvent[] {
    return [...this.buffer]
  }

  clear(): void {
    this.adapters.clear()
    this.buffer.length = 0
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  private enrichEvent(event: AnalyticsEvent): AnalyticsEvent {
    return {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
      properties: {
        ...this.config.globalProperties,
        ...event.properties,
      },
    }
  }

  private isEventAllowed(eventName: string): boolean {
    // Check deny list first
    if (this.config.denyList.length > 0 && this.config.denyList.includes(eventName)) {
      return false
    }

    // Check allow list (empty = allow all)
    if (this.config.allowList.length > 0 && !this.config.allowList.includes(eventName)) {
      return false
    }

    return true
  }
}

// ============================================================
// IN-MEMORY ADAPTER (FOR TESTING)
// ============================================================

/**
 * In-memory analytics adapter for testing and debugging
 */
export class InMemoryAnalyticsAdapter implements AnalyticsAdapter {
  readonly name: string
  readonly events: AnalyticsEvent[] = []
  readonly pageViews: PageViewEvent[] = []
  readonly interactions: InteractionEvent[] = []
  private userId: string | undefined = undefined
  private userTraits: Readonly<Record<string, unknown>> | undefined = undefined

  constructor(name = 'in-memory') {
    this.name = name
  }

  trackEvent(event: AnalyticsEvent): void {
    this.events.push(event)
  }

  trackPageView(event: PageViewEvent): void {
    this.pageViews.push(event)
  }

  trackInteraction(event: InteractionEvent): void {
    this.interactions.push(event)
  }

  identify(userId: string, traits?: Readonly<Record<string, unknown>>): void {
    this.userId = userId
    this.userTraits = traits
  }

  reset(): void {
    this.userId = undefined
    this.userTraits = undefined
  }

  async flush(): Promise<void> {
    // No-op for in-memory adapter
  }

  getUserId(): string | undefined {
    return this.userId
  }

  getUserTraits(): Readonly<Record<string, unknown>> | undefined {
    return this.userTraits
  }

  clear(): void {
    this.events.length = 0
    this.pageViews.length = 0
    this.interactions.length = 0
    this.userId = undefined
    this.userTraits = undefined
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create an analytics capability instance
 */
export function createAnalyticsCapability(config?: AnalyticsConfig): AnalyticsCapability {
  return new DefaultAnalyticsCapability(config)
}

/**
 * Create an in-memory analytics adapter (for testing)
 */
export function createInMemoryAdapter(name?: string): InMemoryAnalyticsAdapter {
  return new InMemoryAnalyticsAdapter(name)
}
