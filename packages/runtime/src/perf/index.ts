/**
 * Performance Monitoring Module
 *
 * Provides Core Web Vitals collection, surface render timing,
 * performance budget enforcement, and unified reporting.
 *
 * @module @pwfabric/runtime/perf
 */

// Web Vitals collection
export type {
  WebVitalName,
  WebVitalRating,
  WebVitalMetric,
  WebVitalCallback,
  WebVitalsReport,
} from './web-vitals.js'
export { WebVitalsCollector, createWebVitalsCollector, rateMetric } from './web-vitals.js'

// Render timing
export type { RenderMetrics, RenderTimerConfig } from './render-timer.js'
export { RenderTimer, createRenderTimer } from './render-timer.js'

// Performance budget
export type { PerformanceBudget, BudgetViolation, BudgetCheckResult } from './budget.js'
export { DEFAULT_BUDGET, BudgetChecker, createBudgetChecker } from './budget.js'

// Reporter
export type { ReportDestination, ReporterConfig, PerformanceReport } from './reporter.js'
export { PerformanceReporter, createPerformanceReporter } from './reporter.js'
