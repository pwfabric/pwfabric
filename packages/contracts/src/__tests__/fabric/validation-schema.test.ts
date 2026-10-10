/**
 * Validation Schema Tests
 *
 * Covers validationIssueSchema, validationIssueSeverity, and fabricValidationResultSchema.
 *
 * @module @pwfabric/contracts/fabric/__tests__/validation-schema
 */

import { describe, it, expect } from 'vitest'
import {
  validationIssueSeverity,
  validationIssueSchema,
  fabricValidationResultSchema,
  type ValidationIssue,
  type FabricValidationResult,
} from '../../fabric/validation.js'

describe('validationIssueSeverity', () => {
  it('should accept error severity', () => {
    const result = validationIssueSeverity.safeParse('error')
    expect(result.success).toBe(true)
  })

  it('should accept warning severity', () => {
    const result = validationIssueSeverity.safeParse('warning')
    expect(result.success).toBe(true)
  })

  it('should reject unknown severity', () => {
    const result = validationIssueSeverity.safeParse('info')
    expect(result.success).toBe(false)
  })

  it('should reject empty string', () => {
    const result = validationIssueSeverity.safeParse('')
    expect(result.success).toBe(false)
  })
})

describe('validationIssueSchema', () => {
  describe('valid issues', () => {
    it('should accept a minimal validation issue', () => {
      const result = validationIssueSchema.safeParse({
        severity: 'error',
        code: 'MISSING_FIELD',
        message: 'Required field is missing',
      })
      expect(result.success).toBe(true)
    })

    it('should accept an issue with all optional fields', () => {
      const result = validationIssueSchema.safeParse({
        severity: 'warning',
        code: 'DEPRECATED_FIELD',
        message: 'This field is deprecated',
        path: 'props.size',
        suggestion: 'Use props.scale instead',
      })
      expect(result.success).toBe(true)
    })

    it('should accept an error-severity issue', () => {
      const issue: ValidationIssue = {
        severity: 'error',
        code: 'INVALID_TYPE',
        message: 'Expected string, received number',
        path: 'entryPoints.main',
      }
      const result = validationIssueSchema.safeParse(issue)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid issues', () => {
    it('should reject missing severity', () => {
      const result = validationIssueSchema.safeParse({
        code: 'MISSING_FIELD',
        message: 'Required field is missing',
      })
      expect(result.success).toBe(false)
    })

    it('should reject missing code', () => {
      const result = validationIssueSchema.safeParse({
        severity: 'error',
        message: 'Something went wrong',
      })
      expect(result.success).toBe(false)
    })

    it('should reject missing message', () => {
      const result = validationIssueSchema.safeParse({
        severity: 'error',
        code: 'SOME_CODE',
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid severity', () => {
      const result = validationIssueSchema.safeParse({
        severity: 'critical',
        code: 'SOME_CODE',
        message: 'Some message',
      })
      expect(result.success).toBe(false)
    })
  })
})

describe('fabricValidationResultSchema', () => {
  describe('valid results', () => {
    it('should accept a passing validation result with no issues', () => {
      const result = fabricValidationResultSchema.safeParse({
        valid: true,
        errors: [],
        warnings: [],
      })
      expect(result.success).toBe(true)
    })

    it('should accept a failing result with errors', () => {
      const result = fabricValidationResultSchema.safeParse({
        valid: false,
        errors: [{ severity: 'error', code: 'MISSING_FIELD', message: 'name is required' }],
        warnings: [],
      })
      expect(result.success).toBe(true)
    })

    it('should accept a result with warnings only', () => {
      const result = fabricValidationResultSchema.safeParse({
        valid: true,
        errors: [],
        warnings: [
          {
            severity: 'warning',
            code: 'DEPRECATED',
            message: 'Use newer API',
            path: 'props.size',
          },
        ],
      })
      expect(result.success).toBe(true)
    })

    it('should accept a result with both errors and warnings', () => {
      const validationResult: FabricValidationResult = {
        valid: false,
        errors: [{ severity: 'error', code: 'BAD_TYPE', message: 'wrong type' }],
        warnings: [{ severity: 'warning', code: 'DEPRECATED', message: 'old field' }],
      }
      const result = fabricValidationResultSchema.safeParse(validationResult)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid results', () => {
    it('should reject missing valid field', () => {
      const result = fabricValidationResultSchema.safeParse({
        errors: [],
        warnings: [],
      })
      expect(result.success).toBe(false)
    })

    it('should reject missing errors array', () => {
      const result = fabricValidationResultSchema.safeParse({
        valid: true,
        warnings: [],
      })
      expect(result.success).toBe(false)
    })

    it('should reject invalid issue within errors', () => {
      const result = fabricValidationResultSchema.safeParse({
        valid: false,
        errors: [{ severity: 'critical', code: 'X', message: 'bad' }],
        warnings: [],
      })
      expect(result.success).toBe(false)
    })
  })
})
