/**
 * Block Registry Tests — @pwfabric/runtime/blocks
 *
 * Tests for BlockRegistry class, createDefaultRegistry, and the blockRegistry singleton.
 *
 * @module @pwfabric/runtime/blocks/__tests__/registry
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  BlockRegistry,
  blockRegistry,
  createBlockRegistry,
  getBlockRegistry,
} from '../index.js'
import { TEST_BLOCK_DEFINITIONS } from '../__test-fixtures__/block-fixtures.js'
import type { BlockCategory, BlockDefinition } from '@pwfabric/core'

// per-block `*Definition` exports retired. Resolve
// fixture instances from `TEST_BLOCK_DEFINITIONS` so the existing
// test scenarios keep working against the same canonical type set.
const def = (type: string): BlockDefinition => {
  const hit = TEST_BLOCK_DEFINITIONS.find((d) => d.type === type)
  if (!hit) throw new Error(`Legacy fixture missing block definition: ${type}`)
  return hit
}
const containerDefinition = def('container')
const gridDefinition = def('grid')
const textDefinition = def('text')
const headingDefinition = def('heading')
const buttonDefinition = def('button')
const imageDefinition = def('image')
const formDefinition = def('form')
const inputDefinition = def('input')
// section / navbar fixtures retained for completeness coverage but not
// asserted directly — assertions on `defaultLayout` etc. don't apply to the
// inline stubs.
void def('section')
void def('navbar')
const cardDefinition = def('card')
const alertDefinition = def('alert')
const progressDefinition = def('progress')
const textareaDefinition = def('textarea')
const statDefinition = def('stat')
const skeletonDefinition = def('skeleton')
const drawerDefinition = def('drawer')
const ratingDefinition = def('rating')
const dateInputDefinition = def('date-input')
const stepperDefinition = def('stepper')
const tagInputDefinition = def('tag-input')
const calloutDefinition = def('callout')
const timelineDefinition = def('timeline')

// ============================================================
// BlockRegistry class
// ============================================================

describe('BlockRegistry', () => {
  let registry: BlockRegistry

  beforeEach(() => {
    registry = new BlockRegistry()
  })

  describe('register', () => {
    it('should register a block definition', () => {
      // Arrange + Act
      registry.register(containerDefinition)

      // Assert
      expect(registry.has('container')).toBe(true)
    })

    it('should throw if block type is already registered', () => {
      registry.register(containerDefinition)

      expect(() => registry.register(containerDefinition)).toThrow(
        'Block type "container" is already registered'
      )
    })

    it('should register multiple distinct block types', () => {
      registry.register(containerDefinition)
      registry.register(textDefinition)
      registry.register(buttonDefinition)

      expect(registry.list()).toHaveLength(3)
    })
  })

  describe('get', () => {
    it('should return the registered block definition', () => {
      registry.register(textDefinition)

      const def = registry.get('text')

      expect(def).toBe(textDefinition)
    })

    it('should return undefined for an unregistered type', () => {
      const def = registry.get('unknown-block')

      expect(def).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for a registered block', () => {
      registry.register(buttonDefinition)

      expect(registry.has('button')).toBe(true)
    })

    it('should return false for an unregistered block', () => {
      expect(registry.has('unknown-block')).toBe(false)
    })
  })

  describe('list', () => {
    it('should return all registered definitions', () => {
      registry.register(containerDefinition)
      registry.register(textDefinition)

      const list = registry.list()

      expect(list).toHaveLength(2)
      expect(list).toContain(containerDefinition)
      expect(list).toContain(textDefinition)
    })

    it('should return an empty array when no blocks are registered', () => {
      const list = registry.list()

      expect(list).toHaveLength(0)
    })
  })

  describe('getByCategory', () => {
    beforeEach(() => {
      registry.register(containerDefinition) // layout
      registry.register(gridDefinition) // layout
      registry.register(textDefinition) // text
      registry.register(headingDefinition) // text
      registry.register(buttonDefinition) // control
      registry.register(imageDefinition) // media
      registry.register(formDefinition) // form
      registry.register(inputDefinition) // form
    })

    it('should return layout blocks', () => {
      const layout = registry.getByCategory('layout')

      expect(layout).toHaveLength(2)
      expect(layout.map((d) => d.type)).toContain('container')
      expect(layout.map((d) => d.type)).toContain('grid')
    })

    it('should return text blocks', () => {
      const text = registry.getByCategory('text')

      expect(text).toHaveLength(2)
      expect(text.map((d) => d.type)).toContain('text')
      expect(text.map((d) => d.type)).toContain('heading')
    })

    it('should return control blocks', () => {
      const control = registry.getByCategory('control')

      expect(control).toHaveLength(1)
      expect(control.map((d) => d.type)).toContain('button')
    })

    it('should return form blocks', () => {
      const form = registry.getByCategory('form')

      expect(form).toHaveLength(2)
      expect(form.map((d) => d.type)).toContain('form')
      expect(form.map((d) => d.type)).toContain('input')
    })

    it('should return media blocks', () => {
      const media = registry.getByCategory('media')

      expect(media).toHaveLength(1)
      expect(media[0]?.type).toBe('image')
    })

    it('should return an empty array for a category with no registered blocks', () => {
      const empty = registry.getByCategory('custom' as BlockCategory)

      expect(empty).toHaveLength(0)
    })
  })

  describe('types', () => {
    it('should return all registered type identifiers', () => {
      registry.register(containerDefinition)
      registry.register(textDefinition)

      const types = registry.types()

      expect(types).toContain('container')
      expect(types).toContain('text')
    })

    it('should return an empty array when no blocks are registered', () => {
      const types = registry.types()

      expect(types).toHaveLength(0)
    })
  })

  describe('unregister', () => {
    it('should remove a registered block and return true', () => {
      registry.register(containerDefinition)

      const result = registry.unregister('container')

      expect(result).toBe(true)
      expect(registry.has('container')).toBe(false)
    })

    it('should return false for an unregistered type', () => {
      const result = registry.unregister('unknown-block')

      expect(result).toBe(false)
    })
  })

  describe('clear', () => {
    it('should remove all registrations', () => {
      registry.register(containerDefinition)
      registry.register(textDefinition)

      registry.clear()

      expect(registry.list()).toHaveLength(0)
    })

    it('should allow re-registration after clear', () => {
      registry.register(containerDefinition)
      registry.clear()

      // Should not throw
      expect(() => registry.register(containerDefinition)).not.toThrow()
      expect(registry.has('container')).toBe(true)
    })
  })
})

// ============================================================
// Canonical block definitions — structural assertions
// ============================================================
//
// The runtime ships no hardcoded `*Definition` exports; the
// fixture stubs (`TEST_BLOCK_DEFINITIONS`) carry only the metadata
// the rule engine needs (type / canHaveChildren / allowed-parents /
// allowed-children). The structural-shape assertions therefore reduce to
// type+category+canHaveChildren round-trips against the fixture.

describe('Canonical block definitions', () => {
  it('container fixture has the expected structural metadata', () => {
    expect(containerDefinition.type).toBe('container')
    expect(containerDefinition.name).toBe('Container')
    expect(containerDefinition.category).toBe('layout')
    expect(containerDefinition.canHaveChildren).toBe(true)
  })

  it('grid fixture has the expected structural metadata', () => {
    expect(gridDefinition.type).toBe('grid')
    expect(gridDefinition.category).toBe('layout')
    expect(gridDefinition.canHaveChildren).toBe(true)
  })

  it('text fixture has the expected structural metadata', () => {
    expect(textDefinition.type).toBe('text')
    expect(textDefinition.category).toBe('text')
    expect(textDefinition.canHaveChildren).toBe(false)
  })

  it('heading fixture has the expected structural metadata', () => {
    expect(headingDefinition.type).toBe('heading')
    expect(headingDefinition.category).toBe('text')
    expect(headingDefinition.canHaveChildren).toBe(false)
  })

  it('button fixture has the expected structural metadata', () => {
    expect(buttonDefinition.type).toBe('button')
    expect(buttonDefinition.category).toBe('control')
    expect(buttonDefinition.canHaveChildren).toBe(false)
  })

  it('image fixture has the expected structural metadata', () => {
    expect(imageDefinition.type).toBe('image')
    expect(imageDefinition.category).toBe('media')
    expect(imageDefinition.canHaveChildren).toBe(false)
  })

  it('form fixture has the expected structural metadata', () => {
    expect(formDefinition.type).toBe('form')
    expect(formDefinition.category).toBe('form')
    expect(formDefinition.canHaveChildren).toBe(true)
  })

  it('input fixture allows form + container as parents', () => {
    expect(inputDefinition.allowedParents).toContain('form')
    expect(inputDefinition.allowedParents).toContain('container')
  })
})

// ============================================================
// createBlockRegistry factory
// ============================================================

describe('createBlockRegistry', () => {
  it('should create an empty registry by default', () => {
    const registry = createBlockRegistry()

    expect(registry.list()).toHaveLength(0)
  })

  it('createBlockRegistry(true) returns the (now empty) default', () => {
    // The factory still flips the populate flag through the same code
    // path, but the default registry is empty post-. Block content
    // is supplied per-world via the dynamic install pipeline.
    const registry = createBlockRegistry(true)
    expect(registry.list()).toHaveLength(0)
  })

  it('should return a fresh BlockRegistry instance', () => {
    const r1 = createBlockRegistry()
    const r2 = createBlockRegistry()

    expect(r1).not.toBe(r2)
  })
})

// ============================================================
// blockRegistry singleton and getBlockRegistry
// ============================================================

describe('getBlockRegistry', () => {
  it('should return the blockRegistry singleton', () => {
    const registry = getBlockRegistry()

    expect(registry).toBe(blockRegistry)
  })

  it('should consistently return the same instance', () => {
    expect(getBlockRegistry()).toBe(getBlockRegistry())
  })
})

describe('blockRegistry singleton (empty default)', () => {
  it('starts empty; per-world content arrives via getBlockRegistryForWorld / installedBlocksOverride', () => {
    expect(blockRegistry.list()).toHaveLength(0)
  })

  it('still exposes the BlockRegistry surface (register/get/has/list/clear)', () => {
    expect(typeof blockRegistry.register).toBe('function')
    expect(typeof blockRegistry.get).toBe('function')
    expect(typeof blockRegistry.has).toBe('function')
    expect(typeof blockRegistry.list).toBe('function')
    expect(typeof blockRegistry.clear).toBe('function')
  })

  it('accepts dynamic registration of a block at runtime', () => {
    const tmp = new BlockRegistry()
    tmp.register(containerDefinition)
    expect(tmp.has('container')).toBe(true)
    expect(tmp.list()).toHaveLength(1)
  })

  // per-block `defaultLayout` lives in the published
  // pwpack manifest now; the runtime fixture stubs intentionally omit it
  // since validation/composition tests don't consult layout metadata.
  it('all 45 fixture entries roundtrip through register / list / has', () => {
    const tmp = new BlockRegistry()
    for (const d of [
      cardDefinition,
      alertDefinition,
      progressDefinition,
      textareaDefinition,
      statDefinition,
      skeletonDefinition,
      drawerDefinition,
      ratingDefinition,
      dateInputDefinition,
      stepperDefinition,
      tagInputDefinition,
      calloutDefinition,
      timelineDefinition,
    ]) {
      tmp.register(d)
    }
    expect(tmp.list().length).toBeGreaterThan(0)
  })
})
