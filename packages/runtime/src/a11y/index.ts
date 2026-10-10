/**
 * Accessibility (a11y) Module
 *
 * Provides runtime accessibility utilities for the PWFabric platform:
 * - Screen reader announcements via ARIA live regions
 * - Focus trapping, restoration, and skip links
 * - Keyboard navigation for composite widgets
 * - WCAG 2.0 color contrast checking
 *
 * All DOM operations are SSR-safe (no-op when `document` is unavailable).
 *
 * @module @pwfabric/runtime/a11y
 */

// Announcer - Screen reader live region management
export type { AnnouncementLevel, LiveRegionConfig } from './announcer.js'
export { LiveRegionAnnouncer, createAnnouncer } from './announcer.js'

// Focus - Focus management utilities
export type { FocusTrapConfig } from './focus.js'
export {
  FocusTrapManager,
  FocusRestorer,
  createSkipLink,
  createFocusTrap,
  createFocusRestorer,
} from './focus.js'

// Keyboard - Keyboard navigation manager
export type { ArrowDirection, KeyboardNavConfig } from './keyboard.js'
export {
  KeyboardNavigationManager,
  RovingTabIndex,
  createKeyboardNav,
  createRovingTabIndex,
} from './keyboard.js'

// Contrast - WCAG color contrast checking
export type { ContrastResult } from './contrast.js'
export { hexToRgb, relativeLuminance, contrastRatio, checkContrast, meetsWCAG } from './contrast.js'
