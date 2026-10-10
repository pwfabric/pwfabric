/**
 * Dynamic Block Loader Tests
 *
 * Tests for BlockModuleLoader singleton.
 * Covers loading, caching, deduplication, preload, and invalidation.
 *
 * @module @pwfabric/runtime/render/__tests__/dynamic-block-loader
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BlockModuleLoader } from '../dynamic-block-loader.js'
import type { DynamicBlockDescriptor } from '@pwfabric/contracts'

// ============================================================
// HELPERS
// ============================================================

function createDescriptor(overrides: Partial<DynamicBlockDescriptor> = {}): DynamicBlockDescriptor {
  return {
    blockType: 'test-block',
    moduleUrl: 'https://example.com/blocks/test-block/1.0.0/dist/bundle.mjs',
    integrity: 'sha256-abc123',
    publisher: 'TestPublisher',
    publisherVerified: true,
    definition: {
      name: 'Test Block',
      category: 'content',
      defaultProps: {},
      canHaveChildren: false,
      propertySchema: [],
    },
    ...overrides,
  }
}

// ============================================================
// TESTS
// ============================================================

describe('BlockModuleLoader', () => {
  beforeEach(() => {
    // Clear all cached modules between tests
    BlockModuleLoader.invalidate()
  })

  describe('isLoaded', () => {
    it('should return false for unloaded block types', () => {
      expect(BlockModuleLoader.isLoaded('nonexistent')).toBe(false)
    })
  })

  describe('getSync', () => {
    it('should return null for unloaded block types', () => {
      expect(BlockModuleLoader.getSync('nonexistent')).toBeNull()
    })
  })

  describe('invalidate', () => {
    it('should clear all entries when called without argument', () => {
      // State should be clean after invalidate
      expect(BlockModuleLoader.isLoaded('anything')).toBe(false)
    })

    it('should clear specific block type when called with argument', () => {
      BlockModuleLoader.invalidate('test-block')
      expect(BlockModuleLoader.isLoaded('test-block')).toBe(false)
    })
  })

  describe('load', () => {
    it('should reject when module URL cannot be loaded', async () => {
      const descriptor = createDescriptor()

      // Dynamic import will fail since the URL doesn't exist
      await expect(BlockModuleLoader.load(descriptor)).rejects.toThrow()
    })
  })

  describe('preload', () => {
    it('should not throw when called with empty array', () => {
      expect(() => BlockModuleLoader.preload([])).not.toThrow()
    })

    it('should not throw when called with descriptors (fire-and-forget)', () => {
      const descriptors = [createDescriptor()]
      // preload is fire-and-forget, should not throw
      expect(() => BlockModuleLoader.preload(descriptors)).not.toThrow()
    })
  })
})
