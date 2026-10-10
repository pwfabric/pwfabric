/**
 * Binding Engine
 *
 * Resolves and manages capability bindings for surfaces
 *
 * @module @pwfabric/runtime/binding/engine
 */

import type { SurfaceId, Capability, ExecutionResult, ExecutionError } from '@pwfabric/contracts'
import { executionErr } from '@pwfabric/contracts'
import type { FabricKernel } from '../kernel.js'
import type {
  BindingConfig,
  BoundCapability,
  BindingState,
  BindingError,
  BindingContext,
  BindingResult,
  SurfaceBindingResult,
  AuthContext,
} from './types.js'
import type { CacheProvider } from '../cache/types.js'

// ============================================================
// BINDING ENGINE
// ============================================================

/**
 * Binding engine interface
 */
export interface BindingEngine {
  /**
   * Bind a capability to a surface
   */
  bind<TOutput>(surfaceId: SurfaceId, config: BindingConfig): BindingResult<TOutput>

  /**
   * Bind all capabilities for a surface
   */
  bindAll(surfaceId: SurfaceId, configs: readonly BindingConfig[]): SurfaceBindingResult

  /**
   * Get a bound capability
   */
  get(surfaceId: SurfaceId, alias: string): BoundCapability | undefined

  /**
   * Unbind a capability
   */
  unbind(surfaceId: SurfaceId, alias: string): boolean

  /**
   * Unbind all capabilities for a surface
   */
  unbindAll(surfaceId: SurfaceId): void

  /**
   * Get binding context for a surface
   */
  getContext(surfaceId: SurfaceId): BindingContext | undefined

  /**
   * Set authentication context
   */
  setAuthContext(surfaceId: SurfaceId, auth: AuthContext): void
}

// ============================================================
// RUNTIME BINDING ENGINE
// ============================================================

/**
 * Runtime binding engine implementation
 */
export class RuntimeBindingEngine implements BindingEngine {
  private readonly fabric: FabricKernel
  private readonly cache: CacheProvider | undefined
  private readonly contexts = new Map<SurfaceId, BindingContext>()

  constructor(fabric: FabricKernel, cache?: CacheProvider) {
    this.fabric = fabric
    this.cache = cache
  }

  bind<TOutput>(surfaceId: SurfaceId, config: BindingConfig): BindingResult<TOutput> {
    // Resolve capability from fabric
    const resolution = this.fabric.resolve(config.capabilityId)
    if (!resolution.found) {
      return {
        success: false,
        error: {
          type: 'resolution_failed',
          message: `Capability ${config.capabilityId} not found`,
        },
      }
    }

    const alias = config.alias ?? config.capabilityId

    // Create bound capability
    const boundCapability = this.createBoundCapability<unknown, TOutput>(
      surfaceId,
      alias,
      resolution.capability,
      config
    )

    // Get or create context
    let context = this.contexts.get(surfaceId)
    if (!context) {
      context = {
        surfaceId,
        data: {},
        bindings: new Map(),
      }
      this.contexts.set(surfaceId, context)
    }

    // Add to bindings
    context.bindings.set(alias, boundCapability as BoundCapability)

    return { success: true, binding: boundCapability }
  }

  bindAll(surfaceId: SurfaceId, configs: readonly BindingConfig[]): SurfaceBindingResult {
    const errors: BindingError[] = []

    for (const config of configs) {
      const result = this.bind(surfaceId, config)
      if (!result.success) {
        errors.push(result.error)
      }
    }

    if (errors.length > 0) {
      return { success: false, errors }
    }

    const context = this.contexts.get(surfaceId)
    if (!context) {
      return {
        success: false,
        errors: [{ type: 'resolution_failed', message: 'Context not created' }],
      }
    }

    return { success: true, context }
  }

  get(surfaceId: SurfaceId, alias: string): BoundCapability | undefined {
    return this.contexts.get(surfaceId)?.bindings.get(alias)
  }

  unbind(surfaceId: SurfaceId, alias: string): boolean {
    const context = this.contexts.get(surfaceId)
    if (!context) return false
    return context.bindings.delete(alias)
  }

  unbindAll(surfaceId: SurfaceId): void {
    this.contexts.delete(surfaceId)
  }

  getContext(surfaceId: SurfaceId): BindingContext | undefined {
    return this.contexts.get(surfaceId)
  }

  setAuthContext(surfaceId: SurfaceId, auth: AuthContext): void {
    const existing = this.contexts.get(surfaceId)
    if (existing) {
      const updated: BindingContext = {
        ...existing,
        auth,
      }
      this.contexts.set(surfaceId, updated)
    } else {
      this.contexts.set(surfaceId, {
        surfaceId,
        auth,
        data: {},
        bindings: new Map(),
      })
    }
  }

