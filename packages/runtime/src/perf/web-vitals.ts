/**
 * Core Web Vitals Collection
 *
 * Collects Core Web Vitals (LCP, FID, CLS, FCP, TTFB, INP) using
 * PerformanceObserver. Provides real-time metric collection with
 * rating classification based on web.dev thresholds.
 *
 * All browser APIs are guarded for SSR safety.
 *
 * @module @pwfabric/runtime/perf
 */

// ============================================================
// TYPES
// ============================================================

/** Web Vital metric names */
export type WebVitalName = 'LCP' | 'FID' | 'CLS' | 'FCP' | 'TTFB' | 'INP'

/** Rating classification for a metric */
export type WebVitalRating = 'good' | 'needs-improvement' | 'poor'

/** A single Web Vital measurement */
export interface WebVitalMetric {
  /** Metric name */
  readonly name: WebVitalName
  /** Metric value (ms for timing metrics, unitless for CLS) */
  readonly value: number
  /** Rating based on web.dev thresholds */
  readonly rating: WebVitalRating
  /** Timestamp when the metric was collected */
  readonly timestamp: number
}

/** Callback invoked when a metric is collected */
export type WebVitalCallback = (metric: WebVitalMetric) => void

/** Aggregated report of all collected Web Vitals */
export interface WebVitalsReport {
  /** Largest Contentful Paint */
  readonly lcp?: WebVitalMetric | undefined
  /** First Input Delay */
  readonly fid?: WebVitalMetric | undefined
  /** Cumulative Layout Shift */
  readonly cls?: WebVitalMetric | undefined
  /** First Contentful Paint */
  readonly fcp?: WebVitalMetric | undefined
  /** Time to First Byte */
  readonly ttfb?: WebVitalMetric | undefined
  /** Interaction to Next Paint */
  readonly inp?: WebVitalMetric | undefined
  /** Timestamp when the report was generated */
  readonly collectedAt: number
}

// ============================================================
// THRESHOLDS (from web.dev)
// ============================================================

/** Rating thresholds: [goodThreshold, poorThreshold] */
const THRESHOLDS: Record<WebVitalName, readonly [number, number]> = {
  LCP: [2500, 4000],
  FID: [100, 300],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  INP: [200, 500],
} as const

// ============================================================
// UTILITY
// ============================================================

/**
 * Rate a metric value against web.dev thresholds.
 *
 * @param name - The metric name
 * @param value - The measured value
 * @returns The rating classification
 */
export function rateMetric(name: WebVitalName, value: number): WebVitalRating {
  const threshold = THRESHOLDS[name]
  if (!threshold) {
    return 'good'
  }
  if (value <= threshold[0]) {
    return 'good'
  }
  if (value > threshold[1]) {
    return 'poor'
  }
  return 'needs-improvement'
}

// ============================================================
// COLLECTOR
// ============================================================

/**
 * Collects Core Web Vitals using PerformanceObserver.
 *
 * Supports LCP, FID, CLS, FCP, TTFB, and INP metrics.
 * All observers are cleaned up on dispose.
 */
export class WebVitalsCollector {
  private metrics = new Map<WebVitalName, WebVitalMetric>()
  private observers: PerformanceObserver[] = []
  private callbacks = new Map<WebVitalName, WebVitalCallback[]>()
  private clsValue = 0
  private clsSessionEntries: PerformanceEntry[] = []
  private clsSessionValue = 0

  /**
   * Start collecting all Web Vitals.
   *
   * Creates PerformanceObservers for each metric type.
   * Safe to call in SSR environments (no-ops silently).
   */
  startCollecting(): void {
    if (typeof PerformanceObserver === 'undefined') {
      return
    }

    this.observeLCP()
    this.observeFID()
    this.observeCLS()
    this.observeFCP()
    this.observeTTFB()
    this.observeINP()
  }

  /**
   * Register a callback for a specific metric.
   *
   * The callback fires each time the metric is updated.
   *
   * @param name - The metric name to observe
   * @param callback - Function to call with the metric
   */
  onMetric(name: WebVitalName, callback: WebVitalCallback): void {
    const existing = this.callbacks.get(name) ?? []
    existing.push(callback)
    this.callbacks.set(name, existing)
  }

  /**
   * Get the current Web Vitals report.
   *
   * @returns A snapshot of all collected metrics
   */
  getReport(): WebVitalsReport {
    return {
      lcp: this.metrics.get('LCP'),
      fid: this.metrics.get('FID'),
      cls: this.metrics.get('CLS'),
      fcp: this.metrics.get('FCP'),
      ttfb: this.metrics.get('TTFB'),
      inp: this.metrics.get('INP'),
      collectedAt: Date.now(),
    }
  }

  /**
   * Stop collecting metrics and disconnect all observers.
   */
  stopCollecting(): void {
    for (const observer of this.observers) {
      observer.disconnect()
    }
    this.observers = []
  }

