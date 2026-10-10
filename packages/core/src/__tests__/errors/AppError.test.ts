/**
 * AppError Tests
 *
 * Tests for application error classes
 *
 * @module @pwfabric/core/errors/__tests__/AppError
 */

import { describe, it, expect } from 'vitest'
import {
  AppError,
  ValidationAppError,
  NetworkAppError,
  EditorAppError,
} from '../../errors/AppError.js'
import { ErrorCode, getHttpStatus, isRetryable } from '../../errors/ErrorCode.js'

describe('ErrorCode', () => {
  describe('constants', () => {
    it('should have validation error codes', () => {
      expect(ErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED')
      expect(ErrorCode.INVALID_INPUT).toBe('INVALID_INPUT')
      expect(ErrorCode.MISSING_REQUIRED).toBe('MISSING_REQUIRED')
      expect(ErrorCode.INVALID_FORMAT).toBe('INVALID_FORMAT')
    })

    it('should have network error codes', () => {
      expect(ErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR')
      expect(ErrorCode.TIMEOUT).toBe('TIMEOUT')
      expect(ErrorCode.CONNECTION_FAILED).toBe('CONNECTION_FAILED')
      expect(ErrorCode.REQUEST_FAILED).toBe('REQUEST_FAILED')
    })

    it('should have authentication error codes', () => {
      expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED')
      expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN')
      expect(ErrorCode.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED')
      expect(ErrorCode.INVALID_CREDENTIALS).toBe('INVALID_CREDENTIALS')
    })

    it('should have resource error codes', () => {
      expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND')
      expect(ErrorCode.ALREADY_EXISTS).toBe('ALREADY_EXISTS')
      expect(ErrorCode.CONFLICT).toBe('CONFLICT')
      expect(ErrorCode.GONE).toBe('GONE')
    })

    it('should have runtime error codes', () => {
      expect(ErrorCode.RUNTIME_ERROR).toBe('RUNTIME_ERROR')
      expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
      expect(ErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE')
      expect(ErrorCode.NOT_IMPLEMENTED).toBe('NOT_IMPLEMENTED')
    })

    it('should have editor error codes', () => {
      expect(ErrorCode.EDITOR_ERROR).toBe('EDITOR_ERROR')
      expect(ErrorCode.BLOCK_NOT_FOUND).toBe('BLOCK_NOT_FOUND')
      expect(ErrorCode.INVALID_OPERATION).toBe('INVALID_OPERATION')
      expect(ErrorCode.RENDER_ERROR).toBe('RENDER_ERROR')
    })
  })

  describe('getHttpStatus', () => {
    it('should return 400 for validation errors', () => {
      expect(getHttpStatus(ErrorCode.VALIDATION_FAILED)).toBe(400)
      expect(getHttpStatus(ErrorCode.INVALID_INPUT)).toBe(400)
      expect(getHttpStatus(ErrorCode.MISSING_REQUIRED)).toBe(400)
      expect(getHttpStatus(ErrorCode.INVALID_FORMAT)).toBe(400)
    })

    it('should return 401 for auth errors', () => {
      expect(getHttpStatus(ErrorCode.UNAUTHORIZED)).toBe(401)
      expect(getHttpStatus(ErrorCode.TOKEN_EXPIRED)).toBe(401)
      expect(getHttpStatus(ErrorCode.INVALID_CREDENTIALS)).toBe(401)
    })

    it('should return 403 for forbidden', () => {
      expect(getHttpStatus(ErrorCode.FORBIDDEN)).toBe(403)
    })

    it('should return 404 for not found', () => {
      expect(getHttpStatus(ErrorCode.NOT_FOUND)).toBe(404)
      expect(getHttpStatus(ErrorCode.BLOCK_NOT_FOUND)).toBe(404)
      expect(getHttpStatus(ErrorCode.GONE)).toBe(404)
    })

    it('should return 409 for conflict', () => {
      expect(getHttpStatus(ErrorCode.CONFLICT)).toBe(409)
      expect(getHttpStatus(ErrorCode.ALREADY_EXISTS)).toBe(409)
    })

    it('should return 408 for timeout', () => {
      expect(getHttpStatus(ErrorCode.TIMEOUT)).toBe(408)
    })

    it('should return 503 for service unavailable', () => {
      expect(getHttpStatus(ErrorCode.SERVICE_UNAVAILABLE)).toBe(503)
    })

    it('should return 501 for not implemented', () => {
      expect(getHttpStatus(ErrorCode.NOT_IMPLEMENTED)).toBe(501)
    })

    it('should return 500 for other errors', () => {
      expect(getHttpStatus(ErrorCode.RUNTIME_ERROR)).toBe(500)
      expect(getHttpStatus(ErrorCode.INTERNAL_ERROR)).toBe(500)
      expect(getHttpStatus(ErrorCode.EDITOR_ERROR)).toBe(500)
    })
  })

  describe('isRetryable', () => {
    it('should return true for retryable errors', () => {
      expect(isRetryable(ErrorCode.NETWORK_ERROR)).toBe(true)
      expect(isRetryable(ErrorCode.TIMEOUT)).toBe(true)
      expect(isRetryable(ErrorCode.CONNECTION_FAILED)).toBe(true)
      expect(isRetryable(ErrorCode.SERVICE_UNAVAILABLE)).toBe(true)
    })

    it('should return false for non-retryable errors', () => {
      expect(isRetryable(ErrorCode.VALIDATION_FAILED)).toBe(false)
      expect(isRetryable(ErrorCode.UNAUTHORIZED)).toBe(false)
      expect(isRetryable(ErrorCode.NOT_FOUND)).toBe(false)
      expect(isRetryable(ErrorCode.RUNTIME_ERROR)).toBe(false)
    })
  })
})

describe('AppError', () => {
  describe('constructor', () => {
    it('should create error with code and message', () => {
      const error = new AppError('VALIDATION_FAILED', 'Invalid input')

      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.message).toBe('Invalid input')
      expect(error.name).toBe('AppError')
    })

    it('should set timestamp', () => {
      const before = new Date()
      const error = new AppError('RUNTIME_ERROR', 'Error')
      const after = new Date()

      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should set httpStatus based on code', () => {
      const validationError = new AppError('VALIDATION_FAILED', 'Invalid')
      const authError = new AppError('UNAUTHORIZED', 'Not authorized')
      const notFoundError = new AppError('NOT_FOUND', 'Resource not found')

      expect(validationError.httpStatus).toBe(400)
      expect(authError.httpStatus).toBe(401)
      expect(notFoundError.httpStatus).toBe(404)
    })

    it('should set isRetryable based on code', () => {
      const retryableError = new AppError('NETWORK_ERROR', 'Network failed')
      const nonRetryableError = new AppError('VALIDATION_FAILED', 'Invalid')

      expect(retryableError.isRetryable).toBe(true)
      expect(nonRetryableError.isRetryable).toBe(false)
    })

    it('should accept context', () => {
      const error = new AppError('VALIDATION_FAILED', 'Invalid', {
        context: { field: 'email', value: 'invalid' },
      })

      expect(error.context).toEqual({ field: 'email', value: 'invalid' })
    })

    it('should accept cause', () => {
      const cause = new Error('Original error')
      const error = new AppError('RUNTIME_ERROR', 'Wrapped error', { cause })

      expect(error.cause).toBe(cause)
    })
  })

  describe('toJSON', () => {
    it('should serialize to JSON', () => {
      const error = new AppError('NOT_FOUND', 'Resource not found')
      const json = error.toJSON()

      expect(json.code).toBe('NOT_FOUND')
      expect(json.message).toBe('Resource not found')
      expect(json.timestamp).toBeDefined()
    })

    it('should include traceId when provided', () => {
      const error = new AppError('RUNTIME_ERROR', 'Error')
      const json = error.toJSON('trace-123')

      expect(json.traceId).toBe('trace-123')
    })

    it('should include context when present', () => {
      const error = new AppError('VALIDATION_FAILED', 'Invalid', {
        context: { field: 'name' },
      })
      const json = error.toJSON()

      expect(json.context).toEqual({ field: 'name' })
    })

    it('should omit context when not present', () => {
      const error = new AppError('RUNTIME_ERROR', 'Error')
      const json = error.toJSON()

      expect(json.context).toBeUndefined()
    })
  })

  describe('from', () => {
    it('should return AppError unchanged', () => {
      const original = new AppError('NOT_FOUND', 'Not found')
      const result = AppError.from(original)

      expect(result).toBe(original)
    })

    it('should wrap Error with message', () => {
      const original = new Error('Original message')
      const result = AppError.from(original)

      expect(result.message).toBe('Original message')
      expect(result.cause).toBe(original)
      expect(result.code).toBe('RUNTIME_ERROR')
    })

    it('should wrap Error with custom code', () => {
      const original = new Error('Auth failed')
      const result = AppError.from(original, 'UNAUTHORIZED')

      expect(result.code).toBe('UNAUTHORIZED')
    })

    it('should convert non-Error values to string', () => {
      const result = AppError.from('string error')

      expect(result.message).toBe('string error')
    })

    it('should handle null/undefined', () => {
      expect(AppError.from(null).message).toBe('null')
      expect(AppError.from(undefined).message).toBe('undefined')
    })
  })
})

describe('ValidationAppError', () => {
  it('should create validation error', () => {
    const error = new ValidationAppError('Name is required')

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.message).toBe('Name is required')
    expect(error.name).toBe('ValidationAppError')
  })

  it('should include field', () => {
    const error = new ValidationAppError('Invalid email', { field: 'email' })

    expect(error.field).toBe('email')
    expect(error.context).toEqual({ field: 'email' })
  })

  it('should merge context with field', () => {
    const error = new ValidationAppError('Invalid', {
      field: 'name',
      context: { maxLength: 100 },
    })

    expect(error.context).toEqual({ field: 'name', maxLength: 100 })
  })
})

describe('NetworkAppError', () => {
  it('should create network error', () => {
    const error = new NetworkAppError('Connection refused')

    expect(error.code).toBe('NETWORK_ERROR')
    expect(error.message).toBe('Connection refused')
    expect(error.name).toBe('NetworkAppError')
  })

  it('should include url and statusCode', () => {
    const error = new NetworkAppError('Request failed', {
      url: 'https://api.example.com',
      statusCode: 500,
    })

    expect(error.url).toBe('https://api.example.com')
    expect(error.statusCode).toBe(500)
    expect(error.context).toEqual({
      url: 'https://api.example.com',
      statusCode: 500,
    })
  })

  it('should be retryable', () => {
    const error = new NetworkAppError('Network error')

    expect(error.isRetryable).toBe(true)
  })
})

describe('EditorAppError', () => {
  it('should create editor error', () => {
    const error = new EditorAppError('Block operation failed')

    expect(error.code).toBe('EDITOR_ERROR')
    expect(error.message).toBe('Block operation failed')
    expect(error.name).toBe('EditorAppError')
  })

  it('should include blockId and operation', () => {
    const error = new EditorAppError('Cannot delete block', {
      blockId: 'block-123',
      operation: 'delete',
    })

    expect(error.blockId).toBe('block-123')
    expect(error.operation).toBe('delete')
    expect(error.context).toEqual({
      blockId: 'block-123',
      operation: 'delete',
    })
  })

  it('should allow custom error code', () => {
    const error = new EditorAppError('Block not found', {
      code: 'BLOCK_NOT_FOUND',
      blockId: 'missing-block',
    })

    expect(error.code).toBe('BLOCK_NOT_FOUND')
    expect(error.httpStatus).toBe(404)
  })
})
