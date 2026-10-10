/**
 * Execution Context
 *
 * Runtime execution context for capability execution
 *
 * @module @pwfabric/runtime/execution-context
 */

import type {
  CapabilityId,
  FabricId,
  ManifestationId,
  ExecutionContext,
  ExecutionLogger,
  ExecutionResult,
  Timestamp,
} from '@pwfabric/contracts'

// ============================================================
// LOGGER IMPLEMENTATION
// ============================================================

/**
 * Console-based execution logger
 */
export class ConsoleExecutionLogger implements ExecutionLogger {
  constructor(
    private readonly traceId: string,
    private readonly spanId: string
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    console.debug(`[${this.traceId}:${this.spanId}] DEBUG: ${message}`, data || '')
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.info(`[${this.traceId}:${this.spanId}] INFO: ${message}`, data || '')
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(`[${this.traceId}:${this.spanId}] WARN: ${message}`, data || '')
  }

  error(message: string, data?: Record<string, unknown>): void {
    console.error(`[${this.traceId}:${this.spanId}] ERROR: ${message}`, data || '')
  }
}

/**
 * No-op logger for silent execution
 */
export class NoOpExecutionLogger implements ExecutionLogger {
  debug(_message: string, _data?: Record<string, unknown>): void {
    // No-op
  }
  info(_message: string, _data?: Record<string, unknown>): void {
    // No-op
  }
  warn(_message: string, _data?: Record<string, unknown>): void {
    // No-op
  }
  error(_message: string, _data?: Record<string, unknown>): void {
    // No-op
  }
}

// ============================================================
// EXECUTION CONTEXT IMPLEMENTATION
// ============================================================

/**
 * Invocation handler type for resolving capability execution
 */
export type InvocationHandler = <TInput, TOutput>(
  capabilityId: CapabilityId,
  input: TInput
) => Promise<ExecutionResult<TOutput>>

/**
 * Runtime execution context options
 */
export interface RuntimeExecutionContextOptions {
  traceId: string
  spanId: string
  parentSpanId?: string
  fabricId: FabricId
  manifestationId?: ManifestationId
  timeout?: number
  data?: Record<string, unknown>
  logger?: ExecutionLogger
  invoker: InvocationHandler
}

/**
 * Runtime execution context implementation
 */
export class RuntimeExecutionContext implements ExecutionContext {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly fabricId: FabricId
  readonly manifestationId?: ManifestationId
  readonly startedAt: Timestamp
  readonly timeout?: number
  readonly data: Record<string, unknown>
  readonly logger: ExecutionLogger

  private readonly invoker: InvocationHandler

  constructor(options: RuntimeExecutionContextOptions) {
    this.traceId = options.traceId
    this.spanId = options.spanId
    if (options.parentSpanId !== undefined) {
      this.parentSpanId = options.parentSpanId
    }
    this.fabricId = options.fabricId
    if (options.manifestationId !== undefined) {
      this.manifestationId = options.manifestationId
    }
    this.startedAt = Date.now()
    if (options.timeout !== undefined) {
      this.timeout = options.timeout
    }
    this.data = options.data ?? {}
    this.logger = options.logger ?? new ConsoleExecutionLogger(this.traceId, this.spanId)
    this.invoker = options.invoker
  }

  invoke<TInput, TOutput>(
    capabilityId: CapabilityId,
    input: TInput
  ): Promise<ExecutionResult<TOutput>> {
    return this.invoker(capabilityId, input)
  }

  child(spanId: string): ExecutionContext {
    const childOptions: RuntimeExecutionContextOptions = {
      traceId: this.traceId,
      spanId,
      parentSpanId: this.spanId,
      fabricId: this.fabricId,
      invoker: this.invoker,
      data: { ...this.data },
      logger: new ConsoleExecutionLogger(this.traceId, spanId),
    }
    if (this.manifestationId !== undefined) {
      childOptions.manifestationId = this.manifestationId
    }
    if (this.timeout !== undefined) {
      childOptions.timeout = this.timeout
    }
    return new RuntimeExecutionContext(childOptions)
  }
}

// ============================================================
// CONTEXT FACTORY
// ============================================================

/**
 * Generate a unique trace ID
 */
export function generateTraceId(): string {
  return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate a unique span ID
 */
export function generateSpanId(): string {
  return `span_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Options for creating an execution context
 */
export interface CreateExecutionContextOptions {
  fabricId: FabricId
  manifestationId?: ManifestationId
  timeout?: number
  data?: Record<string, unknown>
  silent?: boolean
  invoker: InvocationHandler
}

/**
 * Create a new execution context
 */
export function createExecutionContext(
  options: CreateExecutionContextOptions
): RuntimeExecutionContext {
  const traceId = generateTraceId()
  const spanId = generateSpanId()

  const contextOptions: RuntimeExecutionContextOptions = {
    traceId,
    spanId,
    fabricId: options.fabricId,
    invoker: options.invoker,
    logger: options.silent
      ? new NoOpExecutionLogger()
      : new ConsoleExecutionLogger(traceId, spanId),
  }

  if (options.manifestationId) {
    contextOptions.manifestationId = options.manifestationId
  }
  if (options.timeout) {
    contextOptions.timeout = options.timeout
  }
  if (options.data) {
    contextOptions.data = options.data
  }

  return new RuntimeExecutionContext(contextOptions)
}