  private createBoundCapability<TInput, TOutput>(
    surfaceId: SurfaceId,
    alias: string,
    _capability: Capability,
    config: BindingConfig
  ): BoundCapability<TInput, TOutput> {
    let state: BindingState = 'bound'
    let lastExecuted: number | undefined
    let lastResult: ExecutionResult<TOutput> | undefined
    let lastInput: TInput | undefined
    let error: BindingError | undefined

    const execute = async (input: TInput): Promise<ExecutionResult<TOutput>> => {
      state = 'binding'
      lastInput = input

      try {
        // Apply input transform if configured
        let transformedInput = input
        if (config.transform?.input) {
          try {
            transformedInput = config.transform.input(input) as TInput
          } catch (e) {
            state = 'error'
            error = {
              type: 'transform_failed',
              message: `Input transform failed: ${e}`,
              cause: e,
            }
            const execError: ExecutionError = {
              type: 'execution_error',
              message: error.message,
              capabilityId: config.capabilityId,
            }
            return executionErr(execError)
          }
        }

        // Check cache if enabled
        if (config.cache?.enabled && this.cache) {
          const cacheKey = config.cache.key ?? `${surfaceId}:${alias}:${JSON.stringify(input)}`
          const cached = await this.cache.get<TOutput>(cacheKey)
          if (cached !== undefined) {
            state = 'bound'
            lastExecuted = Date.now()
            lastResult = { success: true, data: cached }
            return lastResult
          }
        }

        // Execute capability
        const result = await this.fabric.execute<TInput, TOutput>(
          config.capabilityId,
          transformedInput
        )

        if (result.success) {
          // Apply output transform if configured
          let output = result.data
          if (config.transform?.output) {
            try {
              output = config.transform.output(output) as TOutput
            } catch (e) {
              state = 'error'
              error = {
                type: 'transform_failed',
                message: `Output transform failed: ${e}`,
                cause: e,
              }
              const execError: ExecutionError = {
                type: 'execution_error',
                message: error.message,
                capabilityId: config.capabilityId,
              }
              return executionErr(execError)
            }
          }

          // Store in cache if enabled
          if (config.cache?.enabled && this.cache) {
            const cacheKey = config.cache.key ?? `${surfaceId}:${alias}:${JSON.stringify(input)}`
            await this.cache.set(cacheKey, output, config.cache.ttl)
          }

          state = 'bound'
          lastExecuted = Date.now()
          lastResult = { success: true, data: output }
          return lastResult
        } else {
          state = 'error'
          error = {
            type: 'execution_failed',
            message: result.error.message,
            cause: result.error,
          }
          lastResult = result
          return result
        }
      } catch (e) {
        state = 'error'
        error = {
          type: 'execution_failed',
          message: `Execution failed: ${e}`,
          cause: e,
        }
        const execError: ExecutionError = {
          type: 'execution_error',
          message: error.message,
          capabilityId: config.capabilityId,
        }
        return executionErr(execError)
      }
    }

    const refresh = async (): Promise<ExecutionResult<TOutput>> => {
      if (lastInput === undefined) {
        const execError: ExecutionError = {
          type: 'execution_error',
          message: 'No previous input to refresh',
          capabilityId: config.capabilityId,
        }
        return executionErr(execError)
      }
      return execute(lastInput)
    }

    const invalidate = (): void => {
      state = 'stale'
      if (config.cache?.enabled && this.cache) {
        const cacheKey = config.cache.key ?? `${surfaceId}:${alias}:${JSON.stringify(lastInput)}`
        this.cache.delete(cacheKey)
      }
    }

    const boundCapability: BoundCapability<TInput, TOutput> = {
      get id() {
        return `${surfaceId}:${alias}`
      },
      capabilityId: config.capabilityId,
      get state() {
        return state
      },
      config,
      execute,
      refresh,
      invalidate,
    }

    // Use Object.defineProperties for optional getters to satisfy exactOptionalPropertyTypes
    Object.defineProperties(boundCapability, {
      lastExecuted: {
        get() {
          return lastExecuted
        },
        enumerable: true,
      },
      lastResult: {
        get() {
          return lastResult
        },
        enumerable: true,
      },
      error: {
        get() {
          return error
        },
        enumerable: true,
      },
    })

    return boundCapability
  }
}

/**
 * Create a binding engine
 */
export function createBindingEngine(fabric: FabricKernel, cache?: CacheProvider): BindingEngine {
  return new RuntimeBindingEngine(fabric, cache)
}
