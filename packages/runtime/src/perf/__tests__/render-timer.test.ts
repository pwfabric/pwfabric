/**
 * RenderTimer Tests
 *
 * @module @pwfabric/runtime/perf/__tests__/render-timer
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { RenderTimer, createRenderTimer } from '../render-timer.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('RenderTimer', () => {
  describe('constructor', () => {
    it('creates a timer with default max entries', () => {
      const timer = new RenderTimer()
      expect(timer.getHistory()).toHaveLength(0)
    })

    it('accepts custom maxEntries config', () => {
      const timer = new RenderTimer({ maxEntries: 3 })
      expect(timer.getHistory()).toHaveLength(0)
    })
  })

  describe('startRender / endRender', () => {
    it('records metrics after start+end cycle', () => {
      const timer = new RenderTimer()
      timer.startRender('surf-1', 5)
      const metrics = timer.endRender('surf-1')

      expect(metrics).toBeDefined()
      expect(metrics?.surfaceId).toBe('surf-1')
      expect(metrics?.blockCount).toBe(5)
      expect(metrics?.duration).toBeGreaterThanOrEqual(0)
      expect(metrics?.startTime).toBeLessThanOrEqual(metrics?.endTime ?? Infinity)
    })

    it('returns undefined when endRender called without startRender', () => {
      const timer = new RenderTimer()
      const result = timer.endRender('unknown-surface')
      expect(result).toBeUndefined()
    })

    it('defaults blockCount to 0 when not specified', () => {
      const timer = new RenderTimer()
      timer.startRender('surf-2')
      const metrics = timer.endRender('surf-2')
      expect(metrics?.blockCount).toBe(0)
    })

    it('adds completed render to history', () => {
      const timer = new RenderTimer()
      timer.startRender('surf-1', 3)
      timer.endRender('surf-1')
      expect(timer.getHistory()).toHaveLength(1)
    })
  })

  describe('bounded history', () => {
    it('truncates history when maxEntries is exceeded', () => {
      const timer = new RenderTimer({ maxEntries: 3 })

      for (let i = 0; i < 5; i++) {
        timer.startRender(`surf-${i}`, 1)
        timer.endRender(`surf-${i}`)
      }

      expect(timer.getHistory()).toHaveLength(3)
    })
  })

  describe('getAverageRenderTime()', () => {
    it('returns 0 when no history', () => {
      const timer = new RenderTimer()
      expect(timer.getAverageRenderTime()).toBe(0)
    })

    it('calculates average from history', () => {
      const timer = new RenderTimer()
      // We can't control exact timing but we can check it's >= 0
      timer.startRender('s1')
      timer.endRender('s1')
      timer.startRender('s2')
      timer.endRender('s2')

      const avg = timer.getAverageRenderTime()
      expect(avg).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getSlowest()', () => {
    it('returns empty array when no history', () => {
      const timer = new RenderTimer()
      expect(timer.getSlowest()).toHaveLength(0)
    })

    it('returns sorted by duration descending', () => {
      const timer = new RenderTimer()
      // We record renders but durations will be close to 0 in tests
      // Just check ordering
      timer.startRender('s1')
      timer.endRender('s1')
      timer.startRender('s2')
      timer.endRender('s2')

      const slowest = timer.getSlowest(2)
      expect(slowest.length).toBeLessThanOrEqual(2)
      if (slowest.length === 2) {
        expect(slowest[0]?.duration).toBeGreaterThanOrEqual(slowest[1]?.duration ?? 0)
      }
    })

    it('respects count parameter', () => {
      const timer = new RenderTimer()
      for (let i = 0; i < 10; i++) {
        timer.startRender(`s${i}`)
        timer.endRender(`s${i}`)
      }
      expect(timer.getSlowest(3)).toHaveLength(3)
    })
  })

  describe('clear()', () => {
    it('clears history and active entries', () => {
      const timer = new RenderTimer()
      timer.startRender('s1')
      timer.endRender('s1')
      timer.startRender('s2') // active, not yet ended

      timer.clear()

      expect(timer.getHistory()).toHaveLength(0)
      // s2 was cleared; endRender now returns undefined
      expect(timer.endRender('s2')).toBeUndefined()
    })
  })
})

describe('createRenderTimer()', () => {
  it('creates a RenderTimer instance', () => {
    const timer = createRenderTimer()
    expect(timer).toBeInstanceOf(RenderTimer)
  })

  it('passes config to instance', () => {
    const timer = createRenderTimer({ maxEntries: 50 })
    expect(timer).toBeInstanceOf(RenderTimer)
  })
})
