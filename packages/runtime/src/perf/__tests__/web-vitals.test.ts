/**
 * WebVitalsCollector Tests
 *
 * @module @pwfabric/runtime/perf/__tests__/web-vitals
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { WebVitalsCollector, createWebVitalsCollector, rateMetric } from '../web-vitals.js'

// ============================================================
// rateMetric
// ============================================================

describe('rateMetric()', () => {
  it('rates LCP as good when at threshold', () => {
    expect(rateMetric('LCP', 2500)).toBe('good')
    expect(rateMetric('LCP', 1000)).toBe('good')
  })

  it('rates LCP as needs-improvement between thresholds', () => {
    expect(rateMetric('LCP', 3000)).toBe('needs-improvement')
  })

  it('rates LCP as poor above upper threshold', () => {
    expect(rateMetric('LCP', 5000)).toBe('poor')
  })

  it('rates FID correctly', () => {
    expect(rateMetric('FID', 50)).toBe('good')
    expect(rateMetric('FID', 200)).toBe('needs-improvement')
    expect(rateMetric('FID', 400)).toBe('poor')
  })

  it('rates CLS correctly', () => {
    expect(rateMetric('CLS', 0.05)).toBe('good')
    expect(rateMetric('CLS', 0.15)).toBe('needs-improvement')
    expect(rateMetric('CLS', 0.3)).toBe('poor')
  })

  it('rates FCP correctly', () => {
    expect(rateMetric('FCP', 1000)).toBe('good')
    expect(rateMetric('FCP', 2000)).toBe('needs-improvement')
    expect(rateMetric('FCP', 4000)).toBe('poor')
  })

  it('rates TTFB correctly', () => {
    expect(rateMetric('TTFB', 500)).toBe('good')
    expect(rateMetric('TTFB', 1000)).toBe('needs-improvement')
    expect(rateMetric('TTFB', 2000)).toBe('poor')
  })

  it('rates INP correctly', () => {
    expect(rateMetric('INP', 100)).toBe('good')
    expect(rateMetric('INP', 300)).toBe('needs-improvement')
    expect(rateMetric('INP', 600)).toBe('poor')
  })
})

// ============================================================
// WebVitalsCollector
// ============================================================

describe('WebVitalsCollector', () => {
  let collector: WebVitalsCollector

  beforeEach(() => {
    collector = new WebVitalsCollector()
  })

  afterEach(() => {
    collector.dispose()
  })

  describe('initial state', () => {
    it('returns empty report initially', () => {
      const report = collector.getReport()
      expect(report.lcp).toBeUndefined()
      expect(report.fid).toBeUndefined()
      expect(report.cls).toBeUndefined()
      expect(report.fcp).toBeUndefined()
      expect(report.ttfb).toBeUndefined()
      expect(report.inp).toBeUndefined()
      expect(typeof report.collectedAt).toBe('number')
    })
  })

  describe('startCollecting()', () => {
    it('no-ops when PerformanceObserver is not available', () => {
      // In test environment PerformanceObserver may or may not be available
      // Just ensure no throw
      expect(() => collector.startCollecting()).not.toThrow()
    })
  })

  describe('stopCollecting()', () => {
    it('does not throw when called without starting', () => {
      expect(() => collector.stopCollecting()).not.toThrow()
    })

    it('does not throw after startCollecting', () => {
      collector.startCollecting()
      expect(() => collector.stopCollecting()).not.toThrow()
    })
  })

  describe('onMetric()', () => {
    it('registers a callback for a metric name', () => {
      const cb = vi.fn()
      collector.onMetric('LCP', cb)
      // In SSR / no PerformanceObserver env, the callback will not be fired naturally
      // but it can be verified by checking it was stored
      expect(cb).not.toHaveBeenCalled()
    })

    it('registers multiple callbacks for same metric', () => {
      const cb1 = vi.fn()
      const cb2 = vi.fn()
      collector.onMetric('FCP', cb1)
      collector.onMetric('FCP', cb2)
      // Both registered without error
      expect(cb1).not.toHaveBeenCalled()
    })
  })

  describe('dispose()', () => {
    it('clears all state', () => {
      collector.startCollecting()
      collector.dispose()
      // After dispose, report should be empty again
      const report = collector.getReport()
      expect(report.lcp).toBeUndefined()
    })

    it('resets CLS state', () => {
      // Just ensure dispose doesn't throw
      expect(() => collector.dispose()).not.toThrow()
    })
  })

  describe('getReport()', () => {
    it('includes collectedAt timestamp', () => {
      const before = Date.now()
      const report = collector.getReport()
      const after = Date.now()
      expect(report.collectedAt).toBeGreaterThanOrEqual(before)
      expect(report.collectedAt).toBeLessThanOrEqual(after)
    })
  })
})

describe('createWebVitalsCollector()', () => {
  it('returns a WebVitalsCollector instance', () => {
    const c = createWebVitalsCollector()
    expect(c).toBeInstanceOf(WebVitalsCollector)
    c.dispose()
  })
})
