/**
 * Observability Module
 *
 * Exports for observability infrastructure
 *
 * @module @pwfabric/core/observability
 */

export {
  type LogLevel,
  type LogContext,
  type LogEntry,
  type ILogger,
  ConsoleLogger,
  createObservabilityLogger,
} from './logger.js'

export {
  type TraceContext,
  type Span,
  type SpanResult,
  createTraceContext,
  createChildContext,
  createSpan,
  extractTraceId,
  injectTraceId,
} from './tracer.js'
