// @vitest-environment jsdom
/**
 * DataBoundSurfaceRenderer — action dispatcher (Task A: showBlock/hideBlock/navigate).
 *
 * Tests:
 *  1. isSurfaceAction — type guard accepts all 6 types and rejects junk.
 *  2. setState regression — extraction didn't break the existing path.
 *  3. showBlock/hideBlock — sets __show:<blockId> in surface state.
 *  4. navigate — calls window.location.assign (and NOT in inert mode).
 *
 * @module @pwfabric/runtime/render/__tests__/dispatch-actions.dom
 */

import '../../__tests__/dom-test-setup.js'
import { describe, it, expect, afterEach, vi } from 'vitest'
import * as React from 'react'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { DEFAULT_BLOCK_LAYOUT } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'
import { DataBoundSurfaceRenderer, isSurfaceAction, isSafeNavigateUrl } from '../DataBoundSurfaceRenderer.js'
import { useSurfaceEvents, useSurfaceId } from '../../blocks/index.js'
import type { BlockComponentRegistry } from '../types.js'
import { SURFACE_EVENTS } from '@pwfabric/contracts'

// Capture the real jsdom location before any navigate test replaces it via
// Object.defineProperty — vi.restoreAllMocks() does NOT undo defineProperty, so
// without this restore a stubbed `{ assign }` would leak into later test files
// (run-order-dependent flakiness). Restore it after every test.
const ORIGINAL_LOCATION = window.location

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(window, 'location', {
    value: ORIGINAL_LOCATION,
    writable: true,
    configurable: true,
  })
})

// ============================================================
// FIXTURES
// ============================================================

const L = DEFAULT_BLOCK_LAYOUT

/** Block that renders the entire surfaceState via {{state}} expression. */
const StateDumpBlock = ({ props }: { props: Record<string, unknown> }) => (
  <div data-testid="state-dump" data-state={JSON.stringify(props.surfaceState ?? {})} />
)

/** Button that fires an event (either via event payload action or via block action prop). */
const EventButton = ({ props }: { props: Record<string, unknown> }) => {
  const { emit } = useSurfaceEvents()
  const sid = useSurfaceId()
  return (
    <button
      type="button"
      data-testid={String(props.testId ?? 'btn')}
      onClick={() => {
        const action = props.action
        emit({
          type: SURFACE_EVENTS.BLOCK_CLICK,
          surfaceId: sid,
          blockId: String(props.blockId ?? 'btn'),
          ...(action ? { payload: { action } } : {}),
        } as never)
      }}
    >
      {String(props.label ?? 'click')}
    </button>
  )
}

const components: Partial<BlockComponentRegistry> = {
  dump: StateDumpBlock as never,
  btn: EventButton as never,
}

/** Read the parsed state from the dump block. */
function readState(): Record<string, unknown> {
  const el = screen.getByTestId('state-dump')
  return JSON.parse(el.getAttribute('data-state') ?? '{}') as Record<string, unknown>
}

/** Build a minimal surface with persistence capability. */
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

// ============================================================
// 1. isSurfaceAction — unit
// ============================================================

describe('isSurfaceAction', () => {
  it('accepts setState', () => {
    expect(isSurfaceAction({ type: 'setState', key: 'k', value: 1 })).toBe(true)
  })
  it('accepts refresh', () => {
    expect(isSurfaceAction({ type: 'refresh', sourceId: 'src' })).toBe(true)
  })
  it('accepts refreshAll', () => {
    expect(isSurfaceAction({ type: 'refreshAll' })).toBe(true)
  })
  it('accepts showBlock', () => {
    expect(isSurfaceAction({ type: 'showBlock', blockId: 'b1' })).toBe(true)
  })
  it('accepts hideBlock', () => {
    expect(isSurfaceAction({ type: 'hideBlock', blockId: 'b1' })).toBe(true)
  })
  it('accepts navigate', () => {
    expect(isSurfaceAction({ type: 'navigate', url: 'https://example.com' })).toBe(true)
  })
  it('rejects junk string', () => {
    expect(isSurfaceAction({ type: 'explode' })).toBe(false)
  })
  it('rejects null', () => {
    expect(isSurfaceAction(null)).toBe(false)
  })
  it('rejects primitive', () => {
    expect(isSurfaceAction('setState')).toBe(false)
  })
  it('rejects object with no type', () => {
    expect(isSurfaceAction({ blockId: 'b1' })).toBe(false)
  })
})

