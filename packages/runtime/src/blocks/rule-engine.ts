/**
 * Composition Rule Engine
 *
 * CP7: Validation engine for block compositions
 * Block metadata accessor is now an injectable provider so
 * web-side editor flows can supply install-aware data without depending on
 * the populated runtime singleton.
 *
 * @module @pwfabric/core/blocks/rule-engine
 */

import type {
  Block,
  BlockValidationResult as ValidationResult,
  BlockValidationError as ValidationError,
  CompositionRule,
  BlockDefinition,
} from '@pwfabric/core'
import { MAX_NESTING_DEPTH } from '@pwfabric/core'
import { blockRegistry } from './registry.js'
import { compositionRules } from './composition-rules.js'

// ============================================================
// BLOCK META PROVIDER
// ============================================================

/**
 * Snapshot of the block metadata the rule engine consults during
 * validation. A subset of `BlockDefinition` — only the fields that
 * affect composition decisions (name + child/parent rules).
 */
export interface BlockMetaSnapshot {
  readonly type: string
  readonly name: string
  readonly canHaveChildren: boolean
  readonly allowedChildren?: readonly string[]
  readonly allowedParents?: readonly string[]
}

/**
 * Pluggable block metadata accessor. The default implementation is a
 * thin adapter over the legacy `blockRegistry` singleton; install-aware
 * editor flows construct their own provider that wraps
 * `useInstalledAtoms` data.
 */
export interface BlockMetaProvider {
  get(type: string): BlockMetaSnapshot | undefined
}

function definitionToSnapshot(def: BlockDefinition): BlockMetaSnapshot {
  return {
    type: def.type,
    name: def.name,
    canHaveChildren: def.canHaveChildren,
    ...(def.allowedChildren !== undefined ? { allowedChildren: def.allowedChildren } : {}),
    ...(def.allowedParents !== undefined ? { allowedParents: def.allowedParents } : {}),
  }
}

/**
 * Default provider — reads from the runtime `blockRegistry` singleton.
 * Returns `undefined` for types absent from the singleton (post-
 * the singleton is empty by default).
 */
export const defaultBlockMetaProvider: BlockMetaProvider = {
  get(type: string): BlockMetaSnapshot | undefined {
    const def = blockRegistry.get(type)
    return def ? definitionToSnapshot(def) : undefined
  },
}

// ============================================================
// ERROR CODES
// ============================================================

export const CompositionErrorCode = {
  MAX_DEPTH_EXCEEDED: 'MAX_DEPTH_EXCEEDED',
  INVALID_CHILD: 'INVALID_CHILD',
  INVALID_PARENT: 'INVALID_PARENT',
  NO_CHILDREN_ALLOWED: 'NO_CHILDREN_ALLOWED',
  SELF_NESTING: 'SELF_NESTING',
  UNKNOWN_BLOCK_TYPE: 'UNKNOWN_BLOCK_TYPE',
  ORPHANED_BLOCK: 'ORPHANED_BLOCK',
} as const

export type CompositionErrorCodeType =
  (typeof CompositionErrorCode)[keyof typeof CompositionErrorCode]

// ============================================================
// RULE ENGINE CLASS
// ============================================================

/**
 * Composition Rule Engine
 *
 * Validates block compositions against defined rules.
 */
export class CompositionRuleEngine {
  /** Rules for this engine instance (reserved for future custom rule support) */
  readonly rules: readonly CompositionRule[]
  /** Block metadata accessor */
  readonly meta: BlockMetaProvider

  constructor(
    rules: readonly CompositionRule[] = compositionRules,
    meta: BlockMetaProvider = defaultBlockMetaProvider
  ) {
    this.rules = rules
    this.meta = meta
  }

