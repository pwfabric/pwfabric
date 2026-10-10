/**
 * Execution Types
 *
 * PHASE0-WS1: Context and result types for capability execution
 *
 * @module @pwfabric/contracts/fabric/execution
 */

import type { CapabilityId, FabricId, ManifestationId } from '../core/ids.js'
import type { Result } from '../core/result.js'

// ============================================================
// TIMESTAMPS
// ============================================================

/**
 * Unix timestamp in milliseconds
 */
export type Timestamp = number

/**
 * Get current timestamp
 */
export function now(): Timestamp {
  return Date.now()
}

// ============================================================
// EXECUTION CONTEXT
// ============================================================

/**
 * Execution context provided to every capability execution
 */
export interface ExecutionContext {
  /**
   * Unique execution trace ID (for correlation)
   */
  readonly traceId: string

  /**
   * Parent span ID (for distributed tracing)
   */
  readonly spanId: string

  /**
   * Parent span ID (if nested)
   */
  readonly parentSpanId?: string

  /**
   * The fabric executing this capability
   */
  readonly fabricId: FabricId

  /**
   * The manifestation (if running in one)
   */
  readonly manifestationId?: ManifestationId

  /**
   * Execution start time
   */
  readonly startedAt: Timestamp

  /**
   * Timeout for this execution (ms)
   */
  readonly timeout?: number

  /**
   * Arbitrary context data passed through the execution
   */
  readonly data: Record<string, unknown>

  /**
   * Logger for structured logging
   */
  readonly logger: ExecutionLogger

  /**
   * Execute a dependency capability
   */
  invoke<TInput, TOutput>(
    capabilityId: CapabilityId,
    input: TInput
  ): Promise<ExecutionResult<TOutput>>

  /**
   * Create a child context for nested execution
   */
  child(spanId: string): ExecutionContext
}

/**
 * Execution logger interface
 */
export interface ExecutionLogger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void
}

// ============================================================
// EXECUTION RESULT
// ============================================================

/**
 * Execution error types
 */
export type ExecutionErrorType =
  | 'validation_error'
  | 'timeout'
  | 'capability_not_found'
  | 'dependency_failed'
  | 'execution_error'
  | 'contract_violation'

/**
 * Execution error
 */
export interface ExecutionError {
  readonly type: ExecutionErrorType
  readonly message: string
  readonly capabilityId: CapabilityId
  readonly cause?: unknown
  readonly stack?: string
}

/**
 * Execution result type
 */
export type ExecutionResult<T> = Result<T, ExecutionError>

/**
 * Create a successful execution result
 */
export function executionOk<T>(data: T): ExecutionResult<T> {
  return { success: true, data }
}

/**
 * Create a failed execution result
 */
export function executionErr(error: ExecutionError): ExecutionResult<never> {
  return { success: false, error }
}

// ============================================================
// EXECUTION TRACE
// ============================================================

/**
 * Execution trace for debugging/observability
 */
export interface ExecutionTrace {
  readonly traceId: string
  readonly spans: readonly ExecutionSpan[]
  readonly startedAt: Timestamp
  readonly endedAt: Timestamp
  readonly duration: number
}

/**
 * Individual execution span
 */
export interface ExecutionSpan {
  readonly spanId: string
  readonly parentSpanId?: string
  readonly capabilityId: CapabilityId
  readonly startedAt: Timestamp
  readonly endedAt: Timestamp
  readonly duration: number
  readonly status: 'success' | 'failure'
  readonly error?: ExecutionError
}

// ============================================================
// EXECUTION OPTIONS
// ============================================================

/**
 * Options for capability execution
 */
export interface ExecutionOptions {
  /**
   * Timeout in milliseconds
   */
  timeout?: number

  /**
   * Number of retry attempts
   */
  retries?: number

  /**
   * Retry delay in milliseconds
   */
  retryDelay?: number

  /**
   * Custom context data
   */
  contextData?: Record<string, unknown>

  /**
   * Whether to trace this execution
   */
  trace?: boolean
}

// ============================================================
// EXECUTION METRICS
// ============================================================

/**
 * Execution metrics for observability
 */
export interface ExecutionMetrics {
  readonly capabilityId: CapabilityId
  readonly totalExecutions: number
  readonly successfulExecutions: number
  readonly failedExecutions: number
  readonly averageDuration: number
  readonly p50Duration: number
  readonly p95Duration: number
  readonly p99Duration: number
}
