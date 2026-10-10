/**
 * Execution Types Tests
 *
 * Tests for execution context, results, and utilities
 *
 * @module @pwfabric/contracts/fabric/__tests__/execution
 */

import { describe, it, expect, vi } from 'vitest'
import {
  now,
  executionOk,
  executionErr,
  type Timestamp,
  type ExecutionLogger,
  type ExecutionErrorType,
  type ExecutionError,
  type ExecutionResult,
  type ExecutionTrace,
  type ExecutionSpan,
  type ExecutionOptions,
  type ExecutionMetrics,
} from '../../fabric/execution.js'
import type { CapabilityId } from '../../core/ids.js'

describe('now', () => {
  it('should return current timestamp', () => {
    const before = Date.now()
    const timestamp = now()
    const after = Date.now()

    expect(timestamp).toBeGreaterThanOrEqual(before)
    expect(timestamp).toBeLessThanOrEqual(after)
  })

  it('should return number type', () => {
    const timestamp = now()

    expect(typeof timestamp).toBe('number')
  })
})

describe('executionOk', () => {
  it('should create successful result with data', () => {
    const data = { token: 'abc123', userId: 'user-1' }
    const result = executionOk(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual(data)
    }
  })

  it('should create successful result with primitive', () => {
    const result = executionOk(42)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe(42)
    }
  })

  it('should create successful result with null', () => {
    const result = executionOk(null)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBeNull()
    }
  })

  it('should create successful result with array', () => {
    const data = [1, 2, 3]
    const result = executionOk(data)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toEqual([1, 2, 3])
    }
  })
})

describe('executionErr', () => {
  it('should create failed result with error', () => {
    const error: ExecutionError = {
      type: 'validation_error',
      message: 'Invalid input',
      capabilityId: 'auth/login' as CapabilityId,
    }
    const result = executionErr(error)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toEqual(error)
    }
  })

  it('should preserve error type', () => {
    const error: ExecutionError = {
      type: 'timeout',
      message: 'Execution timed out',
      capabilityId: 'slow/operation' as CapabilityId,
    }
    const result = executionErr(error)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.type).toBe('timeout')
    }
  })

  it('should include cause when provided', () => {
    const cause = new Error('Original error')
    const error: ExecutionError = {
      type: 'execution_error',
      message: 'Execution failed',
      capabilityId: 'auth/login' as CapabilityId,
      cause,
    }
    const result = executionErr(error)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.cause).toBe(cause)
    }
  })

  it('should include stack when provided', () => {
    const error: ExecutionError = {
      type: 'execution_error',
      message: 'Execution failed',
      capabilityId: 'auth/login' as CapabilityId,
      stack: 'Error: ...\n  at ...',
    }
    const result = executionErr(error)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.stack).toBeDefined()
    }
  })
})

describe('Timestamp', () => {
  it('should be a number type', () => {
    const ts: Timestamp = Date.now()

    expect(typeof ts).toBe('number')
  })
})

describe('ExecutionErrorType', () => {
  it('should include all error types', () => {
    const types: ExecutionErrorType[] = [
      'validation_error',
      'timeout',
      'capability_not_found',
      'dependency_failed',
      'execution_error',
      'contract_violation',
    ]

    expect(types).toHaveLength(6)
  })
})

describe('ExecutionError', () => {
  it('should accept minimal error', () => {
    const error: ExecutionError = {
      type: 'execution_error',
      message: 'Something went wrong',
      capabilityId: 'test/capability' as CapabilityId,
    }

    expect(error.type).toBe('execution_error')
    expect(error.message).toBe('Something went wrong')
  })

  it('should accept full error', () => {
    const error: ExecutionError = {
      type: 'dependency_failed',
      message: 'Dependency execution failed',
      capabilityId: 'payments/process' as CapabilityId,
      cause: new Error('DB connection lost'),
      stack: 'Error: ...',
    }

    expect(error.type).toBe('dependency_failed')
    expect(error.cause).toBeDefined()
    expect(error.stack).toBeDefined()
  })
})

