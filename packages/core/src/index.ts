/**
 * @pwfabric/core
 *
 * Core functionality and utilities for the PWFabric platform.
 *
 * PHASE0-WS3: Core orchestration layer
 * Platform hardening (errors, monitoring, observability)
 *
 * @module @pwfabric/core
 */

// Re-export contracts for convenience
export * from '@pwfabric/contracts'

// Core exports - explicitly exclude conflicting names
export {
  PWFabricError,
  ValidationError as CoreValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from './errors.js'

export { type LogLevel, type LogEntry, Logger, createLogger } from './logger.js'

// Error infrastructure
export {
  ErrorCode,
  type ErrorCodeType,
  getHttpStatus,
  isRetryable,
  AppError,
  ValidationAppError,
  NetworkAppError,
  EditorAppError,
  type ErrorContext,
  type SerializedError,
} from './errors/index.js'

// Monitoring infrastructure
export {
  type WebVitalName,
  type MetricRating,
  type Metric,
  type WebVitalMetric,
  type TimingMetric,
  type RenderMetric,
  type PerformanceBudget,
  type MetricsState,
  DEFAULT_BUDGET,
  createMetricsState,
  getRating,
  type WebVitalCallback,
  observeLCP,
  observeFID,
  observeCLS,
  observeTTFB,
  observeINP,
  observeFCP,
  observeAllWebVitals,
} from './monitoring/index.js'

// Observability infrastructure
export {
  type LogContext,
  type ILogger,
  ConsoleLogger,
  createObservabilityLogger,
  type TraceContext,
  type Span,
  type SpanResult,
  createTraceContext,
  createChildContext,
  createSpan,
  extractTraceId,
  injectTraceId,
} from './observability/index.js'

export {
  // ok and err are already exported from contracts
  sleep,
  retry,
  generateId,
} from './utils.js'

// Builders (PHASE0-WS3)
export { ContractBuilder, defineContract, anySchema, objectSchema } from './contract-builder.js'

// Canonical contracts
export { passthroughContract } from './contracts/passthrough.js'

// Delegated OAuth scope lists — the ONE reader. Three copies of a
// tolerant reader once split a JSON string into scope-shaped garbage and sent
// it to Microsoft; consumers import this instead of remembering the rule.
export { isScopeToken, readScopeList, type ScopeListReading } from './oauth-scopes.js'

export { CapabilityBuilder, defineCapability } from './capability-builder.js'

export {
  FieldBuilder,
  ConfigSchemaBuilder,
  SimpleConfigSchema,
  defineConfigSchema,
} from './config-schema-builder.js'

// State management (PHASE0-WS3)
export {
  type StateStore,
  type StateListener,
  type StateSnapshot,
  type Selector,
  type Transition,
  type StateMachineConfig,
  type StateMachine,
  SimpleStateStore,
  SimpleStateMachine,
  createStateStore,
  computed,
  subscribeToSlice,
  createStateMachine,
} from './state.js'

// Block ecosystem types and layout schema
// Block schemas, definitions, rule engine, and React components are in @pwfabric/runtime/blocks (retired standalone package)
export {
  // Types
  type BlockCategory,
  type BlockDefinition,
  type Block,
  type ValidationError as BlockValidationError,
  type ValidationResult as BlockValidationResult,
  type CompositionRuleType,
  type CompositionRule,
  MAX_NESTING_DEPTH,
  BLOCK_CATEGORIES,
  // Layout schema
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
  blockLayoutSchema,
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
  // Block host imports — the one list the bundler, the host import maps and the
  // shim files all derive from.
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
} from './blocks/index.js'
