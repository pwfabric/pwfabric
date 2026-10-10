/**
 * Performance Metric Reporter
 *
 * Orchestrates Web Vitals collection, render timing, and budget
 * checking into a unified reporting pipeline. Supports periodic
 * automatic reporting or manual on-demand reports.
 *
 * @module @pwfabric/runtime/perf
 */

import type { WebVitalsReport } from './web-vitals.js'
import type { RenderMetrics } from './render-timer.js'
import type { PerformanceBudget, BudgetCheckResult } from './budget.js'
import { WebVitalsCollector } from './web-vitals.js'
import { RenderTimer } from './render-timer.js'
import { BudgetChecker } from './budget.js'

// ============================================================
// TYPES
// ============================================================

/** Where to send performance reports */
export type ReportDestination = 'console' | 'custom'

/** Reporter configuration */
export interface ReporterConfig {
  /** Report destination */
  readonly destination: ReportDestination
  /** Custom report handler (required when destination is 'custom') */
  readonly onReport?: (report: PerformanceReport) => void | Promise<void>
  /** Reporting interval in ms (0 = manual only, default: 0) */
  readonly interval?: number
  /** Whether to include render metrics (default: true) */
  readonly includeRenderMetrics?: boolean
  /** Whether to include Web Vitals (default: true) */
  readonly includeWebVitals?: boolean
  /** Performance budget to check against */
  readonly budget?: PerformanceBudget
}

/** A complete performance report */
export interface PerformanceReport {
  /** Timestamp when the report was generated */
  readonly timestamp: number
  /** Web Vitals snapshot */
  readonly webVitals?: WebVitalsReport | undefined
  /** Render timing summary */
  readonly renderMetrics?:
    | {
        readonly averageRenderTime: number
        readonly totalRenders: number
        readonly slowestRenders: readonly RenderMetrics[]
      }
    | undefined
  /** Budget check result */
  readonly budgetCheck?: BudgetCheckResult | undefined
}

// ============================================================
// DEFAULTS
// ============================================================

const DEFAULT_SLOWEST_COUNT = 5

// ============================================================
// REPORTER
// ============================================================

/**
 * Orchestrates performance monitoring components and generates
 * unified performance reports.
 *
 * Manages a WebVitalsCollector, RenderTimer, and BudgetChecker
 * internally. Supports automatic periodic reporting or manual
 * on-demand report generation.
 */
export class PerformanceReporter {
  private readonly destination: ReportDestination
  private readonly onReportCallback?:
    | ((report: PerformanceReport) => void | Promise<void>)
    | undefined
  private readonly interval: number
  private readonly includeRenderMetrics: boolean
  private readonly includeWebVitals: boolean

  private webVitals?: WebVitalsCollector | undefined
  private renderTimer?: RenderTimer | undefined
  private budgetChecker?: BudgetChecker | undefined
  private intervalId?: ReturnType<typeof setInterval> | undefined

  /**
   * @param config - Reporter configuration
   */
  constructor(config: ReporterConfig) {
    this.destination = config.destination
    this.onReportCallback = config.onReport
    this.interval = config.interval ?? 0
    this.includeRenderMetrics = config.includeRenderMetrics ?? true
    this.includeWebVitals = config.includeWebVitals ?? true

    // Initialize sub-components
    if (this.includeWebVitals) {
      this.webVitals = new WebVitalsCollector()
    }

    if (this.includeRenderMetrics) {
      this.renderTimer = new RenderTimer()
    }

    if (config.budget) {
      this.budgetChecker = new BudgetChecker(config.budget)
    }
  }

  /**
   * Start periodic reporting and Web Vitals collection.
   *
   * If an interval is configured, reports will be generated
   * automatically at that interval. Web Vitals collection
   * starts immediately.
   */
  start(): void {
    // Start web vitals collection
    this.webVitals?.startCollecting()

    // Set up periodic reporting
    if (this.interval > 0) {
      this.intervalId = setInterval(() => {
        void this.report()
      }, this.interval)
    }
  }

  /**
   * Generate and deliver a performance report.
   *
   * Collects metrics from all active sub-components, runs
   * budget checks if configured, and delivers the report
   * to the configured destination.
   *
   * @returns The generated performance report
   */
  async report(): Promise<PerformanceReport> {
    const performanceReport: PerformanceReport = {
      timestamp: Date.now(),
      webVitals: this.buildWebVitalsSection(),
      renderMetrics: this.buildRenderMetricsSection(),
      budgetCheck: this.buildBudgetCheckSection(),
    }

    await this.deliverReport(performanceReport)

    return performanceReport
  }