// ============================================================
// Integration helpers
// ============================================================

const dumpBlock: Block = {
  id: 'dump-1',
  type: 'dump',
  layout: L,
  props: { surfaceState: '{{state}}' },
}

// ============================================================
// 2. setState regression — extraction didn't break existing path
// ============================================================

describe('setState regression after dispatchAction extraction', () => {
  it('payload.action setState updates state and re-renders', async () => {
    const btnBlock: Block = {
      id: 'btn-set',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-set',
        blockId: 'btn-set',
        label: 'Set',
        action: { type: 'setState', key: 'greeting', value: 'hello' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock], { greeting: '' })
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-set').click()
    })
    await waitFor(() => {
      expect(readState()).toMatchObject({ greeting: 'hello' })
    })
  })
})

// ============================================================
// 3. showBlock / hideBlock — sets __show:<blockId> in state
// ============================================================

describe('showBlock / hideBlock sets __show:<blockId> in surface state', () => {
  it('showBlock sets __show:<blockId> to true', async () => {
    const btnBlock: Block = {
      id: 'btn-show',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-show',
        blockId: 'btn-show',
        label: 'Show',
        action: { type: 'showBlock', blockId: 'target-block' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-show').click()
    })
    await waitFor(() => {
      const state = readState()
      expect(state['__show:target-block']).toBe(true)
    })
  })

  it('hideBlock sets __show:<blockId> to false', async () => {
    const btnBlock: Block = {
      id: 'btn-hide',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-hide',
        blockId: 'btn-hide',
        label: 'Hide',
        action: { type: 'hideBlock', blockId: 'target-block' },
      },
    }
    // Start with it shown, then hide it
    const surface = makeSurface([dumpBlock, btnBlock], { '__show:target-block': true })
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-hide').click()
    })
    await waitFor(() => {
      const state = readState()
      expect(state['__show:target-block']).toBe(false)
    })
  })

  it('showBlock in inert mode does NOT update state', async () => {
    const btnBlock: Block = {
      id: 'btn-show-inert',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-show-inert',
        blockId: 'btn-show-inert',
        label: 'Show (inert)',
        action: { type: 'showBlock', blockId: 'b1' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="inert" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())
    const stateBefore = readState()

    await act(async () => {
      screen.getByTestId('btn-show-inert').click()
    })

    // Give React a moment — state should NOT have changed
    await new Promise((r) => setTimeout(r, 20))
    expect(readState()).toEqual(stateBefore)
  })
})

// ============================================================
// 4. navigate — calls window.location.assign; not in inert mode
// ============================================================

describe('navigate action', () => {
  it('calls window.location.assign with the url in live mode', async () => {
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign: assignSpy },
      writable: true,
      configurable: true,
    })

    const btnBlock: Block = {
      id: 'btn-nav',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-nav',
        blockId: 'btn-nav',
        label: 'Navigate',
        action: { type: 'navigate', url: 'https://example.com' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-nav').click()
    })
    expect(assignSpy).toHaveBeenCalledWith('https://example.com')
  })

  it('does NOT navigate to a javascript: URL (XSS guard wired into dispatch)', async () => {
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign: assignSpy },
      writable: true,
      configurable: true,
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const btnBlock: Block = {
      id: 'btn-nav-xss',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-nav-xss',
        blockId: 'btn-nav-xss',
        label: 'Navigate (xss)',
        action: { type: 'navigate', url: 'javascript:alert(document.cookie)' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="live" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-nav-xss').click()
    })
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('does NOT call window.location.assign in inert mode', async () => {
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign: assignSpy },
      writable: true,
      configurable: true,
    })

    const btnBlock: Block = {
      id: 'btn-nav-inert',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-nav-inert',
        blockId: 'btn-nav-inert',
        label: 'Navigate (inert)',
        action: { type: 'navigate', url: 'https://example.com' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(<DataBoundSurfaceRenderer surface={surface} components={components} interactionMode="inert" />)
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-nav-inert').click()
    })
    expect(assignSpy).not.toHaveBeenCalled()
  })
})

