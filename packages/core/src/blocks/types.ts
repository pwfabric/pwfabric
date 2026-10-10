/**
 * Block Type Definitions
 *
 * Core type definitions for the block ecosystem
 *
 * @module @pwfabric/core/blocks/types
 */

import type { ZodSchema } from 'zod'
import type { BlockLayout } from './layout-schema.js'

// The block instance type is defined in @pwfabric/contracts; re-exported here.
export type { Block } from '@pwfabric/contracts'

// ============================================================
// BLOCK CATEGORIES
// ============================================================

/**
 * Block category classification.
 *
 * `feedback` is the family of toast, spinner and radial-progress blocks. A
 * block's atom id comes from its directory, and a pack's integrity check
 * requires the category and the directory to agree, so these blocks carry
 * `feedback` rather than being filed under `control`.
 */
export type BlockCategory =
  | 'layout'
  | 'panel'
  | 'text'
  | 'data'
  | 'control'
  | 'media'
  | 'form'
  | 'feedback'
  // Categories by SHAPE: `overlay` (modal, drawer, popover, tooltip,
  // command-palette), `container` (card, accordion, tabs, tree-view) and
  // `integration` (app views that own a connection to an outside service:
  // calendar, chat, files…). `panel` remains for packs that still use it.
  | 'overlay'
  | 'container'
  | 'integration'

// ============================================================
// BLOCK DEFINITION
// ============================================================

/**
 * Block definition interface
 *
 * Defines the structure and constraints of a block type.
 */
export interface BlockDefinition {
  /** Unique block type identifier */
  readonly type: string

  /** Human-readable display name */
  readonly name: string

  /** Block category for grouping */
  readonly category: BlockCategory

  /** Icon character or identifier */
  readonly icon: string

  /** Zod schema for props validation */
  readonly schema: ZodSchema

  /** Default props for new instances */
  readonly defaultProps: Record<string, unknown>

  /** Default layout for new instances (span/offset/order/hidden per breakpoint) */
  readonly defaultLayout?: BlockLayout

  /** Whether this block can contain children */
  readonly canHaveChildren: boolean

  /**
   * Optional: which child block types this block accepts. The runtime's
   * composition rules enforce it. `allowedChildTraits` is the trait-based
   * alternative, for a block that accepts any child with a given trait.
   */
  readonly allowedChildren?: readonly string[]

  /** Optional: Restrict which block types can be parents */
  readonly allowedParents?: readonly string[]

  /** open trait vocabulary this block carries (kebab-case). */
  readonly traits?: readonly string[]

  /**
   * a child block passes if it carries ANY of these traits.
   * Only meaningful when `canHaveChildren` is true.
   */
  readonly allowedChildTraits?: readonly string[]

  /** Optional: Maximum instances allowed in a surface */
  readonly maxInstances?: number
}

// ============================================================
// BLOCK INSTANCE
// ============================================================
// Block is re-exported from @pwfabric/contracts above.

// ============================================================
// VALIDATION
// ============================================================

/**
 * Validation error interface
 */
export interface ValidationError {
  /** Error code for programmatic handling */
  readonly code: string

  /** Human-readable error message */
  readonly message: string

  /** Optional: Associated block ID */
  readonly blockId?: string

  /** Optional: Suggestion for fixing the error */
  readonly suggestion?: string
}

/**
 * Validation result interface
 */
export interface ValidationResult {
  /** Whether validation passed */
  readonly valid: boolean

  /** List of validation errors */
  readonly errors: readonly ValidationError[]
}

// ============================================================
// COMPOSITION RULES
// ============================================================

/**
 * Composition rule type
 */
export type CompositionRuleType =
  | 'max_depth'
  | 'allowed_children'
  | 'allowed_parents'
  | 'required_parent'
  | 'no_children'
  | 'no_self_nesting'

/**
 * Composition rule interface
 */
export interface CompositionRule {
  /** Rule type */
  readonly type: CompositionRuleType

  /** Rule description */
  readonly description: string

  /** Block type this rule applies to (or '*' for all) */
  readonly appliesTo: string | '*'

  /** Rule-specific configuration */
  readonly config: Record<string, unknown>
}

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Maximum block nesting depth. SINGLE SOURCE OF TRUTH — every validator and the
 * composer prompt derive from this constant.
 *
 * Canonical rule (enforced identically everywhere): root blocks are at depth 0,
 * and a block is INVALID when its depth `>= MAX_NESTING_DEPTH`. So the deepest
 * legal block sits at depth `MAX_NESTING_DEPTH - 1`, i.e. up to `MAX_NESTING_DEPTH`
 * levels of nesting (root included).
 *
 * Consumers: the runtime rule engine and composition-rules prose
 * (@pwfabric/runtime), and a host's surface validation (MAX_NESTING_EXCEEDED)
 * and composer instructions ("Max nesting depth: N levels").
 */
export const MAX_NESTING_DEPTH = 10

/**
 * Block categories ordered for display
 */
export const BLOCK_CATEGORIES: readonly BlockCategory[] = [
  'layout',
  'panel',
  'text',
  'data',
  'control',
  'media',
  'form',
  // Last in display order: status and notification chrome, not content.
  'feedback',
] as const
