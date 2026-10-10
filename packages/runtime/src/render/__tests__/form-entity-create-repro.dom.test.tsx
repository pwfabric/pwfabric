// @vitest-environment jsdom
/**
 * REPRO: does the DataBound render path attach the form→entity bridge so a
 * form:submit fires entityFacade.store.create? (phone-directory: Save → no POST.)
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor, fireEvent } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())

const createSpy = vi.fn().mockResolvedValue({ success: true, data: { id: 'e1' } })
const entityFacade = { store: { create: createSpy } } as never

// Test 'form' block that emits form:submit (mirrors the real pack form block).
const FormBlock = () => {
  const { emit } = useSurfaceEvents()
  const sid = useSurfaceId()
  return (
    <button
      data-testid="save"
      onClick={() =>
        emit({
          type: SURFACE_EVENTS.FORM_SUBMIT,
          surfaceId: sid,
          blockId: 'add-form',
          payload: { values: { name: 'Linus', phone: '+90 555' }, formId: 'add-form', timestamp: 0 },
        } as never)
      }
    >
      Save
    </button>
  )
}

const components: Partial<BlockComponentRegistry> = { form: FormBlock as never }

const L = DEFAULT_BLOCK_LAYOUT
const surface = {
  id: 'phone-dir',
  blocks: [{ id: 'add-form', type: 'form', layout: L, props: {} }],
  capabilities: [
    { capability: 'platform/persistence', required: true, config: {
        dataSources: [
          { id: 'contacts', kind: 'state' },
          // A form writes to a SOURCE now, so the destination must be one.
          { id: 'contact', kind: 'entity', entityType: 'contact' },
        ],
        initialState: { contacts: [] },
      } },
    { capability: 'platform/entities', required: true, config: { formBindings: [{ formId: 'add-form', sourceId: 'contact', operation: 'create' }] } },
  ],
} as never

describe('REPRO form→entity create on DataBound path', () => {
  it('form:submit calls entityFacade.store.create', async () => {
    render(
      <DataBoundSurfaceRenderer surface={surface} components={components as never} entityFacade={entityFacade} interactionMode="live" />
    )
    fireEvent.click(await screen.findByTestId('save'))
    await waitFor(() => expect(createSpy).toHaveBeenCalled())
    expect(createSpy).toHaveBeenCalledWith('contact', { name: 'Linus', phone: '+90 555' })
  })
})
