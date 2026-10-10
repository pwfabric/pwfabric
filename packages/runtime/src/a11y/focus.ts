/**
 * Focus Management Utilities
 *
 * Provides focus trapping, focus restoration, and skip-link helpers
 * for accessible modal dialogs, drawers, and navigation patterns.
 * All DOM operations are SSR-safe.
 *
 * @module @pwfabric/runtime/a11y/focus
 */

// ============================================================
// TYPES
// ============================================================

/** Configuration for a focus trap */
export interface FocusTrapConfig {
  /** The container element to trap focus within */
  container: HTMLElement | null
  /** Initial element to focus, or a CSS selector to find it */
  initialFocus?: HTMLElement | string
  /** Whether to return focus to the previously focused element on deactivate (default true) */
  returnFocus?: boolean
  /** Whether pressing Escape deactivates the trap (default true) */
  escapeDeactivates?: boolean
}

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Selector for elements that can receive focus.
 * Covers interactive HTML elements and elements with explicit tabindex.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable]',
  'details > summary',
  'audio[controls]',
  'video[controls]',
].join(', ')

// ============================================================
// FOCUS TRAP MANAGER
// ============================================================

/**
 * Manages focus trapping within a container element.
 *
 * When activated, Tab and Shift+Tab keypresses are intercepted to
 * keep focus cycling within the container's focusable elements.
 * Optionally deactivates on Escape key press.
 *
 * Used for modal dialogs, slide-over panels, and other overlay patterns
 * that require focus to remain within the component for accessibility.
 */
export class FocusTrapManager {
  private active: boolean
  private config: FocusTrapConfig | null
  private previousFocus: Element | null
  private readonly boundHandleKeyDown: (event: KeyboardEvent) => void

  constructor() {
    this.active = false
    this.config = null
    this.previousFocus = null
    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
  }

  /**
   * Activate the focus trap with the given configuration.
   *
   * Saves the currently focused element, attaches a keydown listener,
   * and moves focus to the initial focus target (if specified) or the
   * first focusable element in the container.
   *
   * @param config - Focus trap configuration
   */
  activate(config: FocusTrapConfig): void {
    if (typeof document === 'undefined') return
    if (!config.container) return
    if (this.active) {
      this.deactivate()
    }

    this.config = {
      ...config,
      returnFocus: config.returnFocus ?? true,
      escapeDeactivates: config.escapeDeactivates ?? true,
    }
    this.previousFocus = document.activeElement
    this.active = true

    document.addEventListener('keydown', this.boundHandleKeyDown)

    // Determine and apply initial focus
    const initialTarget = this.resolveInitialFocus()
    if (initialTarget) {
      initialTarget.focus()
    } else {
      // Fall back to the first focusable element
      const focusable = this.getFocusableElements()
      if (focusable.length > 0) {
        focusable[0]?.focus()
      }
    }
  }

  /**
   * Deactivate the focus trap and optionally return focus to the
   * previously focused element.
   */
  deactivate(): void {
    if (typeof document === 'undefined') return
    if (!this.active) return

    this.active = false
    document.removeEventListener('keydown', this.boundHandleKeyDown)

    if (this.config?.returnFocus && this.previousFocus instanceof HTMLElement) {
      this.previousFocus.focus()
    }

    this.config = null
    this.previousFocus = null
  }

  /**
   * Check whether the focus trap is currently active.
   *
   * @returns `true` if the trap is active
   */
  isActive(): boolean {
    return this.active
  }

  /**
   * Dispose of the focus trap, deactivating it and cleaning up resources.
   */
  dispose(): void {
    this.deactivate()
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Resolve the initial focus target from the config.
   * Handles both HTMLElement references and CSS selector strings.
   */
  private resolveInitialFocus(): HTMLElement | null {
    if (!this.config?.initialFocus || !this.config.container) return null

    if (typeof this.config.initialFocus === 'string') {
      return this.config.container.querySelector<HTMLElement>(this.config.initialFocus)
    }

    return this.config.initialFocus
  }

  /**
   * Get all focusable elements within the trap container, sorted in DOM order.
   *
   * @returns Array of focusable HTMLElements
   */
  private getFocusableElements(): HTMLElement[] {
    if (!this.config?.container) return []

    const elements = this.config.container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    return Array.from(elements).filter((el) => {
      // Filter out elements that are not visible
      return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
    })
  }

  /**
   * Handle keydown events to trap Tab focus and optionally deactivate on Escape.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.active || !this.config) return

    // Handle Escape
    if (event.key === 'Escape' && this.config.escapeDeactivates) {
      event.preventDefault()
      this.deactivate()
      return
    }

    // Handle Tab / Shift+Tab
    if (event.key !== 'Tab') return

    const focusable = this.getFocusableElements()
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }

    const firstElement = focusable[0]
    const lastElement = focusable[focusable.length - 1]

    if (event.shiftKey) {
      // Shift+Tab: wrap from first to last
      if (
        document.activeElement === firstElement ||
        !this.config.container?.contains(document.activeElement)
      ) {
        event.preventDefault()
        lastElement?.focus()
      }
    } else {
      // Tab: wrap from last to first
      if (
        document.activeElement === lastElement ||
        !this.config.container?.contains(document.activeElement)
      ) {
        event.preventDefault()
        firstElement?.focus()
      }
    }
  }
}

// ============================================================
// FOCUS RESTORER
// ============================================================

/**
 * Manages a stack of focus positions for nested focus contexts.
 *
 * Useful when opening nested dialogs or panels where each level
 * needs to save and restore the previous focus target.
 */
export class FocusRestorer {
  private stack: Element[]

  constructor() {
    this.stack = []
  }

  /**
   * Save the currently focused element onto the stack.
   */
  save(): void {
    if (typeof document === 'undefined') return

    const activeElement = document.activeElement
    if (activeElement) {
      this.stack.push(activeElement)
    }
  }

  /**
   * Pop the most recently saved element from the stack and restore focus to it.
   */
  restore(): void {
    if (typeof document === 'undefined') return

    const element = this.stack.pop()
    if (element instanceof HTMLElement) {
      element.focus()
    }
  }
}

// ============================================================
// SKIP LINK HELPER
// ============================================================

/**
 * Create a skip-to-content link configuration.
 *
 * Returns the href, label, and click handler for a skip link that
 * jumps focus to the element with the specified ID. The target element
 * is given a `tabindex` of `-1` if it does not already have one so
 * it can receive programmatic focus.
 *
 * @param targetId - The ID of the element to skip to
 * @returns Skip link configuration object
 */
export function createSkipLink(targetId: string): {
  href: string
  label: string
  handleClick: (e: Event) => void
} {
  return {
    href: `#${targetId}`,
    label: 'Skip to content',
    handleClick: (e: Event) => {
      if (typeof document === 'undefined') return

      e.preventDefault()
      const target = document.getElementById(targetId)
      if (target) {
        // Ensure the element can receive focus
        if (!target.hasAttribute('tabindex')) {
          target.setAttribute('tabindex', '-1')
        }
        target.focus()
        target.scrollIntoView({ behavior: 'smooth' })
      }
    },
  }
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a new FocusTrapManager instance.
 *
 * @returns A new FocusTrapManager
 */
export function createFocusTrap(): FocusTrapManager {
  return new FocusTrapManager()
}

/**
 * Create a new FocusRestorer instance.
 *
 * @returns A new FocusRestorer
 */
export function createFocusRestorer(): FocusRestorer {
  return new FocusRestorer()
}
