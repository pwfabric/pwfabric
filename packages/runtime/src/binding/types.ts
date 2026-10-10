/**
 * Binding System Types
 *
 * Types for capability-to-surface binding
 *
 * @module @pwfabric/runtime/binding/types
 */

import type { CapabilityId, SurfaceId, ExecutionResult } from '@pwfabric/contracts'

// ============================================================
// BINDING TYPES
// ============================================================

/**
 * Binding state
 */
export type BindingState = 'unbound' | 'binding' | 'bound' | 'error' | 'stale'

/**
 * Binding configuration
 */
export interface BindingConfig {
  readonly capabilityId: CapabilityId
  readonly alias?: string
  readonly transform?: RuntimeBindingTransform
  readonly cache?: BindingCacheConfig
  readonly retry?: RetryConfig
}

/**
 * Transform configuration for binding input/output (runtime version)
 * Named differently from contracts BindingTransform to avoid export collision
 */
export interface RuntimeBindingTransform {
  readonly input?: (data: unknown) => unknown
  readonly output?: (data: unknown) => unknown
}

/**
 * Cache configuration for binding (runtime version)
 * Named differently from contracts CacheConfig to avoid export collision
 */
export interface BindingCacheConfig {
  readonly enabled: boolean
  readonly ttl?: number
  readonly key?: string
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  readonly maxAttempts: number
  readonly backoff: 'fixed' | 'exponential'
  readonly delayMs: number
}

// ============================================================
// BINDING INSTANCE
// ============================================================

/**
 * A bound capability instance
 */
export interface BoundCapability<TInput = unknown, TOutput = unknown> {
  readonly id: string
  readonly capabilityId: CapabilityId
  readonly state: BindingState
  readonly config: BindingConfig
  readonly lastExecuted?: number
  readonly lastResult?: ExecutionResult<TOutput>
  readonly error?: BindingError

  /**
   * Execute the bound capability
   */
  execute(input: TInput): Promise<ExecutionResult<TOutput>>

  /**
   * Refresh the binding (re-execute with last input)
   */
  refresh(): Promise<ExecutionResult<TOutput>>

  /**
   * Invalidate cached data
   */
  invalidate(): void
}

/**
 * Binding error
 */
export interface BindingError {
  readonly type: 'resolution_failed' | 'execution_failed' | 'transform_failed' | 'cache_failed'
  readonly message: string
  readonly cause?: unknown
}

// ============================================================
// BINDING CONTEXT
// ============================================================

/**
 * Context for binding resolution
 */
export interface BindingContext {
  readonly surfaceId: SurfaceId
  readonly auth?: AuthContext
  readonly data: Record<string, unknown>
  readonly bindings: Map<string, BoundCapability>
}

/**
 * Authentication context
 */
export interface AuthContext {
  readonly isAuthenticated: boolean
  readonly userId?: string
  readonly worldId?: string
  readonly scopes?: readonly string[]
  readonly token?: string
  readonly expiresAt?: number
}

// ============================================================
// BINDING RESULT
// ============================================================

/**
 * Result of binding resolution
 */
export type BindingResult<T = unknown> =
  | { readonly success: true; readonly binding: BoundCapability<unknown, T> }
  | { readonly success: false; readonly error: BindingError }

/**
 * Result of binding all capabilities for a surface
 */
export type SurfaceBindingResult =
  | { readonly success: true; readonly context: BindingContext }
  | { readonly success: false; readonly errors: readonly BindingError[] }
