// @vitest-environment jsdom
/**
 * Raw HTML a block writes keeps its nodes through the update the runner
 * applies after hydration (pwapp-format §2.5): payments-api-docs' prose
 * paragraph and every inline SVG icon were thrown away and parsed again.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import * as ReactJsxRuntime from 'react/jsx-runtime'
import { renderToString } from 'react-dom/server'
import { renderFat } from '../fat.js'
import { createSurfaceElement } from '../render-core.js'
import { blockJsxRuntime, blockReact, stableHtml, stableHtmlProps, STABLE_HTML_MAX } from '../stable-html.js'
import type { RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

const surface = (content: string): RenderableSurface =>
  ({ id: 'srf_html', blocks: [{ id: 'p1', type: 'prose', props: { content }, layout: { span: { xs: 4 } } }] }) as unknown as RenderableSurface

/** A prose-like block: builds its `{ __html }` in render, as packs do. */
function proseWith(jsx: typeof ReactJsxRuntime.jsx) {
  return function Prose({ props }: BlockComponentProps): React.ReactElement {
    return jsx('div', { 'data-prose': '', dangerouslySetInnerHTML: { __html: `<p>${String(props.content)}</p>` } }) as React.ReactElement
  }
}

let container: HTMLDivElement | null = null
afterEach(() => container?.remove())

async function hydrateThenUpdate(component: (p: BlockComponentProps) => React.ReactElement): Promise<{ kept: boolean; text: string }> {
  container = document.createElement('div')
  document.body.appendChild(container)
  const opts = { surface: surface('Hello'), components: { prose: component }, interactionMode: 'inert' as const }
  container.innerHTML = renderToString(createSurfaceElement(opts))
  const painted = container.querySelector('[data-prose] p')
  const handle = renderFat(container, { ...opts, hydrate: true })
  await settle()
  // The visit's own inputs, as the runner applies them: a new surface object, the same content.
  handle.update({ ...opts, surface: surface('Hello') })
  await settle()
  const now = container.querySelector('[data-prose] p')
  handle.unmount()
  return { kept: painted !== null && now === painted, text: now?.textContent ?? '' }
}

describe('raw HTML a block writes', () => {
  it('keeps the painted nodes through the update after hydration (block React)', async () => {
    const runtime = blockJsxRuntime(ReactJsxRuntime)
    const result = await hydrateThenUpdate(proseWith(runtime.jsx))
    expect(result).toEqual({ kept: true, text: 'Hello' })
  })

  it('React itself rewrites it for a new object with the same text (why the block React exists)', async () => {
    const result = await hydrateThenUpdate(proseWith(ReactJsxRuntime.jsx))
    expect(result.kept).toBe(false)
  })

  it('createElement on the block React does the same, and the namespace is its own default', () => {
    const R = blockReact(React)
    const a = R.createElement('div', { dangerouslySetInnerHTML: { __html: '<b>x</b>' } })
    const b = R.createElement('div', { dangerouslySetInnerHTML: { __html: '<b>x</b>' } })
    expect((a.props as { dangerouslySetInnerHTML: unknown }).dangerouslySetInnerHTML).toBe(
      (b.props as { dangerouslySetInnerHTML: unknown }).dangerouslySetInnerHTML
    )
    expect((R as unknown as { default: unknown }).default).toBe(R)
    expect(R.useState).toBe(React.useState)
  })

  it('leaves every other prop and an unusual raw-HTML value alone', () => {
    const plain = { id: 'x' }
    expect(stableHtmlProps(plain)).toBe(plain)
    const extra = { dangerouslySetInnerHTML: { __html: 'a', other: 1 } }
    expect(stableHtmlProps(extra)).toBe(extra)
    const notText = { dangerouslySetInnerHTML: { __html: 3 } }
    expect(stableHtmlProps(notText)).toBe(notText)
    expect(stableHtmlProps(null)).toBe(null)
    const once = stableHtmlProps({ title: 't', dangerouslySetInnerHTML: { __html: 'q' } })
    expect(once).toEqual({ title: 't', dangerouslySetInnerHTML: { __html: 'q' } })
    expect(stableHtmlProps(once)).toBe(once)
  })

  it('remembers a bounded number of strings', () => {
    const first = stableHtml('first-of-many')
    for (let i = 0; i <= STABLE_HTML_MAX; i++) stableHtml(`s${i}`)
    expect(stableHtml('first-of-many')).not.toBe(first)
    expect(stableHtml('first-of-many')).toEqual(first)
  })
})