describe('ExecutionResult', () => {
  it('should be a Result type alias', () => {
    const successResult: ExecutionResult<string> = executionOk('success')
    const failResult: ExecutionResult<string> = executionErr({
      type: 'execution_error',
      message: 'fail',
      capabilityId: 'test' as CapabilityId,
    })

    expect(successResult.success).toBe(true)
    expect(failResult.success).toBe(false)
  })
})

describe('ExecutionLogger', () => {
  it('should have all log methods', () => {
    const logger: ExecutionLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    logger.debug('debug message')
    logger.info('info message')
    logger.warn('warn message')
    logger.error('error message')

    expect(logger.debug).toHaveBeenCalledWith('debug message')
    expect(logger.info).toHaveBeenCalledWith('info message')
    expect(logger.warn).toHaveBeenCalledWith('warn message')
    expect(logger.error).toHaveBeenCalledWith('error message')
  })

  it('should accept data parameter', () => {
    const logger: ExecutionLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const data = { userId: 'user-1', action: 'login' }
    logger.info('User action', data)

    expect(logger.info).toHaveBeenCalledWith('User action', data)
  })
})

describe('ExecutionTrace', () => {
  it('should contain trace information', () => {
    const trace: ExecutionTrace = {
      traceId: 'trace-123',
      spans: [],
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      duration: 100,
    }

    expect(trace.traceId).toBe('trace-123')
    expect(trace.duration).toBe(100)
  })

  it('should contain spans', () => {
    const span: ExecutionSpan = {
      spanId: 'span-1',
      capabilityId: 'auth/login' as CapabilityId,
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
      duration: 50,
      status: 'success',
    }

    const trace: ExecutionTrace = {
      traceId: 'trace-123',
      spans: [span],
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      duration: 100,
    }

    expect(trace.spans).toHaveLength(1)
    expect(trace.spans[0].status).toBe('success')
  })
})

describe('ExecutionSpan', () => {
  it('should represent successful span', () => {
    const span: ExecutionSpan = {
      spanId: 'span-1',
      capabilityId: 'auth/login' as CapabilityId,
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
      duration: 50,
      status: 'success',
    }

    expect(span.status).toBe('success')
    expect(span.error).toBeUndefined()
  })

  it('should represent failed span with error', () => {
    const span: ExecutionSpan = {
      spanId: 'span-1',
      parentSpanId: 'span-0',
      capabilityId: 'auth/login' as CapabilityId,
      startedAt: Date.now() - 50,
      endedAt: Date.now(),
      duration: 50,
      status: 'failure',
      error: {
        type: 'execution_error',
        message: 'Auth failed',
        capabilityId: 'auth/login' as CapabilityId,
      },
    }

    expect(span.status).toBe('failure')
    expect(span.error).toBeDefined()
    expect(span.parentSpanId).toBe('span-0')
  })
})

describe('ExecutionOptions', () => {
  it('should accept empty options', () => {
    const options: ExecutionOptions = {}

    expect(options.timeout).toBeUndefined()
  })

  it('should accept full options', () => {
    const options: ExecutionOptions = {
      timeout: 5000,
      retries: 3,
      retryDelay: 100,
      contextData: { userId: 'user-1' },
      trace: true,
    }

    expect(options.timeout).toBe(5000)
    expect(options.retries).toBe(3)
    expect(options.retryDelay).toBe(100)
    expect(options.contextData?.userId).toBe('user-1')
    expect(options.trace).toBe(true)
  })
})

describe('ExecutionMetrics', () => {
  it('should contain all metrics', () => {
    const metrics: ExecutionMetrics = {
      capabilityId: 'auth/login' as CapabilityId,
      totalExecutions: 1000,
      successfulExecutions: 950,
      failedExecutions: 50,
      averageDuration: 150,
      p50Duration: 100,
      p95Duration: 300,
      p99Duration: 500,
    }

    expect(metrics.totalExecutions).toBe(1000)
    expect(metrics.successfulExecutions + metrics.failedExecutions).toBe(metrics.totalExecutions)
    expect(metrics.p50Duration).toBeLessThanOrEqual(metrics.p95Duration)
    expect(metrics.p95Duration).toBeLessThanOrEqual(metrics.p99Duration)
  })
})
