// @vitest-environment jsdom
/**
 * A block type nothing can render — no descriptor, no component.
 *
 * Published pages keep the renderer's quiet behaviour (children only, no
 * visible marker). A preview host opts into `placeholderMissingBlocks` and gets
 * a visible "rebuild needed" note instead, without anything being fetched or
 * imported for the missing type. The fat handle's `update` re-renders into the
 * same root.
 */

import * as React from 'react'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderFat } from '../fat.js'
import { missingBlockTypes } from '../render-core.js'
import type { RenderableSurface } from '@pwfabric/contracts'
import type { BlockComponentProps } from '@pwfabric/runtime'

const FULL_SPAN = { span: { xs: 4, sm: 8, md: 12, lg: 12 } }

function TextBlock({ props }: BlockComponentProps): React.ReactElement {
  return React.createElement('p', { 'data-testid': 'text-block' }, String(props.content ?? ''))
}

function surfaceWith(...types: string[]): RenderableSurface {
  return {
    id: 'srf_missing',
    blocks: types.map((type, i) => ({
      id: `b${i}`,
      type,
      props: { content: `block ${i}` },
      layout: FULL_SPAN,
      ...(type === 'section'
        ? { children: [{ id: `c${i}`, type: 'text', props: { content: 'inside' }, layout: FULL_SPAN }] }
        : {}),
    })),
  } as unknown as RenderableSurface
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms))

let container: HTMLDivElement
let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  fetchSpy = vi.fn(() => Promise.reject(new Error('no network in this test')))
  vi.stubGlobal('fetch', fetchSpy)
})

afterEach(() => {
  container.remove()
  vi.unstubAllGlobals()
})

describe('missingBlockTypes', () => {
  it('lists types with neither a descriptor nor a component, walking children', () => {
    const surface = surfaceWith('text', 'hero', 'section')
    ;(surface as unknown as { blocks: { children?: unknown[] }[] }).blocks[2]!.children!.push({
      id: 'deep',
      type: 'pricing',
    })
    const missing = missingBlockTypes(
      surface,
      [
        {
          blockType: 'section',
          moduleUrl: 'data:text/javascript,',
          integrity: '',
          publisher: 'workspace',
          publisherVerified: false,
          definition: { name: 'section', category: 'marketplace', defaultProps: {}, canHaveChildren: true },
        },
      ],
      { text: TextBlock }
    )
    expect(missing.sort()).toEqual(['hero', 'pricing'])
  })
})

describe('placeholderMissingBlocks', () => {
  it('is off by default: an unknown type draws no placeholder', async () => {
    const handle = renderFat(container, {
      surface: surfaceWith('text', 'hero'),
      components: { text: TextBlock },
      interactionMode: 'inert',
    })
    await tick()
    expect(container.querySelector('[data-unknown-type="hero"]')).not.toBeNull()
    expect(container.querySelector('[data-pw-rebuild-needed]')).toBeNull()
    handle.unmount()
  })

  it('draws a rebuild-needed placeholder and loads no code for the missing type', async () => {
    const handle = renderFat(container, {
      surface: surfaceWith('text', 'hero'),
      components: { text: TextBlock },
      interactionMode: 'inert',
      placeholderMissingBlocks: true,
    })
    await tick(20)
    const note = container.querySelector('[data-pw-rebuild-needed="hero"]')
    expect(note).not.toBeNull()
    expect(note?.textContent).toContain('Rebuild needed')
    // The known block still renders through its own component.
    expect(container.querySelector('[data-testid="text-block"]')?.textContent).toBe('block 0')
    // Nothing was requested for the missing type — no module, no manifest.
    expect(fetchSpy).not.toHaveBeenCalled()
    handle.unmount()
  })

  it('keeps the subtree of a missing container visible inside the placeholder', async () => {
    const handle = renderFat(container, {
      surface: surfaceWith('section'),
      components: { text: TextBlock },
      interactionMode: 'inert',
      placeholderMissingBlocks: true,
    })
    await tick(20)
    const note = container.querySelector('[data-pw-rebuild-needed="section"]')
    expect(note?.querySelector('[data-testid="text-block"]')?.textContent).toBe('inside')
    handle.unmount()
  })

  it('never shadows a type the host supplied a component for', async () => {
    const handle = renderFat(container, {
      surface: surfaceWith('text'),
      components: { text: TextBlock },
      interactionMode: 'inert',
      placeholderMissingBlocks: true,
    })
    await tick()
    expect(container.querySelector('[data-pw-rebuild-needed]')).toBeNull()
    handle.unmount()
  })
})

describe('FatMountHandle.update', () => {
  it('re-renders new fat options into the same root', async () => {
    const handle = renderFat(container, {
      surface: surfaceWith('text'),
      components: { text: TextBlock },
      interactionMode: 'inert',
    })
    await tick()
    const surfaceRoot = container.querySelector('[data-pw-surface]')
    expect(container.querySelector('[data-testid="text-block"]')?.textContent).toBe('block 0')

    handle.update({
      surface: surfaceWith('text', 'hero'),
      components: { text: TextBlock },
      interactionMode: 'inert',
      placeholderMissingBlocks: true,
    })
    await tick(20)
    expect(container.querySelector('[data-pw-rebuild-needed="hero"]')).not.toBeNull()
    // Same React root: the surface element was updated, not replaced by a new mount.
    expect(container.querySelectorAll('[data-pw-surface]').length).toBe(1)
    expect(surfaceRoot?.isConnected).toBe(true)
    handle.unmount()
  })
})
