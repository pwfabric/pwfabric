/**
 * BudgetChecker Tests
 *
 * @module @pwfabric/runtime/perf/__tests__/budget
 */

import { describe, it, expect } from 'vitest'
import { BudgetChecker, createBudgetChecker, DEFAULT_BUDGET } from '../budget.js'

describe('DEFAULT_BUDGET', () => {
  it('has expected default thresholds', () => {
    expect(DEFAULT_BUDGET.lcp).toBe(2500)
    expect(DEFAULT_BUDGET.fid).toBe(100)
    expect(DEFAULT_BUDGET.cls).toBe(0.1)
    expect(DEFAULT_BUDGET.fcp).toBe(1800)
    expect(DEFAULT_BUDGET.ttfb).toBe(800)
    expect(DEFAULT_BUDGET.maxRenderTime).toBe(100)
  })
})

describe('BudgetChecker', () => {
  describe('constructor', () => {
    it('uses default budget when no argument provided', () => {
      const checker = new BudgetChecker()
      const budget = checker.getBudget()
      expect(budget.lcp).toBe(2500)
    })

    it('merges custom budget with defaults', () => {
      const checker = new BudgetChecker({ lcp: 3000 })
      const budget = checker.getBudget()
      expect(budget.lcp).toBe(3000)
      expect(budget.fid).toBe(100) // default preserved
    })
  })

  describe('check()', () => {
    it('returns passed=true when no metrics provided', () => {
      const checker = new BudgetChecker()
      const result = checker.check({})
      expect(result.passed).toBe(true)
      expect(result.violations).toHaveLength(0)
      expect(typeof result.checkedAt).toBe('number')
    })

    it('passes when metrics are within budget', () => {
      const checker = new BudgetChecker()
      const result = checker.check({
        lcp: 2000,
        fid: 80,
        cls: 0.05,
        fcp: 1500,
        ttfb: 600,
      })
      expect(result.passed).toBe(true)
      expect(result.violations).toHaveLength(0)
    })

    it('detects warning violation (within 20% over)', () => {
      const checker = new BudgetChecker()
      // lcp budget is 2500; 2600 is 4% over → warning
      const result = checker.check({ lcp: 2600 })
      expect(result.passed).toBe(false)
      expect(result.violations).toHaveLength(1)
      const violation = result.violations[0]
      expect(violation.metric).toBe('lcp')
      expect(violation.severity).toBe('warning')
      expect(violation.budget).toBe(2500)
      expect(violation.actual).toBe(2600)
    })

    it('detects error violation (more than 20% over)', () => {
      const checker = new BudgetChecker()
      // lcp budget is 2500; 3100 is 24% over → error
      const result = checker.check({ lcp: 3100 })
      expect(result.passed).toBe(false)
      expect(result.violations).toHaveLength(1)
      expect(result.violations[0]?.severity).toBe('error')
    })

    it('handles maxBundleSize metric', () => {
      const checker = new BudgetChecker({ maxBundleSize: 100000 })
      const result = checker.check({ maxBundleSize: 200000 })
      expect(result.passed).toBe(false)
      expect(result.violations[0]?.metric).toBe('maxBundleSize')
    })

    it('skips metrics not present in the check input', () => {
      const checker = new BudgetChecker()
      const result = checker.check({ lcp: 1000 }) // only lcp, rest skipped
      expect(result.passed).toBe(true)
    })

    it('skips budget keys with undefined threshold', () => {
      // maxBundleSize is undefined in DEFAULT_BUDGET
      const checker = new BudgetChecker()
      const result = checker.check({ maxBundleSize: 999999 })
      expect(result.passed).toBe(true) // no threshold to violate
    })

    it('detects multiple violations', () => {
      const checker = new BudgetChecker()
      const result = checker.check({ lcp: 5000, fid: 500 })
      expect(result.violations.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('setBudget()', () => {
    it('merges partial budget update', () => {
      const checker = new BudgetChecker()
      checker.setBudget({ lcp: 1000 })
      const budget = checker.getBudget()
      expect(budget.lcp).toBe(1000)
      expect(budget.fid).toBe(100) // still default
    })
  })

  describe('getBudget()', () => {
    it('returns a copy (not a reference)', () => {
      const checker = new BudgetChecker()
      const budget = checker.getBudget()
      ;(budget as Record<string, unknown>).lcp = 9999
      expect(checker.getBudget().lcp).toBe(2500) // original unchanged
    })
  })
})

describe('createBudgetChecker()', () => {
  it('creates a BudgetChecker instance', () => {
    const checker = createBudgetChecker()
    expect(checker).toBeInstanceOf(BudgetChecker)
  })

  it('passes custom budget', () => {
    const checker = createBudgetChecker({ lcp: 5000 })
    expect(checker.getBudget().lcp).toBe(5000)
  })
})
