/**
 * Result Types for Operations
 *
 * PHASE0-WS1: Typed result handling without exceptions
 *
 * @module @pwfabric/contracts/core/result
 */

// ============================================================
// RESULT TYPE
// ============================================================

/**
 * Success result
 */
export interface Success<T> {
  readonly success: true
  readonly data: T
}

/**
 * Failure result
 */
export interface Failure<E> {
  readonly success: false
  readonly error: E
}

/**
 * Result type for operations that can fail
 * Encodes success/failure in the type system
 */
export type Result<T, E = Error> = Success<T> | Failure<E>

/**
 * Async result type
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>

// ============================================================
// RESULT CONSTRUCTORS
// ============================================================

/**
 * Create a success result
 */
export function ok<T>(data: T): Success<T> {
  return { success: true, data }
}

/**
 * Create a failure result
 */
export function err<E>(error: E): Failure<E> {
  return { success: false, error }
}

// ============================================================
// RESULT TYPE GUARDS
// ============================================================

/**
 * Check if result is successful
 */
export function isOk<T, E>(result: Result<T, E>): result is Success<T> {
  return result.success === true
}

/**
 * Check if result is a failure
 */
export function isErr<T, E>(result: Result<T, E>): result is Failure<E> {
  return result.success === false
}

// ============================================================
// RESULT UTILITIES
// ============================================================

/**
 * Unwrap a result, throwing if it's a failure
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.success) {
    return result.data
  }
  throw result.error
}

/**
 * Unwrap a result with a default value
 */
export function unwrapOr<T, E>(result: Result<T, E>, defaultValue: T): T {
  if (result.success) {
    return result.data
  }
  return defaultValue
}

/**
 * Map over a successful result
 */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (data: T) => U): Result<U, E> {
  if (result.success) {
    return ok(fn(result.data))
  }
  return result
}

/**
 * Map over a failure result
 */
export function mapError<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  if (!result.success) {
    return err(fn(result.error))
  }
  return result
}

/**
 * FlatMap (bind) over a result
 */
export function flatMap<T, U, E>(
  result: Result<T, E>,
  fn: (data: T) => Result<U, E>
): Result<U, E> {
  if (result.success) {
    return fn(result.data)
  }
  return result
}

// ============================================================
// VALIDATION RESULT
// ============================================================

/**
 * Validation error details
 */
export interface ValidationError {
  readonly path: string[]
  readonly message: string
  readonly code: string
}

/**
 * Validation result type
 */
export type ValidationResult<T = unknown> = Result<T, ValidationError[]>

/**
 * Create a validation success
 */
export function validationOk<T>(data: T): ValidationResult<T> {
  return ok(data)
}

/**
 * Create a validation failure
 */
export function validationErr(errors: ValidationError[]): ValidationResult<never> {
  return err(errors)
}

/**
 * Create a single validation error
 */
export function validationError(path: string[], message: string, code: string): ValidationError {
  return { path, message, code }
}
