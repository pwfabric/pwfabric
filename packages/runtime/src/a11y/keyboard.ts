/**
 * Keyboard Navigation Manager
 *
 * Provides arrow-key navigation for composite widgets (tabs, menus,
 * listboxes) and roving tabindex management. All DOM operations are
 * SSR-safe.
 *
 * @module @pwfabric/runtime/a11y/keyboard
 */

// ============================================================
// TYPES
// ============================================================

/** Direction(s) in which arrow key navigation operates */
export type ArrowDirection = 'horizontal' | 'vertical' | 'both'

/** Configuration for keyboard navigation */
export interface KeyboardNavConfig {
  /** Container element holding navigable items */
  container: HTMLElement | null
  /** Direction of arrow key navigation */
  direction: ArrowDirection
  /** Whether navigation wraps around at boundaries (default true) */
  loop?: boolean
  /** CSS selector for navigable items (default '[role="option"], [role="tab"], button, a') */
  selector?: string
}

// ============================================================
// CONSTANTS
// ============================================================

const DEFAULT_SELECTOR = '[role="option"], [role="tab"], button, a'

// ============================================================
// KEYBOARD NAVIGATION MANAGER
// ============================================================

/**
 * Manages keyboard navigation within a composite widget.
 *
 * Listens for arrow key events on a container and moves focus
 * between child items matching a configurable selector. Supports
 * horizontal, vertical, or both directional navigation with
 * optional looping at boundaries.
 */
export class KeyboardNavigationManager {
  private config: KeyboardNavConfig | null
  private currentIndex: number
  private readonly boundHandleKeyDown: (event: KeyboardEvent) => void

  constructor() {
    this.config = null
    this.currentIndex = 0
    this.boundHandleKeyDown = this.handleKeyDown.bind(this)
  }

  /**
   * Activate keyboard navigation on the given container.
   *
   * @param config - Keyboard navigation configuration
   */
  activate(config: KeyboardNavConfig): void {
    if (typeof document === 'undefined') return
    if (!config.container) return
    if (this.config) {
      this.deactivate()
    }

    this.config = {
      ...config,
      loop: config.loop ?? true,
      selector: config.selector ?? DEFAULT_SELECTOR,
    }
    this.currentIndex = 0

    this.config.container?.addEventListener('keydown', this.boundHandleKeyDown)
  }

  /**
   * Deactivate keyboard navigation and remove event listeners.
   */
  deactivate(): void {
    if (!this.config?.container) return

    this.config.container.removeEventListener('keydown', this.boundHandleKeyDown)
    this.config = null
    this.currentIndex = 0
  }

  /**
   * Move focus to the next item in the navigation order.
   */
  focusNext(): void {
    const items = this.getItems()
    if (items.length === 0) return

    const nextIndex = this.currentIndex + 1

    if (nextIndex >= items.length) {
      if (this.config?.loop) {
        this.currentIndex = 0
      } else {
        return
      }
    } else {
      this.currentIndex = nextIndex
    }

    items[this.currentIndex]?.focus()
  }

  /**
   * Move focus to the previous item in the navigation order.
   */
  focusPrevious(): void {
    const items = this.getItems()
    if (items.length === 0) return

    const prevIndex = this.currentIndex - 1

    if (prevIndex < 0) {
      if (this.config?.loop) {
        this.currentIndex = items.length - 1
      } else {
        return
      }
    } else {
      this.currentIndex = prevIndex
    }

    items[this.currentIndex]?.focus()
  }

  /**
   * Move focus to the first item.
   */
  focusFirst(): void {
    const items = this.getItems()
    if (items.length === 0) return

    this.currentIndex = 0
    items[0]?.focus()
  }

  /**
   * Move focus to the last item.
   */
  focusLast(): void {
    const items = this.getItems()
    if (items.length === 0) return

    this.currentIndex = items.length - 1
    items[this.currentIndex]?.focus()
  }

  /**
   * Get the current focused item index.
   *
   * @returns The zero-based index of the currently focused item
   */
  getCurrentIndex(): number {
    return this.currentIndex
  }

  /**
   * Dispose of the keyboard navigation manager, removing all listeners.
   */
  dispose(): void {
    this.deactivate()
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Handle keydown events for arrow key navigation and Home/End support.
   */
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.config) return

