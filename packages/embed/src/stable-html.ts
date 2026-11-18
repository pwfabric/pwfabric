/**
 * Markup a block writes as raw HTML keeps its nodes across renders.
 *
 * WHY. React 19 writes `dangerouslySetInnerHTML` again whenever the prop is a
 * NEW object — not when its `__html` changed: `{ __html: same }` re-sets
 * `innerHTML`, and every node under the element is thrown away and parsed
 * again. A block naturally builds that object in render (`<div
 * dangerouslySetInnerHTML={{ __html: sanitized }} />`), so every render of
 * it did so: the update the runner applies right after hydration
 * (pwapp-format §2.5) replaced the very nodes the build had painted (a prose
 * paragraph, every inline SVG icon), the browser counted the page's largest
 * paint again, and any later render did the same to text a reader may be
 * selecting.
 *
 * WHAT. The React a block imports (`react`, `react/jsx-runtime`, through the
 * page's import map) is this bundle's, with `jsx`, `jsxs` and
 * `createElement` passing a raw-HTML prop through {@link stableHtmlProps}:
 * the same text is always the same object, so React sees no change and
 * leaves the nodes alone. The markup written is unchanged — this only keeps
 * React from writing it twice.
 *
 * @module @pwfabric/embed/stable-html
 */

/** At most this many distinct markup strings are remembered (oldest dropped first). */
export const STABLE_HTML_MAX = 2000

const interned = new Map<string, { readonly __html: string }>()

/** The one `{ __html }` object for `html`. */
export function stableHtml(html: string): { readonly __html: string } {
  let held = interned.get(html)
  if (!held) {
    held = Object.freeze({ __html: html })
    interned.set(html, held)
    if (interned.size > STABLE_HTML_MAX) {
      const oldest = interned.keys().next()
      if (!oldest.done) interned.delete(oldest.value)
    }
  }
  return held
}

/** `props` with its `dangerouslySetInnerHTML` (a lone string `__html`) replaced by the one object for that text. */
export function stableHtmlProps<P>(props: P): P {
  if (!props || typeof props !== 'object') return props
  const raw = (props as { dangerouslySetInnerHTML?: unknown }).dangerouslySetInnerHTML
  if (!raw || typeof raw !== 'object') return props
  const keys = Object.keys(raw)
  const html = (raw as { __html?: unknown }).__html
  if (keys.length !== 1 || typeof html !== 'string') return props
  const held = stableHtml(html)
  return held === raw ? props : { ...props, dangerouslySetInnerHTML: held }
}

type ElementFactory = (type: unknown, props: unknown, ...rest: unknown[]) => unknown

function wrap(factory: unknown): unknown {
  if (typeof factory !== 'function') return factory
  const f = factory as ElementFactory
  return (type: unknown, props: unknown, ...rest: unknown[]) => f(type, stableHtmlProps(props), ...rest)
}

/** A `react/jsx-runtime` namespace whose element factories keep raw HTML stable. */
export function blockJsxRuntime<T extends object>(runtime: T): T {
  const r = runtime as Record<string, unknown>
  return Object.freeze({ ...r, jsx: wrap(r['jsx']), jsxs: wrap(r['jsxs']), ...(r['jsxDEV'] ? { jsxDEV: wrap(r['jsxDEV']) } : {}) }) as T
}

/** A `react` namespace whose `createElement` keeps raw HTML stable. */
export function blockReact<T extends object>(react: T): T {
  const r = react as Record<string, unknown>
  const out: Record<string, unknown> = { ...r, createElement: wrap(r['createElement']) }
  // The namespace as a default import (`import React from 'react'`) is the same object.
  out['default'] = out
  return Object.freeze(out) as T
}
