/**
 * Form Processor
 *
 * Form processing implementation
 *
 * @module @pwfabric/runtime/forms/processor
 */

import type { ZodType } from 'zod'
import type {
  FormProcessor,
  FormField,
  FormSubmitHandler,
  FormResult,
  FormError,
  FormValidationResult,
  FormProcessorConfig,
} from './types.js'
import { DefaultFormValidator, validateWithZod } from './validator.js'

// ============================================================
// DEFAULT FORM PROCESSOR
// ============================================================

/**
 * Default form processor implementation
 */
export class DefaultFormProcessor implements FormProcessor {
  private readonly validator: DefaultFormValidator
  private readonly config: Required<FormProcessorConfig>

  constructor(config: FormProcessorConfig = {}) {
    this.validator = new DefaultFormValidator(config.messages)
    this.config = {
      validateOnSubmit: config.validateOnSubmit ?? true,
      validateOnBlur: config.validateOnBlur ?? true,
      validateOnChange: config.validateOnChange ?? false,
      messages: config.messages ?? {},
    }
  }

  validate(values: Record<string, unknown>, fields: readonly FormField[]): FormValidationResult {
    return this.validator.validateAll(values, fields)
  }

  validateWithSchema<T>(values: Record<string, unknown>, schema: ZodType<T>): FormValidationResult {
    return validateWithZod(values, schema)
  }

  async process<T>(
    _formId: string,
    values: Record<string, unknown>,
    handler: FormSubmitHandler<T>
  ): Promise<FormResult<T>> {
    try {
      const result = await handler(values)
      return {
        success: true,
        data: result,
      }
    } catch (error) {
      return {
        success: false,
        error: this.createFormError(error),
      }
    }
  }

  /**
   * Process form with validation
   */
  async processWithValidation<T>(
    formId: string,
    values: Record<string, unknown>,
    fields: readonly FormField[],
    handler: FormSubmitHandler<T>
  ): Promise<FormResult<T>> {
    // Validate first if enabled
    if (this.config.validateOnSubmit) {
      const validationResult = this.validate(values, fields)

      if (!validationResult.valid) {
        return {
          success: false,
          error: {
            type: 'validation_failed',
            message: 'Form validation failed',
            validationErrors: validationResult.errors,
          },
        }
      }
    }

    return this.process(formId, values, handler)
  }

  /**
   * Process form with Zod schema validation
   */
  async processWithSchema<T, TOutput>(
    formId: string,
    values: Record<string, unknown>,
    schema: ZodType<TOutput>,
    handler: FormSubmitHandler<T>
  ): Promise<FormResult<T>> {
    // Validate with Zod schema
    const validationResult = this.validateWithSchema(values, schema)

    if (!validationResult.valid) {
      return {
        success: false,
        error: {
          type: 'validation_failed',
          message: 'Form validation failed',
          validationErrors: validationResult.errors,
        },
      }
    }

    return this.process(formId, values, handler)
  }

  private createFormError(error: unknown): FormError {
    if (error instanceof Error) {
      // Check for network errors
      if (
        error.name === 'NetworkError' ||
        error.message.includes('network') ||
        error.message.includes('fetch')
      ) {
        return {
          type: 'network_error',
          message: 'A network error occurred. Please try again.',
          cause: error,
        }
      }

      return {
        type: 'processing_failed',
        message: error.message,
        cause: error,
      }
    }

    return {
      type: 'unknown',
      message: 'An unexpected error occurred',
      cause: error,
    }
  }
}

/**
 * Create a form processor
 */
export function createFormProcessor(config?: FormProcessorConfig): FormProcessor {
  return new DefaultFormProcessor(config)
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if a form result is successful
 */
export function isFormSuccess<T>(result: FormResult<T>): result is { success: true; data: T } {
  return result.success
}

/**
 * Check if a form result is a failure
 */
export function isFormFailure<T>(
  result: FormResult<T>
): result is { success: false; error: FormError } {
  return !result.success
}

/**
 * Format form validation errors into a single message
 */
export function formatFormErrors(errors: Record<string, string[]>): string {
  const messages: string[] = []

  for (const [field, fieldErrors] of Object.entries(errors)) {
    for (const error of fieldErrors) {
      messages.push(`${field}: ${error}`)
    }
  }

  return messages.join('. ')
}

/**
 * Get all error messages as a flat array
 */
export function getErrorMessages(errors: Record<string, string[]>): string[] {
  const messages: string[] = []

  for (const fieldErrors of Object.values(errors)) {
    messages.push(...fieldErrors)
  }

  return messages
}
