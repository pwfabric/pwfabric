// @vitest-environment jsdom
/**
 * Proves `hydrate: true` genuinely reuses server-rendered DOM nodes instead
 * of tearing them down and remounting (which is what happened before this
 * option existed — `mountSurface` always called `createRoot`, which discards
 * any existing children in the target). We fake "server-rendered markup" by
 * writing static HTML into the container before mounting (mirrors what the
 * real export does: SSR output already sits in #pw-root before embed.js runs).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderFat } from '../fat.js'
import { createSurfaceElement } from '../render-core.js'
import type { RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'
import * as React from 'react'
import { renderToString } from 'react-dom/server'

/** Polls until `ok()` holds or `ms` pass (then the caller's expect reports the state). */
async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
}

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  container.id = 'pw-root'
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function TextBlock({ props }: BlockComponentProps): React.ReactElement {
  return React.createElement('p', { 'data-testid': 'text-block' }, String(props.content ?? ''))
}

function textSurface(): RenderableSurface {
  return {
    id: 'srf_hydrate_test',
    blocks: [{ id: 'b1', type: 'text', props: { content: 'Hello hydrate' }, layout: { span: { xs: 4 } } }],
  } as unknown as RenderableSurface
}

describe('hydrate option', () => {
  it('reuses existing server-rendered DOM nodes instead of discarding them', async () => {
    // Real SSR output — renderToString on the EXACT same element tree
    // mountSurface builds, so the client render matches structurally (a
    // hand-approximated fake markup mismatches on things like the injected
    // SURFACE_BASE_CSS <style> tag and boolean-vs-string attribute
    // serialization, which throws on hydration instead of proving reuse).
    const opts = { surface: textSurface(), components: { text: TextBlock }, interactionMode: 'inert' as const }
    const markup = renderToString(createSurfaceElement(opts))
    container.innerHTML = markup
    const ssrNode = container.querySelector('[data-testid="text-block"]') as HTMLElement

    const handle = renderFat(container, {
      ...opts,
      hydrate: true,
    })
    await new Promise((r) => setTimeout(r, 0))

    const postHydrateNode = container.querySelector('[data-testid="text-block"]')
    expect(postHydrateNode).not.toBeNull()
    // The KEY proof: hydration attaches to the SAME DOM node rather than
    // creating a new one — object identity survives the mount call.
    expect(postHydrateNode).toBe(ssrNode)
    expect(postHydrateNode?.textContent).toBe('Hello hydrate')

    handle.unmount()
  })

  it('without hydrate, the same scenario DISCARDS the existing node (proves the contrast)', async () => {
    const markup = '<p data-testid="text-block" data-block-id="b1">Hello hydrate</p>'
    container.innerHTML = markup
    const preMountNode = container.querySelector('[data-testid="text-block"]')

    const handle = renderFat(container, {
      surface: textSurface(),
      components: { text: TextBlock },
      interactionMode: 'inert',
      // no `hydrate` — default createRoot behaviour
    })
    await new Promise((r) => setTimeout(r, 0))

    const postMountNode = container.querySelector('[data-testid="text-block"]')
    expect(postMountNode).not.toBeNull()
    expect(postMountNode).not.toBe(preMountNode)

    handle.unmount()
  })

  it('handle.render() reuses the same root for a subsequent update (no fresh createRoot/hydrateRoot)', async () => {
    const handle = renderFat(container, {
      surface: textSurface(),
      components: { text: TextBlock },
      interactionMode: 'inert',
    })
    // React commits asynchronously; under a loaded parallel run one macrotask is
    // not always enough, so wait for the DOM to show the state the test needs.
    const textOf = () => container.querySelector('[data-testid="text-block"]')?.textContent
    await until(() => textOf() === 'Hello hydrate')
    expect(textOf()).toBe('Hello hydrate')

    const surface2 = {
      id: 'srf_hydrate_test_2',
      blocks: [{ id: 'b2', type: 'text', props: { content: 'Updated via render()' }, layout: { span: { xs: 4 } } }],
    } as unknown as RenderableSurface

    handle.render({ surface: surface2, components: { text: TextBlock }, interactionMode: 'inert' })
    await until(() => textOf() === 'Updated via render()')
    expect(textOf()).toBe('Updated via render()')

    handle.unmount()
  })
})