  /**
   * Check if a child can be inserted into a parent
   *
   * @param parent - Parent block (null for root level)
   * @param childType - Type of child block to insert
   * @param currentDepth - Current nesting depth
   * @returns Validation result
   */
  canInsert(parent: Block | null, childType: string, currentDepth = 0): ValidationResult {
    const errors: ValidationError[] = []

    // Check if child type is registered
    const childDef = this.meta.get(childType)
    if (!childDef) {
      errors.push({
        code: CompositionErrorCode.UNKNOWN_BLOCK_TYPE,
        message: `Unknown block type: ${childType}`,
        suggestion: 'Use a registered block type',
      })
      return { valid: false, errors }
    }

    // Root level insertion
    if (parent === null) {
      return { valid: true, errors: [] }
    }

    // Get parent definition
    const parentDef = this.meta.get(parent.type)
    if (!parentDef) {
      errors.push({
        code: CompositionErrorCode.UNKNOWN_BLOCK_TYPE,
        message: `Unknown parent block type: ${parent.type}`,
        blockId: parent.id,
      })
      return { valid: false, errors }
    }

    // Check if parent can have children
    if (!parentDef.canHaveChildren) {
      errors.push({
        code: CompositionErrorCode.NO_CHILDREN_ALLOWED,
        message: `${parentDef.name} blocks cannot have children`,
        blockId: parent.id,
        suggestion: `Place the ${childDef.name} block outside of ${parentDef.name}`,
      })
      return { valid: false, errors }
    }

    // Check depth limit
    if (currentDepth >= MAX_NESTING_DEPTH) {
      errors.push({
        code: CompositionErrorCode.MAX_DEPTH_EXCEEDED,
        message: `Maximum nesting depth (${MAX_NESTING_DEPTH}) exceeded`,
        blockId: parent.id,
        suggestion: 'Reduce nesting or restructure your layout',
      })
      return { valid: false, errors }
    }

    // Check allowed children
    if (parentDef.allowedChildren && !parentDef.allowedChildren.includes(childType)) {
      errors.push({
        code: CompositionErrorCode.INVALID_CHILD,
        message: `${childDef.name} is not allowed inside ${parentDef.name}`,
        blockId: parent.id,
        suggestion: `Allowed children: ${parentDef.allowedChildren.join(', ')}`,
      })
      return { valid: false, errors }
    }

    // Check allowed parents
    if (childDef.allowedParents && !childDef.allowedParents.includes(parent.type)) {
      errors.push({
        code: CompositionErrorCode.INVALID_PARENT,
        message: `${childDef.name} should be placed inside ${childDef.allowedParents.join(' or ')}`,
        blockId: parent.id,
        suggestion: `Move the ${childDef.name} into a ${childDef.allowedParents[0]}`,
      })
      // This is a warning, not a hard error
      return { valid: true, errors }
    }

    // Check grid-specific rules (no nested grids)
    if (parent.type === 'grid' && childType === 'grid') {
      errors.push({
        code: CompositionErrorCode.INVALID_CHILD,
        message: 'Grids cannot contain other grids as direct children',
        blockId: parent.id,
        suggestion: 'Wrap the inner grid in a container first',
      })
      return { valid: false, errors }
    }

    return { valid: true, errors: [] }
  }

  /**
   * Check if a block can be moved to a new parent
   *
   * @param block - Block to move
   * @param newParent - New parent block (null for root level)
   * @param currentDepth - Current nesting depth
   * @returns Validation result
   */
  canMove(block: Block, newParent: Block | null, currentDepth = 0): ValidationResult {
    const errors: ValidationError[] = []

    // Check for self-nesting
    if (newParent && this.isDescendantOf(newParent, block)) {
      errors.push({
        code: CompositionErrorCode.SELF_NESTING,
        message: 'Cannot move a block into itself or its descendants',
        blockId: block.id,
        suggestion: 'Choose a different location',
      })
      return { valid: false, errors }
    }

    // Use canInsert for other validations
    return this.canInsert(newParent, block.type, currentDepth)
  }

