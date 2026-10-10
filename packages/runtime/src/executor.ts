/**
 * Task executor for PWFabric runtime
 */

import { type Result, ok, err } from '@pwfabric/core'
import { type RuntimeContext, createContext } from './context.js'

/**
 * Task definition
 */
export interface Task<TInput, TOutput> {
  name: string
  execute: (input: TInput, ctx: RuntimeContext) => Promise<TOutput>
}

/**
 * Executor options
 */
export interface ExecutorOptions {
  timeout?: number
  retries?: number
}

/**
 * Execute a task with the given input
 */
export async function executeTask<TInput, TOutput>(
  task: Task<TInput, TOutput>,
  input: TInput,
  options: ExecutorOptions = {}
): Promise<Result<TOutput, Error>> {
  const ctx = createContext(task.name)
  const { timeout = 30000 } = options

  ctx.logger.info(`Starting task: ${task.name}`)

  try {
    const result = await Promise.race([
      task.execute(input, ctx),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Task ${task.name} timed out after ${timeout}ms`)),
          timeout
        )
      ),
    ])

    ctx.logger.info(`Task ${task.name} completed successfully`)
    return ok(result)
  } catch (error) {
    const err_ = error instanceof Error ? error : new Error(String(error))
    ctx.logger.error(`Task ${task.name} failed`, { error: err_.message })
    return err(err_)
  }
}

/**
 * Create a task definition
 */
export function defineTask<TInput, TOutput>(
  name: string,
  execute: (input: TInput, ctx: RuntimeContext) => Promise<TOutput>
): Task<TInput, TOutput> {
  return { name, execute }
}
