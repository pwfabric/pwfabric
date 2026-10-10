/**
 * Analytics Capability Types
 *
 * Event tracking, page views, and user interaction tracking
 *
 * Provider-agnostic via adapter pattern (GA, Mixpanel, etc.)
 *
 * @module @pwfabric/runtime/analytics/types
 */

// ============================================================
// ANALYTICS EVENTS
// ============================================================

/**
 * Analytics event
 */
export interface AnalyticsEvent {
  /** Event name/action */
  readonly name: string

  /** Event category */
  readonly category?: string

  /** Event label for further classification */
  readonly label?: string

  /** Numeric value associated with the event */
  readonly value?: number

  /** Additional event properties */
  readonly properties?: Readonly<Record<string, unknown>>

  /** Timestamp (defaults to Date.now()) */
  readonly timestamp?: number
}

/**
 * Page view event
 */
export interface PageViewEvent {
  /** Page path */
  readonly path: string

  /** Page title */
  readonly title?: string

  /** Referrer URL */
  readonly referrer?: string

  /** Additional page properties */
  readonly properties?: Readonly<Record<string, unknown>>

  /** Timestamp */
  readonly timestamp?: number
}

/**
 * User interaction event
 */
export interface InteractionEvent {
  /** Type of interaction */
  readonly type: InteractionType

  /** Target element or component identifier */
  readonly target: string

  /** Additional interaction data */
  readonly data?: Readonly<Record<string, unknown>>

  /** Timestamp */
  readonly timestamp?: number
}

/**
 * Supported interaction types
 */
export type InteractionType =
  | 'click'
  | 'submit'
  | 'scroll'
  | 'focus'
  | 'blur'
  | 'hover'
  | 'drag'
  | 'resize'
  | 'custom'

// ============================================================
// ANALYTICS ADAPTER (PROVIDER PATTERN)
// ============================================================

/**
 * Analytics adapter interface for provider integration
 *
 * Implement this interface to connect to a specific analytics
 * provider (Google Analytics, Mixpanel, Amplitude, etc.)
 */
export interface AnalyticsAdapter {
  /** Adapter identifier */
  readonly name: string

  /** Initialize the adapter */
  initialize?(config: Readonly<Record<string, unknown>>): void | Promise<void>

  /** Track a custom event */
  trackEvent(event: AnalyticsEvent): void

  /** Track a page view */
  trackPageView(event: PageViewEvent): void

  /** Track a user interaction */
  trackInteraction(event: InteractionEvent): void

  /** Set user identity */
  identify?(userId: string, traits?: Readonly<Record<string, unknown>>): void

  /** Reset/clear user identity */
  reset?(): void

  /** Flush any buffered events */
  flush?(): Promise<void>
}

// ============================================================
// ANALYTICS CONFIGURATION
// ============================================================

/**
 * Analytics capability configuration
 */
export interface AnalyticsConfig {
  /** Whether analytics is enabled */
  readonly enabled?: boolean

  /** Whether to buffer events before sending */
  readonly bufferEvents?: boolean

  /** Maximum buffer size before auto-flush */
  readonly maxBufferSize?: number

  /** Global properties to attach to all events */
  readonly globalProperties?: Readonly<Record<string, unknown>>

  /** Event name filter (only track matching events) */
  readonly allowList?: readonly string[]

  /** Event name filter (exclude matching events) */
  readonly denyList?: readonly string[]
}

// ============================================================
// ANALYTICS CAPABILITY INTERFACE
// ============================================================

/**
 * Analytics capability interface
 */
export interface AnalyticsCapability {
  /** Register an analytics adapter (provider) */
  addAdapter(adapter: AnalyticsAdapter): void

  /** Remove an adapter by name */
  removeAdapter(name: string): boolean

  /** Track a custom event */
  trackEvent(event: AnalyticsEvent): void

  /** Track a page view */
  trackPageView(event: PageViewEvent): void

  /** Track a user interaction */
  trackInteraction(event: InteractionEvent): void

  /** Set user identity across all adapters */
  identify(userId: string, traits?: Readonly<Record<string, unknown>>): void

  /** Reset identity across all adapters */
  reset(): void

  /** Flush all buffered events */
  flush(): Promise<void>

  /** Get registered adapter names */
  getAdapterNames(): readonly string[]

  /** Check if analytics is enabled */
  isEnabled(): boolean

  /** Enable or disable analytics */
  setEnabled(enabled: boolean): void

  /** Get buffered events (if buffering is enabled) */
  getBuffer(): readonly AnalyticsEvent[]

  /** Clear all adapters and state */
  clear(): void
}
