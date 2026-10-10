/**
 * Performance Budget Enforcement
 *
 * Defines performance budgets based on web.dev recommendations
 * and checks measured metrics against those budgets. Violations
 * are reported with severity levels.
 *
 * @module @pwfabric/runtime/perf
 */

// ============================================================
// TYPES
// ============================================================

/** Performance budget thresholds */
export interface PerformanceBudget {
  /** Max Largest Contentful Paint in ms */
  readonly lcp?: number
  /** Max First Input Delay in ms */
  readonly fid?: number
  /** Max Cumulative Layout Shift score */
  readonly cls?: number
  /** Max First Contentful Paint in ms */
  readonly fcp?: number
  /** Max Time to First Byte in ms */
  readonly ttfb?: number
  /** Max bundle size in bytes */
  readonly maxBundleSize?: number
  /** Max render time in ms */
  readonly maxRenderTime?: number
}

/** A single budget violation */
export interface BudgetViolation {
  /** Metric that violated the budget */
  readonly metric: string
  /** Budget threshold */
  readonly budget: number
  /** Actual measured value */
  readonly actual: number
  /** Severity: warning if within 20% over, error if more */
  readonly severity: 'warning' | 'error'
}

/** Result of checking metrics against a budget */
export interface BudgetCheckResult {
  /** Whether all metrics passed the budget */
  readonly passed: boolean
  /** List of violations (empty if passed) */
  readonly violations: readonly BudgetViolation[]
  /** Timestamp when the check was performed */
  readonly checkedAt: number
}

// ============================================================
// DEFAULT BUDGET
// ============================================================

/**
 * Default performance budgets based on web.dev "good" thresholds.
 */
export const DEFAULT_BUDGET: Readonly<PerformanceBudget> = {
  lcp: 2500,
  fid: 100,
  cls: 0.1,
  fcp: 1800,
  ttfb: 800,
  maxRenderTime: 100,
} as const

// ============================================================
// BUDGET CHECKER
// ============================================================

/**
 * Multiplier above the budget threshold that escalates a
 * violation from "warning" to "error". A value 20% over
 * budget is a warning; more than 20% over is an error.
 */
const ERROR_MULTIPLIER = 1.2

/** Mapping from budget keys to the metric keys used in check() */
const BUDGET_METRIC_MAP: ReadonlyMap<keyof PerformanceBudget, string> = new Map<
  keyof PerformanceBudget,
  string
>([
  ['lcp', 'lcp'],
  ['fid', 'fid'],
  ['cls', 'cls'],
  ['fcp', 'fcp'],
  ['ttfb', 'ttfb'],
  ['maxBundleSize', 'maxBundleSize'],
  ['maxRenderTime', 'maxRenderTime'],
])

/**
 * Checks measured performance metrics against a budget.
 *
 * Uses default web.dev "good" thresholds unless overridden.
 * Violations are classified as "warning" (within 20% over)
 * or "error" (more than 20% over).
 */
export class BudgetChecker {
  private budget: PerformanceBudget

  /**
   * @param budget - Custom budget thresholds (merged with defaults)
   */
  constructor(budget?: PerformanceBudget) {
    this.budget = budget ? { ...DEFAULT_BUDGET, ...budget } : { ...DEFAULT_BUDGET }
  }

  /**
   * Check a set of metrics against the current budget.
   *
   * @param metrics - Map of metric name to measured value
   * @returns Check result with pass/fail and any violations
   */
  check(metrics: Partial<Record<string, number>>): BudgetCheckResult {
    const violations: BudgetViolation[] = []

    for (const [budgetKey, metricKey] of BUDGET_METRIC_MAP) {
      const threshold = this.budget[budgetKey]
      if (threshold === undefined) {
        continue
      }

      const actual = metrics[metricKey]
      if (actual === undefined) {
        continue
      }

      if (actual > threshold) {
        const severity: 'warning' | 'error' =
          actual > threshold * ERROR_MULTIPLIER ? 'error' : 'warning'

        violations.push({
          metric: metricKey,
          budget: threshold,
          actual,
          severity,
        })
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      checkedAt: Date.now(),
    }
  }

  /**
   * Update the performance budget.
   *
   * Merges the provided values with the existing budget.
   *
   * @param budget - Partial budget to merge
   */
  setBudget(budget: Partial<PerformanceBudget>): void {
    this.budget = { ...this.budget, ...budget }
  }

  /**
   * Get the current performance budget.
   *
   * @returns Readonly copy of the budget
   */
  getBudget(): Readonly<PerformanceBudget> {
    return { ...this.budget }
  }
}

// ============================================================
// FACTORY
// ============================================================

/**
 * Create a new BudgetChecker instance.
 *
 * @param budget - Optional custom budget thresholds
 * @returns A new BudgetChecker
 */
export function createBudgetChecker(budget?: PerformanceBudget): BudgetChecker {
  return new BudgetChecker(budget)
}
