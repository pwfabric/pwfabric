/**
 * Keyboard Navigation Tests
 *
 * @vitest-environment jsdom
 * @module @pwfabric/runtime/a11y/__tests__/keyboard
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  KeyboardNavigationManager,
  RovingTabIndex,
  createKeyboardNav,
  createRovingTabIndex,
} from '../keyboard.js'

// Helper: create a container with N buttons
function createContainer(count = 4): HTMLElement {
  const container = document.createElement('div')
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button')
    btn.textContent = `Item ${i + 1}`
    Object.defineProperty(btn, 'offsetParent', { value: document.body, configurable: true })
    container.appendChild(btn)
  }
  document.body.appendChild(container)
  return container
}

function fireKey(container: HTMLElement, key: string): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  container.dispatchEvent(event)
}

describe('KeyboardNavigationManager', () => {
  let nav: KeyboardNavigationManager
  let container: HTMLElement

  beforeEach(() => {
    nav = new KeyboardNavigationManager()
    container = createContainer()
  })

  afterEach(() => {
    nav.dispose()
    container.remove()
  })

  describe('activate / deactivate', () => {
    it('should activate with container', () => {
      nav.activate({ container, direction: 'horizontal' })
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should be a no-op when container is null', () => {
      expect(() => nav.activate({ container: null, direction: 'horizontal' })).not.toThrow()
    })

    it('should deactivate existing nav before re-activating', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.activate({ container, direction: 'vertical' })
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should deactivate cleanly', () => {
      nav.activate({ container, direction: 'both' })
      nav.deactivate()
      // After deactivate, arrow keys should not be handled
      fireKey(container, 'ArrowRight')
      expect(nav.getCurrentIndex()).toBe(0)
    })
  })

  describe('focusNext / focusPrevious', () => {
    it('should move to next item', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.focusNext()
      expect(nav.getCurrentIndex()).toBe(1)
    })

    it('should loop from last to first when loop=true', () => {
      nav.activate({ container, direction: 'horizontal', loop: true })
      nav.focusNext()
      nav.focusNext()
      nav.focusNext()
      nav.focusNext() // wraps to 0
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should not advance past last when loop=false', () => {
      const singleContainer = createContainer(1)
      nav.activate({ container: singleContainer, direction: 'horizontal', loop: false })
      nav.focusNext()
      expect(nav.getCurrentIndex()).toBe(0)
      singleContainer.remove()
    })

    it('should move to previous item', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.focusNext()
      nav.focusPrevious()
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should loop from first to last when going previous with loop=true', () => {
      nav.activate({ container, direction: 'vertical', loop: true })
      nav.focusPrevious() // wraps to last (index 3)
      expect(nav.getCurrentIndex()).toBe(3)
    })

    it('should not go before first when loop=false', () => {
      nav.activate({ container, direction: 'vertical', loop: false })
      nav.focusPrevious()
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should be no-op when no items', () => {
      const emptyContainer = document.createElement('div')
      document.body.appendChild(emptyContainer)
      nav.activate({ container: emptyContainer, direction: 'horizontal' })
      expect(() => nav.focusNext()).not.toThrow()
      expect(() => nav.focusPrevious()).not.toThrow()
      emptyContainer.remove()
    })
  })

  describe('focusFirst / focusLast', () => {
    it('should jump to first item', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.focusNext()
      nav.focusNext()
      nav.focusFirst()
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should jump to last item', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.focusLast()
      expect(nav.getCurrentIndex()).toBe(3)
    })

    it('should be no-op when no items for focusFirst', () => {
      const empty = document.createElement('div')
      document.body.appendChild(empty)
      nav.activate({ container: empty, direction: 'horizontal' })
      expect(() => nav.focusFirst()).not.toThrow()
      expect(() => nav.focusLast()).not.toThrow()
      empty.remove()
    })
  })

  describe('arrow key event handling', () => {
    it('should handle ArrowRight for horizontal direction', () => {
      nav.activate({ container, direction: 'horizontal' })
      fireKey(container, 'ArrowRight')
      expect(nav.getCurrentIndex()).toBe(1)
    })

    it('should handle ArrowLeft for horizontal direction', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.focusNext()
      fireKey(container, 'ArrowLeft')
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should handle ArrowDown for vertical direction', () => {
      nav.activate({ container, direction: 'vertical' })
      fireKey(container, 'ArrowDown')
      expect(nav.getCurrentIndex()).toBe(1)
    })

    it('should handle ArrowUp for vertical direction', () => {
      nav.activate({ container, direction: 'vertical' })
      nav.focusNext()
      fireKey(container, 'ArrowUp')
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should handle all arrows for both direction', () => {
      nav.activate({ container, direction: 'both' })
      fireKey(container, 'ArrowRight')
      expect(nav.getCurrentIndex()).toBe(1)
      fireKey(container, 'ArrowDown')
      expect(nav.getCurrentIndex()).toBe(2)
    })

    it('should handle Home key', () => {
      nav.activate({ container, direction: 'horizontal' })
      nav.focusNext()
      nav.focusNext()
      fireKey(container, 'Home')
      expect(nav.getCurrentIndex()).toBe(0)
    })

    it('should handle End key', () => {
      nav.activate({ container, direction: 'horizontal' })
      fireKey(container, 'End')
      expect(nav.getCurrentIndex()).toBe(3)
    })

    it('should NOT handle ArrowRight for vertical direction', () => {
      nav.activate({ container, direction: 'vertical' })
      fireKey(container, 'ArrowRight')
      expect(nav.getCurrentIndex()).toBe(0) // unchanged
    })

    it('should NOT handle ArrowDown for horizontal direction', () => {
      nav.activate({ container, direction: 'horizontal' })
      fireKey(container, 'ArrowDown')
      expect(nav.getCurrentIndex()).toBe(0) // unchanged
    })
  })

  describe('createKeyboardNav factory', () => {
    it('should return KeyboardNavigationManager instance', () => {
      expect(createKeyboardNav()).toBeInstanceOf(KeyboardNavigationManager)
    })
  })
})

describe('RovingTabIndex', () => {
  let rti: RovingTabIndex
  let container: HTMLElement

  beforeEach(() => {
    rti = new RovingTabIndex()
    container = createContainer()
  })

  afterEach(() => {
    rti.dispose()
    container.remove()
  })

  describe('attach', () => {
    it('should set first item tabindex=0 and rest to -1', () => {
      rti.attach(container)
      const buttons = container.querySelectorAll('button')
      expect(buttons[0]?.getAttribute('tabindex')).toBe('0')
      expect(buttons[1]?.getAttribute('tabindex')).toBe('-1')
      expect(buttons[2]?.getAttribute('tabindex')).toBe('-1')
    })
  })

  describe('setActive', () => {
    it('should make specified element tabindex=0 and others -1', () => {
      rti.attach(container)
      const buttons = container.querySelectorAll<HTMLButtonElement>('button')
      rti.setActive(buttons[2] as HTMLButtonElement)
      expect(buttons[0]?.getAttribute('tabindex')).toBe('-1')
      expect(buttons[2]?.getAttribute('tabindex')).toBe('0')
    })

    it('should be a no-op when not attached', () => {
      const btn = container.querySelector<HTMLButtonElement>('button')
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(() => rti.setActive(btn!)).not.toThrow()
    })
  })

  describe('detach', () => {
    it('should restore all items to tabindex=0', () => {
      rti.attach(container)
      rti.detach()
      const buttons = container.querySelectorAll('button')
      buttons.forEach((btn) => {
        expect(btn.getAttribute('tabindex')).toBe('0')
      })
    })

    it('should be a no-op when not attached', () => {
      expect(() => rti.detach()).not.toThrow()
    })
  })

  describe('dispose', () => {
    it('should call detach on dispose', () => {
      rti.attach(container)
      rti.dispose()
      // After dispose, container should be null — verify no throw on second dispose
      expect(() => rti.dispose()).not.toThrow()
    })
  })

  describe('custom selector', () => {
    it('should use custom selector when provided', () => {
      const customContainer = document.createElement('div')
      const link = document.createElement('a')
      link.href = '#'
      customContainer.appendChild(link)
      document.body.appendChild(customContainer)

      const customRti = createRovingTabIndex('a[href]')
      customRti.attach(customContainer)
      expect(link.getAttribute('tabindex')).toBe('0')
      customRti.dispose()
      customContainer.remove()
    })
  })

  describe('createRovingTabIndex factory', () => {
    it('should return RovingTabIndex instance', () => {
      expect(createRovingTabIndex()).toBeInstanceOf(RovingTabIndex)
    })

    it('should accept optional selector', () => {
      expect(createRovingTabIndex('button')).toBeInstanceOf(RovingTabIndex)
    })
  })
})
