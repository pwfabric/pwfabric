/**
 * Form Validator
 *
 * Form validation implementation
 *
 * @module @pwfabric/runtime/forms/validator
 */

import { z, type ZodType, type ZodError } from 'zod'
import type {
  FormValidator,
  FormField,
  ValidationRule,
  FormValidationResult,
  ValidationMessages,
} from './types.js'
import { DEFAULT_VALIDATION_MESSAGES } from './types.js'

// ============================================================
// DEFAULT FORM VALIDATOR
// ============================================================

/**
 * Default form validator implementation
 */
export class DefaultFormValidator implements FormValidator {
  private readonly messages: ValidationMessages

  constructor(customMessages: Partial<ValidationMessages> = {}) {
    this.messages = { ...DEFAULT_VALIDATION_MESSAGES, ...customMessages }
  }

  validateField(value: unknown, field: FormField): string[] {
    const errors: string[] = []

    // Check required
    if (field.required && this.isEmpty(value)) {
      errors.push(this.messages.required)
      return errors // Return early if required and empty
    }

    // Skip other validations if value is empty and not required
    if (this.isEmpty(value) && !field.required) {
      return errors
    }

    // Run custom validation rules
    if (field.validation) {
      for (const rule of field.validation) {
        const error = this.validateRule(value, rule)
        if (error) {
          errors.push(error)
        }
      }
    }

    return errors
  }

  validateAll(values: Record<string, unknown>, fields: readonly FormField[]): FormValidationResult {
    const errors: Record<string, string[]> = {}
    let hasErrors = false

    for (const field of fields) {
      const value = values[field.name]
      const fieldErrors = this.validateField(value, field)

      if (fieldErrors.length > 0) {
        errors[field.name] = fieldErrors
        hasErrors = true
      }
    }

    return {
      valid: !hasErrors,
      errors,
    }
  }

  private validateRule(value: unknown, rule: ValidationRule): string | null {
    switch (rule.type) {
      case 'required':
        return this.isEmpty(value) ? rule.message : null

      case 'email':
        return this.validateEmail(value, rule.message)

      case 'url':
        return this.validateUrl(value, rule.message)

      case 'minLength':
        return this.validateMinLength(value, rule.value as number, rule.message)

      case 'maxLength':
        return this.validateMaxLength(value, rule.value as number, rule.message)

      case 'min':
        return this.validateMin(value, rule.value as number, rule.message)

      case 'max':
        return this.validateMax(value, rule.value as number, rule.message)

      case 'pattern':
        return this.validatePattern(value, rule.value as string | RegExp, rule.message)

      case 'custom':
        // Custom validation function is expected to be in rule.value
        if (typeof rule.value === 'function') {
          const isValid = (rule.value as (v: unknown) => boolean)(value)
          return isValid ? null : rule.message
        }
        return null

      default:
        return null
    }
  }

  private isEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true
    if (typeof value === 'string') return value.trim() === ''
    if (Array.isArray(value)) return value.length === 0
    return false
  }

  private validateEmail(value: unknown, message: string): string | null {
    if (typeof value !== 'string') return message

    // Basic email regex - covers most common cases
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(value) ? null : message
  }

  private validateUrl(value: unknown, message: string): string | null {
    if (typeof value !== 'string') return message

    try {
      new URL(value)
      return null
    } catch {
      return message
    }
  }

  private validateMinLength(value: unknown, minLength: number, message: string): string | null {
    if (typeof value !== 'string') return message
    return value.length >= minLength ? null : this.formatMessage(message, minLength)
  }

  private validateMaxLength(value: unknown, maxLength: number, message: string): string | null {
    if (typeof value !== 'string') return message
    return value.length <= maxLength ? null : this.formatMessage(message, maxLength)
  }

  private validateMin(value: unknown, min: number, message: string): string | null {
    const num = Number(value)
    if (Number.isNaN(num)) return message
    return num >= min ? null : this.formatMessage(message, min)
  }

  private validateMax(value: unknown, max: number, message: string): string | null {
    const num = Number(value)
    if (Number.isNaN(num)) return message
    return num <= max ? null : this.formatMessage(message, max)
  }

  private validatePattern(
    value: unknown,
    pattern: string | RegExp,
    message: string
  ): string | null {
    if (typeof value !== 'string') return message

    const regex = typeof pattern === 'string' ? new RegExp(pattern) : pattern
    return regex.test(value) ? null : message
  }

  private formatMessage(message: string, value: unknown): string {
    return message.replace('{value}', String(value))
  }
}

// ============================================================
// ZOD SCHEMA VALIDATOR
// ============================================================

/**
 * Validate values using a Zod schema
 */
export function validateWithZod<T>(
  values: Record<string, unknown>,
  schema: ZodType<T>
): FormValidationResult {
  const result = schema.safeParse(values)

  if (result.success) {
    return {
      valid: true,
      errors: {},
    }
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error),
  }
}

/**
 * Convert Zod errors to FormValidationResult format
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!errors[path]) {
      errors[path] = []
    }
    errors[path].push(issue.message)
  }

  return errors
}

// ============================================================
// BUILT-IN ZOD SCHEMAS
// ============================================================

/**
 * Common Zod schemas for form validation
 */
export const FormSchemas = {
  /**
   * Email validation schema
   */
  email: z.string().email('Please enter a valid email address'),

  /**
   * Required string schema
   */
  requiredString: z.string().min(1, 'This field is required'),

  /**
   * URL validation schema
   */
  url: z.string().url('Please enter a valid URL'),

  /**
   * Phone number schema (basic)
   */
  phone: z.string().regex(/^\+?[\d\s-()]+$/, 'Please enter a valid phone number'),

  /**
   * Password schema (min 8 chars, at least one number and letter)
   */
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
}

/**
 * Create a form validator
 */
export function createFormValidator(customMessages?: Partial<ValidationMessages>): FormValidator {
  return new DefaultFormValidator(customMessages)
}
