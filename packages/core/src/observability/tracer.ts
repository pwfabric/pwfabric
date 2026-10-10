/**
 * Trace Context
 *
 * Request tracing for observability
 *
 * @module @pwfabric/core/observability/tracer
 */

/**
 * Trace context
 */
export interface TraceContext {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly startTime: number
}

/**
 * Span represents a unit of work
 */
export interface Span {
  readonly context: TraceContext
  readonly name: string
  readonly startTime: number
  end(): SpanResult
}

/**
 * Completed span result
 */
export interface SpanResult {
  readonly context: TraceContext
  readonly name: string
  readonly startTime: number
  readonly endTime: number
  readonly duration: number
}

/**
 * Generate a random trace/span ID
 */
function generateId(): string {
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256)
    }
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Create a new trace context
 */
export function createTraceContext(parentSpanId?: string): TraceContext {
  const context: TraceContext = {
    traceId: generateId(),
    spanId: generateId().slice(0, 16),
    startTime: Date.now(),
  }
  if (parentSpanId !== undefined) {
    return { ...context, parentSpanId }
  }
  return context
}

/**
 * Create a child span from existing context
 */
export function createChildContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateId().slice(0, 16),
    parentSpanId: parent.spanId,
    startTime: Date.now(),
  }
}

/**
 * Create a span for tracing
 */
export function createSpan(name: string, parentContext?: TraceContext): Span {
  const context = parentContext ? createChildContext(parentContext) : createTraceContext()
  const startTime = performance.now()

  return {
    context,
    name,
    startTime,
    end(): SpanResult {
      const endTime = performance.now()
      return {
        context,
        name,
        startTime,
        endTime,
        duration: endTime - startTime,
      }
    },
  }
}

/**
 * Extract trace ID from headers
 */
export function extractTraceId(
  headers: Headers | Record<string, string | undefined>
): string | undefined {
  if (headers instanceof Headers) {
    return headers.get('x-trace-id') ?? undefined
  }
  return headers['x-trace-id']
}

/**
 * Inject trace ID into headers
 */
export function injectTraceId(headers: Headers | Record<string, string>, traceId: string): void {
  if (headers instanceof Headers) {
    headers.set('x-trace-id', traceId)
  } else {
    headers['x-trace-id'] = traceId
  }
}
