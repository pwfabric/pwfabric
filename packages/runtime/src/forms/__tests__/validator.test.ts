/**
 * Form Validator Tests
 *
 * Tests for form validation implementation
 *
 * @module @pwfabric/runtime/forms/__tests__/validator
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  DefaultFormValidator,
  createFormValidator,
  validateWithZod,
  FormSchemas,
} from '../validator.js'
import type { FormField } from '../types.js'

describe('DefaultFormValidator', () => {
  const validator = new DefaultFormValidator()

  describe('required validation', () => {
    const requiredField: FormField = {
      name: 'name',
      type: 'text',
      required: true,
    }

    it('should fail for undefined value', () => {
      const errors = validator.validateField(undefined, requiredField)

      expect(errors).toContain('This field is required')
    })

    it('should fail for null value', () => {
      const errors = validator.validateField(null, requiredField)

      expect(errors).toContain('This field is required')
    })

    it('should fail for empty string', () => {
      const errors = validator.validateField('', requiredField)

      expect(errors).toContain('This field is required')
    })

    it('should fail for whitespace-only string', () => {
      const errors = validator.validateField('   ', requiredField)

      expect(errors).toContain('This field is required')
    })

    it('should pass for non-empty value', () => {
      const errors = validator.validateField('John', requiredField)

      expect(errors).toHaveLength(0)
    })
  })

  describe('email validation', () => {
    const emailField: FormField = {
      name: 'email',
      type: 'email',
      validation: [{ type: 'email', message: 'Invalid email' }],
    }

    it('should pass for valid email', () => {
      const errors = validator.validateField('test@example.com', emailField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for invalid email', () => {
      const errors = validator.validateField('not-an-email', emailField)

      expect(errors).toContain('Invalid email')
    })

    it('should fail for email without domain', () => {
      const errors = validator.validateField('test@', emailField)

      expect(errors).toContain('Invalid email')
    })

    it('should fail for email without @', () => {
      const errors = validator.validateField('test.example.com', emailField)

      expect(errors).toContain('Invalid email')
    })
  })

  describe('url validation', () => {
    const urlField: FormField = {
      name: 'website',
      type: 'url',
      validation: [{ type: 'url', message: 'Invalid URL' }],
    }

    it('should pass for valid URL', () => {
      const errors = validator.validateField('https://example.com', urlField)

      expect(errors).toHaveLength(0)
    })

    it('should pass for URL with path', () => {
      const errors = validator.validateField('https://example.com/path/to/page', urlField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for invalid URL', () => {
      const errors = validator.validateField('not-a-url', urlField)

      expect(errors).toContain('Invalid URL')
    })
  })

  describe('minLength validation', () => {
    const minLengthField: FormField = {
      name: 'password',
      type: 'password',
      validation: [{ type: 'minLength', value: 8, message: 'Must be at least {value} characters' }],
    }

    it('should pass for string meeting minimum', () => {
      const errors = validator.validateField('password123', minLengthField)

      expect(errors).toHaveLength(0)
    })

    it('should pass for string exactly at minimum', () => {
      const errors = validator.validateField('12345678', minLengthField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for string below minimum', () => {
      const errors = validator.validateField('short', minLengthField)

      expect(errors).toContain('Must be at least 8 characters')
    })
  })

  describe('maxLength validation', () => {
    const maxLengthField: FormField = {
      name: 'username',
      type: 'text',
      validation: [
        { type: 'maxLength', value: 20, message: 'Must be no more than {value} characters' },
      ],
    }

    it('should pass for string under maximum', () => {
      const errors = validator.validateField('john', maxLengthField)

      expect(errors).toHaveLength(0)
    })

    it('should pass for string exactly at maximum', () => {
      const errors = validator.validateField('12345678901234567890', maxLengthField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for string above maximum', () => {
      const errors = validator.validateField('thisusernameiswaytoolongtobevalid', maxLengthField)

      expect(errors).toContain('Must be no more than 20 characters')
    })
  })

  describe('min validation', () => {
    const minField: FormField = {
      name: 'age',
      type: 'number',
      validation: [{ type: 'min', value: 18, message: 'Must be at least {value}' }],
    }

    it('should pass for number above minimum', () => {
      const errors = validator.validateField(25, minField)

      expect(errors).toHaveLength(0)
    })

    it('should pass for number exactly at minimum', () => {
      const errors = validator.validateField(18, minField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for number below minimum', () => {
      const errors = validator.validateField(15, minField)

      expect(errors).toContain('Must be at least 18')
    })

    it('should work with string numbers', () => {
      const errors = validator.validateField('25', minField)

      expect(errors).toHaveLength(0)
    })
  })

  describe('max validation', () => {
    const maxField: FormField = {
      name: 'quantity',
      type: 'number',
      validation: [{ type: 'max', value: 100, message: 'Must be no more than {value}' }],
    }

    it('should pass for number under maximum', () => {
      const errors = validator.validateField(50, maxField)

      expect(errors).toHaveLength(0)
    })

    it('should pass for number exactly at maximum', () => {
      const errors = validator.validateField(100, maxField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for number above maximum', () => {
      const errors = validator.validateField(150, maxField)

      expect(errors).toContain('Must be no more than 100')
    })
  })

  describe('pattern validation', () => {
    const patternField: FormField = {
      name: 'zipcode',
      type: 'text',
      validation: [{ type: 'pattern', value: /^\d{5}$/, message: 'Must be 5 digits' }],
    }

    it('should pass for matching pattern', () => {
      const errors = validator.validateField('12345', patternField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for non-matching pattern', () => {
      const errors = validator.validateField('1234', patternField)

      expect(errors).toContain('Must be 5 digits')
    })

    it('should work with string pattern', () => {
      const stringPatternField: FormField = {
        name: 'code',
        type: 'text',
        validation: [
          { type: 'pattern', value: '^[A-Z]{3}$', message: 'Must be 3 uppercase letters' },
        ],
      }

      expect(validator.validateField('ABC', stringPatternField)).toHaveLength(0)
      expect(validator.validateField('abc', stringPatternField)).toContain(
        'Must be 3 uppercase letters'
      )
    })
  })

  describe('custom validation', () => {
    const customField: FormField = {
      name: 'custom',
      type: 'text',
      validation: [
        {
          type: 'custom',
          value: (v: unknown) => v === 'valid',
          message: 'Value must be "valid"',
        },
      ],
    }

    it('should pass for valid custom rule', () => {
      const errors = validator.validateField('valid', customField)

      expect(errors).toHaveLength(0)
    })

    it('should fail for invalid custom rule', () => {
      const errors = validator.validateField('invalid', customField)

      expect(errors).toContain('Value must be "valid"')
    })

    it('returns no error when custom rule has no function value', () => {
      const field: FormField = {
        name: 'no-fn',
        type: 'text',
        validation: [{ type: 'custom', message: 'ignored' }],
      }
      const errors = validator.validateField('anything', field)
      expect(errors).toHaveLength(0)
    })

    it('returns no error for unknown rule type', () => {
      const field: FormField = {
        name: 'unknown',
        type: 'text',
        validation: [{ type: 'unknown-type' as never, message: 'nope' }],
      }
      const errors = validator.validateField('anything', field)
      expect(errors).toHaveLength(0)
    })

    it('returns no error for required rule when value is present', () => {
      const field: FormField = {
        name: 'req-rule',
        type: 'text',
        required: true,
        validation: [{ type: 'required', message: 'Field is required' }],
      }
      const errors = validator.validateField('present value', field)
      expect(errors).toHaveLength(0)
    })
  })

  describe('multiple validation rules', () => {
    const multiRuleField: FormField = {
      name: 'password',
      type: 'password',
      required: true,
      validation: [
        { type: 'minLength', value: 8, message: 'Too short' },
        { type: 'maxLength', value: 20, message: 'Too long' },
        { type: 'pattern', value: /[A-Z]/, message: 'Must contain uppercase' },
      ],
    }

    it('should return all errors for invalid value', () => {
      const errors = validator.validateField('short', multiRuleField)

      expect(errors).toContain('Too short')
      expect(errors).toContain('Must contain uppercase')
    })

    it('should return no errors for valid value', () => {
      const errors = validator.validateField('ValidPassword1', multiRuleField)

      expect(errors).toHaveLength(0)
    })
  })

  describe('validateAll', () => {
    const fields: FormField[] = [
      { name: 'name', type: 'text', required: true },
      {
        name: 'email',
        type: 'email',
        required: true,
        validation: [{ type: 'email', message: 'Invalid email' }],
      },
      {
        name: 'age',
        type: 'number',
        validation: [{ type: 'min', value: 0, message: 'Must be positive' }],
      },
    ]

    it('should return valid for correct values', () => {
      const result = validator.validateAll(
        { name: 'John', email: 'john@example.com', age: 25 },
        fields
      )

      expect(result.valid).toBe(true)
      expect(Object.keys(result.errors)).toHaveLength(0)
    })

    it('should return errors for all invalid fields', () => {
      const result = validator.validateAll({ name: '', email: 'invalid', age: -5 }, fields)

      expect(result.valid).toBe(false)
      expect(result.errors.name).toBeDefined()
      expect(result.errors.email).toBeDefined()
      expect(result.errors.age).toBeDefined()
    })

    it('should skip validation for optional empty fields', () => {
      const result = validator.validateAll({ name: 'John', email: 'john@example.com' }, fields)

      expect(result.valid).toBe(true)
    })
  })
})

describe('validateWithZod', () => {
  it('should validate with Zod schema', () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.string().email('Invalid email'),
    })

    const result = validateWithZod({ name: 'John', email: 'john@example.com' }, schema)

    expect(result.valid).toBe(true)
  })

  it('should return Zod errors', () => {
    const schema = z.object({
      name: z.string().min(1, 'Name is required'),
      email: z.string().email('Invalid email'),
    })

    const result = validateWithZod({ name: '', email: 'invalid' }, schema)

    expect(result.valid).toBe(false)
    expect(result.errors.name).toBeDefined()
    expect(result.errors.email).toBeDefined()
  })

  it('should handle nested paths', () => {
    const schema = z.object({
      user: z.object({
        name: z.string().min(1, 'Name is required'),
      }),
    })

    const result = validateWithZod({ user: { name: '' } }, schema)

    expect(result.valid).toBe(false)
    expect(result.errors['user.name']).toBeDefined()
  })
})

describe('FormSchemas', () => {
  it('should validate email', () => {
    expect(FormSchemas.email.safeParse('test@example.com').success).toBe(true)
    expect(FormSchemas.email.safeParse('invalid').success).toBe(false)
  })

  it('should validate required string', () => {
    expect(FormSchemas.requiredString.safeParse('hello').success).toBe(true)
    expect(FormSchemas.requiredString.safeParse('').success).toBe(false)
  })

  it('should validate URL', () => {
    expect(FormSchemas.url.safeParse('https://example.com').success).toBe(true)
    expect(FormSchemas.url.safeParse('invalid').success).toBe(false)
  })

  it('should validate phone', () => {
    expect(FormSchemas.phone.safeParse('+1 (555) 123-4567').success).toBe(true)
    expect(FormSchemas.phone.safeParse('abc').success).toBe(false)
  })

  it('should validate password', () => {
    expect(FormSchemas.password.safeParse('Password1').success).toBe(true)
    expect(FormSchemas.password.safeParse('short').success).toBe(false)
    expect(FormSchemas.password.safeParse('12345678').success).toBe(false) // Numbers only, no letter
    expect(FormSchemas.password.safeParse('NoNumbers').success).toBe(false)
  })
})

describe('createFormValidator', () => {
  it('should create validator with default messages', () => {
    const validator = createFormValidator()

    expect(validator).toBeInstanceOf(DefaultFormValidator)
  })

  it('should create validator with custom messages', () => {
    const validator = createFormValidator({
      required: 'Custom required message',
    })

    const field: FormField = { name: 'test', type: 'text', required: true }
    const errors = validator.validateField('', field)

    expect(errors).toContain('Custom required message')
  })
})
