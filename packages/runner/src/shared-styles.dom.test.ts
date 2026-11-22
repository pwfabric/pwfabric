/**
 * @vitest-environment jsdom
 *
 * A first frame's shared rules (pwapp-format §2.5): sent once in the app's
 * frame stylesheet, put back into the frame before it is hydrated.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { FRAME_CSS_ATTR, SHARED_STYLE_ATTR, fillSharedStyles, sharedStyleMarker, sharedStyleTexts } from './first-frame.js'

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

const css = `${sharedStyleMarker(0)}[data-pw-surface]{box-sizing:border-box}${sharedStyleMarker(1)}.a{color:red}\n.b{}`

describe('the shared frame stylesheet', () => {
  it('reads back each text exactly, by number', () => {
    expect([...sharedStyleTexts(css)]).toEqual([
      [0, '[data-pw-surface]{box-sizing:border-box}'],
      [1, '.a{color:red}\n.b{}'],
    ])
  })

  it('puts each text back and drops the marker, so the frame is the markup the renderer draws', async () => {
    document.head.innerHTML = `<link rel="stylesheet" href="https://app.test/assets/frame.1.css" ${FRAME_CSS_ATTR} />`
    document.body.innerHTML = `<div id="root"><style data-pw-base-css ${SHARED_STYLE_ATTR}="0"></style><style ${SHARED_STYLE_ATTR}="1"></style><style>.own{}</style></div>`
    const asked: string[] = []
    const ok = await fillSharedStyles(document.getElementById('root') as HTMLElement, document, async (href) => {
      asked.push(href)
      return css
    })
    expect(ok).toBe(true)
    expect(asked).toEqual(['https://app.test/assets/frame.1.css'])
    expect(document.getElementById('root')?.innerHTML).toBe(
      '<style data-pw-base-css="">[data-pw-surface]{box-sizing:border-box}</style><style>.a{color:red}\n.b{}</style><style>.own{}</style>'
    )
  })

  it('a frame with nothing shared needs nothing', async () => {
    document.body.innerHTML = '<div id="root"><style>.own{}</style></div>'
    expect(await fillSharedStyles(document.body, document, () => Promise.reject(new Error('not asked')))).toBe(true)
  })

  it('a text that cannot be had leaves the frame not whole: it is drawn anew, not hydrated', async () => {
    document.body.innerHTML = `<div id="root"><style ${SHARED_STYLE_ATTR}="0"></style></div>`
    expect(await fillSharedStyles(document.body, document, async () => css)).toBe(false) // no link
    document.head.innerHTML = `<link rel="stylesheet" href="https://app.test/f.css" ${FRAME_CSS_ATTR} />`
    expect(await fillSharedStyles(document.body, document, () => Promise.reject(new Error('offline')))).toBe(false)
    document.body.innerHTML = `<div id="root"><style ${SHARED_STYLE_ATTR}="7"></style></div>`
    expect(await fillSharedStyles(document.body, document, async () => css)).toBe(false)
  })
})
