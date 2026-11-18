/**
 * The shell's page-hints script (pwapp-format §2.1) asks for what the OPENED
 * page needs — its receipt, block modules and first image — and for nothing
 * of any other page's: a visitor on `#/quickstart` was sent the entry page's
 * receipt ("preloaded but not used"), its block modules and its cover image.
 * Only an own key of the table is a page, and no hint stops the app.
 *
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { PAGE_HINTS_SCRIPT } from '../../dev/shell.js'

const hints = {
  entry: 'menu',
  maxWidth: 639,
  routes: ['menu', 'dish'],
  notFound: 'notfound',
  pages: {
    menu: { receipt: 'pwpack/surfaces/menu.receipt.json', modules: ['blocks/a.1.mjs'], image: './pwpack/media/cover.svg', imagePriority: true },
    dish: { receipt: 'pwpack/surfaces/dish.receipt.json', modules: ['blocks/b.2.mjs'], frame: 'pwpack/surfaces/dish.html', frameKeys: ['tab'] },
    notfound: { receipt: 'pwpack/surfaces/notfound.receipt.json', modules: [] },
  },
}

function run(hash: string, data: unknown = hints, width = 390): string[] {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  history.replaceState(null, '', `/${hash}`)
  document.head.innerHTML = `<script type="application/json" id="pw-page-hints">${JSON.stringify(data)}</script>`
  new Function(PAGE_HINTS_SCRIPT)()
  return [...document.head.querySelectorAll('link')].map(
    (l) => `${l.rel} ${l.getAttribute('as')} ${l.getAttribute('href')}${l.crossOrigin ? ' cors' : ''}${l.getAttribute('fetchpriority') ? ' high' : ''}`
  )
}

afterEach(() => {
  document.head.innerHTML = ''
  history.replaceState(null, '', '/')
})

describe('the page-hints script', () => {
  it('asks for the entry page’s needs on the entry page only', () => {
    expect(run('')).toEqual([
      'preload fetch ./pwpack/surfaces/menu.receipt.json cors',
      // The request the block loader makes (fetch, CORS): one download, not two.
      'preload fetch ./blocks/a.1.mjs cors',
      'preload image ./pwpack/media/cover.svg high',
    ])
  })

  it('a deep link asks for that page’s, and nothing of the entry page’s', () => {
    expect(run('#/dish?id=3')).toEqual([
      'preload fetch ./pwpack/surfaces/dish.receipt.json cors',
      'preload fetch ./blocks/b.2.mjs cors',
      // Its first frame, which the first-paint script fetches: not a round trip behind the runner.
      'preload fetch ./pwpack/surfaces/dish.html cors',
    ])
  })

  it('E-5: the frame is asked for only where the first-paint script will put it in', () => {
    const page = ['preload fetch ./pwpack/surfaces/dish.receipt.json cors', 'preload fetch ./blocks/b.2.mjs cors']
    // Wider than the painted breakpoint: the runner draws the page, the frame
    // would be "preloaded but not used within a few seconds".
    expect(run('#/dish?id=3', hints, 1280)).toEqual(page)
    // A query key that changes the frame keeps the build's frame out too.
    expect(run('#/dish?tab=reviews', hints, 390)).toEqual(page)
    expect(run('#/dish?id=3', hints, 639)).toEqual([...page, 'preload fetch ./pwpack/surfaces/dish.html cors'])
  })

  it('an address naming no route asks for the not-found page’s', () => {
    expect(run('#/nope')).toEqual(['preload fetch ./pwpack/surfaces/notfound.receipt.json cors'])
  })

  for (const hash of ['#/constructor', '#/__proto__', '#/toString', '#/hasOwnProperty']) {
    it(`${hash} names no page and asks for nothing`, () => {
      expect(run(hash, { ...hints, notFound: undefined })).toEqual([])
    })
  }

  it('a broken table asks for nothing and throws nothing', () => {
    history.replaceState(null, '', '/')
    document.head.innerHTML = `<script type="application/json" id="pw-page-hints">{not json</script>`
    expect(() => new Function(PAGE_HINTS_SCRIPT)()).not.toThrow()
    expect(document.head.querySelectorAll('link')).toHaveLength(0)
  })
})
