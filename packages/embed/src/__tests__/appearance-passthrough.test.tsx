// @vitest-environment jsdom
/**
 * Regression test for the fat-mode `appearance` option being silently
 * dropped instead of overriding `surface.appearance` (as its doc comment
 * promises: "falls back to surface.appearance"). Before the fix, `render()`'s
 * fat branch never copied `o.appearance` into `fatOpts`, and `renderFat()`
 * passed `opts.surface` straight through with no merge — so a caller
 * (notably the standalone web-app export, which threads
 * `receipt.appearanceConfigSnapshot` through exactly this option) had its
 * project-level appearance override silently ignored in favour of whatever
 * `surface.appearance` already held.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '../index.js'
import { renderFat } from '../fat.js'
import type { RenderableSurface } from '@pwfabric/contracts'

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  container.id = 'pw-root'
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function surfaceWithNoAppearance(): RenderableSurface {
  return { id: 'srf_appearance_test', blocks: [] } as unknown as RenderableSurface
}

describe('appearance option override (fat mode)', () => {
  it('renderFat: an explicit `appearance` option overrides an absent surface.appearance', async () => {
    const handle = renderFat(container, {
      surface: surfaceWithNoAppearance(),
      appearance: { config: { theme: { colors: { primary: '#e11d48' } } } },
      interactionMode: 'inert',
    })
    await new Promise((r) => setTimeout(r, 0))

    const surfaceRoot = container.querySelector('[data-pw-surface]') as HTMLElement | null
    expect(surfaceRoot).not.toBeNull()
    expect(surfaceRoot?.style.getPropertyValue('--pw-color-primary')).toBe('#e11d48')

    handle.unmount()
  })

  it('render(): the top-level EmbedOptions.appearance reaches the DOM through the fat path', async () => {
    const handle = await render(
      container,
      { surface: surfaceWithNoAppearance() },
      {
        mode: 'fat',
        appearance: { config: { theme: { colors: { primary: '#e11d48' } } } },
        interactionMode: 'inert',
      }
    )
    await new Promise((r) => setTimeout(r, 0))

    const surfaceRoot = container.querySelector('[data-pw-surface]') as HTMLElement | null
    expect(surfaceRoot?.style.getPropertyValue('--pw-color-primary')).toBe('#e11d48')

    handle.unmount()
  })

  it('the `appearance` option takes priority over an existing surface.appearance', async () => {
    const surface = {
      id: 'srf_override_test',
      blocks: [],
      appearance: { config: { theme: { colors: { primary: '#4f46e5' } } } },
    } as unknown as RenderableSurface

    const handle = renderFat(container, {
      surface,
      appearance: { config: { theme: { colors: { primary: '#e11d48' } } } },
      interactionMode: 'inert',
    })
    await new Promise((r) => setTimeout(r, 0))

    const surfaceRoot = container.querySelector('[data-pw-surface]') as HTMLElement | null
    expect(surfaceRoot?.style.getPropertyValue('--pw-color-primary')).toBe('#e11d48')

    handle.unmount()
  })
})
