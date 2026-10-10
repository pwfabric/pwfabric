// @vitest-environment jsdom
/**
 * Surface bus subscription timing.
 *
 * `bus.emit` is synchronous and unbuffered — an event emitted while nobody is
 * listening is dropped and never replayed. React runs effects CHILD-FIRST, so
 * any subscription owned by `BehaviorSurfaceProvider` attaches only after every
 * block's own mount effect has already run. While the provider subscribed from
 * an effect, a block that emitted on mount had its event silently swallowed —
 * deterministically, not as a race.
 *
 * The same gap opened more narrowly for ordinary interactions landing between a
 * commit and its passive-effect flush, which is what made `dispatch-actions.dom`
 * and `entity-list-reactive-repro.dom` intermittently fail.
 *
 * These tests pin the mount-time case because it is the deterministic one: both
 * fail outright if a subscription moves back into an effect.
 *
 * @module @pwfabric/runtime/render/__tests__/surface-bus-subscription-timing.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, cleanup, screen, waitFor } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import { SURFACE_EVENTS } from '@pwfabric/contracts'
import { DataBoundSurfaceRenderer } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'

afterEach(() => cleanup())

const L = DEFAULT_BLOCK_LAYOUT

/** Renders the resolved surface state so assertions can read it back. */
const StateDumpBlock = ({ props }: { props: Record<string, unknown> }): React.ReactElement => (
  <div data-testid="state-dump" data-state={JSON.stringify(props.surfaceState ?? {})} />
)

function readState(): Record<string, unknown> {
  const el = screen.getByTestId('state-dump')
  return JSON.parse(el.getAttribute('data-state') ?? '{}') as Record<string, unknown>
}

const dumpBlock = {
  id: 'dump-1',
  type: 'dump',
  layout: L,
  props: { surfaceState: '{{state}}' },
}

/** Emits a declarative action from its OWN mount effect — i.e. before any
 *  effect owned by an ancestor could have subscribed. */
const ShowOnMountBlock = (): React.ReactElement => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  React.useEffect(() => {
    emit({
      type: SURFACE_EVENTS.BLOCK_CLICK,
      surfaceId,
      blockId: 'mount-emitter',
      payload: { action: { type: 'showBlock', blockId: 'revealed' } },
    } as never)
  }, [emit, surfaceId])
  return <div data-testid="mount-emitter" />
}

/** Submits a form from its own mount effect (auto-submit on load). */
const SubmitOnMountBlock = (): React.ReactElement => {
  const { emit } = useSurfaceEvents()
  const surfaceId = useSurfaceId()
  React.useEffect(() => {
    emit({
      type: SURFACE_EVENTS.FORM_SUBMIT,
      surfaceId,
      blockId: 'auto-form',
      payload: { values: { name: 'Grace' }, formId: 'auto-form', timestamp: 0 },
    } as never)
  }, [emit, surfaceId])
  return <div data-testid="auto-form" />
}

const components: Partial<BlockComponentRegistry> = {
  dump: StateDumpBlock as never,
  shower: ShowOnMountBlock as never,
  autoform: SubmitOnMountBlock as never,
}

const persistence = {
  capability: 'platform/persistence',
  required: true,
  config: {
    dataSources: [
      { id: 'data', kind: 'static', staticData: [] },
      { id: 'contact', kind: 'entity', entityType: 'contact' },
    ],
    initialState: {},
  },
}

describe('surface bus subscriptions are live before blocks mount', () => {
  it('delivers an action emitted from a block mount effect to the renderer', async () => {
    const surface = {
      blocks: [dumpBlock, { id: 'mount-1', type: 'shower', layout: L, props: {} }],
      capabilities: [persistence],
    } as never

    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components as never}
        interactionMode="live"
      />
    )

    await waitFor(() => expect(readState()['__show:revealed']).toBe(true))
  })

  it('notifies the host of an event emitted from a block mount effect', async () => {
    const seen: string[] = []
    const surface = {
      blocks: [dumpBlock, { id: 'mount-1', type: 'shower', layout: L, props: {} }],
      capabilities: [persistence],
    } as never

    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components as never}
        interactionMode="live"
        onEvent={((e: { canonicalType?: string }) => seen.push(e.canonicalType ?? '')) as never}
      />
    )

    await waitFor(() => expect(seen).toContain(SURFACE_EVENTS.BLOCK_CLICK))
  })

  it('routes a form submitted from a mount effect to the entity bridge', async () => {
    const create = vi.fn(async () => ({ success: true, data: { id: 'new' } }))
    const entityFacade = {
      store: { create },
      resolveBinding: vi.fn(async () => ({ items: [], total: 0 })),
    } as never

    const surface = {
      blocks: [dumpBlock, { id: 'auto-1', type: 'autoform', layout: L, props: {} }],
      capabilities: [
        persistence,
        {
          capability: 'platform/entities',
          required: true,
          config: {
            formBindings: [{ formId: 'auto-form', sourceId: 'contact', operation: 'create' }],
          },
        },
      ],
    } as never

    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components as never}
        entityFacade={entityFacade}
        interactionMode="live"
      />
    )

    await waitFor(() => expect(create).toHaveBeenCalledWith('contact', { name: 'Grace' }))
  })
})
