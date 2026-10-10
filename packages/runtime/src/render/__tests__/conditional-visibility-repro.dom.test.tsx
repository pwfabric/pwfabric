// @vitest-environment jsdom
/**
 * REPRO: conditional visibility (visibleWhen/if) on a persistence-capability
 * surface — does form↔success gating hide blocks at load on the DataBound path?
 *
 * Mirrors the phone-directory staging surface: a contacts dataSource (kind:state)
 * + initialState {formOpen:false, submitted:false} + blocks gated on those.
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import type { Block } from '@pwfabric/core'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())

const box =
  (testid: string) =>
  ({ props }: { props: Record<string, unknown> }) => (
    <div data-testid={testid}>{String(props.title ?? '')}</div>
  )

const components: Partial<BlockComponentRegistry> = {
  alert: box('alert') as never,
  section: box('section') as never,
}

const L = DEFAULT_BLOCK_LAYOUT
const blocks: Block[] = [
  { id: 'anchor', type: 'alert', layout: L, props: { title: 'ANCHOR' } },
  { id: 'success-banner', type: 'alert', layout: L, props: { title: 'Contact added' }, if: '{{state.submitted}}' } as never,
  { id: 'table-section', type: 'section', layout: L, props: { title: 'TABLE' } },
  { id: 'form-section', type: 'section', layout: L, props: { title: 'FORM' }, if: '{{state.formOpen}}' } as never,
]

const initialState = { formOpen: false, submitted: false, contacts: [{ name: 'Ada' }] }
const persistenceCap = {
  capability: 'platform/persistence',
  required: true,
  config: { dataSources: [{ id: 'contacts', kind: 'state' }], initialState },
}

describe('REPRO conditional visibility (DataBound path)', () => {
  it('gates success+form at load (submitted/formOpen = false)', async () => {
    render(
      <DataBoundSurfaceRenderer
        surface={{ blocks, capabilities: [persistenceCap] } as never}
        components={components as never}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByText('ANCHOR')).not.toBeNull()) // loaded
    // table-section is always visible; form-section gated → exactly 1 section
    expect(screen.queryByText('TABLE')).not.toBeNull()
    expect(screen.queryByText('FORM')).toBeNull() // form-section HIDDEN (formOpen=false)
    expect(screen.queryByText('Contact added')).toBeNull() // success HIDDEN (submitted=false)
  })
})
