/**
 * Task Executor Tests
 *
 * @module @pwfabric/runtime/__tests__/executor
 */

import { describe, it, expect, vi } from 'vitest'
import { executeTask, defineTask } from '../executor.js'

describe('defineTask()', () => {
  it('creates a task with name and execute function', () => {
    const execute = vi.fn(async (input: string) => `hello ${input}`)
    const task = defineTask('my-task', execute)

    expect(task.name).toBe('my-task')
    expect(task.execute).toBe(execute)
  })
})

describe('executeTask()', () => {
  it('returns ok result on success', async () => {
    const task = defineTask('add', async (input: { a: number; b: number }) => input.a + input.b)
    const result = await executeTask(task, { a: 2, b: 3 })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toBe(5)
    }
  })

  it('returns err result on failure', async () => {
    const task = defineTask('fail-task', async () => {
      throw new Error('task failed')
    })
    const result = await executeTask(task, {})

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('task failed')
    }
  })

  it('wraps non-Error exceptions', async () => {
    const task = defineTask('throw-string', async () => {
      throw new Error('string error')
    })
    const result = await executeTask(task, {})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('string error')
    }
  })

  it('times out when task exceeds timeout option', async () => {
    vi.useFakeTimers()
    const task = defineTask('slow-task', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000))
      return 'done'
    })

    const resultPromise = executeTask(task, {}, { timeout: 100 })
    vi.advanceTimersByTime(150)

    const result = await resultPromise
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toContain('timed out')
    }
    vi.useRealTimers()
  })

  it('calls task execute with context', async () => {
    const execute = vi.fn(async () => 'done')
    const task = defineTask('ctx-task', execute)

    await executeTask(task, { x: 1 })

    expect(execute).toHaveBeenCalledOnce()
    const firstCall = execute.mock.calls[0]
    expect(firstCall).toBeDefined()
    const [inputArg, ctxArg] = firstCall ?? []
    expect(inputArg).toEqual({ x: 1 })
    expect(ctxArg).toBeDefined()
    expect((ctxArg as { logger: unknown }).logger).toBeDefined()
  })
})
