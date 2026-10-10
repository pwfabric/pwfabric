/**
 * Binding Module
 *
 * Capability-to-surface binding system
 * Enhanced data binding with expressions, collections, and data sources
 *
 * @module @pwfabric/runtime/binding
 */

// ============================================================
// TYPES
// ============================================================

export type {
  BindingState,
  BindingConfig,
  RuntimeBindingTransform,
  BindingCacheConfig,
  RetryConfig,
  BoundCapability,
  BindingError,
  BindingContext,
  AuthContext,
  BindingResult,
  SurfaceBindingResult,
} from './types.js'

// ============================================================
// ENGINE
// ============================================================

export type { BindingEngine } from './engine.js'
export { RuntimeBindingEngine, createBindingEngine } from './engine.js'

// ============================================================
// EXPRESSION EVALUATOR
// ============================================================

export type {
  BindingExpressionContext,
  ExpressionEvalResult,
  ExpressionEvaluator,
  ExpressionDependency,
} from './expression.js'

export {
  evaluateExpression,
  resolvePath as resolveBindingPath,
  extractDependencies,
  isExpression as isBindingExpression,
  interpolate as interpolateBinding,
  createExpressionEvaluator,
  DEFAULT_BINDING_HELPERS,
} from './expression.js'

// ============================================================
// COLLECTION BINDING
// ============================================================

export type {
  CollectionChangeType,
  CollectionChangeEvent,
  CollectionChangeListener,
  CollectionBinding,
  MutableCollectionBinding,
} from './collection.js'

export {
  ReactiveCollection,
  createCollection,
  createReadOnlyCollection,
  createCollectionFromAsync,
} from './collection.js'

// ============================================================
// DATA SOURCES
// ============================================================

export type {
  DataSourceType,
  DataSource,
  DataSourceListener,
  BaseDataSourceConfig,
  DataSourceCacheConfig,
  StaticDataSourceConfig,
  ApiDataSourceConfig,
  GraphQLDataSourceConfig,
  StateDataSourceConfig,
  DataSourceConfig,
  DataSourceRetryConfig,
  DataSourceRegistry,
} from './datasource.js'

export {
  StaticDataSource,
  ApiDataSource,
  StateDataSource,
  InMemoryDataSourceRegistry,
  createDataSourceRegistry,
  createDataSource,
  createStaticDataSource,
  createApiDataSource,
  createStateDataSource,
} from './datasource.js'

// ============================================================
// TWO-WAY BINDING (P1-5)
// ============================================================

export type {
  TwoWayBindingConfig,
  ValidationResult as TwoWayValidationResult,
  TwoWayBinding,
  ChangeListener,
} from './two-way.js'

export { TwoWayBindingManager, createTwoWayBindingManager } from './two-way.js'
