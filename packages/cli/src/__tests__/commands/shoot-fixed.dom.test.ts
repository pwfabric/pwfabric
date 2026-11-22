/**
 * `pwf shoot`'s full-page shot draws a fixed element where a visitor sees it:
 * one at the top of the window at the top of the page, one at the bottom of
 * the window at the bottom of the page — not both wherever the window was.
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { PIN_FIXED_ELEMENTS } from '../../commands/lib/pin-fixed.js'

const pinFixedElements = (): number => (0, eval)(PIN_FIXED_ELEMENTS) as number

function fixed(top: number, height: number): HTMLElement {
  const el = document.createElement('div')
  el.style.position = 'fixed'
  el.getBoundingClientRect = () => ({ top, left: 0, width: 390, height, bottom: top + height, right: 390, x: 0, y: top, toJSON: () => ({}) }) as DOMRect
  document.body.appendChild(el)
  return el
}

describe('pinFixedElements', () => {
  it('pins a top bar at the page top and a bottom bar at the page bottom, in absolute place', () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true })
    Object.defineProperty(document.documentElement, 'scrollHeight', { value: 3000, configurable: true })
    const header = fixed(0, 60)
    const bar = fixed(836, 64)
    const plain = document.createElement('p')
    document.body.appendChild(plain)
    expect(pinFixedElements()).toBe(2)
    expect([header.style.position, header.style.top]).toEqual(['absolute', '0px'])
    // 3000 - (900 - 836): the bar's distance from the window's bottom, kept from the page's.
    expect([bar.style.position, bar.style.top, bar.style.bottom]).toEqual(['absolute', '2936px', 'auto'])
    expect(bar.style.width).toBe('390px')
    expect(plain.style.position).toBe('')
  })
})
