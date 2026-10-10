/**
 * Form Processor Tests
 *
 * Tests for form processing implementation
 *
 * @module @pwfabric/runtime/forms/__tests__/processor
 */

import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import {
  DefaultFormProcessor,
  createFormProcessor,
  isFormSuccess,
  isFormFailure,
  formatFormErrors,
  getErrorMessages,
} from '../processor.js'
import type { FormField, FormResult } from '../types.js'

describe('DefaultFormProcessor', () => {
  const processor = new DefaultFormProcessor()

  describe('validate', () => {
    const fields: FormField[] = [
      { name: 'name', type: 'text', required: true },
      {
        name: 'email',
        type: 'email',
        required: true,
        validation: [{ type: 'email', message: 'Invalid email' }],
      },
    ]

    it('should return valid for correct values', () => {
      const result = processor.validate({ name: 'John', email: 'john@example.com' }, fields)

      expect(result.valid).toBe(true)
    })

    it('should return errors for invalid values', () => {
      const result = processor.validate({ name: '', email: 'invalid' }, fields)

      expect(result.valid).toBe(false)
      expect(result.errors.name).toBeDefined()
      expect(result.errors.email).toBeDefined()
    })
  })

  describe('validateWithSchema', () => {
    const schema = z.object({
      name: z.string().min(1),
      email: z.string().email(),
    })

    it('should validate using Zod schema', () => {
      const result = processor.validateWithSchema(
        { name: 'John', email: 'john@example.com' },
        schema
      )

      expect(result.valid).toBe(true)
    })

    it('should return Zod errors', () => {
      const result = processor.validateWithSchema({ name: '', email: 'invalid' }, schema)

      expect(result.valid).toBe(false)
    })
  })

  describe('process', () => {
    it('should call handler and return success', async () => {
      const handler = vi.fn().mockResolvedValue({ id: 1, success: true })

      const result = await processor.process('form-1', { name: 'John' }, handler)

      expect(handler).toHaveBeenCalledWith({ name: 'John' })
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data).toEqual({ id: 1, success: true })
      }
    })

    it('should handle sync handlers', async () => {
      const handler = vi.fn().mockReturnValue({ id: 1 })

      const result = await processor.process('form-1', { name: 'John' }, handler)

      expect(result.success).toBe(true)
    })

    it('should handle handler errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Processing failed'))

      const result = await processor.process('form-1', { name: 'John' }, handler)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('processing_failed')
        expect(result.error.message).toBe('Processing failed')
      }
    })

    it('should detect network errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('network connection failed'))

      const result = await processor.process('form-1', { name: 'John' }, handler)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('network_error')
      }
    })

    it('should handle non-Error rejections', async () => {
      const handler = vi.fn().mockRejectedValue('String error')

      const result = await processor.process('form-1', { name: 'John' }, handler)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('unknown')
      }
    })
  })

  describe('processWithValidation', () => {
    const fields: FormField[] = [{ name: 'name', type: 'text', required: true }]

    it('should validate before processing', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const result = await (processor as DefaultFormProcessor).processWithValidation(
        'form-1',
        { name: '' },
        fields,
        handler
      )

      expect(handler).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.type).toBe('validation_failed')
        expect(result.error.validationErrors).toBeDefined()
      }
    })

    it('should process after successful validation', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const result = await (processor as DefaultFormProcessor).processWithValidation(
        'form-1',
        { name: 'John' },
        fields,
        handler
      )

      expect(handler).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })

  describe('processWithSchema', () => {
    const schema = z.object({
      name: z.string().min(1),
    })

    it('should validate with schema before processing', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const result = await (processor as DefaultFormProcessor).processWithSchema(
        'form-1',
        { name: '' },
        schema,
        handler
      )

      expect(handler).not.toHaveBeenCalled()
      expect(result.success).toBe(false)
    })

    it('should process after successful schema validation', async () => {
      const handler = vi.fn().mockResolvedValue({ success: true })

      const result = await (processor as DefaultFormProcessor).processWithSchema(
        'form-1',
        { name: 'John' },
        schema,
        handler
      )

      expect(handler).toHaveBeenCalled()
      expect(result.success).toBe(true)
    })
  })
})

describe('createFormProcessor', () => {
  it('should create processor with default config', () => {
    const processor = createFormProcessor()

    expect(processor).toBeInstanceOf(DefaultFormProcessor)
  })

  it('should create processor with custom config', () => {
    const processor = createFormProcessor({
      validateOnSubmit: false,
      validateOnBlur: false,
    })

    expect(processor).toBeInstanceOf(DefaultFormProcessor)
  })
})

describe('isFormSuccess', () => {
  it('should return true for success result', () => {
    const result: FormResult<string> = { success: true, data: 'test' }

    expect(isFormSuccess(result)).toBe(true)
  })

  it('should return false for failure result', () => {
    const result: FormResult<string> = {
      success: false,
      error: { type: 'unknown', message: 'Error' },
    }

    expect(isFormSuccess(result)).toBe(false)
  })
})

describe('isFormFailure', () => {
  it('should return true for failure result', () => {
    const result: FormResult<string> = {
      success: false,
      error: { type: 'unknown', message: 'Error' },
    }

    expect(isFormFailure(result)).toBe(true)
  })

  it('should return false for success result', () => {
    const result: FormResult<string> = { success: true, data: 'test' }

    expect(isFormFailure(result)).toBe(false)
  })
})

describe('formatFormErrors', () => {
  it('should format errors into a single string', () => {
    const errors = {
      name: ['Name is required'],
      email: ['Invalid email', 'Email is too short'],
    }

    const formatted = formatFormErrors(errors)

    expect(formatted).toContain('name: Name is required')
    expect(formatted).toContain('email: Invalid email')
    expect(formatted).toContain('email: Email is too short')
  })

  it('should return empty string for no errors', () => {
    const formatted = formatFormErrors({})

    expect(formatted).toBe('')
  })
})

describe('getErrorMessages', () => {
  it('should return all error messages as array', () => {
    const errors = {
      name: ['Name is required'],
      email: ['Invalid email', 'Email is too short'],
    }

    const messages = getErrorMessages(errors)

    expect(messages).toHaveLength(3)
    expect(messages).toContain('Name is required')
    expect(messages).toContain('Invalid email')
    expect(messages).toContain('Email is too short')
  })

  it('should return empty array for no errors', () => {
    const messages = getErrorMessages({})

    expect(messages).toEqual([])
  })
})
