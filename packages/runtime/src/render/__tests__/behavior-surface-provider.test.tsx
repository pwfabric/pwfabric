/**
 * BehaviorSurfaceProvider Tests
 *
 * Verifies that BehaviorSurfaceProvider correctly wires
 * SurfaceIdContext and SurfaceEventContext for its subtree.
 *
 * Uses renderToString + consumer component pattern (SSR-safe, no jsdom).
 *
 * @module @pwfabric/runtime/render/__tests__/behavior-surface-provider
 */

import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { BehaviorSurfaceProvider } from '../BehaviorSurfaceProvider.js'
import { useSurfaceId } from '../hooks/useSurfaceId.js'
import { useSurfaceEvents } from '../hooks/useSurfaceEvents.js'

// ============================================================
// CONSUMER COMPONENTS
// ============================================================

/**
 * Reads surfaceId from context and exposes it as a data attribute.
 */
function SurfaceIdReader(): React.ReactNode {
  const id = useSurfaceId()
  return <div data-surface-id={id} />
}

/**
 * Reads the bus from context and exposes whether emit is a function.
 */
function BusReader(): React.ReactNode {
  const { emit } = useSurfaceEvents()
  return <div data-emit-type={typeof emit} />
}

// ============================================================
// TESTS
// ============================================================

describe('BehaviorSurfaceProvider', () => {
  describe('children rendering', () => {
    it('renders children without error', () => {
      expect(() =>
        renderToString(
          <BehaviorSurfaceProvider surfaceId="s-1">
            <span>hello</span>
          </BehaviorSurfaceProvider>
        )
      ).not.toThrow()
    })

    it('renders child content in the output', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="s-1">
          <span data-testid="child">content</span>
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-testid="child"')
      expect(html).toContain('content')
    })
  })

  describe('useSurfaceId — provider wiring', () => {
    it('passes the correct surfaceId to consuming children', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="surface-abc">
          <SurfaceIdReader />
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-surface-id="surface-abc"')
    })

    it('passes a different surfaceId when provider uses a different value', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="surface-xyz">
          <SurfaceIdReader />
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-surface-id="surface-xyz"')
    })
  })

  describe('useSurfaceId — outside provider', () => {
    it('returns empty string when used outside any BehaviorSurfaceProvider', () => {
      const html = renderToString(<SurfaceIdReader />)
      expect(html).toContain('data-surface-id=""')
    })
  })

  describe('useSurfaceEvents — bus access', () => {
    it('provides a bus with emit as a function inside the provider', () => {
      const html = renderToString(
        <BehaviorSurfaceProvider surfaceId="s-1">
          <BusReader />
        </BehaviorSurfaceProvider>
      )
      expect(html).toContain('data-emit-type="function"')
    })
  })

  describe('nested providers — isolation', () => {
    it('two sibling providers pass their own surfaceIds to their respective children', () => {
      const html = renderToString(
        <div>
          <BehaviorSurfaceProvider surfaceId="parent-a">
            <SurfaceIdReader />
          </BehaviorSurfaceProvider>
          <BehaviorSurfaceProvider surfaceId="parent-b">
            <SurfaceIdReader />
          </BehaviorSurfaceProvider>
        </div>
      )
      expect(html).toContain('data-surface-id="parent-a"')
      expect(html).toContain('data-surface-id="parent-b"')
    })
  })
})