  /**
   * Stop collecting and clear all state.
   */
  dispose(): void {
    this.stopCollecting()
    this.metrics.clear()
    this.callbacks.clear()
    this.clsValue = 0
    this.clsSessionEntries = []
    this.clsSessionValue = 0
  }

  // ----------------------------------------------------------
  // Private: metric recording
  // ----------------------------------------------------------

  private recordMetric(name: WebVitalName, value: number): void {
    const metric: WebVitalMetric = {
      name,
      value,
      rating: rateMetric(name, value),
      timestamp: Date.now(),
    }
    this.metrics.set(name, metric)

    const cbs = this.callbacks.get(name)
    if (cbs) {
      for (const cb of cbs) {
        cb(metric)
      }
    }
  }

  // ----------------------------------------------------------
  // Private: observer helpers
  // ----------------------------------------------------------

  private tryObserve(
    entryType: string,
    handler: (entries: PerformanceEntryList) => void,
    options?: { buffered?: boolean; type?: string }
  ): void {
    try {
      const observer = new PerformanceObserver((list) => {
        handler(list.getEntries())
      })
      const observeOptions: PerformanceObserverInit = {
        type: options?.type ?? entryType,
        buffered: options?.buffered ?? true,
      }
      observer.observe(observeOptions)
      this.observers.push(observer)
    } catch {
      // Entry type not supported in this browser — silently skip
    }
  }

  private observeLCP(): void {
    this.tryObserve('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1]
      if (last) {
        this.recordMetric('LCP', last.startTime)
      }
    })
  }

  private observeFID(): void {
    this.tryObserve('first-input', (entries) => {
      const first = entries[0]
      if (first) {
        const fidEntry = first as PerformanceEventTiming
        this.recordMetric('FID', fidEntry.processingStart - fidEntry.startTime)
      }
    })
  }

  private observeCLS(): void {
    this.tryObserve('layout-shift', (entries) => {
      for (const entry of entries) {
        const lsEntry = entry as LayoutShiftEntry
        // Only count shifts without recent user input
        if (!lsEntry.hadRecentInput) {
          // Session window algorithm
          if (
            this.clsSessionEntries.length > 0 &&
            entry.startTime -
              (this.clsSessionEntries[this.clsSessionEntries.length - 1]?.startTime ?? 0) >
              1000
          ) {
            // Gap > 1s → start new session window
            if (this.clsSessionValue > this.clsValue) {
              this.clsValue = this.clsSessionValue
            }
            this.clsSessionEntries = []
            this.clsSessionValue = 0
          }

          // Add to current session
          if (
            this.clsSessionEntries.length === 0 ||
            entry.startTime - (this.clsSessionEntries[0]?.startTime ?? 0) <= 5000
          ) {
            this.clsSessionEntries.push(entry)
            this.clsSessionValue += lsEntry.value
          } else {
            // Session exceeded 5s → start new session
            if (this.clsSessionValue > this.clsValue) {
              this.clsValue = this.clsSessionValue
            }
            this.clsSessionEntries = [entry]
            this.clsSessionValue = lsEntry.value
          }

          // Report the max of current session and previous max
          const currentCls = Math.max(this.clsValue, this.clsSessionValue)
          this.recordMetric('CLS', currentCls)
        }
      }
    })
  }

  private observeFCP(): void {
    this.tryObserve('paint', (entries) => {
      const fcp = entries.find((e) => e.name === 'first-contentful-paint')
      if (fcp) {
        this.recordMetric('FCP', fcp.startTime)
      }
    })
  }

  private observeTTFB(): void {
    this.tryObserve('navigation', (entries) => {
      const nav = entries[0] as PerformanceNavigationTiming | undefined
      if (nav) {
        this.recordMetric('TTFB', nav.responseStart)
      }
    })
  }

  private observeINP(): void {
    this.tryObserve(
      'event',
      (entries) => {
        let maxDuration = 0
        for (const entry of entries) {
          const eventEntry = entry as PerformanceEventTiming
          if (eventEntry.duration > maxDuration) {
            maxDuration = eventEntry.duration
          }
        }
        if (maxDuration > 0) {
          const existing = this.metrics.get('INP')
          // INP tracks the worst interaction
          if (!existing || maxDuration > existing.value) {
            this.recordMetric('INP', maxDuration)
          }
        }
      },
      { type: 'event', buffered: true }
    )
  }
}

// ============================================================
// LAYOUT SHIFT ENTRY TYPE (not in all TS libs)
// ============================================================

interface LayoutShiftEntry extends PerformanceEntry {
  readonly hadRecentInput: boolean
  readonly value: number
}

interface PerformanceEventTiming extends PerformanceEntry {
  readonly processingStart: number
  readonly duration: number
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a new WebVitalsCollector instance.
 *
 * @returns A new collector (not yet started)
 */
export function createWebVitalsCollector(): WebVitalsCollector {
  return new WebVitalsCollector()
}
