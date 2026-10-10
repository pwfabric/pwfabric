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
  responsiveNumberSchema,
  responsiveBooleanSchema,
  responsiveWidthScopeSchema,
  widthScopeSchema,
  type WidthScope,
  blockLayoutSchema,
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
} from './layout-schema.js'

// What a dynamically loaded block may import, and what the host must provide.
// One list; the bundler's allowlist, every host import map and every shim file
// are derived from it rather than hand-copied — see the module header for the
// three-way drift this replaces.
export {
  BLOCK_HOST_IMPORTS,
  blockBundleExternals,
  blockImportMap,
  blockShimFiles,
  blockHostGlobals,
  unseededHostGlobals,
  specifiersForShim,
  type HostImport,
  type HostImportKind,
  type HostSeeding,
} from './host-imports.js'

// NOTE: CompositionRuleEngine has moved to @pwfabric/runtime/blocks
