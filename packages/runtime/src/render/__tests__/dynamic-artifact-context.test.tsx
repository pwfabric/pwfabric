/**
 * Dynamic Artifact Context Tests
 *
 * Tests for DynamicArtifactProvider and hooks.
 * Covers provider wiring, hook access, preloading, and empty state.
 *
 * @module @pwfabric/runtime/render/__tests__/dynamic-artifact-context
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as React from 'react'
import { renderToString } from 'react-dom/server'
import type { DynamicBlockDescriptor, DynamicStarterDescriptor } from '@pwfabric/contracts'
import {
  DynamicArtifactProvider,
  useDynamicBlocks,
  useDynamicStarters,
} from '../dynamic-artifact-context.js'

// Mock the BlockModuleLoader to prevent actual module loading
vi.mock('../dynamic-block-loader.js', () => ({
  BlockModuleLoader: {
    preload: vi.fn(),
    load: vi.fn(),
    isLoaded: vi.fn().mockReturnValue(false),
    invalidate: vi.fn(),
  },
}))

// ============================================================
// HELPERS
// ============================================================

function createBlockDescriptor(
  overrides: Partial<DynamicBlockDescriptor> = {}
): DynamicBlockDescriptor {
  return {
    blockType: 'custom-chart',
    moduleUrl: 'https://api.example.com/artifacts/mp/custom-chart/1.0.0/dist/bundle.mjs',
    integrity: 'sha256-abc123',
    publisher: 'TestPub',
    publisherVerified: true,
    definition: {
      name: 'Custom Chart',
      category: 'content',
      defaultProps: { type: 'bar' },
      canHaveChildren: false,
      propertySchema: [],
    },
    ...overrides,
  }
}

function createStarterDescriptor(
  overrides: Partial<DynamicStarterDescriptor> = {}
): DynamicStarterDescriptor {
  return {
    starterId: 'analytics-dashboard',
    name: 'Analytics Dashboard',
    description: 'A starter with analytics blocks',
    category: 'general',
    blocks: [],
    publisher: 'TestPub',
    publisherVerified: true,
    requiredBlockTypes: ['custom-chart'],
    ...overrides,
  }
}

/**
 * Test component that reads dynamic blocks and renders a summary.
 */
function BlockReader(): React.ReactNode {
  const { blocks, isLoaded } = useDynamicBlocks()
  return (
    <div
      data-loaded={String(isLoaded)}
      data-count={blocks.size}
      data-types={Array.from(blocks.keys()).join(',')}
    />
  )
}

/**
 * Test component that reads dynamic starters and renders a summary.
 */
function StarterReader(): React.ReactNode {
  const { starters, isLoaded } = useDynamicStarters()
  return (
    <div
      data-loaded={String(isLoaded)}
      data-count={starters.size}
      data-ids={Array.from(starters.keys()).join(',')}
    />
  )
}

// ============================================================
// TESTS
// ============================================================

describe('DynamicArtifactProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useDynamicBlocks', () => {
    it('should return empty map when no blocks provided', () => {
      const html = renderToString(
        <DynamicArtifactProvider>
          <BlockReader />
        </DynamicArtifactProvider>
      )

      expect(html).toContain('data-loaded="true"')
      expect(html).toContain('data-count="0"')
    })

    it('should provide block descriptors indexed by blockType', () => {
      const blocks = [
        createBlockDescriptor({ blockType: 'chart-a' }),
        createBlockDescriptor({ blockType: 'chart-b' }),
      ]

      const html = renderToString(
        <DynamicArtifactProvider dynamicBlocks={blocks}>
          <BlockReader />
        </DynamicArtifactProvider>
      )

      expect(html).toContain('data-count="2"')
      expect(html).toContain('chart-a')
      expect(html).toContain('chart-b')
      expect(html).toContain('data-loaded="true"')
    })

    it('should report isLoaded=false while descriptors are still loading', () => {
      const html = renderToString(
        <DynamicArtifactProvider isLoaded={false}>
          <BlockReader />
        </DynamicArtifactProvider>
      )

      // Client editors pass the live loading state so consumers can tell
      // "still loading" apart from "no descriptor" (avoids the unknown flash).
      expect(html).toContain('data-loaded="false"')
      expect(html).toContain('data-count="0"')
    })
  })

  describe('useDynamicStarters', () => {
    it('should return empty map when no starters provided', () => {
      const html = renderToString(
        <DynamicArtifactProvider>
          <StarterReader />
        </DynamicArtifactProvider>
      )

      expect(html).toContain('data-loaded="true"')
      expect(html).toContain('data-count="0"')
    })

    it('should provide starter descriptors indexed by starterId', () => {
      const starters = [
        createStarterDescriptor({ starterId: 'starter-a' }),
        createStarterDescriptor({ starterId: 'starter-b' }),
      ]

      const html = renderToString(
        <DynamicArtifactProvider dynamicStarters={starters}>
          <StarterReader />
        </DynamicArtifactProvider>
      )

      expect(html).toContain('data-count="2"')
      expect(html).toContain('starter-a')
      expect(html).toContain('starter-b')
      expect(html).toContain('data-loaded="true"')
    })
  })

  describe('combined provider', () => {
    it('should provide both blocks and starters simultaneously', () => {
      const blocks = [createBlockDescriptor()]
      const starters = [createStarterDescriptor()]

      const html = renderToString(
        <DynamicArtifactProvider dynamicBlocks={blocks} dynamicStarters={starters}>
          <BlockReader />
          <StarterReader />
        </DynamicArtifactProvider>
      )

      // Both should be populated
      expect(html).toContain('data-count="1"')
      expect(html).toContain('data-loaded="true"')
    })
  })
})
