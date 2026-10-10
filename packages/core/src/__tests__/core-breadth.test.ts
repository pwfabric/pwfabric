/**
 * Core breadth coverage tests.
 *
 * Exercises previously-untested core modules:
 *  - `logger.ts`              — the legacy `Logger` / `createLogger`
 *  - `utils.ts`               — `ok`, `err`, `sleep`, `retry`, `generateId`
 *  - `errors.ts`              — `PWFabricError` hierarchy
 *  - `observability/logger.ts`— `ConsoleLogger` structured logger
 *  - `observability/tracer.ts`— trace context + spans + header propagation
 *  - `monitoring/metrics.ts`  — metrics state + Web-Vital ratings
 *  - `blocks/layout-schema.ts`— responsive layout schema + cascade helpers
 *
 * @module @pwfabric/core/__tests__/core-breadth
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  // logger.ts
  Logger,
  createLogger,
  // utils.ts
  ok,
  err,
  sleep,
  retry,
  generateId,
  // errors.ts
  PWFabricError,
  CoreValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  // observability
  ConsoleLogger,
  createObservabilityLogger,
  createTraceContext,
  createChildContext,
  createSpan,
  extractTraceId,
  injectTraceId,
  // monitoring
  DEFAULT_BUDGET,
  createMetricsState,
  getRating,
  // blocks/layout-schema
  responsiveNumberSchema,
  responsiveBooleanSchema,
  blockLayoutSchema,
  resolveResponsiveValue,
  resolveSpanAtBreakpoint,
  getColumnsAtBreakpoint,
  getBreakpointForWidth,
} from '../index.js'

// ============================================================
// logger.ts
// ============================================================

describe('Logger (legacy)', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('createLogger returns a Logger instance', () => {
    expect(createLogger('test')).toBeInstanceOf(Logger)
  })

  it('writes info messages to stdout', () => {
    createLogger('svc').info('hello')
    expect(stdoutSpy).toHaveBeenCalled()
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('[INFO]')
    expect(out).toContain('[svc]')
    expect(out).toContain('hello')
  })

  it('routes error messages to console.error and warn to console.warn', () => {
    const log = createLogger('svc')
    log.error('boom')
    log.warn('careful')
    expect(errorSpy).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('suppresses messages below the configured minimum level', () => {
    const log = createLogger('svc', 'error')
    log.debug('debug')
    log.info('info')
    log.warn('warn')
    // Only the error-level log should emit.
    expect(stdoutSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('serializes context payloads on info logs', () => {
    createLogger('svc', 'debug').info('with-ctx', { userId: 'u-1' })
    const out = stdoutSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('u-1')
  })

  it('child() namespaces the logger name', () => {
    const child = createLogger('parent').child('worker')
    child.error('x')
    const out = errorSpy.mock.calls.map((c) => String(c[0])).join('')
    expect(out).toContain('[parent:worker]')
  })
})

// ============================================================
// utils.ts
// ============================================================

describe('utils', () => {
  it('ok() wraps a success result', () => {
    expect(ok(42)).toEqual({ success: true, data: 42 })
  })

  it('err() wraps a failure result', () => {
    expect(err('nope')).toEqual({ success: false, error: 'nope' })
  })

  it('sleep() resolves after the requested delay', async () => {
    const start = Date.now()
    await sleep(10)
    expect(Date.now() - start).toBeGreaterThanOrEqual(8)
  })

  it('generateId() returns a unique UUID each call', () => {
    const a = generateId()
    const b = generateId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/i)
    expect(a).not.toBe(b)
  })

  it('retry() returns the result on the first successful attempt', async () => {
    const fn = vi.fn(async () => 'done')
    await expect(retry(fn, { initialDelay: 1 })).resolves.toBe('done')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('retry() retries until it succeeds', async () => {
    let attempts = 0
    const fn = vi.fn(async () => {
      attempts += 1
      if (attempts < 3) throw new Error('transient')
      return 'eventually'
    })
    await expect(
      retry(fn, { maxAttempts: 5, initialDelay: 1, backoffFactor: 1 })
    ).resolves.toBe('eventually')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('retry() throws the last error after exhausting attempts', async () => {
    const fn = vi.fn(async () => {
      throw new Error('always fails')
    })
    await expect(retry(fn, { maxAttempts: 2, initialDelay: 1 })).rejects.toThrow('always fails')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('retry() wraps a non-Error throw into an Error', async () => {
    const fn = vi.fn(async () => {
      throw 'string failure'
    })
    await expect(retry(fn, { maxAttempts: 1, initialDelay: 1 })).rejects.toThrow('string failure')
  })
})

// ============================================================
// errors.ts
// ============================================================

describe('PWFabricError hierarchy', () => {
  it('PWFabricError carries a code and a timestamp', () => {
    const e = new PWFabricError('something broke', 'CUSTOM_CODE')
    expect(e).toBeInstanceOf(Error)
    expect(e.name).toBe('PWFabricError')
    expect(e.code).toBe('CUSTOM_CODE')
    expect(e.timestamp).toBeInstanceOf(Date)
  })

  it('CoreValidationError sets the VALIDATION_ERROR code and field', () => {
    const e = new CoreValidationError('bad email', 'email')
    expect(e).toBeInstanceOf(PWFabricError)
    expect(e.code).toBe('VALIDATION_ERROR')
    expect(e.field).toBe('email')
    expect(e.name).toBe('ValidationError')
  })

  it('CoreValidationError leaves field undefined when omitted', () => {
    expect(new CoreValidationError('bad').field).toBeUndefined()
  })

  it('NotFoundError builds a message from the resource name', () => {
    const e = new NotFoundError('Surface')
    expect(e.code).toBe('NOT_FOUND')
    expect(e.resource).toBe('Surface')
    expect(e.message).toBe('Surface not found')
  })

  it('UnauthorizedError and ForbiddenError default their messages', () => {
    expect(new UnauthorizedError().message).toBe('Unauthorized')
    expect(new UnauthorizedError().code).toBe('UNAUTHORIZED')
    expect(new ForbiddenError().message).toBe('Forbidden')
    expect(new ForbiddenError().code).toBe('FORBIDDEN')
  })

  it('UnauthorizedError accepts a custom message', () => {
    expect(new UnauthorizedError('token expired').message).toBe('token expired')
  })
})

// ============================================================
// observability/logger.ts
// ============================================================

describe('ConsoleLogger (observability)', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('createObservabilityLogger returns a ConsoleLogger', () => {
    expect(createObservabilityLogger('svc')).toBeInstanceOf(ConsoleLogger)
  })

  it('emits info/warn/error to the matching console method', () => {
    const log = createObservabilityLogger('svc', 'debug')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(logSpy).toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('respects the minimum level threshold', () => {
    const log = createObservabilityLogger('svc', 'warn')
    log.debug('d')
    log.info('i')
    expect(logSpy).not.toHaveBeenCalled()
    log.warn('w')
    expect(warnSpy).toHaveBeenCalledTimes(1)
  })

  it('child() namespaces the logger and still emits', () => {
    const child = createObservabilityLogger('parent', 'debug').child('db')
    child.info('connected')
    const out = logSpy.mock.calls.map((c) => String(c[0])).join(' ')
    expect(out).toContain('parent:db')
  })

  it('passes the log context through to the console call', () => {
    createObservabilityLogger('svc', 'debug').info('with ctx', { traceId: 't-1' })
    const ctxArg = logSpy.mock.calls[0]?.[1]
    expect(ctxArg).toEqual({ traceId: 't-1' })
  })
})

// ============================================================
// observability/tracer.ts
// ============================================================

describe('tracer', () => {
  it('createTraceContext produces a hex traceId and spanId', () => {
    const ctx = createTraceContext()
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(ctx.parentSpanId).toBeUndefined()
    expect(typeof ctx.startTime).toBe('number')
  })

  it('createTraceContext records a parentSpanId when supplied', () => {
    const ctx = createTraceContext('parent-span')
    expect(ctx.parentSpanId).toBe('parent-span')
  })

  it('createChildContext inherits the traceId and links the parent span', () => {
    const parent = createTraceContext()
    const child = createChildContext(parent)
    expect(child.traceId).toBe(parent.traceId)
    expect(child.parentSpanId).toBe(parent.spanId)
    expect(child.spanId).not.toBe(parent.spanId)
  })

  it('createSpan().end() returns a result with a non-negative duration', () => {
    const span = createSpan('db-query')
    expect(span.name).toBe('db-query')
    const result = span.end()
    expect(result.name).toBe('db-query')
    expect(result.duration).toBeGreaterThanOrEqual(0)
    expect(result.endTime).toBeGreaterThanOrEqual(result.startTime)
  })

  it('createSpan with a parent context produces a child span', () => {
    const parent = createTraceContext()
    const span = createSpan('child-op', parent)
    expect(span.context.traceId).toBe(parent.traceId)
    expect(span.context.parentSpanId).toBe(parent.spanId)
  })

  it('extractTraceId reads x-trace-id from a Headers object', () => {
    const headers = new Headers()
    headers.set('x-trace-id', 'trace-123')
    expect(extractTraceId(headers)).toBe('trace-123')
  })

  it('extractTraceId reads x-trace-id from a plain record', () => {
    expect(extractTraceId({ 'x-trace-id': 'trace-456' })).toBe('trace-456')
    expect(extractTraceId({})).toBeUndefined()
  })

  it('injectTraceId writes x-trace-id into a Headers object and a record', () => {
    const headers = new Headers()
    injectTraceId(headers, 'trace-789')
    expect(headers.get('x-trace-id')).toBe('trace-789')

    const record: Record<string, string> = {}
    injectTraceId(record, 'trace-000')
    expect(record['x-trace-id']).toBe('trace-000')
  })
})

// ============================================================
// monitoring/metrics.ts
// ============================================================

describe('monitoring metrics', () => {
  it('createMetricsState seeds null web vitals and the default budget', () => {
    const state = createMetricsState()
    expect(state.webVitals.LCP).toBeNull()
    expect(state.timings).toEqual([])
    expect(state.renders).toEqual([])
    expect(state.budget).toEqual(DEFAULT_BUDGET)
  })

  it('createMetricsState merges a partial budget override', () => {
    const state = createMetricsState({ LCP: 1000 })
    expect(state.budget.LCP).toBe(1000)
    // Non-overridden keys keep their defaults.
    expect(state.budget.CLS).toBe(DEFAULT_BUDGET.CLS)
  })

  it('getRating classifies LCP values across all three bands', () => {
    expect(getRating('LCP', 2000)).toBe('good')
    expect(getRating('LCP', 3000)).toBe('needs-improvement')
    expect(getRating('LCP', 5000)).toBe('poor')
  })

  it('getRating classifies CLS and INP correctly', () => {
    expect(getRating('CLS', 0.05)).toBe('good')
    expect(getRating('CLS', 0.2)).toBe('needs-improvement')
    expect(getRating('INP', 600)).toBe('poor')
  })
})

// ============================================================
// blocks/layout-schema.ts
// ============================================================

describe('layout-schema', () => {
  it('responsiveNumberSchema accepts partial breakpoint maps', () => {
    expect(responsiveNumberSchema.safeParse({ md: 6, lg: 12 }).success).toBe(true)
    expect(responsiveNumberSchema.safeParse({}).success).toBe(true)
  })

  it('responsiveNumberSchema rejects negative and unknown keys', () => {
    expect(responsiveNumberSchema.safeParse({ md: -1 }).success).toBe(false)
    expect(responsiveNumberSchema.safeParse({ bogus: 1 }).success).toBe(false)
  })

  it('responsiveBooleanSchema accepts boolean breakpoint maps', () => {
    expect(responsiveBooleanSchema.safeParse({ xs: true, lg: false }).success).toBe(true)
  })

  it('blockLayoutSchema validates a span-only layout', () => {
    expect(blockLayoutSchema.safeParse({ span: { md: 6 } }).success).toBe(true)
  })

  it('blockLayoutSchema validates a layout with offset/order/hidden', () => {
    expect(
      blockLayoutSchema.safeParse({
        span: { md: 6 },
        offset: { md: 3 },
        order: { md: 1 },
        hidden: { xs: true },
      }).success
    ).toBe(true)
  })

  it('resolveResponsiveValue cascades down from the nearest defined breakpoint', () => {
    const responsive = { xs: 1, md: 6 }
    // lg is undefined → cascades down to md.
    expect(resolveResponsiveValue(responsive, 'lg')).toBe(6)
    // sm is undefined → cascades down to xs.
    expect(resolveResponsiveValue(responsive, 'sm')).toBe(1)
    expect(resolveResponsiveValue(responsive, 'xs')).toBe(1)
  })

  it('resolveResponsiveValue returns undefined for an undefined input', () => {
    expect(resolveResponsiveValue(undefined, 'md')).toBeUndefined()
  })

  it('resolveSpanAtBreakpoint returns the explicit span or the column default', () => {
    expect(resolveSpanAtBreakpoint({ span: { md: 8 } }, 'md')).toBe(8)
    // No span defined for lg → falls back to that breakpoint's column count.
    const fallback = resolveSpanAtBreakpoint({ span: {} }, 'lg')
    expect(typeof fallback).toBe('number')
    expect(fallback).toBeGreaterThan(0)
  })

  it('getColumnsAtBreakpoint returns a positive column count for each breakpoint', () => {
    for (const bp of ['xs', 'sm', 'md', 'lg', 'xl', '2xl'] as const) {
      expect(getColumnsAtBreakpoint(bp)).toBeGreaterThan(0)
    }
  })

  it('getBreakpointForWidth maps widths to the correct breakpoint', () => {
    expect(getBreakpointForWidth(0)).toBe('xs')
    expect(getBreakpointForWidth(10000)).toBe('2xl')
    // A mid-range width resolves to a named breakpoint.
    const mid = getBreakpointForWidth(800)
    expect(['xs', 'sm', 'md', 'lg', 'xl', '2xl']).toContain(mid)
  })
})
