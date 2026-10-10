/**
 * Performance Metrics Types
 *
 * Type definitions for performance monitoring
 *
 * @module @pwfabric/core/monitoring/metrics
 */

/**
 * Web Vitals metric names
 */
export type WebVitalName = 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'INP' | 'FCP'

/**
 * Metric rating
 */
export type MetricRating = 'good' | 'needs-improvement' | 'poor'

/**
 * Base metric interface
 */
export interface Metric {
  readonly name: string
  readonly value: number
  readonly timestamp: number
}

/**
 * Web Vital metric
 */
export interface WebVitalMetric extends Metric {
  readonly name: WebVitalName
  readonly rating: MetricRating
  readonly delta: number
  readonly entries: readonly PerformanceEntry[]
}

/**
 * Custom timing metric
 */
export interface TimingMetric extends Metric {
  readonly name: string
  readonly duration: number
  readonly startTime: number
  readonly endTime: number
  readonly metadata?: Record<string, unknown> | undefined
}

/**
 * Component render metric
 */
export interface RenderMetric extends Metric {
  readonly name: string
  readonly componentName: string
  readonly renderCount: number
  readonly duration: number
}

/**
 * Performance budget thresholds
 */
export interface PerformanceBudget {
  readonly LCP: number
  readonly FID: number
  readonly CLS: number
  readonly TTFB: number
  readonly INP: number
}

/**
 * Default performance budgets based on Core Web Vitals thresholds
 */
export const DEFAULT_BUDGET: PerformanceBudget = {
  LCP: 2500, // 2.5s
  FID: 100, // 100ms
  CLS: 0.1, // 0.1
  TTFB: 800, // 800ms
  INP: 200, // 200ms
}

/**
 * Metric collection state
 */
export interface MetricsState {
  readonly webVitals: Record<WebVitalName, WebVitalMetric | null>
  readonly timings: readonly TimingMetric[]
  readonly renders: readonly RenderMetric[]
  readonly budget: PerformanceBudget
}

/**
 * Create initial metrics state
 */
export function createMetricsState(budget: Partial<PerformanceBudget> = {}): MetricsState {
  return {
    webVitals: {
      LCP: null,
      FID: null,
      CLS: null,
      TTFB: null,
      INP: null,
      FCP: null,
    },
    timings: [],
    renders: [],
    budget: { ...DEFAULT_BUDGET, ...budget },
  }
}

/**
 * Get rating for a Web Vital metric
 */
export function getRating(name: WebVitalName, value: number): MetricRating {
  const thresholds: Record<WebVitalName, [number, number]> = {
    LCP: [2500, 4000],
    FID: [100, 300],
    CLS: [0.1, 0.25],
    TTFB: [800, 1800],
    INP: [200, 500],
    FCP: [1800, 3000],
  }

  const [good, poor] = thresholds[name]
  if (value <= good) return 'good'
  if (value <= poor) return 'needs-improvement'
  return 'poor'
}