  /**
   * Stop periodic reporting.
   *
   * Does not stop Web Vitals collection or clear history.
   * Use `dispose()` for full cleanup.
   */
  stop(): void {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId)
      this.intervalId = undefined
    }
  }

  /**
   * Get the internal WebVitalsCollector.
   *
   * Useful for registering custom metric callbacks.
   *
   * @returns The collector, or undefined if Web Vitals are disabled
   */
  getWebVitals(): WebVitalsCollector | undefined {
    return this.webVitals
  }

  /**
   * Get the internal RenderTimer.
   *
   * Useful for tracking surface render timing externally.
   *
   * @returns The timer, or undefined if render metrics are disabled
   */
  getRenderTimer(): RenderTimer | undefined {
    return this.renderTimer
  }

  /**
   * Stop reporting and release all resources.
   */
  dispose(): void {
    this.stop()
    this.webVitals?.dispose()
    this.renderTimer?.clear()
    this.webVitals = undefined
    this.renderTimer = undefined
    this.budgetChecker = undefined
  }

  // ----------------------------------------------------------
  // Private: report building
  // ----------------------------------------------------------

  private buildWebVitalsSection(): WebVitalsReport | undefined {
    if (!this.includeWebVitals || !this.webVitals) {
      return undefined
    }
    return this.webVitals.getReport()
  }

  private buildRenderMetricsSection(): PerformanceReport['renderMetrics'] | undefined {
    if (!this.includeRenderMetrics || !this.renderTimer) {
      return undefined
    }

    const history = this.renderTimer.getHistory()
    return {
      averageRenderTime: this.renderTimer.getAverageRenderTime(),
      totalRenders: history.length,
      slowestRenders: this.renderTimer.getSlowest(DEFAULT_SLOWEST_COUNT),
    }
  }

  private buildBudgetCheckSection(): BudgetCheckResult | undefined {
    if (!this.budgetChecker) {
      return undefined
    }

    // Collect all available numeric metrics for budget checking
    const metrics: Record<string, number> = {}

    // Web Vitals
    if (this.webVitals) {
      const vitalsReport = this.webVitals.getReport()
      if (vitalsReport.lcp) metrics['lcp'] = vitalsReport.lcp.value
      if (vitalsReport.fid) metrics['fid'] = vitalsReport.fid.value
      if (vitalsReport.cls) metrics['cls'] = vitalsReport.cls.value
      if (vitalsReport.fcp) metrics['fcp'] = vitalsReport.fcp.value
      if (vitalsReport.ttfb) metrics['ttfb'] = vitalsReport.ttfb.value
    }

    // Render metrics
    if (this.renderTimer) {
      const avg = this.renderTimer.getAverageRenderTime()
      if (avg > 0) {
        metrics['maxRenderTime'] = avg
      }
    }

    return this.budgetChecker.check(metrics)
  }

  // ----------------------------------------------------------
  // Private: report delivery
  // ----------------------------------------------------------

  private async deliverReport(performanceReport: PerformanceReport): Promise<void> {
    switch (this.destination) {
      case 'console':
        this.logToConsole(performanceReport)
        break

      case 'custom':
        if (this.onReportCallback) {
          await this.onReportCallback(performanceReport)
        }
        break
    }
  }

  private logToConsole(performanceReport: PerformanceReport): void {
    if (typeof globalThis.console === 'undefined') {
      return
    }

    const log = globalThis.console
    const group = typeof log.group === 'function' ? log.group.bind(log) : undefined
    const groupEnd = typeof log.groupEnd === 'function' ? log.groupEnd.bind(log) : undefined

    if (group) {
      group('[PWFabric Perf Report]')
    } else {
      log.warn('[PWFabric Perf Report]')
    }

    if (performanceReport.webVitals) {
      log.warn('Web Vitals:', performanceReport.webVitals)
    }

    if (performanceReport.renderMetrics) {
      log.warn('Render Metrics:', performanceReport.renderMetrics)
    }

    if (performanceReport.budgetCheck) {
      const status = performanceReport.budgetCheck.passed ? 'PASS' : 'FAIL'
      log.warn(`Budget Check: ${status}`, performanceReport.budgetCheck.violations)
    }

    if (groupEnd) {
      groupEnd()
    }
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a new PerformanceReporter instance.
 *
 * @param config - Reporter configuration
 * @returns A new PerformanceReporter
 */
export function createPerformanceReporter(config: ReporterConfig): PerformanceReporter {
  return new PerformanceReporter(config)
}
