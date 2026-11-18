/**
 * boot.js's deep-link hints read a key out of the visitor's address. Only an
 * own key of the table is a page: `#/constructor` or `#/__proto__` must not
 * reach a prototype member, and no hint can stop the app from starting.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { bootScript } from '../../dev/shell.js'

const hints = { dish: { receipt: 'pwpack/surfaces/dish.receipt.json', modules: ['blocks/text.1.mjs'] } }

/** The boot module's own code, without its import and the runner start. */
function runBootHints(hash: string): { started: boolean } {
  history.replaceState(null, '', `/${hash}`)
  const source = bootScript({ pageHints: hints })
    .split('\n')
    .filter((l) => !l.startsWith('import '))
    .join('\n')
  const state = { started: false }
  new Function('runApp', source)(() => {
    state.started = true
  })
  return state
}

afterEach(() => {
  document.head.innerHTML = ''
  history.replaceState(null, '', '/')
})

describe('boot.js deep-link hints', () => {
  it("asks for a deep-linked page's receipt and modules", () => {
    expect(runBootHints('#/dish?id=3').started).toBe(true)
    const links = [...document.head.querySelectorAll('link')].map((l) => `${l.rel} ${l.getAttribute('href')}`)
    expect(links).toEqual(['preload ./pwpack/surfaces/dish.receipt.json', 'modulepreload ./blocks/text.1.mjs'])
  })

  for (const hash of ['#/constructor', '#/__proto__', '#/toString', '#/hasOwnProperty']) {
    it(`${hash} names no page, adds nothing and the app still starts`, () => {
      expect(runBootHints(hash).started).toBe(true)
      expect(document.head.querySelectorAll('link')).toHaveLength(0)
    })
  }
})
