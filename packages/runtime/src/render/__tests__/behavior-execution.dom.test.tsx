// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — behavior execution (Task C).
 *
 * Tests:
 *  1. canonicalizeEventType — unit: colon/dot/plain normalization.
 *  2. block:click behavior with matching targetBlockId runs its action.
 *  3. block:click behavior with mismatched targetBlockId does NOT run.
 *  4. form:submit behavior with no targetBlockId runs on the form event.
 *  5. Behaviors do NOT run in interactionMode="inert".
 *  6. Surface with behaviors but NO dataSources still executes (fast-path guard).
 *
 * @module @pwfabric/runtime/render/__tests__/behavior-execution.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import {
  DataBoundSurfaceRenderer,
  canonicalizeEventType,
} from '../DataBoundSurfaceRenderer.js'
import type { RuntimeBehavior } from '../data-binding-types.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'
import { SURFACE_EVENTS } from '@pwfabric/contracts'

afterEach(() => {
  cleanup()
})

// ============================================================
// FIXTURES
// ============================================================

const L = DEFAULT_BLOCK_LAYOUT

/** Block that renders the entire surfaceState via {{state}} expression. */
const StateDumpBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="state-dump" data-state={JSON.stringify(props.surfaceState ?? {})} />
)

/** Button that fires BLOCK_CLICK on the bus. */
const ClickButton = ({ props }: { props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const sid = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={String(props.testId ?? 'btn')}
      onClick={() => {
        emit({
          type: SURFACE_EVENTS.BLOCK_CLICK,
          surfaceId: sid,
          blockId: String(props.blockId ?? 'btn'),
        } as never)
      }}
    >
      click
    </button>
  )
}

/** Button that fires FORM_SUBMIT on the bus. */
const SubmitButton = ({ props }: { props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const sid = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={String(props.testId ?? 'submit-btn')}
      onClick={() => {
        emit({
          type: SURFACE_EVENTS.FORM_SUBMIT,
          surfaceId: sid,
          blockId: String(props.blockId ?? 'form'),
        } as never)
      }}
    >
      submit
    </button>
  )
}

/**
 * Button that calls `context.onEvent` DIRECTLY — the pre-bus legacy path some
 * deployed block bundles still use instead of `useSurfaceEvents().emit()`.
 * This event never passes through the bus's `busOnEvent` bridge, so it never
 * gets `canonicalType` stamped (`handleEvent` must still
 * match stored behaviors for a canonicalType-less 'click' event).
 */
const LegacyOnEventButton = ({
  props,
  block,
  context,
}: {
  props: Record<string, unknown>
  block: { id: string }
  context: { onEvent?: (e: { type: string; blockId: string }) => void }
}) => (
  <button
    type="button"
    data-testid={String(props.testId ?? 'legacy-btn')}
    onClick={() => {
      context.onEvent?.({ type: (props.eventType as string) ?? 'click', blockId: block.id })
    }}
  >
    legacy event
  </button>
)

const components: Partial<BlockComponentRegistry> = {
  dump: StateDumpBlock as never,
  clickbtn: ClickButton as never,
  submitbtn: SubmitButton as never,
  legacybtn: LegacyOnEventButton as never,
}

/** Read the parsed state from the dump block. */
function readState(): Record<string, unknown> {
  const el = screen.getByTestId('state-dump')
  return JSON.parse(el.getAttribute('data-state') ?? '{}') as Record<string, unknown>
}

const dumpBlock: Block = {
  id: 'dump-1',
  type: 'dump',
  layout: L,
  props: { surfaceState: '{{state}}' },
}

/** Surface with platform/persistence (has dataSources so DataBoundInner is used). */
function makeSurface(blocks: Block[], initialState: Record<string, unknown> = {}): never {
  return {
    blocks,
    capabilities: [
      {
        capability: 'platform/persistence',
        required: true,
        config: {
          dataSources: [{ id: 'data', kind: 'static', staticData: [] }],
          initialState,
        },
      },
    ],
  } as never
}

/** Surface with NO dataSources — exercises the fast-path guard. */
function makeSurfaceNoDatasources(
  blocks: Block[],
  initialState: Record<string, unknown> = {}
): never {
  return {
    blocks,
    capabilities: [
      {
        capability: 'platform/persistence',
        required: true,
        config: { initialState },
      },
    ],
  } as never
}

// ============================================================
// 1. canonicalizeEventType — unit
// ============================================================

describe('canonicalizeEventType', () => {
  it("passes 'block:click' through unchanged", () => {
    expect(canonicalizeEventType('block:click')).toBe('block:click')
  })

  it("converts 'surface.load' to 'surface:load'", () => {
    expect(canonicalizeEventType('surface.load')).toBe('surface:load')
  })

  it("lowercases 'CLICK' to 'click'", () => {
    expect(canonicalizeEventType('CLICK')).toBe('click')
  })

  it('trims whitespace', () => {
    expect(canonicalizeEventType('  block:click  ')).toBe('block:click')
  })

  it('lowercases colon-form events', () => {
    expect(canonicalizeEventType('FORM:SUBMIT')).toBe('form:submit')
  })

  it('converts only the first dot', () => {
    expect(canonicalizeEventType('a.b.c')).toBe('a:b.c')
  })
})

// ============================================================
// 2. block:click behavior — targetBlockId MATCH → action runs
// ============================================================

