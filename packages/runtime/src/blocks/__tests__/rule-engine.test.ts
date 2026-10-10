/**
 * Composition Rule Engine Tests — @pwfabric/runtime/blocks
 *
 * Tests for CompositionRuleEngine, canInsertBlock, canMoveBlock, validateBlockTree,
 * and related convenience functions.
 *
 * @module @pwfabric/runtime/blocks/__tests__/rule-engine
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import {
  CompositionRuleEngine,
  CompositionErrorCode,
  canInsertBlock,
  canMoveBlock,
  validateBlockTree,
  createCompositionRuleEngine,
  getCompositionRuleEngine,
  compositionRuleEngine,
  blockRegistry,
  populateTestBlocks,
} from '../index.js'
import { MAX_NESTING_DEPTH, DEFAULT_BLOCK_LAYOUT, type BlockLayout } from '@pwfabric/core'
import type { Block } from '@pwfabric/core'

// blockRegistry no longer auto-populates. The composition
// rule engine in this suite needs the legacy first-party set, so we opt
// back in through the bootstrap helper. Production code does NOT call
// this — install state arrives via `getBlockRegistryForWorld` (browser)
// or `installedBlocksOverride` (server) per world.
beforeAll(() => {
  blockRegistry.clear()
  populateTestBlocks()
})

afterAll(() => {
  blockRegistry.clear()
})

// Helper: get a block's defaultLayout from the registry, falling back to DEFAULT_BLOCK_LAYOUT
function getLayout(blockType: string): BlockLayout {
  return blockRegistry.get(blockType)?.defaultLayout ?? DEFAULT_BLOCK_LAYOUT
}

// Helper: build a minimal Block fixture
function makeBlock(id: string, type: string, children?: Block[]): Block {
  const block: Block = { id, type, layout: getLayout(type), props: {} }
  if (children) block.children = children
  return block
}

// ============================================================
// CompositionRuleEngine — canInsert
// ============================================================

describe('CompositionRuleEngine', () => {
  let engine: CompositionRuleEngine

  beforeEach(() => {
    engine = new CompositionRuleEngine()
  })

  describe('canInsert', () => {
    it('should allow root-level insertion of any registered block type', () => {
      const result = engine.canInsert(null, 'container')

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject unknown block types at root level', () => {
      const result = engine.canInsert(null, 'not-a-real-block')

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.UNKNOWN_BLOCK_TYPE)
    })

    it('should allow valid children inside a container', () => {
      const parent = makeBlock('p1', 'container')

      const result = engine.canInsert(parent, 'text')

      expect(result.valid).toBe(true)
    })

    it('should reject children inside a non-container block (text)', () => {
      const parent = makeBlock('p1', 'text')

      const result = engine.canInsert(parent, 'button')

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.NO_CHILDREN_ALLOWED)
    })

    it('should reject children inside a button block', () => {
      const parent = makeBlock('p1', 'button')

      const result = engine.canInsert(parent, 'text')

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.NO_CHILDREN_ALLOWED)
    })

    it('should enforce max nesting depth', () => {
      const parent = makeBlock('p1', 'container')

      const result = engine.canInsert(parent, 'container', MAX_NESTING_DEPTH)

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.MAX_DEPTH_EXCEEDED)
    })

    it('should allow insertion at depth one below the max', () => {
      const parent = makeBlock('p1', 'container')

      const result = engine.canInsert(parent, 'container', MAX_NESTING_DEPTH - 1)

      expect(result.valid).toBe(true)
    })

    it('should reject grid nested directly inside grid', () => {
      const parent = makeBlock('p1', 'grid')

      const result = engine.canInsert(parent, 'grid')

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.INVALID_CHILD)
    })

    it('should allow container inside grid', () => {
      const parent = makeBlock('p1', 'grid')

      const result = engine.canInsert(parent, 'container')

      expect(result.valid).toBe(true)
    })

    it('should reject a form block inside grid (grid has allowedChildren)', () => {
      const parent = makeBlock('p1', 'grid')

      const result = engine.canInsert(parent, 'form')

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.INVALID_CHILD)
    })

    it('should warn about invalid parent for input (but allowedParents is a warning)', () => {
      // Input has allowedParents: ['form', 'container'] — placing inside grid is a warning,
      // but grid also has allowedChildren restricting to container, so the grid check fires first.
      const gridParent = makeBlock('p1', 'grid')
      const result = engine.canInsert(gridParent, 'input')

      // Grid's allowedChildren does not include input => INVALID_CHILD
      expect(result.valid).toBe(false)
    })

    it('should treat unknown parent block type as error', () => {
      const parent = makeBlock('p1', 'unknown-parent-type')

      const result = engine.canInsert(parent, 'text')

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.UNKNOWN_BLOCK_TYPE)
    })
  })

  // ============================================================
  // CompositionRuleEngine — canMove
  // ============================================================

  describe('canMove', () => {
    it('should allow moving a block to a valid parent', () => {
      const block = makeBlock('b1', 'text')
      const newParent = makeBlock('p1', 'container')

      const result = engine.canMove(block, newParent)

      expect(result.valid).toBe(true)
    })

    it('should allow moving a block to root level', () => {
      const block = makeBlock('b1', 'container')

      const result = engine.canMove(block, null)

      expect(result.valid).toBe(true)
    })

    it('should reject moving a block into itself', () => {
      const block = makeBlock('b1', 'container')

      const result = engine.canMove(block, block)

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.SELF_NESTING)
    })

    it('should reject moving a parent block into one of its descendants', () => {
      const grandchild = makeBlock('gc', 'text')
      const child = makeBlock('c1', 'container', [grandchild])
      const parent = makeBlock('p1', 'container', [child])

      // Attempting to move parent into child (descendant)
      const result = engine.canMove(parent, child)

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.SELF_NESTING)
    })

    it('should reject an invalid move that violates canInsert rules', () => {
      const block = makeBlock('b1', 'text')
      const parent = makeBlock('p1', 'text') // text cannot have children

      const result = engine.canMove(block, parent)

      expect(result.valid).toBe(false)
      expect(result.errors[0]?.code).toBe(CompositionErrorCode.NO_CHILDREN_ALLOWED)
    })
  })

  // ============================================================
  // CompositionRuleEngine — validateTree
  // ============================================================

  describe('validateTree', () => {
    it('should return valid for an empty tree', () => {
      const result = engine.validateTree([])

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should return valid for a well-formed tree', () => {
      const blocks: Block[] = [
        makeBlock('root', 'container', [makeBlock('h1', 'heading'), makeBlock('t1', 'text')]),
      ]

      const result = engine.validateTree(blocks)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect unknown block types', () => {
      const blocks: Block[] = [makeBlock('b1', 'unknown-type')]

      const result = engine.validateTree(blocks)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === CompositionErrorCode.UNKNOWN_BLOCK_TYPE)).toBe(
        true
      )
    })

    it('should detect children in a non-container block', () => {
      const blocks: Block[] = [makeBlock('t1', 'text', [makeBlock('b1', 'button')])]

      const result = engine.validateTree(blocks)

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === CompositionErrorCode.NO_CHILDREN_ALLOWED)).toBe(
        true
      )
    })

    it('should detect excessive nesting depth', () => {
      // Build a tree that exceeds MAX_NESTING_DEPTH
      let current: Block = makeBlock('leaf', 'text')
      for (let i = 0; i < MAX_NESTING_DEPTH + 2; i++) {
        current = makeBlock(`c${i}`, 'container', [current])
      }

      const result = engine.validateTree([current])

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.code === CompositionErrorCode.MAX_DEPTH_EXCEEDED)).toBe(
        true
      )
    })

    it('should produce exactly 1 MAX_DEPTH_EXCEEDED error for a single over-depth block', () => {
      // Build exactly MAX_NESTING_DEPTH wrappers — the leaf sits at depth MAX_NESTING_DEPTH
      let current: Block = makeBlock('deep', 'text')
      for (let i = 0; i < MAX_NESTING_DEPTH; i++) {
        current = makeBlock(`c${i}`, 'container', [current])
      }

      const result = engine.validateTree([current])

      const depthErrors = result.errors.filter(
        (e) => e.code === CompositionErrorCode.MAX_DEPTH_EXCEEDED
      )
      expect(depthErrors).toHaveLength(1)
      expect(depthErrors[0]?.blockId).toBe('deep')
    })

    it('should attribute each MAX_DEPTH_EXCEEDED error to its own block (not its parent)', () => {
      let current: Block = makeBlock('leaf', 'text')
      for (let i = 0; i < MAX_NESTING_DEPTH + 2; i++) {
        current = makeBlock(`c${i}`, 'container', [current])
      }

      const result = engine.validateTree([current])

      const depthErrors = result.errors.filter(
        (e) => e.code === CompositionErrorCode.MAX_DEPTH_EXCEEDED
      )
      const uniqueBlockIds = new Set(depthErrors.map((e) => e.blockId))
      expect(depthErrors).toHaveLength(uniqueBlockIds.size)
      // The deepest valid parent (c2 at depth 4 in a 0-indexed 7-level tree) should not appear
      expect(uniqueBlockIds.has('c2')).toBe(false)
      expect(uniqueBlockIds.has('leaf')).toBe(true)
    })

    it('should validate multiple root-level blocks independently', () => {
      const blocks: Block[] = [
        makeBlock('c1', 'container', [makeBlock('t1', 'text')]),
        makeBlock('c2', 'container', [makeBlock('h1', 'heading')]),
      ]

      const result = engine.validateTree(blocks)

      expect(result.valid).toBe(true)
    })
  })

  // ============================================================
  // CompositionRuleEngine — getBlockDepth
  // ============================================================

  describe('getBlockDepth', () => {
    it('should return 0 for a root-level block', () => {
      const blocks: Block[] = [makeBlock('root', 'container')]

      const depth = engine.getBlockDepth(blocks, 'root')

      expect(depth).toBe(0)
    })

    it('should return correct depth for nested blocks', () => {
      const blocks: Block[] = [
        makeBlock('root', 'container', [
          makeBlock('child', 'container', [makeBlock('grandchild', 'text')]),
        ]),
      ]

      expect(engine.getBlockDepth(blocks, 'child')).toBe(1)
      expect(engine.getBlockDepth(blocks, 'grandchild')).toBe(2)
    })

    it('should return -1 for a block not in the tree', () => {
      const blocks: Block[] = [makeBlock('root', 'container')]

      const depth = engine.getBlockDepth(blocks, 'non-existent')

      expect(depth).toBe(-1)
    })
  })
})

// ============================================================
// CompositionErrorCode
// ============================================================

describe('CompositionErrorCode', () => {
  it('should expose all expected error code constants', () => {
    expect(CompositionErrorCode.MAX_DEPTH_EXCEEDED).toBe('MAX_DEPTH_EXCEEDED')
    expect(CompositionErrorCode.INVALID_CHILD).toBe('INVALID_CHILD')
    expect(CompositionErrorCode.INVALID_PARENT).toBe('INVALID_PARENT')
    expect(CompositionErrorCode.NO_CHILDREN_ALLOWED).toBe('NO_CHILDREN_ALLOWED')
    expect(CompositionErrorCode.SELF_NESTING).toBe('SELF_NESTING')
    expect(CompositionErrorCode.UNKNOWN_BLOCK_TYPE).toBe('UNKNOWN_BLOCK_TYPE')
    expect(CompositionErrorCode.ORPHANED_BLOCK).toBe('ORPHANED_BLOCK')
  })
})

// ============================================================
// Convenience functions
// ============================================================

describe('canInsertBlock (convenience function)', () => {
  it('should allow root-level insertion using the default engine', () => {
    const result = canInsertBlock(null, 'container')

    expect(result.valid).toBe(true)
  })

  it('should reject unknown types using the default engine', () => {
    const result = canInsertBlock(null, 'completely-unknown')

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.code).toBe(CompositionErrorCode.UNKNOWN_BLOCK_TYPE)
  })
})

describe('canMoveBlock (convenience function)', () => {
  it('should allow moving a block to root using the default engine', () => {
    const block = makeBlock('b1', 'text')

    const result = canMoveBlock(block, null)

    expect(result.valid).toBe(true)
  })

  it('should reject self-nesting using the default engine', () => {
    const block = makeBlock('b1', 'container')

    const result = canMoveBlock(block, block)

    expect(result.valid).toBe(false)
    expect(result.errors[0]?.code).toBe(CompositionErrorCode.SELF_NESTING)
  })
})

describe('validateBlockTree (convenience function)', () => {
  it('should return valid for an empty tree using the default engine', () => {
    const result = validateBlockTree([])

    expect(result.valid).toBe(true)
  })

  it('should detect errors using the default engine', () => {
    const result = validateBlockTree([makeBlock('b1', 'does-not-exist')])

    expect(result.valid).toBe(false)
  })
})

// ============================================================
// Factory and singleton helpers
// ============================================================

describe('createCompositionRuleEngine', () => {
  it('should create a new engine instance', () => {
    const engine = createCompositionRuleEngine()

    expect(engine).toBeInstanceOf(CompositionRuleEngine)
  })

  it('should create a different instance each time', () => {
    const e1 = createCompositionRuleEngine()
    const e2 = createCompositionRuleEngine()

    expect(e1).not.toBe(e2)
  })
})

describe('getCompositionRuleEngine', () => {
  it('should return the compositionRuleEngine singleton', () => {
    const engine = getCompositionRuleEngine()

    expect(engine).toBe(compositionRuleEngine)
  })

  it('should return the same instance on repeated calls', () => {
    expect(getCompositionRuleEngine()).toBe(getCompositionRuleEngine())
  })
})
