/**
 * Execution context for PWFabric runtime
 */

import { type Logger, createLogger } from '@pwfabric/core'

/**
 * Runtime context interface
 */
export interface RuntimeContext {
  readonly id: string
  readonly logger: Logger
  readonly startTime: Date
  readonly metadata: Map<string, unknown>
}

/**
 * Create a new runtime context
 */
export function createContext(name: string): RuntimeContext {
  return {
    id: crypto.randomUUID(),
    logger: createLogger(`runtime:${name}`),
    startTime: new Date(),
    metadata: new Map(),
  }
}

/**
 * Context builder for fluent API
 */
export class ContextBuilder {
  private name = 'default'
  private meta = new Map<string, unknown>()

  withName(name: string): this {
    this.name = name
    return this
  }

  withMetadata(key: string, value: unknown): this {
    this.meta.set(key, value)
    return this
  }

  build(): RuntimeContext {
    const ctx = createContext(this.name)
    for (const [key, value] of this.meta) {
      ctx.metadata.set(key, value)
    }
    return ctx
  }
}
