// @vitest-environment jsdom
/**
 * The static first paint (pwapp-format §2.5): `renderStatic` writes a page's
 * first frame as HTML, and the renderer HYDRATES that HTML — the same nodes
 * stay on screen — with the first render the build rendered.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as React from 'react'
import type { DynamicBlockDescriptor, RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'
import { BlockModuleLoader } from '@pwfabric/runtime'
import { registerBlocks, renderStatic } from '../static-render.js'
import { renderFat } from '../fat.js'
import { autoload } from '../index.js'

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 10))
}

/** True while the page is rendered "outside a browser" in these tests. */
let onServer = false

function Note({ props }: BlockComponentProps): React.ReactElement {
  return React.createElement('p', { 'data-testid': `note-${String(props.id)}` }, String(props.text ?? ''))
}

/** Reads `window` while rendering — the rule a block must not break. */
function Measured(): React.ReactElement {
  if (onServer) throw new Error('window is not defined')
  return React.createElement('p', { 'data-testid': 'measured' }, 'measured in the browser')
}

const descriptor = (blockType: string): DynamicBlockDescriptor =>
  ({ blockType, moduleUrl: `blocks/${blockType}.js`, integrity: '0'.repeat(64) }) as unknown as DynamicBlockDescriptor

const blocks = [descriptor('note'), descriptor('measured')]

function surface(withMeasured = false): RenderableSurface {
  return {
    blocks: [
      { id: 'a', type: 'note', props: { id: 'a', text: 'First' }, layout: { span: { xs: 4 } } },
      ...(withMeasured ? [{ id: 'm', type: 'measured', props: {}, layout: { span: { xs: 4 } } }] : []),
      { id: 'b', type: 'note', props: { id: 'b', text: 'Second' }, layout: { span: { xs: 4 } } },
    ],
  } as unknown as RenderableSurface
}

const options = { mode: 'fat', blocks, viewport: 'xs', loadingStrategy: 'immediate' } as const

function serverRender(s: RenderableSurface): ReturnType<typeof renderStatic> {
  onServer = true
  try {
    return renderStatic(s, options)
  } finally {
    onServer = false
  }
}

let container: HTMLDivElement
beforeEach(() => {
  BlockModuleLoader.invalidate()
  registerBlocks([
    { blockType: 'note', module: { Component: Note } },
    { blockType: 'measured', module: { Component: Measured } },
  ])
  container = document.createElement('div')
  container.id = 'pw-root'
  document.body.appendChild(container)
})
afterEach(() => {
  container.remove()
  vi.restoreAllMocks()
})

describe('renderStatic', () => {
  it('writes the page from registered block modules, as the browser would draw it', () => {
    const { html, failed } = serverRender(surface())
    expect(failed).toEqual([])
    expect(html).toContain('data-testid="note-a"')
    expect(html).toContain('>First<')
    expect(html).toContain('>Second<')
    // No script reaches the HTML: a Content Security Policy that allows no
    // inline script still paints it.
    expect(html).not.toMatch(/<script/i)
  })

  it('a block that reads the browser while rendering is named, and the rest of the page is still written', () => {
    const { html, failed } = serverRender(surface(true))
    expect(failed).toEqual([{ blockType: 'measured', message: 'window is not defined' }])
    expect(html).toContain('>First<')
    expect(html).toContain('>Second<')
    expect(html).not.toContain('measured in the browser')
  })
})

describe('hydrating the static first paint', () => {
  it('keeps the very nodes the build wrote, and reports the first commit once', async () => {
    container.innerHTML = serverRender(surface()).html
    const first = container.querySelector('[data-testid="note-a"]')
    const warn = vi.spyOn(console, 'warn')
    const onHydrated = vi.fn()
    const handle = renderFat(container, { surface: surface(), ...options, hydrate: true, onHydrated })
    await until(() => onHydrated.mock.calls.length > 0)
    expect(onHydrated).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-testid="note-a"]')).toBe(first)
    expect(warn.mock.calls.filter((c) => String(c[0]).includes('did not match'))).toEqual([])
    // An update after the first commit is an update of the same tree.
    handle.update({ surface: surface(), ...options, viewport: 'lg' })
    await until(() => container.querySelector('[data-viewport="lg"]') !== null)
    expect(container.querySelector('[data-testid="note-a"]')).toBe(first)
    handle.unmount()
  })

  it('the block the build could not render is drawn by the browser, beside the kept nodes', async () => {
    container.innerHTML = serverRender(surface(true)).html
    const first = container.querySelector('[data-testid="note-a"]')
    const handle = renderFat(container, { surface: surface(true), ...options, hydrate: true })
    await until(() => container.querySelector('[data-testid="measured"]') !== null)
    expect(container.querySelector('[data-testid="measured"]')?.textContent).toBe('measured in the browser')
    expect(container.querySelector('[data-testid="note-a"]')).toBe(first)
    handle.unmount()
  })

  it('HTML that is not the first render is drawn again, and the host is told', async () => {
    container.innerHTML = serverRender(surface()).html.replace('>First<', '>Stale<')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const handle = renderFat(container, { surface: surface(), ...options, hydrate: true })
    await until(() => container.querySelector('[data-testid="note-a"]')?.textContent === 'First')
    expect(container.querySelector('[data-testid="note-a"]')?.textContent).toBe('First')
    await until(() => warn.mock.calls.some((c) => String(c[0]).includes('did not match')))
    expect(warn.mock.calls.some((c) => String(c[0]).includes('static first paint did not match'))).toBe(true)
    handle.unmount()
  })
})

describe('autoload', () => {
  it('does not take a rendered surface (static first paint) for an embed placeholder', () => {
    container.innerHTML = serverRender(surface()).html
    expect(container.querySelector('[data-pw-surface]')).not.toBeNull()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    autoload(container)
    expect(warn).not.toHaveBeenCalled()
    expect(container.querySelector('[data-pw-hydrated]')).toBeNull()
  })
})