// ============================================================
// 4b. onNavigateAction — host intercept (connected preview)
// ============================================================

describe('navigate action — onNavigateAction host intercept', () => {
  it('skips window.location.assign when onNavigateAction returns true', async () => {
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign: assignSpy },
      writable: true,
      configurable: true,
    })
    const onNavigateAction = vi.fn().mockReturnValue(true)

    const btnBlock: Block = {
      id: 'btn-nav-intercept',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-nav-intercept',
        blockId: 'btn-nav-intercept',
        label: 'Navigate (intercepted)',
        action: { type: 'navigate', url: '/sibling-page' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components}
        interactionMode="live"
        onNavigateAction={onNavigateAction}
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-nav-intercept').click()
    })
    expect(onNavigateAction).toHaveBeenCalledWith('/sibling-page')
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('falls through to window.location.assign when onNavigateAction returns false', async () => {
    const assignSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { assign: assignSpy },
      writable: true,
      configurable: true,
    })
    const onNavigateAction = vi.fn().mockReturnValue(false)

    const btnBlock: Block = {
      id: 'btn-nav-fallthrough',
      type: 'btn',
      layout: L,
      props: {
        testId: 'btn-nav-fallthrough',
        blockId: 'btn-nav-fallthrough',
        label: 'Navigate (fallthrough)',
        action: { type: 'navigate', url: 'https://external.example.com' },
      },
    }
    const surface = makeSurface([dumpBlock, btnBlock])
    render(
      <DataBoundSurfaceRenderer
        surface={surface}
        components={components}
        interactionMode="live"
        onNavigateAction={onNavigateAction}
      />
    )
    await waitFor(() => expect(screen.queryByTestId('state-dump')).not.toBeNull())

    await act(async () => {
      screen.getByTestId('btn-nav-fallthrough').click()
    })
    expect(onNavigateAction).toHaveBeenCalledWith('https://external.example.com')
    expect(assignSpy).toHaveBeenCalledWith('https://external.example.com')
  })
})

// ============================================================
// 5. isSafeNavigateUrl — XSS guard
// ============================================================

describe('isSafeNavigateUrl', () => {
  it('allows http(s) absolute URLs', () => {
    expect(isSafeNavigateUrl('https://example.com/x')).toBe(true)
    expect(isSafeNavigateUrl('http://example.com')).toBe(true)
    expect(isSafeNavigateUrl('HTTPS://EXAMPLE.COM')).toBe(true)
  })

  it('allows relative / anchor / query / protocol-relative URLs', () => {
    expect(isSafeNavigateUrl('/dashboard')).toBe(true)
    expect(isSafeNavigateUrl('#section')).toBe(true)
    expect(isSafeNavigateUrl('?tab=1')).toBe(true)
    expect(isSafeNavigateUrl('//example.com/x')).toBe(true)
  })

  it('rejects javascript: and other dangerous schemes', () => {
    expect(isSafeNavigateUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeNavigateUrl('JavaScript:alert(1)')).toBe(false)
    expect(isSafeNavigateUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeNavigateUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeNavigateUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects scheme-smuggling via whitespace/control chars', () => {
    expect(isSafeNavigateUrl('  javascript:alert(1)')).toBe(false)
    expect(isSafeNavigateUrl('java\tscript:alert(1)')).toBe(false)
    expect(isSafeNavigateUrl('java\nscript:alert(1)')).toBe(false)
  })

  it('rejects empty and non-string input', () => {
    expect(isSafeNavigateUrl('')).toBe(false)
    expect(isSafeNavigateUrl('   ')).toBe(false)
    expect(isSafeNavigateUrl(null)).toBe(false)
    expect(isSafeNavigateUrl(undefined)).toBe(false)
    expect(isSafeNavigateUrl(123)).toBe(false)
  })
})
