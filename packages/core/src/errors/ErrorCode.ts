/**
 * Error Codes
 *
 * Standardized error codes for PWFabric platform
 *
 * @module @pwfabric/core/errors/ErrorCode
 */

/**
 * Error code categories
 */
export const ErrorCode = {
  // Validation errors (1xxx)
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED: 'MISSING_REQUIRED',
  INVALID_FORMAT: 'INVALID_FORMAT',

  // Network errors (2xxx)
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  CONNECTION_FAILED: 'CONNECTION_FAILED',
  REQUEST_FAILED: 'REQUEST_FAILED',

  // Authentication errors (3xxx)
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',

  // Resource errors (4xxx)
  NOT_FOUND: 'NOT_FOUND',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  CONFLICT: 'CONFLICT',
  GONE: 'GONE',

  // Runtime errors (5xxx)
  RUNTIME_ERROR: 'RUNTIME_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',

  // Editor errors (6xxx)
  EDITOR_ERROR: 'EDITOR_ERROR',
  BLOCK_NOT_FOUND: 'BLOCK_NOT_FOUND',
  INVALID_OPERATION: 'INVALID_OPERATION',
  RENDER_ERROR: 'RENDER_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

/**
 * Get HTTP status code for an error code
 */
export function getHttpStatus(code: ErrorCode): number {
  switch (code) {
    case ErrorCode.VALIDATION_FAILED:
    case ErrorCode.INVALID_INPUT:
    case ErrorCode.MISSING_REQUIRED:
    case ErrorCode.INVALID_FORMAT:
      return 400

    case ErrorCode.UNAUTHORIZED:
    case ErrorCode.TOKEN_EXPIRED:
    case ErrorCode.INVALID_CREDENTIALS:
      return 401

    case ErrorCode.FORBIDDEN:
      return 403

    case ErrorCode.NOT_FOUND:
    case ErrorCode.BLOCK_NOT_FOUND:
    case ErrorCode.GONE:
      return 404

    case ErrorCode.CONFLICT:
    case ErrorCode.ALREADY_EXISTS:
      return 409

    case ErrorCode.TIMEOUT:
      return 408

    case ErrorCode.SERVICE_UNAVAILABLE:
      return 503

    case ErrorCode.NOT_IMPLEMENTED:
      return 501

    default:
      return 500
  }
}

/**
 * Check if error code is retryable
 */
export function isRetryable(code: ErrorCode): boolean {
  const retryableCodes: ErrorCode[] = [
    ErrorCode.NETWORK_ERROR,
    ErrorCode.TIMEOUT,
    ErrorCode.CONNECTION_FAILED,
    ErrorCode.SERVICE_UNAVAILABLE,
  ]
  return retryableCodes.includes(code)
}
