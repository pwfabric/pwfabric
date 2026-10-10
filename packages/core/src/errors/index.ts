/**
 * Error Module
 *
 * Exports for error infrastructure
 *
 * @module @pwfabric/core/errors
 */

export {
  ErrorCode,
  getHttpStatus,
  isRetryable,
  type ErrorCode as ErrorCodeType,
} from './ErrorCode.js'
export {
  AppError,
  ValidationAppError,
  NetworkAppError,
  EditorAppError,
  type ErrorContext,
  type SerializedError,
} from './AppError.js'
