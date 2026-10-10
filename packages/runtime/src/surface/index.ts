/**
 * Surface Rendering Module
 *
 * Surface JSON interpreter, renderer, layout system, and primitives
 *
 * This module provides the complete surface rendering pipeline:
 * - JSON interpretation and validation
 * - Layout resolution (slots, conditionals, loops)
 * - Deterministic rendering
 * - Built-in primitives
 *
 * @module @pwfabric/runtime/surface
 */

// Types
export type {
  PrimitiveType,
  BaseNodeProps,
  RenderNode,
  SurfaceJSON,
  BindingJSON,
  LayoutJSON,
  RenderContext,
  RenderResult,
  RenderOutput,
  RenderError,
  RenderErrorCode,
} from './types.js'

export {
  createNode,
  createRenderContext,
  createChildContext,
  renderSuccess,
  renderError,
} from './types.js'

// Expression evaluation
export type { ExpressionResult, ExpressionContext } from './expression.js'
export {
  evaluate,
  interpolate,
  resolvePath,
  createExpressionContext,
  DEFAULT_HELPERS,
} from './expression.js'

// Layout system
export type { LayoutResult } from './layout.js'
export {
  resolveLayout,
  createSlotMap,
  extractSlots,
  composeLayouts,
  wrapInContainer,
  validateLayout,
} from './layout.js'

// Primitives
export type {
  TextProps,
  ContainerProps,
  ButtonProps,
  InputProps,
  ImageProps,
  LinkProps,
  ListProps,
  HeadingProps,
  SpacerProps,
  DividerProps,
  SlotProps,
  ConditionalProps,
  LoopProps,
  PrimitiveDefinition,
  PropDefinition,
} from './primitives.js'

export {
  PRIMITIVE_DEFINITIONS,
  text,
  container,
  button,
  heading,
  spacer,
  divider,
  isPrimitive,
  getPrimitiveDefinition,
} from './primitives.js'

// Schemas
export {
  surfaceJsonSchema,
  layoutJsonSchema,
  bindingJsonSchema,
  environmentSchema,
  isSurfaceJSON,
  isLayoutJSON,
  isBindingJSON,
} from './schemas.js'

// Interpreter
export type {
  InterpretedSurface,
  InterpretationResult,
  InterpretSurfaceOptions,
} from './interpreter.js'
export {
  interpretSurface,
  parseSurfaceJSON,
  SurfaceBuilder,
  surface,
  createSurfaceContext,
} from './interpreter.js'

// Renderer
export type { RenderOptions, SurfaceRenderer } from './renderer.js'
export {
  DeterministicRenderer,
  createRenderer,
  renderSurface,
  isRenderSuccess,
  isRenderError,
  serializeNode,
  serializeOutput,
  hashNode,
  verifyDeterminism,
} from './renderer.js'

// Block Props Validation
export type {
  BlockPropsValidationResult,
  BlockPropsValidationOptions,
  LayoutPropsIssue,
  ManifestPropSpec,
  BlockManifestPropsMap,
  ManifestPropFinding,
  ManifestPropFindingCode,
} from './validation.js'
export {
  validateBlockProps,
  validateLayoutProps,
  blockManifestPropFindings,
  manifestPropFindings,
} from './validation.js'

// Typed Transform Wrappers
export type {
  MapTransformConfig,
  FilterTransformConfig,
  PickTransformConfig,
  OmitTransformConfig,
  CustomTransformConfig,
  TypedTransformConfig,
  TransformValidationResult,
} from './transforms.js'
export {
  mapTransformConfigSchema,
  filterTransformConfigSchema,
  pickTransformConfigSchema,
  omitTransformConfigSchema,
  customTransformConfigSchema,
  validateTransformConfig,
  narrowTransformDescriptor,
  createMapTransform,
  createFilterTransform,
  createPickTransform,
  createOmitTransform,
  createCustomTransform,
} from './transforms.js'

// Typed Output Factories
export type {
  TypedWebOutput,
  TypedApiOutput,
  TypedCliOutput,
  OutputFactoryResult,
} from './output.js'
export { createWebOutput, createApiOutput, createCliOutput } from './output.js'
