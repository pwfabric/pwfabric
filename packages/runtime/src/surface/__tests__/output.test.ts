/**
 * Typed Output Factory Tests
 *
 * Tests for createWebOutput, createApiOutput, createCliOutput
 */

import { describe, it, expect } from 'vitest'
import { createWebOutput, createApiOutput, createCliOutput } from '../output.js'

describe('createWebOutput', () => {
  it('should create a valid web output', () => {
    const result = createWebOutput({
      data: { html: '<div>Hello</div>' },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.type).toBe('web')
    expect(result.output.data.html).toBe('<div>Hello</div>')
  })

  it('should create web output with css and head', () => {
    const result = createWebOutput({
      data: {
        html: '<div>Hello</div>',
        css: '.container { color: red; }',
        head: '<title>Test</title>',
      },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.data.css).toBe('.container { color: red; }')
    expect(result.output.data.head).toBe('<title>Test</title>')
  })

  it('should include optional component field', () => {
    const mockComponent = { render: () => null }
    const result = createWebOutput({
      data: { html: '<div/>' },
      component: mockComponent,
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.component).toBe(mockComponent)
  })

  it('should include optional html field', () => {
    const result = createWebOutput({
      data: { html: '<div>inner</div>' },
      html: '<html><body><div>inner</div></body></html>',
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.html).toBe('<html><body><div>inner</div></body></html>')
  })

  it('should reject invalid data (missing html)', () => {
    const result = createWebOutput({
      data: {} as { html: string },
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should reject non-string html', () => {
    const result = createWebOutput({
      data: { html: 123 as unknown as string },
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('createApiOutput', () => {
  it('should create a valid API output', () => {
    const result = createApiOutput({
      data: { json: { users: [] }, status: 200 },
      status: 200,
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.type).toBe('api')
    expect(result.output.data.status).toBe(200)
    expect(result.output.status).toBe(200)
  })

  it('should include optional headers', () => {
    const result = createApiOutput({
      data: { json: null, status: 204 },
      status: 204,
      headers: { 'Content-Type': 'application/json' },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('should include optional body', () => {
    const result = createApiOutput({
      data: { json: { id: 1 }, status: 200 },
      status: 200,
      body: { id: 1, name: 'test' },
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.body).toEqual({ id: 1, name: 'test' })
  })

  it('should reject invalid status code in data', () => {
    const result = createApiOutput({
      data: { json: {}, status: 999 },
      status: 200,
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should reject missing status in data', () => {
    const result = createApiOutput({
      data: { json: {} } as { json: unknown; status: number },
      status: 200,
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.errors.length).toBeGreaterThan(0)
  })
})

describe('createCliOutput', () => {
  it('should create a valid CLI output', () => {
    const result = createCliOutput({
      data: { formatted: 'Hello, World!' },
      exitCode: 0,
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.type).toBe('cli')
    expect(result.output.data.formatted).toBe('Hello, World!')
    expect(result.output.exitCode).toBe(0)
  })

  it('should include raw data', () => {
    const result = createCliOutput({
      data: { formatted: 'pretty output', raw: { count: 42 } },
      exitCode: 0,
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.data.raw).toEqual({ count: 42 })
  })

  it('should include stdout and stderr', () => {
    const result = createCliOutput({
      data: { formatted: 'output' },
      exitCode: 1,
      stdout: 'some output',
      stderr: 'error message',
    })

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.output.stdout).toBe('some output')
    expect(result.output.stderr).toBe('error message')
    expect(result.output.exitCode).toBe(1)
  })

  it('should reject invalid data (missing formatted)', () => {
    const result = createCliOutput({
      data: {} as { formatted: string },
      exitCode: 0,
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should reject non-string formatted', () => {
    const result = createCliOutput({
      data: { formatted: 123 as unknown as string },
      exitCode: 0,
    })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.errors.length).toBeGreaterThan(0)
  })
})
