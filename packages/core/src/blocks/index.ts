/**
 * Block Ecosystem
 *
 * Block type definitions, layout schema, and composition rule engine.
 * Block schemas, definitions, and components are in @pwfabric/runtime/blocks.
 *
 * @module @pwfabric/core/blocks
 */

// Types (remain in core — used by @pwfabric/runtime/blocks as peer types)
export type {
  BlockCategory,
  BlockDefinition,
  Block,
  ValidationError,
  ValidationResult,
  CompositionRuleType,
  CompositionRule,
} from './types.js'

export { MAX_NESTING_DEPTH, BLOCK_CATEGORIES } from './types.js'

// Layout Schema
export {
  type BreakpointName,
  type BreakpointDefinition,
  type ResponsiveValue,
  type BlockLayout,
  type PreviewViewport,
  BREAKPOINTS,
  BREAKPOINT_ORDER,
  DEFAULT_BLOCK_LAYOUT,
  VIEWPORT_PRESETS,
  type WidthScope,
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
} from './layout-schema.js'

// What a dynamically loaded block may import, and what the host must provide,
// is `@pwfabric/core/host-imports` (./host-imports.ts): the compiler and the
// hosts read it, a visitor's page does not.

// NOTE: CompositionRuleEngine has moved to @pwfabric/runtime/blocks
