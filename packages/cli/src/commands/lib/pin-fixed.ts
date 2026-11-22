/**
 * Browser code, as text: it runs IN THE PAGE before `pwf shoot`'s full-page
 * shot. A full-page shot draws a `position: fixed` element wherever the window
 * was — a bottom bar ends up mid-page. Each one is set `position: absolute` at
 * the place a visitor sees it: one in the window's upper half at that
 * distance from the page's top, one in the lower half at that distance from
 * the page's bottom. The expression answers how many it moved.
 */
export const PIN_FIXED_ELEMENTS = `(() => {
  const viewport = window.innerHeight
  const pageHeight = Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, viewport)
  const places = [...document.querySelectorAll('body *')]
    .filter((e) => getComputedStyle(e).position === 'fixed')
    .map((e) => {
      const r = e.getBoundingClientRect()
      const top = r.top + r.height / 2 < viewport / 2 ? r.top + window.scrollY : pageHeight - (viewport - r.top)
      return { e, top, left: r.left + window.scrollX, width: r.width, height: r.height }
    })
  for (const p of places) {
    p.e.style.position = 'absolute'
    p.e.style.bottom = 'auto'
    p.e.style.right = 'auto'
    p.e.style.width = p.width + 'px'
    p.e.style.height = p.height + 'px'
    // Absolute is placed in the nearest positioned ancestor: its page offset is taken off.
    const parent = p.e.offsetParent && p.e.offsetParent !== document.body ? p.e.offsetParent.getBoundingClientRect() : null
    p.e.style.top = p.top - (parent ? parent.top + window.scrollY : 0) + 'px'
    p.e.style.left = p.left - (parent ? parent.left + window.scrollX : 0) + 'px'
  }
  return places.length
})()`