describe('behavior block:click with matching targetBlockId', () => {
  it('runs setState action when blockId matches', async () => {
    const clickerBlock: Block = {
      id: 'btn-a',
      type: 'clickbtn',
      layout: L,
      props: { testId: 'btn-a', blockId: 'btn-a' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b1',
        event: 'block:click',
        targetBlockId: 'btn-a',
        actions: [{ type: 'setState', key: 'clicked', value: true }],
      },
    ]
    const surface = makeSurface([dumpBlock, clickerBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-a').click()
    })

    await waitFor(() => {
      expect(readState()).toMatchObject({ clicked: true })
    })
  })
})

// ============================================================
// 3. block:click behavior — targetBlockId MISMATCH → no action
// ============================================================

describe('behavior block:click with mismatched targetBlockId', () => {
  it('does NOT run action when blockId does not match targetBlockId', async () => {
    const clickerBlock: Block = {
      id: 'btn-b',
      type: 'clickbtn',
      layout: L,
      props: { testId: 'btn-b', blockId: 'btn-b' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b2',
        event: 'block:click',
        targetBlockId: 'some-other-block',
        actions: [{ type: 'setState', key: 'wrongTarget', value: true }],
      },
    ]
    const surface = makeSurface([dumpBlock, clickerBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())
    const stateBefore = readState()

    await act(async () => {
      screen.getByTestId('btn-b').click()
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(readState()).toEqual(stateBefore)
  })
})

// ============================================================
// 4. form:submit behavior — no targetBlockId → runs on submit event
// ============================================================

describe('form:submit behavior with no targetBlockId', () => {
  it('runs action on form:submit bus event', async () => {
    const submitBlock: Block = {
      id: 'form-submit-btn',
      type: 'submitbtn',
      layout: L,
      props: { testId: 'form-submit-btn', blockId: 'my-form' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b3',
        event: 'form:submit',
        actions: [{ type: 'setState', key: 'submitted', value: true }],
      },
    ]
    const surface = makeSurface([dumpBlock, submitBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('form-submit-btn').click()
    })

    await waitFor(() => {
      expect(readState()).toMatchObject({ submitted: true })
    })
  })
})

// ============================================================
// 5. Behaviors do NOT run in interactionMode="inert"
// ============================================================

describe('behaviors in inert mode', () => {
  it('does NOT run behavior actions when interactionMode is inert', async () => {
    const clickerBlock: Block = {
      id: 'btn-inert',
      type: 'clickbtn',
      layout: L,
      props: { testId: 'btn-inert', blockId: 'btn-inert' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b4',
        event: 'block:click',
        targetBlockId: 'btn-inert',
        actions: [{ type: 'setState', key: 'shouldNotSet', value: true }],
      },
    ]
    const surface = makeSurface([dumpBlock, clickerBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="inert"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())
    const stateBefore = readState()

    await act(async () => {
      screen.getByTestId('btn-inert').click()
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(readState()).toEqual(stateBefore)
  })
})

// ============================================================
// 6. Surface with behaviors but NO dataSources — fast-path guard
// ============================================================

describe('behaviors with no dataSources (fast-path guard)', () => {
  it('executes behavior actions even when the surface has no dataSources', async () => {
    const clickerBlock: Block = {
      id: 'btn-nodatasrc',
      type: 'clickbtn',
      layout: L,
      props: { testId: 'btn-nodatasrc', blockId: 'btn-nodatasrc' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b5',
        event: 'block:click',
        targetBlockId: 'btn-nodatasrc',
        actions: [{ type: 'showBlock', blockId: 'reveal-block' }],
      },
    ]
    // No dataSources in this surface
    const surface = makeSurfaceNoDatasources([dumpBlock, clickerBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-nodatasrc').click()
    })

    await waitFor(() => {
      expect(readState()).toMatchObject({ '__show:reveal-block': true })
    })
  })
})

// ============================================================
// 7. block:click behavior — matches a canonicalType-less legacy click event
//    (connected preview click-through)
// ============================================================

describe('behavior block:click with a canonicalType-less legacy click event', () => {
  it('still runs the action when the block calls context.onEvent directly (no bus, no canonicalType)', async () => {
    const legacyBlock: Block = {
      id: 'btn-legacy',
      type: 'legacybtn',
      layout: L,
      props: { testId: 'btn-legacy' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b6',
        event: 'block:click',
        targetBlockId: 'btn-legacy',
        actions: [{ type: 'setState', key: 'legacyClicked', value: true }],
      },
    ]
    const surface = makeSurface([dumpBlock, legacyBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-legacy').click()
    })

    await waitFor(() => {
      expect(readState()).toMatchObject({ legacyClicked: true })
    })
  })

  it('does not misfire a block:click behavior for a canonicalType-less non-click event', async () => {
    const legacyBlock: Block = {
      id: 'btn-legacy-change',
      type: 'legacybtn',
      layout: L,
      props: { testId: 'btn-legacy-change', eventType: 'change' },
    }
    const behaviors: RuntimeBehavior[] = [
      {
        id: 'b7',
        event: 'block:click',
        targetBlockId: 'btn-legacy-change',
        actions: [{ type: 'setState', key: 'shouldNotFire', value: true }],
      },
    ]
    const surface = makeSurface([dumpBlock, legacyBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        behaviors={behaviors}
        components={components}
        interactionMode="live"
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())
    const stateBefore = readState()

    await act(async () => {
      screen.getByTestId('btn-legacy-change').click()
    })

    await new Promise((r) => setTimeout(r, 20))
    expect(readState()).toEqual(stateBefore)
  })
})
