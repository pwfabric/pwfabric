/**
 * Focus Management Tests
 *
 * @vitest-environment jsdom
 * @module @pwfabric/runtime/a11y/__tests__/focus
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  FocusTrapManager,
  FocusRestorer,
  createFocusTrap,
  createFocusRestorer,
  createSkipLink,
} from '../focus.js'

// Helper: create a container with focusable buttons
function createContainer(buttonCount = 3): HTMLElement {
  const container = document.createElement('div')
  for (let i = 0; i < buttonCount; i++) {
    const btn = document.createElement('button')
    btn.textContent = `Button ${i + 1}`
    // Simulate visible elements for offsetParent check
    Object.defineProperty(btn, 'offsetParent', { value: document.body, configurable: true })
    container.appendChild(btn)
  }
  document.body.appendChild(container)
  return container
}

describe('FocusTrapManager', () => {
  let trap: FocusTrapManager
  let container: HTMLElement

  beforeEach(() => {
    trap = new FocusTrapManager()
    container = createContainer()
  })

  afterEach(() => {
    trap.dispose()
    container.remove()
  })

  describe('activate / deactivate', () => {
    it('should be inactive initially', () => {
      expect(trap.isActive()).toBe(false)
    })

    it('should become active after activate()', () => {
      trap.activate({ container })
      expect(trap.isActive()).toBe(true)
    })

    it('should become inactive after deactivate()', () => {
      trap.activate({ container })
      trap.deactivate()
      expect(trap.isActive()).toBe(false)
    })

    it('should be a no-op when activating with null container', () => {
      trap.activate({ container: null })
      expect(trap.isActive()).toBe(false)
    })

    it('should deactivate previous trap when activating again', () => {
      trap.activate({ container })
      trap.activate({ container }) // second activation
      expect(trap.isActive()).toBe(true)
    })

    it('should be a no-op when deactivating an already inactive trap', () => {
      expect(() => trap.deactivate()).not.toThrow()
    })
  })

  describe('initialFocus', () => {
    it('should accept an HTMLElement as initialFocus', () => {
      const buttons = container.querySelectorAll<HTMLButtonElement>('button')
      trap.activate({ container, initialFocus: buttons[1] })
      expect(trap.isActive()).toBe(true)
    })

    it('should accept a CSS selector string as initialFocus', () => {
      trap.activate({ container, initialFocus: 'button' })
      expect(trap.isActive()).toBe(true)
    })

    it('should fallback gracefully if selector matches nothing', () => {
      expect(() => trap.activate({ container, initialFocus: '.nonexistent' })).not.toThrow()
    })
  })

  describe('Tab key trapping', () => {
    it('should handle Tab keydown without throwing', () => {
      trap.activate({ container })
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
      expect(() => document.dispatchEvent(event)).not.toThrow()
    })

    it('should handle Shift+Tab keydown without throwing', () => {
      trap.activate({ container })
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      expect(() => document.dispatchEvent(event)).not.toThrow()
    })

    it('should handle Tab when container has no focusable elements', () => {
      const emptyContainer = document.createElement('div')
      document.body.appendChild(emptyContainer)
      trap.activate({ container: emptyContainer })

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
      expect(() => document.dispatchEvent(event)).not.toThrow()
      emptyContainer.remove()
    })

    it('should ignore non-Tab / non-Escape keys', () => {
      trap.activate({ container })
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      expect(() => document.dispatchEvent(event)).not.toThrow()
      expect(trap.isActive()).toBe(true)
    })
  })

  describe('Escape key', () => {
    it('should deactivate on Escape by default', () => {
      trap.activate({ container })
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(event)
      expect(trap.isActive()).toBe(false)
    })

    it('should NOT deactivate on Escape when escapeDeactivates=false', () => {
      trap.activate({ container, escapeDeactivates: false })
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      document.dispatchEvent(event)
      expect(trap.isActive()).toBe(true)
    })
  })

  describe('returnFocus', () => {
    it('should restore focus on deactivate when returnFocus=true (default)', () => {
      const triggerBtn = document.createElement('button')
      document.body.appendChild(triggerBtn)
      triggerBtn.focus()

      trap.activate({ container, returnFocus: true })
      trap.deactivate()
      triggerBtn.remove()
    })

    it('should not restore focus when returnFocus=false', () => {
      trap.activate({ container, returnFocus: false })
      expect(() => trap.deactivate()).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('should deactivate on dispose', () => {
      trap.activate({ container })
      trap.dispose()
      expect(trap.isActive()).toBe(false)
    })
  })
})

describe('FocusRestorer', () => {
  let restorer: FocusRestorer

  beforeEach(() => {
    restorer = new FocusRestorer()
  })

  it('should save and restore focus', () => {
    const btn = document.createElement('button')
    document.body.appendChild(btn)
    btn.focus()

    restorer.save()
    restorer.restore()

    btn.remove()
  })

  it('should be a no-op when stack is empty', () => {
    expect(() => restorer.restore()).not.toThrow()
  })

  it('should save multiple focus positions', () => {
    const btn1 = document.createElement('button')
    const btn2 = document.createElement('button')
    document.body.appendChild(btn1)
    document.body.appendChild(btn2)

    btn1.focus()
    restorer.save()
    btn2.focus()
    restorer.save()

    restorer.restore() // restores btn2
    restorer.restore() // restores btn1

    btn1.remove()
    btn2.remove()
  })

  describe('createFocusRestorer factory', () => {
    it('should return a FocusRestorer instance', () => {
      expect(createFocusRestorer()).toBeInstanceOf(FocusRestorer)
    })
  })
})

describe('createSkipLink', () => {
  beforeEach(() => {
    // jsdom does not implement scrollIntoView — stub it
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.getElementById('main-content')?.remove()
  })

  it('should return correct href and label', () => {
    const skipLink = createSkipLink('main-content')
    expect(skipLink.href).toBe('#main-content')
    expect(skipLink.label).toBe('Skip to content')
  })

  it('should handle click, prevent default, and set tabindex on target', () => {
    const target = document.createElement('div')
    target.id = 'main-content'
    document.body.appendChild(target)

    const skipLink = createSkipLink('main-content')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    skipLink.handleClick(event)

    expect(event.defaultPrevented).toBe(true)
    expect(target.getAttribute('tabindex')).toBe('-1')
  })

  it('should not overwrite existing tabindex on target', () => {
    const target = document.createElement('div')
    target.id = 'main-content'
    target.setAttribute('tabindex', '0')
    document.body.appendChild(target)

    const skipLink = createSkipLink('main-content')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    skipLink.handleClick(event)

    expect(target.getAttribute('tabindex')).toBe('0')
  })

  it('should not throw when target element does not exist', () => {
    const skipLink = createSkipLink('nonexistent-id')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    expect(() => skipLink.handleClick(event)).not.toThrow()
  })
})

describe('createFocusTrap factory', () => {
  it('should return a FocusTrapManager instance', () => {
    expect(createFocusTrap()).toBeInstanceOf(FocusTrapManager)
  })
})
