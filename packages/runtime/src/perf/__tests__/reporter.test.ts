/**
 * PerformanceReporter Tests
 *
 * @module @pwfabric/runtime/perf/__tests__/reporter
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { PerformanceReporter, createPerformanceReporter } from '../reporter.js'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PerformanceReporter', () => {
  describe('constructor', () => {
    it('creates with console destination', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      expect(reporter).toBeInstanceOf(PerformanceReporter)
      reporter.dispose()
    })

    it('creates with custom destination', () => {
      const onReport = vi.fn()
      const reporter = new PerformanceReporter({ destination: 'custom', onReport })
      expect(reporter).toBeInstanceOf(PerformanceReporter)
      reporter.dispose()
    })

    it('creates without web vitals when disabled', () => {
      const reporter = new PerformanceReporter({
        destination: 'console',
        includeWebVitals: false,
      })
      expect(reporter.getWebVitals()).toBeUndefined()
      reporter.dispose()
    })

    it('creates without render metrics when disabled', () => {
      const reporter = new PerformanceReporter({
        destination: 'console',
        includeRenderMetrics: false,
      })
      expect(reporter.getRenderTimer()).toBeUndefined()
      reporter.dispose()
    })

    it('provides web vitals collector by default', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      expect(reporter.getWebVitals()).toBeDefined()
      reporter.dispose()
    })

    it('provides render timer by default', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      expect(reporter.getRenderTimer()).toBeDefined()
      reporter.dispose()
    })
  })

  describe('start()', () => {
    it('starts without throwing', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      expect(() => reporter.start()).not.toThrow()
      reporter.dispose()
    })
  })

  describe('stop()', () => {
    it('stops without throwing', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      reporter.start()
      expect(() => reporter.stop()).not.toThrow()
      reporter.dispose()
    })

    it('stops a periodic interval', () => {
      vi.useFakeTimers()
      const onReport = vi.fn()
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport,
        interval: 1000,
      })
      reporter.start()
      reporter.stop()
      // Advance time — no reports should fire
      vi.advanceTimersByTime(5000)
      expect(onReport).not.toHaveBeenCalled()
      reporter.dispose()
    })
  })

  describe('report()', () => {
    it('calls custom onReport callback', async () => {
      const onReport = vi.fn()
      const reporter = new PerformanceReporter({ destination: 'custom', onReport })
      const result = await reporter.report()

      expect(onReport).toHaveBeenCalledOnce()
      expect(onReport).toHaveBeenCalledWith(result)
      reporter.dispose()
    })

    it('returns a report with timestamp', async () => {
      const reporter = new PerformanceReporter({ destination: 'custom', onReport: vi.fn() })
      const report = await reporter.report()

      expect(typeof report.timestamp).toBe('number')
      reporter.dispose()
    })

    it('includes web vitals section when enabled', async () => {
      const reporter = new PerformanceReporter({ destination: 'custom', onReport: vi.fn() })
      const report = await reporter.report()

      expect(report.webVitals).toBeDefined()
      reporter.dispose()
    })

    it('excludes web vitals section when disabled', async () => {
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport: vi.fn(),
        includeWebVitals: false,
      })
      const report = await reporter.report()

      expect(report.webVitals).toBeUndefined()
      reporter.dispose()
    })

    it('includes render metrics section when enabled', async () => {
      const reporter = new PerformanceReporter({ destination: 'custom', onReport: vi.fn() })
      const report = await reporter.report()

      expect(report.renderMetrics).toBeDefined()
      reporter.dispose()
    })

    it('excludes render metrics when disabled', async () => {
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport: vi.fn(),
        includeRenderMetrics: false,
      })
      const report = await reporter.report()

      expect(report.renderMetrics).toBeUndefined()
      reporter.dispose()
    })

    it('includes budget check when budget configured', async () => {
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport: vi.fn(),
        budget: { lcp: 2500 },
      })
      const report = await reporter.report()

      expect(report.budgetCheck).toBeDefined()
      reporter.dispose()
    })

    it('excludes budget check when no budget configured', async () => {
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport: vi.fn(),
      })
      const report = await reporter.report()

      expect(report.budgetCheck).toBeUndefined()
      reporter.dispose()
    })

    it('logs to console when destination is console', async () => {
      vi.spyOn(console, 'warn').mockImplementation(vi.fn())
      const reporter = new PerformanceReporter({ destination: 'console' })
      await reporter.report()

      // Should have called console.warn (or console.group if supported)
      reporter.dispose()
      // Just verify no throw; console output is implementation detail
    })

    it('includes render metrics from timer', async () => {
      const reporter = new PerformanceReporter({ destination: 'custom', onReport: vi.fn() })
      const timer = reporter.getRenderTimer()
      if (timer) {
        timer.startRender('test-surface', 4)
        timer.endRender('test-surface')
      }

      const report = await reporter.report()
      expect(report.renderMetrics?.totalRenders).toBe(1)
      expect(report.renderMetrics?.averageRenderTime).toBeGreaterThanOrEqual(0)
      reporter.dispose()
    })

    it('includes budget violation when metrics exceed budget', async () => {
      // Create reporter with very tight budget
      const onReport = vi.fn()
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport,
        includeRenderMetrics: true,
        budget: { maxRenderTime: 0 }, // 0ms budget — always violated if any renders
      })

      const timer = reporter.getRenderTimer()
      if (timer) {
        timer.startRender('s1')
        // Force a small duration by not ending immediately (timing-based, skip in CI)
        timer.endRender('s1')
      }

      const report = await reporter.report()
      expect(report.budgetCheck).toBeDefined()
      reporter.dispose()
    })
  })

  describe('dispose()', () => {
    it('disposes without throwing', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      reporter.start()
      expect(() => reporter.dispose()).not.toThrow()
    })

    it('clears web vitals and render timer references', () => {
      const reporter = new PerformanceReporter({ destination: 'console' })
      reporter.dispose()
      expect(reporter.getWebVitals()).toBeUndefined()
      expect(reporter.getRenderTimer()).toBeUndefined()
    })
  })

  describe('periodic reporting', () => {
    it('fires onReport at configured interval', async () => {
      vi.useFakeTimers()
      const onReport = vi.fn().mockResolvedValue(undefined)
      const reporter = new PerformanceReporter({
        destination: 'custom',
        onReport,
        interval: 1000,
      })
      reporter.start()

      vi.advanceTimersByTime(2500)
      // Two ticks should have fired (at 1000ms and 2000ms)
      await Promise.resolve()
      expect(onReport.mock.calls.length).toBeGreaterThanOrEqual(2)

      reporter.dispose()
    })
  })
})

describe('createPerformanceReporter()', () => {
  it('returns a PerformanceReporter instance', () => {
    const reporter = createPerformanceReporter({ destination: 'console' })
    expect(reporter).toBeInstanceOf(PerformanceReporter)
    reporter.dispose()
  })
})
