/**
 * FOCUS IS NOT LOST WHEN THE FOCUSED BLOCK GOES AWAY (WCAG 2.4.3).
 *
 * A wizard step's "Next" button hides its own step on click (`visibleWhen`
 * flips), the button leaves the DOM and the browser drops focus to `<body>`:
 * a keyboard or screen-reader visitor is thrown to the top of the document
 * with nothing announced.
 *
 * The rule: when the element that had focus inside the surface is gone after
 * a render, focus moves to the region that just became visible — the first
 * block shown in this render that was not shown before (document order): its
 * first focusable control, else its first heading (made focusable with
 * `tabindex="-1"`), else the block itself is left alone. When nothing new
 * appeared, focus stays where the browser put it.
 *
 * @module @pwfabric/runtime/render/focus-keeper
 */
import * as React from 'react'

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
const HEADING = 'h1,h2,h3,h4,h5,h6,[role="heading"]'

/** The block ids rendered under `root`, in document order. */
function blockIdsOf(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-block-id]')].map((el) => el.getAttribute('data-block-id') ?? '')
}

/** Where focus goes inside a block that just appeared, or null. */
export function focusTargetIn(block: HTMLElement): HTMLElement | null {
  const control = block.matches(FOCUSABLE) ? block : block.querySelector<HTMLElement>(FOCUSABLE)
  if (control) return control
  const heading = block.matches(HEADING) ? block : block.querySelector<HTMLElement>(HEADING)
  if (heading) {
    if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
    return heading
  }
  return null
}

/** Keeps focus inside the surface rooted at `rootRef` when its focused block is removed. */
export function useFocusKeeper(rootRef: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  const focused = React.useRef<Element | null>(null)
  const shown = React.useRef<Set<string>>(new Set())

  React.useEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) return
    const onFocusIn = (ev: FocusEvent): void => {
      focused.current = ev.target as Element
    }
    root.addEventListener('focusin', onFocusIn)
    return () => root.removeEventListener('focusin', onFocusIn)
  }, [rootRef, enabled])

  // After EVERY commit: the effect has no dependency list on purpose.
  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !enabled) return
    const ids = blockIdsOf(root)
    const before = shown.current
    shown.current = new Set(ids)
    const lost = focused.current
    if (!lost || lost.isConnected) return
    focused.current = null
    const active = root.ownerDocument.activeElement
    if (active && active !== root.ownerDocument.body && active.isConnected) return
    for (const id of ids) {
      if (before.has(id)) continue
      const block = [...root.querySelectorAll<HTMLElement>('[data-block-id]')].find((el) => el.getAttribute('data-block-id') === id)
      const target = block ? focusTargetIn(block) : null
      if (target) {
        target.focus()
        return
      }
    }
  })
}
