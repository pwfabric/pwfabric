// @vitest-environment jsdom
/**
 * Entities CRUD read+reactive: a kind:'entity' dataSource lists records via the
 * facade ({{id}} → items), and a form→entity create triggers a refresh so the
 * list reflects the new row (form-entity-bridge emits entity:created → refreshAll).
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

const items: { id: string; name: string }[] = [{ id: '1', name: 'Ada' }]
const resolveBinding = vi.fn(async () => ({ items: [...items], total: items.length }))
const create = vi.fn(async (_type: string, data: Record<string, unknown>) => {
  items.push({ id: String(items.length + 1), name: String(data.name) })
  return { success: true, data: { id: 'new' } }
})
const entityFacade = { store: { create }, resolveBinding } as never

const TableBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="count">{Array.isArray(props.data) ? props.data.length : 0}</div>
)
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
          payload: { values: { name: 'Linus' }, formId: 'add-form', timestamp: 0 },
        } as never)
      }
    >
      Save
    </button>
  )
}

const components: Partial<BlockComponentRegistry> = { table: TableBlock as never, form: FormBlock as never }

const L = DEFAULT_BLOCK_LAYOUT
const surface = {
  id: 'phone-dir',
  blocks: [
    { id: 'contacts-list', type: 'table', layout: L, props: { data: '{{contacts}}' } },
    { id: 'add-form', type: 'form', layout: L, props: {} },
  ],
  capabilities: [
    { capability: 'platform/persistence', required: true, config: { dataSources: [{ id: 'contacts', kind: 'entity', entityType: 'contact' }], initialState: {} } },
    { capability: 'platform/entities', required: true, config: { formBindings: [{ formId: 'add-form', sourceId: 'contacts', operation: 'create' }] } },
  ],
} as never

describe('entities LIST + REACTIVE on DataBound path', () => {
  it('lists entity records and refreshes the list after a form→entity create', async () => {
    render(<DataBoundSurfaceRenderer surface={surface} components={components as never} entityFacade={entityFacade} interactionMode="live" />)
    // entity source listed via facade.resolveBinding → table shows 1
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'))
    // create + reactive refresh → table reflects the new row (2)
    fireEvent.click(screen.getByTestId('save'))
    await waitFor(() => expect(create).toHaveBeenCalledWith('contact', { name: 'Linus' }))
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('2'))
  })
})
