/**
 * Custom error classes for PWFabric
 */

/**
 * Base error class for all PWFabric errors
 */
export class PWFabricError extends Error {
  public readonly code: string
  public readonly timestamp: Date

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PWFabricError'
    this.code = code
    this.timestamp = new Date()
  }
}

/**
 * Validation error
 */
export class ValidationError extends PWFabricError {
  public readonly field: string | undefined

  constructor(message: string, field?: string, options?: ErrorOptions) {
    super(message, 'VALIDATION_ERROR', options)
    this.name = 'ValidationError'
    this.field = field
  }
}

/**
 * Not found error
 */
export class NotFoundError extends PWFabricError {
  public readonly resource: string

  constructor(resource: string, options?: ErrorOptions) {
    super(`${resource} not found`, 'NOT_FOUND', options)
    this.name = 'NotFoundError'
    this.resource = resource
  }
}

/**
 * Unauthorized error
 */
export class UnauthorizedError extends PWFabricError {
  constructor(message = 'Unauthorized', options?: ErrorOptions) {
    super(message, 'UNAUTHORIZED', options)
    this.name = 'UnauthorizedError'
  }
}

/**
 * Forbidden error
 */
export class ForbiddenError extends PWFabricError {
  constructor(message = 'Forbidden', options?: ErrorOptions) {
    super(message, 'FORBIDDEN', options)
    this.name = 'ForbiddenError'
  }
}
