/**
 * Monitoring Module
 *
 * Exports for performance monitoring
 *
 * @module @pwfabric/core/monitoring
 */

export {
  type WebVitalName,
  type MetricRating,
  type Metric,
  type WebVitalMetric,
  type TimingMetric,
  type RenderMetric,
  type PerformanceBudget,
  type MetricsState,
  DEFAULT_BUDGET,
  createMetricsState,
  getRating,
} from './metrics.js'

export {
  type WebVitalCallback,
  observeLCP,
  observeFID,
  observeCLS,
  observeTTFB,
  observeINP,
  observeFCP,
  observeAllWebVitals,
} from './web-vitals.js'
