/**
 * Application Error Classes
 *
 * Custom error class hierarchy with code, message, context, and cause
 *
 * @module @pwfabric/core/errors/AppError
 */

import { type ErrorCode, getHttpStatus, isRetryable } from './ErrorCode.js'

/**
 * Error context for additional debugging information
 */
export type ErrorContext = Readonly<Record<string, unknown>>

/**
 * Serialized error format for API responses
 */
export interface SerializedError {
  readonly code: ErrorCode
  readonly message: string
  readonly timestamp: string
  readonly traceId?: string
  readonly context?: ErrorContext
}

/**
 * Base application error class
 *
 * All application errors should extend this class
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly timestamp: Date
  public readonly context: ErrorContext | undefined
  public readonly isRetryable: boolean
  public readonly httpStatus: number

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      cause?: Error
      context?: ErrorContext
    }
  ) {
    super(message, { cause: options?.cause })
    this.name = 'AppError'
    this.code = code
    this.timestamp = new Date()
    this.context = options?.context
    this.isRetryable = isRetryable(code)
    this.httpStatus = getHttpStatus(code)
  }

  /**
   * Serialize error for API response
   */
  toJSON(traceId?: string): SerializedError {
    return {
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      ...(traceId && { traceId }),
      ...(this.context && { context: this.context }),
    }
  }

  /**
   * Create error from unknown value
   */
  static from(error: unknown, code: ErrorCode = 'RUNTIME_ERROR'): AppError {
    if (error instanceof AppError) {
      return error
    }

    if (error instanceof Error) {
      return new AppError(code, error.message, { cause: error })
    }

    return new AppError(code, String(error))
  }
}

/**
 * Validation error for input validation failures
 */
export class ValidationAppError extends AppError {
  public readonly field: string | undefined

  constructor(
    message: string,
    options?: {
      field?: string
      cause?: Error
      context?: ErrorContext
    }
  ) {
    const baseOptions: { cause?: Error; context?: ErrorContext } = {}
    if (options?.cause) {
      baseOptions.cause = options.cause
    }
    if (options?.context || options?.field) {
      baseOptions.context = { ...options?.context, field: options?.field }
    }
    super('VALIDATION_FAILED', message, baseOptions)
    this.name = 'ValidationAppError'
    this.field = options?.field
  }
}

/**
 * Network error for connectivity issues
 */
export class NetworkAppError extends AppError {
  public readonly url: string | undefined
  public readonly statusCode: number | undefined

  constructor(
    message: string,
    options?: {
      url?: string
      statusCode?: number
      cause?: Error
      context?: ErrorContext
    }
  ) {
    const baseOptions: { cause?: Error; context?: ErrorContext } = {}
    if (options?.cause) {
      baseOptions.cause = options.cause
    }
    if (options?.context || options?.url || options?.statusCode) {
      baseOptions.context = {
        ...options?.context,
        url: options?.url,
        statusCode: options?.statusCode,
      }
    }
    super('NETWORK_ERROR', message, baseOptions)
    this.name = 'NetworkAppError'
    this.url = options?.url
    this.statusCode = options?.statusCode
  }
}

/**
 * Editor error for studio/editor operations
 */
export class EditorAppError extends AppError {
  public readonly blockId: string | undefined
  public readonly operation: string | undefined

  constructor(
    message: string,
    options?: {
      code?: ErrorCode
      blockId?: string
      operation?: string
      cause?: Error
      context?: ErrorContext
    }
  ) {
    const baseOptions: { cause?: Error; context?: ErrorContext } = {}
    if (options?.cause) {
      baseOptions.cause = options.cause
    }
    if (options?.context || options?.blockId || options?.operation) {
      baseOptions.context = {
        ...options?.context,
        blockId: options?.blockId,
        operation: options?.operation,
      }
    }
    super(options?.code ?? 'EDITOR_ERROR', message, baseOptions)
    this.name = 'EditorAppError'
    this.blockId = options?.blockId
    this.operation = options?.operation
  }
}