    const { direction } = this.config
    let handled = false

    switch (event.key) {
      case 'ArrowRight':
        if (direction === 'horizontal' || direction === 'both') {
          this.focusNext()
          handled = true
        }
        break

      case 'ArrowLeft':
        if (direction === 'horizontal' || direction === 'both') {
          this.focusPrevious()
          handled = true
        }
        break

      case 'ArrowDown':
        if (direction === 'vertical' || direction === 'both') {
          this.focusNext()
          handled = true
        }
        break

      case 'ArrowUp':
        if (direction === 'vertical' || direction === 'both') {
          this.focusPrevious()
          handled = true
        }
        break

      case 'Home':
        this.focusFirst()
        handled = true
        break

      case 'End':
        this.focusLast()
        handled = true
        break
    }

    if (handled) {
      event.preventDefault()
    }
  }

  /**
   * Query navigable items from the container, filtered to visible elements.
   *
   * @returns Array of focusable HTMLElements within the container
   */
  private getItems(): HTMLElement[] {
    if (!this.config?.container) return []

    const selector = this.config.selector ?? DEFAULT_SELECTOR
    const elements = this.config.container.querySelectorAll<HTMLElement>(selector)

    return Array.from(elements).filter((el) => {
      // Exclude disabled and hidden elements
      if (el.hasAttribute('disabled')) return false
      if (el.getAttribute('aria-hidden') === 'true') return false
      return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0
    })
  }
}

// ============================================================
// ROVING TABINDEX
// ============================================================

/**
 * Manages roving tabindex for composite widgets.
 *
 * In the roving tabindex pattern, only one item within a group
 * has `tabindex="0"` (making it tabbable), while all other items
 * have `tabindex="-1"`. This allows the group to participate in
 * the page tab order as a single stop, with arrow keys used to
 * navigate between items within the group.
 *
 * @see https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_roving_tabindex
 */
export class RovingTabIndex {
  private container: HTMLElement | null
  private selector: string

  /**
   * @param selector - CSS selector for items managed by roving tabindex
   */
  constructor(selector?: string) {
    this.container = null
    this.selector = selector ?? DEFAULT_SELECTOR
  }

  /**
   * Attach roving tabindex management to a container.
   *
   * Sets `tabindex="-1"` on all matching items except the first,
   * which gets `tabindex="0"`.
   *
   * @param container - The container element
   */
  attach(container: HTMLElement): void {
    if (typeof document === 'undefined') return

    this.container = container
    const items = this.getItems()

    items.forEach((item, index) => {
      item.setAttribute('tabindex', index === 0 ? '0' : '-1')
    })
  }

  /**
   * Detach roving tabindex management, restoring all items to `tabindex="0"`.
   */
  detach(): void {
    if (!this.container) return

    const items = this.getItems()
    items.forEach((item) => {
      item.setAttribute('tabindex', '0')
    })

    this.container = null
  }

  /**
   * Set a specific element as the active (tabbable) item.
   *
   * The target receives `tabindex="0"` and all sibling items
   * receive `tabindex="-1"`.
   *
   * @param element - The element to make active
   */
  setActive(element: HTMLElement): void {
    if (!this.container) return

    const items = this.getItems()
    for (const item of items) {
      item.setAttribute('tabindex', item === element ? '0' : '-1')
    }
  }

  /**
   * Dispose of the roving tabindex manager.
   */
  dispose(): void {
    this.detach()
  }

  // ============================================================
  // PRIVATE METHODS
  // ============================================================

  /**
   * Query managed items from the container.
   */
  private getItems(): HTMLElement[] {
    if (!this.container) return []
    return Array.from(this.container.querySelectorAll<HTMLElement>(this.selector))
  }
}

// ============================================================
// FACTORY FUNCTIONS
// ============================================================

/**
 * Create a new KeyboardNavigationManager instance.
 *
 * @returns A new KeyboardNavigationManager
 */
export function createKeyboardNav(): KeyboardNavigationManager {
  return new KeyboardNavigationManager()
}

/**
 * Create a new RovingTabIndex instance.
 *
 * @param selector - CSS selector for managed items
 * @returns A new RovingTabIndex
 */
export function createRovingTabIndex(selector?: string): RovingTabIndex {
  return new RovingTabIndex(selector)
}