  /**
   * Validate an entire block tree
   *
   * @param blocks - Root level blocks to validate
   * @returns Array of validation errors
   */
  validateTree(blocks: readonly Block[]): ValidationResult {
    const errors: ValidationError[] = []

    const validateBlock = (block: Block, parent: Block | null, depth: number): void => {
      // Check block type
      const def = this.meta.get(block.type)
      if (!def) {
        errors.push({
          code: CompositionErrorCode.UNKNOWN_BLOCK_TYPE,
          message: `Unknown block type: ${block.type}`,
          blockId: block.id,
        })
        return
      }

      // Validate insertion
      if (parent !== null) {
        if (depth >= MAX_NESTING_DEPTH) {
          errors.push({
            code: CompositionErrorCode.MAX_DEPTH_EXCEEDED,
            message: `Block at depth ${depth} exceeds maximum nesting depth (${MAX_NESTING_DEPTH})`,
            blockId: block.id,
            suggestion: 'Reduce nesting or restructure your layout',
          })
        } else {
          const insertResult = this.canInsert(parent, block.type, depth)
          errors.push(...insertResult.errors)
        }
      }

      // Recursively validate children
      if (block.children) {
        // Check if block can have children
        if (!def.canHaveChildren && block.children.length > 0) {
          errors.push({
            code: CompositionErrorCode.NO_CHILDREN_ALLOWED,
            message: `${def.name} blocks cannot have children`,
            blockId: block.id,
            suggestion: 'Remove children from this block',
          })
        }

        for (const child of block.children) {
          validateBlock(child, block, depth + 1)
        }
      }
    }

    for (const block of blocks) {
      validateBlock(block, null, 0)
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Get the depth of a block in a tree
   *
   * @param blocks - Root level blocks
   * @param targetId - ID of block to find
   * @returns Depth of block or -1 if not found
   */
  getBlockDepth(blocks: readonly Block[], targetId: string): number {
    const findDepth = (blockList: readonly Block[], currentDepth: number): number => {
      for (const block of blockList) {
        if (block.id === targetId) {
          return currentDepth
        }
        if (block.children) {
          const found = findDepth(block.children, currentDepth + 1)
          if (found >= 0) return found
        }
      }
      return -1
    }

    return findDepth(blocks, 0)
  }

  /**
   * Check if a block is a descendant of another block
   *
   * @param block - Block to check descendants of
   * @param potentialAncestor - Potential ancestor block
   * @returns True if block is a descendant
   */
  private isDescendantOf(block: Block, potentialAncestor: Block): boolean {
    if (block.id === potentialAncestor.id) {
      return true
    }

    if (potentialAncestor.children) {
      for (const child of potentialAncestor.children) {
        if (this.isDescendantOf(block, child)) {
          return true
        }
      }
    }

    return false
  }
}

// ============================================================
// SINGLETON INSTANCE
// ============================================================

/**
 * Default composition rule engine singleton
 */
export const compositionRuleEngine = new CompositionRuleEngine()

/**
 * Get the default composition rule engine
 *
 * @returns The default rule engine instance
 */
export function getCompositionRuleEngine(): CompositionRuleEngine {
  return compositionRuleEngine
}

/**
 * Create a new composition rule engine
 *
 * @param rules - Optional custom rules
 * @param meta - Optional block metadata provider
 * @returns New rule engine instance
 */
export function createCompositionRuleEngine(
  rules?: readonly CompositionRule[],
  meta?: BlockMetaProvider
): CompositionRuleEngine {
  return new CompositionRuleEngine(rules, meta)
}

// ============================================================
// CONVENIENCE FUNCTIONS
// ============================================================

/**
 * Check if a block can be inserted (convenience function)
 */
export function canInsertBlock(
  parent: Block | null,
  childType: string,
  currentDepth = 0
): ValidationResult {
  return compositionRuleEngine.canInsert(parent, childType, currentDepth)
}

/**
 * Check if a block can be moved (convenience function)
 */
export function canMoveBlock(
  block: Block,
  newParent: Block | null,
  currentDepth = 0
): ValidationResult {
  return compositionRuleEngine.canMove(block, newParent, currentDepth)
}

/**
 * Validate a block tree (convenience function)
 */
export function validateBlockTree(blocks: readonly Block[]): ValidationResult {
  return compositionRuleEngine.validateTree(blocks)
}
