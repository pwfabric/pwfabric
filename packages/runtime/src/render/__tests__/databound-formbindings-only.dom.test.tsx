// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — write-only (formBindings-only) surfaces.
 *
 * A surface whose only dynamic behaviour is WRITING (platform/entities
 * formBindings, no persistence dataSources) must take the full data-bound
 * path, not the zero-overhead passthrough: statusKeys land via setState and
 * success/error UI hangs off `visibleWhen: "{{state.x}}"` — both live in
 * DataBoundInner's state machinery. Before the fix such surfaces rendered
 * through the plain SurfaceRenderer, where blocks-array `visibleWhen` is
 * never evaluated (status alerts permanently visible) and form submits were
 * silently lost.
 *
 * Locked behaviors:
 *  1. formBindings-only surface → data-bound path: a `visibleWhen` bound to
 *     unset state is OMITTED from the DOM.
 *  2. A surface with no dataSources / behaviors / formBindings but a block
 *     `visibleWhen` ALSO takes the data-bound path: the
 *     condition is evaluated and the block is omitted. It used to take the
 *     passthrough, where the condition was never read and the block rendered.
 *  3. A surface with nothing dynamic at all keeps the passthrough.
 *
 * @module @pwfabric/runtime/render/__tests__/databound-formbindings-only.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer, surfaceNeedsDataBinding } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => {
  cleanup()
})

const components: Partial<BlockComponentRegistry> = {
  text: (({ props }: { props: Record<string, unknown> }) => (
    <p data-testid="text-block">{String(props.content ?? '')}</p>
  )) as never,
}

const blocks: Block[] = [
  {
    id: 'always-1',
    type: 'text',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { content: 'ALWAYS VISIBLE' },
  },
  {
    id: 'gated-1',
    type: 'text',
    layout: DEFAULT_BLOCK_LAYOUT,
    props: { content: 'SUCCESS ALERT' },
    // Block-level conditional visibility bound to a state key no one has set.
    visibleWhen: '{{state.formSuccess}}',
  } as Block,
]

const FORM_BINDINGS_CAPABILITY = {
  capability: 'platform/entities',
  config: {
    formBindings: [
      {
        formId: 'form-1',
        entityType: 'ContactUs',
        statusKeys: { loading: 'formLoading', success: 'formSuccess', error: 'formError' },
      },
    ],
  },
}

describe('DataBoundSurfaceRenderer — formBindings-only surfaces', () => {
  it('takes the data-bound path: visibleWhen bound to unset state is omitted', () => {
    render(
      <DataBoundSurfaceRenderer
        surface={{ blocks, capabilities: [FORM_BINDINGS_CAPABILITY] }}
        components={components as BlockComponentRegistry}
      />
    )
    expect(screen.getByText('ALWAYS VISIBLE')).toBeTruthy()
    // Data-bound path evaluates blocks-array visibleWhen: unset state → falsy → omitted.
    expect(screen.queryByText('SUCCESS ALERT')).toBeNull()
  })

  it('evaluates visibleWhen on a static page (no dataSources/behaviors/formBindings)', () => {
    render(
      <DataBoundSurfaceRenderer
        surface={{ blocks }}
        components={components as BlockComponentRegistry}
      />
    )
    expect(screen.getByText('ALWAYS VISIBLE')).toBeTruthy()
    // This rendered 'SUCCESS ALERT' on the passthrough, which never read
    // the condition. Unset state → falsy → omitted.
    expect(screen.queryByText('SUCCESS ALERT')).toBeNull()
  })

  it('empty formBindings array alone does not opt into the data-bound path', () => {
    const plain = [blocks[0]!]
    expect(surfaceNeedsDataBinding({ blocks: plain })).toBe(false)
    expect(
      surfaceNeedsDataBinding({
        blocks: plain,
        capabilities: [{ capability: 'platform/entities', config: { formBindings: [] } }] as never,
      })
    ).toBe(false)
    // …but the gated block does, whatever the capabilities say.
    expect(
      surfaceNeedsDataBinding({
        blocks,
        capabilities: [{ capability: 'platform/entities', config: { formBindings: [] } }] as never,
      })
    ).toBe(true)
  })
})
