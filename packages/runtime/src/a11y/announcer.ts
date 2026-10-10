/**
 * Screen Reader Live Region Announcer
 *
 * Manages ARIA live regions for dynamic screen reader announcements.
 * Works in both browser and SSR environments (SSR is a safe no-op).
 *
 * @module @pwfabric/runtime/a11y/announcer
 */

// ============================================================
// TYPES
// ============================================================

/** Politeness level for ARIA live region announcements */
export type AnnouncementLevel = 'polite' | 'assertive'

/** Configuration for a live region */
export interface LiveRegionConfig {
  /** Politeness level of the announcement */
  level: AnnouncementLevel
  /** Milliseconds before the announcement is cleared (default 5000) */
  timeout?: number
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_TIMEOUT = 5000
const LIVE_REGION_STYLES =
  'position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;'

// ============================================================
// LIVE REGION STATE
// ============================================================

interface LiveRegionState {
  element: HTMLElement | null
  timer?: ReturnType<typeof setTimeout> | undefined
}

// ============================================================
// LIVE REGION ANNOUNCER
// ============================================================

/**
 * Manages ARIA live regions for screen reader announcements.
 *
 * Creates visually hidden DOM elements with `aria-live` attributes
 * that screen readers monitor for content changes. Supports both
 * `polite` (waits for idle) and `assertive` (interrupts) modes.
 *
 * In SSR environments, all operations are safe no-ops.
 */
export class LiveRegionAnnouncer {
  private regions: Map<AnnouncementLevel, LiveRegionState>

  constructor() {
    this.regions = new Map()
  }

  /**
   * Create a live region DOM element for the given politeness level.
   * In SSR environments this is a no-op.
   *
   * @param level - The ARIA live politeness level
   */
  createRegion(level: AnnouncementLevel): void {
    if (typeof document === 'undefined') return
    if (this.regions.has(level)) return

    const element = document.createElement('div')
    element.setAttribute('aria-live', level)
    element.setAttribute('aria-atomic', 'true')
    element.setAttribute('role', 'status')
    element.setAttribute('style', LIVE_REGION_STYLES)
    element.setAttribute('data-pw-a11y-announcer', level)

    document.body.appendChild(element)

    this.regions.set(level, { element })
  }

  /**
   * Announce a message to screen readers via the specified live region.
   *
   * If the region has not been created yet, it will be created automatically.
   * The message is cleared after the configured timeout (default 5000ms).
   *
   * @param message - The text to announce
   * @param level - The politeness level (default 'polite')
   * @param timeout - Milliseconds before clearing (default 5000)
   */
  announce(
    message: string,
    level: AnnouncementLevel = 'polite',
    timeout: number = DEFAULT_TIMEOUT
  ): void {
    if (typeof document === 'undefined') return

    if (!this.regions.has(level)) {
      this.createRegion(level)
    }

    const region = this.regions.get(level)
    if (!region?.element) return

    // Clear any pending timer
    if (region.timer !== undefined) {
      clearTimeout(region.timer)
    }

    // Clear and re-set to force screen reader re-announcement
    region.element.textContent = ''

    // Use a microtask to ensure the empty state is processed before the new content
    requestAnimationFrame(() => {
      if (region.element) {
        region.element.textContent = message
      }
    })

    // Auto-clear after timeout
    region.timer = setTimeout(() => {
      this.clear(level)
    }, timeout)
  }

  /**
   * Clear the announced message for a specific level or all levels.
   *
   * @param level - The level to clear, or undefined to clear all
   */
  clear(level?: AnnouncementLevel): void {
    if (typeof document === 'undefined') return

    if (level !== undefined) {
      const region = this.regions.get(level)
      if (region) {
        if (region.timer !== undefined) {
          clearTimeout(region.timer)
          region.timer = undefined
        }
        if (region.element) {
          region.element.textContent = ''
        }
      }
    } else {
      for (const regionLevel of this.regions.keys()) {
        this.clear(regionLevel)
      }
    }
  }

  /**
   * Remove all live region DOM elements and clear timers.
   * Call this when the announcer is no longer needed.
   */
  dispose(): void {
    for (const [, region] of this.regions) {
      if (region.timer !== undefined) {
        clearTimeout(region.timer)
      }
      if (region.element && typeof document !== 'undefined') {
        region.element.remove()
      }
    }
    this.regions.clear()
  }
}

// ============================================================
// FACTORY FUNCTION
// ============================================================

/**
 * Create a new LiveRegionAnnouncer instance.
 *
 * @returns A new LiveRegionAnnouncer
 */
export function createAnnouncer(): LiveRegionAnnouncer {
  return new LiveRegionAnnouncer()
}
