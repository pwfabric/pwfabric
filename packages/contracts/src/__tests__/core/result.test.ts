/**
 * Result Types Tests
 *
 * Tests for Result type operations, type guards, and utilities
 *
 * @module @pwfabric/contracts/core/__tests__/result
 */

import { describe, it, expect } from 'vitest'
import {
  ok,
  err,
  isOk,
  isErr,
  unwrap,
  unwrapOr,
  mapResult,
  mapError,
  flatMap,
  validationOk,
  validationErr,
  validationError,
  type Result,
  type Success,
  type Failure,
  type ValidationResult,
} from '../../core/result.js'

describe('Result Constructors', () => {
  describe('ok', () => {
    it('should create a success result', () => {
      const result = ok('value')

      expect(result).toEqual({ success: true, data: 'value' })
    })

    it('should handle complex data types', () => {
      const data = { id: 1, items: [1, 2, 3] }
      const result = ok(data)

      expect(result.success).toBe(true)
      expect((result as Success<typeof data>).data).toEqual(data)
    })

    it('should handle null and undefined', () => {
      expect(ok(null)).toEqual({ success: true, data: null })
      expect(ok(undefined)).toEqual({ success: true, data: undefined })
    })
  })

  describe('err', () => {
    it('should create a failure result', () => {
      const error = new Error('Something went wrong')
      const result = err(error)

      expect(result).toEqual({ success: false, error })
    })

    it('should handle string errors', () => {
      const result = err('error message')

      expect(result.success).toBe(false)
      expect((result as Failure<string>).error).toBe('error message')
    })

    it('should handle complex error objects', () => {
      const errorObj = { code: 'E001', message: 'Failed', details: { field: 'name' } }
      const result = err(errorObj)

      expect(result.success).toBe(false)
      expect((result as Failure<typeof errorObj>).error).toEqual(errorObj)
    })
  })
})

describe('Type Guards', () => {
  describe('isOk', () => {
    it('should return true for success results', () => {
      const result = ok('value')

      expect(isOk(result)).toBe(true)
    })

    it('should return false for failure results', () => {
      const result = err(new Error('error'))

      expect(isOk(result)).toBe(false)
    })

    it('should narrow type correctly', () => {
      const result: Result<string, Error> = ok('value')

      if (isOk(result)) {
        expect(result.data).toBe('value')
      }
    })
  })

  describe('isErr', () => {
    it('should return true for failure results', () => {
      const result = err(new Error('error'))

      expect(isErr(result)).toBe(true)
    })

    it('should return false for success results', () => {
      const result = ok('value')

      expect(isErr(result)).toBe(false)
    })

    it('should narrow type correctly', () => {
      const result: Result<string, Error> = err(new Error('test error'))

      if (isErr(result)) {
        expect(result.error.message).toBe('test error')
      }
    })
  })
})

