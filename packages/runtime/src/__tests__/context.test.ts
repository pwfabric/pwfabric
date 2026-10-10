/**
 * RuntimeContext Tests
 *
 * @module @pwfabric/runtime/__tests__/context
 */

import { describe, it, expect } from 'vitest'
import { createContext, ContextBuilder } from '../context.js'

describe('createContext()', () => {
  it('creates a context with a unique id', () => {
    const ctx1 = createContext('test')
    const ctx2 = createContext('test')
    expect(ctx1.id).toBeDefined()
    expect(ctx2.id).toBeDefined()
    expect(ctx1.id).not.toBe(ctx2.id)
  })

  it('creates a context with a logger', () => {
    const ctx = createContext('my-service')
    expect(ctx.logger).toBeDefined()
    expect(typeof ctx.logger.info).toBe('function')
    expect(typeof ctx.logger.error).toBe('function')
  })

  it('creates a context with startTime as a Date', () => {
    const before = new Date()
    const ctx = createContext('timer-test')
    const after = new Date()

    expect(ctx.startTime).toBeInstanceOf(Date)
    expect(ctx.startTime.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(ctx.startTime.getTime()).toBeLessThanOrEqual(after.getTime())
  })

  it('creates a context with an empty metadata map', () => {
    const ctx = createContext('meta-test')
    expect(ctx.metadata).toBeInstanceOf(Map)
    expect(ctx.metadata.size).toBe(0)
  })
})

describe('ContextBuilder', () => {
  it('builds context with default name', () => {
    const ctx = new ContextBuilder().build()
    expect(ctx.logger).toBeDefined()
    expect(ctx.id).toBeDefined()
  })

  it('builds context with custom name', () => {
    const ctx = new ContextBuilder().withName('custom-service').build()
    expect(ctx.id).toBeDefined()
  })

  it('supports chaining withName', () => {
    const builder = new ContextBuilder()
    const result = builder.withName('svc')
    expect(result).toBe(builder)
  })

  it('adds metadata to the context', () => {
    const ctx = new ContextBuilder()
      .withName('meta-builder')
      .withMetadata('key1', 'value1')
      .withMetadata('key2', 42)
      .build()

    expect(ctx.metadata.get('key1')).toBe('value1')
    expect(ctx.metadata.get('key2')).toBe(42)
  })

  it('supports chaining withMetadata', () => {
    const builder = new ContextBuilder()
    const result = builder.withMetadata('k', 'v')
    expect(result).toBe(builder)
  })
})
