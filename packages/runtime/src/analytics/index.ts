/**
 * Analytics Capability Module
 *
 * Provider-agnostic event tracking via adapter pattern
 *
 * Exports:
 * - Types: AnalyticsEvent, PageViewEvent, InteractionEvent, AnalyticsAdapter, etc.
 * - Implementations: DefaultAnalyticsCapability, InMemoryAnalyticsAdapter
 * - Factory functions: createAnalyticsCapability, createInMemoryAdapter
 *
 * @module @pwfabric/runtime/analytics
 */

// Types
export type {
  AnalyticsEvent,
  PageViewEvent,
  InteractionEvent,
  InteractionType,
  AnalyticsAdapter,
  AnalyticsConfig,
  AnalyticsCapability,
} from './types.js'

// Implementations
export {
  DefaultAnalyticsCapability,
  InMemoryAnalyticsAdapter,
  createAnalyticsCapability,
  createInMemoryAdapter,
} from './tracker.js'