describe('Result Utilities', () => {
  describe('unwrap', () => {
    it('should return data for success results', () => {
      const result = ok('value')

      expect(unwrap(result)).toBe('value')
    })

    it('should throw error for failure results', () => {
      const error = new Error('Something went wrong')
      const result = err(error)

      expect(() => unwrap(result)).toThrow(error)
    })

    it('should handle complex data types', () => {
      const data = { id: 1, name: 'test' }
      const result = ok(data)

      expect(unwrap(result)).toEqual(data)
    })
  })

  describe('unwrapOr', () => {
    it('should return data for success results', () => {
      const result = ok('value')

      expect(unwrapOr(result, 'default')).toBe('value')
    })

    it('should return default for failure results', () => {
      const result: Result<string, Error> = err(new Error('error'))

      expect(unwrapOr(result, 'default')).toBe('default')
    })

    it('should handle null default', () => {
      const result: Result<string | null, Error> = err(new Error('error'))

      expect(unwrapOr(result, null)).toBeNull()
    })
  })

  describe('mapResult', () => {
    it('should transform success data', () => {
      const result = ok(5)
      const mapped = mapResult(result, (x) => x * 2)

      expect(mapped).toEqual({ success: true, data: 10 })
    })

    it('should pass through failure', () => {
      const error = new Error('error')
      const result: Result<number, Error> = err(error)
      const mapped = mapResult(result, (x) => x * 2)

      expect(mapped).toEqual({ success: false, error })
    })

    it('should allow type transformation', () => {
      const result = ok(42)
      const mapped = mapResult(result, (x) => x.toString())

      expect(mapped).toEqual({ success: true, data: '42' })
    })
  })

  describe('mapError', () => {
    it('should transform error', () => {
      const result: Result<number, string> = err('original error')
      const mapped = mapError(result, (e) => new Error(e))

      expect(mapped.success).toBe(false)
      expect((mapped as Failure<Error>).error.message).toBe('original error')
    })

    it('should pass through success', () => {
      const result: Result<number, string> = ok(42)
      const mapped = mapError(result, (e) => new Error(e))

      expect(mapped).toEqual({ success: true, data: 42 })
    })
  })

  describe('flatMap', () => {
    it('should chain success results', () => {
      const result = ok(5)
      const chained = flatMap(result, (x) => ok(x * 2))

      expect(chained).toEqual({ success: true, data: 10 })
    })

    it('should short-circuit on failure', () => {
      const error = new Error('initial error')
      const result: Result<number, Error> = err(error)
      const chained = flatMap(result, (x) => ok(x * 2))

      expect(chained).toEqual({ success: false, error })
    })

    it('should propagate failure from mapping function', () => {
      const result = ok(5)
      const newError = new Error('new error')
      const chained = flatMap(result, () => err(newError))

      expect(chained).toEqual({ success: false, error: newError })
    })

    it('should allow chaining multiple operations', () => {
      const result = ok(10)
      const chained = flatMap(
        flatMap(result, (x) => ok(x / 2)),
        (x) => ok(x.toString())
      )

      expect(chained).toEqual({ success: true, data: '5' })
    })
  })
})

describe('Validation Result', () => {
  describe('validationOk', () => {
    it('should create a validation success', () => {
      const result = validationOk({ name: 'test' })

      expect(result.success).toBe(true)
      expect((result as Success<{ name: string }>).data).toEqual({ name: 'test' })
    })
  })

  describe('validationErr', () => {
    it('should create a validation failure', () => {
      const errors = [{ path: ['name'], message: 'Required', code: 'REQUIRED' }]
      const result = validationErr(errors)

      expect(result.success).toBe(false)
      expect((result as Failure<typeof errors>).error).toEqual(errors)
    })

    it('should handle multiple errors', () => {
      const errors = [
        { path: ['name'], message: 'Required', code: 'REQUIRED' },
        { path: ['email'], message: 'Invalid format', code: 'INVALID_FORMAT' },
      ]
      const result = validationErr(errors)

      expect((result as Failure<typeof errors>).error).toHaveLength(2)
    })
  })

  describe('validationError', () => {
    it('should create a validation error object', () => {
      const error = validationError(['user', 'name'], 'Name is required', 'REQUIRED')

      expect(error).toEqual({
        path: ['user', 'name'],
        message: 'Name is required',
        code: 'REQUIRED',
      })
    })

    it('should handle empty path', () => {
      const error = validationError([], 'Global error', 'GLOBAL')

      expect(error.path).toEqual([])
    })

    it('should handle deep paths', () => {
      const error = validationError(
        ['data', 'users', '0', 'address', 'city'],
        'City is required',
        'REQUIRED'
      )

      expect(error.path).toHaveLength(5)
    })
  })
})

describe('Type inference', () => {
  it('should infer correct types for Result', () => {
    const successResult: Result<number, string> = ok(42)
    const failureResult: Result<number, string> = err('error')

    expect(successResult.success).toBe(true)
    expect(failureResult.success).toBe(false)
  })

  it('should infer correct types for ValidationResult', () => {
    const valid: ValidationResult<{ name: string }> = validationOk({ name: 'test' })
    const invalid: ValidationResult<{ name: string }> = validationErr([
      validationError(['name'], 'Required', 'REQUIRED'),
    ])

    expect(valid.success).toBe(true)
    expect(invalid.success).toBe(false)
  })
})
