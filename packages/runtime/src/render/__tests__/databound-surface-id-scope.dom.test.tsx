// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — the surface id must survive the rebuild.
 *
 * `SurfaceRenderer` derives its render scope from `surface.id` and stamps it as
 * the ATTRIBUTE VALUE: `[data-pw-surface="<id>"]`. Every per-surface rule the
 * runtime emits — dark theme, visibility, interaction states, responsive style
 * — hangs off that selector. Without an id the selector degrades to the
 * value-less `[data-pw-surface]`, which every surface in a document shares, and
 * the last one in document order wins.
 *
 * `DataBoundSurfaceRenderer` decomposes the surface into
 * blocks/appearance/capabilities and REBUILDS it before handing it down. `id`
 * was not one of the pieces — and `DataBoundSurface` did not declare the field
 * at all, so the drop was invisible at the type level too. The result: the
 * scoping looked correct in the source and silently did nothing on the
 * data-bound path, which is the path every surface with dataSources takes.
 *
 * The symptom: a preview rendered `data-pw-surface=""` while its surface
 * document carried `id: "promo-site.home"`.
 *
 * Both branches are locked here because they are separate code paths with the
 * same omission — the passthrough (no dataSources) and the data-bound rebuild.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-surface-id-scope.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
})

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p>{String(props.content ?? '')}</p>
  )) as never,
}

const blocks: Block[] = [
  { id: 'b-1', type: 'text', layout: DEFAULT_BLOCK_LAYOUT, props: { content: 'hello' } },
]

/** The capability that forces the data-bound path (rather than the passthrough). */
const FORM_BINDINGS_CAPABILITY = {
  capability: 'platform/entities',
  config: {
    formBindings: [
      {
        formId: 'form-1',
        entityType: 'ContactUs',
        statusKeys: { loading: 'l', success: 's', error: 'e' },
      },
    ],
  },
}

const scopeOf = (container: HTMLElement): string | null =>
  container.querySelector('[data-pw-surface]')?.getAttribute('data-pw-surface') ?? null

describe('DataBoundSurfaceRenderer — surface id scope', () => {
  it('carries the id through the passthrough branch', () => {
    const { container } = render(
      <DataBoundSurfaceRenderer
        surface={{ id: 'surface-alpha', blocks }}
        components={components as BlockComponentRegistry}
      />
    )
    expect(scopeOf(container)).toBe('surface-alpha')
  })

  it('carries the id through the data-bound rebuild', () => {
    const { container } = render(
      <DataBoundSurfaceRenderer
        surface={{ id: 'surface-beta', blocks, capabilities: [FORM_BINDINGS_CAPABILITY] }}
        components={components as BlockComponentRegistry}
      />
    )
    expect(scopeOf(container)).toBe('surface-beta')
  })

  it('renders an empty scope when the surface genuinely has no id', () => {
    // Not an error — a surface without an id is the documented degrade, and the
    // value-less selector is correct when there is only one surface. What must
    // not happen is an id being present and arriving empty.
    const { container } = render(
      <DataBoundSurfaceRenderer
        surface={{ blocks }}
        components={components as BlockComponentRegistry}
      />
    )
    expect(scopeOf(container)).toBe('')
  })

  it('keeps two surfaces in one document distinguishable', () => {
    // The point of the whole scope: sibling surfaces must not answer to each
    // other's per-surface rules.
    const { container } = render(
      <>
        <DataBoundSurfaceRenderer
          surface={{ id: 'surface-one', blocks, capabilities: [FORM_BINDINGS_CAPABILITY] }}
          components={components as BlockComponentRegistry}
        />
        <DataBoundSurfaceRenderer
          surface={{ id: 'surface-two', blocks, capabilities: [FORM_BINDINGS_CAPABILITY] }}
          components={components as BlockComponentRegistry}
        />
      </>
    )
    const ids = Array.from(container.querySelectorAll('[data-pw-surface]')).map((el) =>
      el.getAttribute('data-pw-surface')
    )
    expect(ids).toEqual(['surface-one', 'surface-two'])
  })
})
