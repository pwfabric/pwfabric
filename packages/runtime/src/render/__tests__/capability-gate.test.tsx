/**
 * Capability Gate Tests
 *
 * Entitlement enforcement at the render layer.
 *
 * @module @pwfabric/runtime/render/__tests__/capability-gate
 */

import { describe, it, expect } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { EntitlementProvider, useEntitlements, GatedBlockPlaceholder } from '../capability-gate.js'
import type { SerializedEntitlements } from '@pwfabric/contracts'

// ============================================================
// GatedBlockPlaceholder
// ============================================================

describe('GatedBlockPlaceholder', () => {
  it('renders with correct data attributes', () => {
    const html = renderToString(
      React.createElement(GatedBlockPlaceholder, { blockId: 'blk-1', blockType: 'hero' })
    )
    expect(html).toContain('data-block-id="blk-1"')
    expect(html).toContain('data-gated-block="hero"')
  })

  it('renders block type in display text', () => {
    const html = renderToString(
      React.createElement(GatedBlockPlaceholder, { blockId: 'blk-2', blockType: 'gallery' })
    )
    expect(html).toContain('gallery')
    expect(html).toContain('Install from Marketplace')
  })
})

// ============================================================
// EntitlementProvider + useEntitlements
// ============================================================

// Helper component that reads entitlements via hook
function EntitlementReader({
  onRead,
}: {
  onRead: (ctx: ReturnType<typeof useEntitlements>) => void
}): React.ReactElement {
  const ctx = useEntitlements()
  onRead(ctx)
  return React.createElement('div', null, 'ok')
}

describe('EntitlementProvider', () => {
  it('provides fail-open defaults when entitlements is null', () => {
    let captured: ReturnType<typeof useEntitlements> | undefined

    renderToString(
      React.createElement(
        EntitlementProvider,
        { entitlements: null },
        React.createElement(EntitlementReader, {
          onRead: (ctx) => {
            captured = ctx
          },
        })
      )
    )

    expect(captured?.loaded).toBe(false)
    expect(captured?.isBlockEntitled('any-block')).toBe(true)
    expect(captured?.isCapabilityEntitled('any-cap')).toBe(true)
  })

  it('provides loaded entitlements with proper checks', () => {
    const entitlements: SerializedEntitlements = {
      worldId: 'tenant-1',
      blocks: ['hero', 'text', 'image'],
      capabilities: ['forms', 'analytics'],
      grantedAt: new Date().toISOString(),
    }

    let captured: ReturnType<typeof useEntitlements> | undefined

    renderToString(
      React.createElement(
        EntitlementProvider,
        { entitlements },
        React.createElement(EntitlementReader, {
          onRead: (ctx) => {
            captured = ctx
          },
        })
      )
    )

    expect(captured?.loaded).toBe(true)
    expect(captured?.isBlockEntitled('hero')).toBe(true)
    expect(captured?.isBlockEntitled('unknown-block')).toBe(false)
    expect(captured?.isCapabilityEntitled('forms')).toBe(true)
    expect(captured?.isCapabilityEntitled('unknown-cap')).toBe(false)
  })

  it('exposes entitledBlocks and entitledCapabilities sets', () => {
    const entitlements: SerializedEntitlements = {
      worldId: 'tenant-2',
      blocks: ['cta'],
      capabilities: ['navigation'],
      grantedAt: new Date().toISOString(),
    }

    let captured: ReturnType<typeof useEntitlements> | undefined

    renderToString(
      React.createElement(
        EntitlementProvider,
        { entitlements },
        React.createElement(EntitlementReader, {
          onRead: (ctx) => {
            captured = ctx
          },
        })
      )
    )

    expect(captured?.entitledBlocks.has('cta')).toBe(true)
    expect(captured?.entitledCapabilities.has('navigation')).toBe(true)
  })
})

describe('useEntitlements (default context)', () => {
  it('returns fail-open defaults when no provider present', () => {
    let captured: ReturnType<typeof useEntitlements> | undefined

    renderToString(
      React.createElement(EntitlementReader, {
        onRead: (ctx) => {
          captured = ctx
        },
      })
    )

    expect(captured?.loaded).toBe(false)
    expect(captured?.isBlockEntitled('anything')).toBe(true)
    expect(captured?.isCapabilityEntitled('anything')).toBe(true)
  })
})
