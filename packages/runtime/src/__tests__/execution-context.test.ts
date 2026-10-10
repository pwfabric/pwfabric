/**
 * ExecutionContext Tests
 *
 * Runtime execution context.
 *
 * @module @pwfabric/runtime/__tests__/execution-context
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ConsoleExecutionLogger,
  NoOpExecutionLogger,
  RuntimeExecutionContext,
  createExecutionContext,
  generateTraceId,
  generateSpanId,
} from '../execution-context.js'
import type { FabricId, ManifestationId, CapabilityId } from '@pwfabric/contracts'
import { executionOk } from '@pwfabric/contracts'

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================
// generateTraceId / generateSpanId
// ============================================================

describe('generateTraceId()', () => {
  it('returns a string starting with trace_', () => {
    const id = generateTraceId()
    expect(id).toMatch(/^trace_/)
  })

  it('returns unique IDs', () => {
    const id1 = generateTraceId()
    const id2 = generateTraceId()
    expect(id1).not.toBe(id2)
  })
})

describe('generateSpanId()', () => {
  it('returns a string starting with span_', () => {
    const id = generateSpanId()
    expect(id).toMatch(/^span_/)
  })
})

// ============================================================
// ConsoleExecutionLogger
// ============================================================

describe('ConsoleExecutionLogger', () => {
  it('logs debug to console.debug', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(vi.fn())
    const logger = new ConsoleExecutionLogger('trace-1', 'span-1')
    logger.debug('debug msg', { key: 'val' })
    expect(spy).toHaveBeenCalled()
  })

  it('logs info to console.info', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(vi.fn())
    const logger = new ConsoleExecutionLogger('trace-1', 'span-1')
    logger.info('info msg')
    expect(spy).toHaveBeenCalled()
  })

  it('logs warn to console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(vi.fn())
    const logger = new ConsoleExecutionLogger('trace-1', 'span-1')
    logger.warn('warn msg')
    expect(spy).toHaveBeenCalled()
  })

  it('logs error to console.error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(vi.fn())
    const logger = new ConsoleExecutionLogger('trace-1', 'span-1')
    logger.error('error msg')
    expect(spy).toHaveBeenCalled()
  })
})

// ============================================================
// NoOpExecutionLogger
// ============================================================

describe('NoOpExecutionLogger', () => {
  it('does not throw for any method', () => {
    const logger = new NoOpExecutionLogger()
    expect(() => logger.debug('d')).not.toThrow()
    expect(() => logger.info('i')).not.toThrow()
    expect(() => logger.warn('w')).not.toThrow()
    expect(() => logger.error('e')).not.toThrow()
  })
})

// ============================================================
// RuntimeExecutionContext
// ============================================================

const mockInvoker = vi.fn(async () => executionOk({}))

function makeOptions(): {
  traceId: string
  spanId: string
  fabricId: FabricId
  invoker: typeof mockInvoker
} {
  return {
    traceId: 'trace-test',
    spanId: 'span-test',
    fabricId: 'fabric-1' as FabricId,
    invoker: mockInvoker,
  }
}

describe('RuntimeExecutionContext', () => {
  it('stores traceId and spanId', () => {
    const ctx = new RuntimeExecutionContext(makeOptions())
    expect(ctx.traceId).toBe('trace-test')
    expect(ctx.spanId).toBe('span-test')
  })

  it('stores fabricId', () => {
    const ctx = new RuntimeExecutionContext(makeOptions())
    expect(ctx.fabricId).toBe('fabric-1')
  })

  it('sets startedAt to current timestamp', () => {
    const before = Date.now()
    const ctx = new RuntimeExecutionContext(makeOptions())
    const after = Date.now()
    expect(ctx.startedAt).toBeGreaterThanOrEqual(before)
    expect(ctx.startedAt).toBeLessThanOrEqual(after)
  })

  it('uses default empty data when not provided', () => {
    const ctx = new RuntimeExecutionContext(makeOptions())
    expect(ctx.data).toEqual({})
  })

  it('stores provided data', () => {
    const ctx = new RuntimeExecutionContext({
      ...makeOptions(),
      data: { userId: '42' },
    })
    expect(ctx.data.userId).toBe('42')
  })

  it('stores optional parentSpanId', () => {
    const ctx = new RuntimeExecutionContext({
      ...makeOptions(),
      parentSpanId: 'parent-span',
    })
    expect(ctx.parentSpanId).toBe('parent-span')
  })

  it('stores optional manifestationId', () => {
    const ctx = new RuntimeExecutionContext({
      ...makeOptions(),
      manifestationId: 'manif-1' as ManifestationId,
    })
    expect(ctx.manifestationId).toBe('manif-1')
  })

  it('stores optional timeout', () => {
    const ctx = new RuntimeExecutionContext({
      ...makeOptions(),
      timeout: 5000,
    })
    expect(ctx.timeout).toBe(5000)
  })

  it('uses provided logger', () => {
    const logger = new NoOpExecutionLogger()
    const ctx = new RuntimeExecutionContext({ ...makeOptions(), logger })
    expect(ctx.logger).toBe(logger)
  })

  it('uses ConsoleExecutionLogger when no logger provided', () => {
    const ctx = new RuntimeExecutionContext(makeOptions())
    expect(ctx.logger).toBeInstanceOf(ConsoleExecutionLogger)
  })

  describe('invoke()', () => {
    it('calls the invoker with capability id and input', async () => {
      const invoker = vi.fn(async () => executionOk({ result: 'ok' }))
      const ctx = new RuntimeExecutionContext({ ...makeOptions(), invoker })

      await ctx.invoke('cap-1' as CapabilityId, { x: 1 })
      expect(invoker).toHaveBeenCalledWith('cap-1', { x: 1 })
    })
  })

  describe('child()', () => {
    it('creates a child context with new spanId', () => {
      const ctx = new RuntimeExecutionContext(makeOptions())
      const child = ctx.child('child-span')

      expect(child.spanId).toBe('child-span')
      expect(child.traceId).toBe(ctx.traceId)
      expect(child.parentSpanId).toBe('span-test')
    })

    it('child inherits data from parent', () => {
      const ctx = new RuntimeExecutionContext({
        ...makeOptions(),
        data: { userId: '99' },
      })
      const child = ctx.child('child-span')
      expect(child.data.userId).toBe('99')
    })

    it('child inherits timeout from parent', () => {
      const ctx = new RuntimeExecutionContext({
        ...makeOptions(),
        timeout: 3000,
      })
      const child = ctx.child('child-span')
      expect(child.timeout).toBe(3000)
    })

    it('child inherits manifestationId from parent', () => {
      const ctx = new RuntimeExecutionContext({
        ...makeOptions(),
        manifestationId: 'manif-1' as ManifestationId,
      })
      const child = ctx.child('child-span')
      expect(child.manifestationId).toBe('manif-1')
    })
  })
})

// ============================================================
// createExecutionContext
// ============================================================

describe('createExecutionContext()', () => {
  it('creates a RuntimeExecutionContext', () => {
    const ctx = createExecutionContext({
      fabricId: 'fab-1' as FabricId,
      invoker: mockInvoker,
    })
    expect(ctx).toBeInstanceOf(RuntimeExecutionContext)
  })

  it('uses NoOpExecutionLogger when silent=true', () => {
    const ctx = createExecutionContext({
      fabricId: 'fab-1' as FabricId,
      invoker: mockInvoker,
      silent: true,
    })
    expect(ctx.logger).toBeInstanceOf(NoOpExecutionLogger)
  })

  it('sets manifestationId when provided', () => {
    const ctx = createExecutionContext({
      fabricId: 'fab-1' as FabricId,
      invoker: mockInvoker,
      manifestationId: 'manif-2' as ManifestationId,
    })
    expect(ctx.manifestationId).toBe('manif-2')
  })

  it('sets timeout when provided', () => {
    const ctx = createExecutionContext({
      fabricId: 'fab-1' as FabricId,
      invoker: mockInvoker,
      timeout: 8000,
    })
    expect(ctx.timeout).toBe(8000)
  })

  it('sets data when provided', () => {
    const ctx = createExecutionContext({
      fabricId: 'fab-1' as FabricId,
      invoker: mockInvoker,
      data: { role: 'admin' },
    })
    expect(ctx.data.role).toBe('admin')
  })
})
