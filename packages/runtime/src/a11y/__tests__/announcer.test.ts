/**
 * LiveRegionAnnouncer Tests
 *
 * @vitest-environment jsdom
 * @module @pwfabric/runtime/a11y/__tests__/announcer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { LiveRegionAnnouncer, createAnnouncer } from '../announcer.js'

describe('LiveRegionAnnouncer', () => {
  let announcer: LiveRegionAnnouncer

  beforeEach(() => {
    // RAF executes synchronously in tests
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
    vi.useFakeTimers()
    announcer = new LiveRegionAnnouncer()
  })

  afterEach(() => {
    announcer.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    // Clean up any leftover DOM nodes
    document.querySelectorAll('[data-pw-a11y-announcer]').forEach((el) => el.remove())
  })

  describe('createRegion', () => {
    it('should create a polite live region in the DOM', () => {
      announcer.createRegion('polite')
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el).toBeTruthy()
      expect(el?.getAttribute('aria-live')).toBe('polite')
      expect(el?.getAttribute('aria-atomic')).toBe('true')
      expect(el?.getAttribute('role')).toBe('status')
    })

    it('should create an assertive live region in the DOM', () => {
      announcer.createRegion('assertive')
      const el = document.querySelector('[data-pw-a11y-announcer="assertive"]')
      expect(el).toBeTruthy()
      expect(el?.getAttribute('aria-live')).toBe('assertive')
    })

    it('should not create duplicate regions for same level', () => {
      announcer.createRegion('polite')
      announcer.createRegion('polite')
      const els = document.querySelectorAll('[data-pw-a11y-announcer="polite"]')
      expect(els.length).toBe(1)
    })
  })

  describe('announce', () => {
    it('should create region automatically if not already created', () => {
      announcer.announce('Hello')
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el).toBeTruthy()
    })

    it('should set text content (RAF runs synchronously in test)', () => {
      announcer.announce('Test message')
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el?.textContent).toBe('Test message')
    })

    it('should use assertive level when specified', () => {
      announcer.announce('Urgent!', 'assertive')
      const el = document.querySelector('[data-pw-a11y-announcer="assertive"]')
      expect(el?.textContent).toBe('Urgent!')
    })

    it('should auto-clear message after default timeout', () => {
      announcer.announce('Auto clear')
      vi.advanceTimersByTime(6000) // past default 5000ms
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el?.textContent).toBe('')
    })

    it('should auto-clear after custom timeout', () => {
      announcer.announce('Custom timeout', 'polite', 1000)
      vi.advanceTimersByTime(1100)
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el?.textContent).toBe('')
    })

    it('should clear pending timer on re-announce', () => {
      announcer.announce('First')
      announcer.announce('Second')
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el?.textContent).toBe('Second')
    })
  })

  describe('clear', () => {
    it('should clear message for specific level', () => {
      announcer.announce('Hello')
      vi.runAllTimers()
      announcer.clear('polite')
      const el = document.querySelector('[data-pw-a11y-announcer="polite"]')
      expect(el?.textContent).toBe('')
    })

    it('should clear all levels when called without argument', () => {
      announcer.announce('Polite', 'polite')
      announcer.announce('Assertive', 'assertive')
      vi.runAllTimers()
      announcer.clear()
      expect(document.querySelector('[data-pw-a11y-announcer="polite"]')?.textContent).toBe('')
      expect(document.querySelector('[data-pw-a11y-announcer="assertive"]')?.textContent).toBe('')
    })

    it('should be a no-op for level with no region', () => {
      expect(() => announcer.clear('polite')).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('should remove all live region elements from DOM', () => {
      announcer.createRegion('polite')
      announcer.createRegion('assertive')
      announcer.dispose()
      expect(document.querySelector('[data-pw-a11y-announcer]')).toBeNull()
    })

    it('should clear all timers on dispose', () => {
      announcer.announce('Will be disposed')
      expect(() => {
        announcer.dispose()
        vi.runAllTimers()
      }).not.toThrow()
    })
  })

  describe('createAnnouncer factory', () => {
    it('should return a LiveRegionAnnouncer instance', () => {
      const a = createAnnouncer()
      expect(a).toBeInstanceOf(LiveRegionAnnouncer)
      a.dispose()
    })
  })
})
