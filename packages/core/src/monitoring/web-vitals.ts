/**
 * Web Vitals Collection
 *
 * Collection of Core Web Vitals using Performance API
 *
 * @module @pwfabric/core/monitoring/web-vitals
 */

import { type WebVitalName, type WebVitalMetric, getRating } from './metrics.js'

/**
 * Callback for when a Web Vital is collected
 */
export type WebVitalCallback = (metric: WebVitalMetric) => void

/**
 * Create a Web Vital metric from performance entries
 */
function createWebVitalMetric(
  name: WebVitalName,
  value: number,
  delta: number,
  entries: PerformanceEntry[]
): WebVitalMetric {
  return {
    name,
    value,
    delta,
    rating: getRating(name, value),
    timestamp: Date.now(),
    entries,
  }
}

/**
 * Observe Largest Contentful Paint (LCP)
 */
export function observeLCP(callback: WebVitalCallback): (() => void) | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined

  let lastValue = 0
  const entries: PerformanceEntry[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const lcpEntry = entry as PerformanceEntry & { startTime: number }
      entries.push(entry)
      const value = lcpEntry.startTime
      const delta = value - lastValue
      lastValue = value
      callback(createWebVitalMetric('LCP', value, delta, [...entries]))
    }
  })

  try {
    observer.observe({ type: 'largest-contentful-paint', buffered: true })
    return () => observer.disconnect()
  } catch {
    return undefined
  }
}

/**
 * Observe First Input Delay (FID)
 */
export function observeFID(callback: WebVitalCallback): (() => void) | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined

  const entries: PerformanceEntry[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const fidEntry = entry as PerformanceEventTiming
      entries.push(entry)
      const value = fidEntry.processingStart - fidEntry.startTime
      callback(createWebVitalMetric('FID', value, value, [...entries]))
    }
  })

  try {
    observer.observe({ type: 'first-input', buffered: true })
    return () => observer.disconnect()
  } catch {
    return undefined
  }
}

/**
 * Observe Cumulative Layout Shift (CLS)
 */
export function observeCLS(callback: WebVitalCallback): (() => void) | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined

  let clsValue = 0
  const entries: PerformanceEntry[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const layoutShift = entry as PerformanceEntry & {
        hadRecentInput: boolean
        value: number
      }
      if (!layoutShift.hadRecentInput) {
        const delta = layoutShift.value
        clsValue += delta
        entries.push(entry)
        callback(createWebVitalMetric('CLS', clsValue, delta, [...entries]))
      }
    }
  })

  try {
    observer.observe({ type: 'layout-shift', buffered: true })
    return () => observer.disconnect()
  } catch {
    return undefined
  }
}

/**
 * Observe Time to First Byte (TTFB)
 */
export function observeTTFB(callback: WebVitalCallback): void {
  if (typeof window === 'undefined' || typeof performance === 'undefined') return

  const navigationEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined

  if (navigationEntry) {
    const value = navigationEntry.responseStart - navigationEntry.requestStart
    callback(createWebVitalMetric('TTFB', value, value, [navigationEntry]))
  }
}

/**
 * Observe Interaction to Next Paint (INP)
 */
export function observeINP(callback: WebVitalCallback): (() => void) | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined

  let maxINP = 0
  const entries: PerformanceEntry[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const eventEntry = entry as PerformanceEventTiming
      const duration = eventEntry.duration
      if (duration > maxINP) {
        maxINP = duration
        entries.push(entry)
        callback(createWebVitalMetric('INP', duration, duration, [...entries]))
      }
    }
  })

  try {
    observer.observe({ type: 'event', buffered: true })
    return () => observer.disconnect()
  } catch {
    return undefined
  }
}

/**
 * Observe First Contentful Paint (FCP)
 */
export function observeFCP(callback: WebVitalCallback): (() => void) | undefined {
  if (typeof PerformanceObserver === 'undefined') return undefined

  const entries: PerformanceEntry[] = []

  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (entry.name === 'first-contentful-paint') {
        entries.push(entry)
        const value = entry.startTime
        callback(createWebVitalMetric('FCP', value, value, [...entries]))
      }
    }
  })

  try {
    observer.observe({ type: 'paint', buffered: true })
    return () => observer.disconnect()
  } catch {
    return undefined
  }
}

/**
 * Observe all Web Vitals
 */
export function observeAllWebVitals(callback: WebVitalCallback): () => void {
  const cleanups: ((() => void) | undefined)[] = []

  cleanups.push(observeLCP(callback))
  cleanups.push(observeFID(callback))
  cleanups.push(observeCLS(callback))
  cleanups.push(observeINP(callback))
  cleanups.push(observeFCP(callback))

  // TTFB is synchronous
  observeTTFB(callback)

  return () => {
    for (const cleanup of cleanups) {
      cleanup?.()
    }
  }
}
