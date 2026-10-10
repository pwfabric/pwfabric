/**
 * Form Processing Types
 *
 * Form processing capability for surfaces
 *
 * @module @pwfabric/runtime/forms/types
 */

import type { ZodType } from 'zod'

// ============================================================
// FORM FIELD TYPES
// ============================================================

/**
 * Form field input type
 */
export type FormFieldType =
  | 'text'
  | 'email'
  | 'number'
  | 'select'
  | 'checkbox'
  | 'textarea'
  | 'password'
  | 'tel'
  | 'url'
  | 'date'
  | 'hidden'

/**
 * Validation rule type
 */
export type ValidationRuleType =
  | 'required'
  | 'minLength'
  | 'maxLength'
  | 'min'
  | 'max'
  | 'pattern'
  | 'email'
  | 'url'
  | 'custom'

/**
 * Validation rule definition
 */
export interface ValidationRule {
  readonly type: ValidationRuleType
  readonly value?: unknown
  readonly message: string
}

/**
 * Select option for select fields
 */
export interface SelectOption {
  readonly value: string | number
  readonly label: string
  readonly disabled?: boolean
}

/**
 * Form field definition
 */
export interface FormField {
  readonly name: string
  readonly type: FormFieldType
  readonly label?: string
  readonly placeholder?: string
  readonly required?: boolean
  readonly disabled?: boolean
  readonly defaultValue?: unknown
  readonly validation?: readonly ValidationRule[]
  readonly options?: readonly SelectOption[] // For select fields
}

// ============================================================
// FORM STATE
// ============================================================

/**
 * Form state tracking
 */
export interface FormState {
  readonly values: Record<string, unknown>
  readonly errors: Record<string, string[]>
  readonly touched: Record<string, boolean>
  readonly isValid: boolean
  readonly isSubmitting: boolean
  readonly isDirty: boolean
  readonly submitCount: number
}

/**
 * Initial form state
 */
export const INITIAL_FORM_STATE: FormState = {
  values: {},
  errors: {},
  touched: {},
  isValid: true,
  isSubmitting: false,
  isDirty: false,
  submitCount: 0,
}

// ============================================================
// FORM VALIDATION RESULT
// ============================================================

/**
 * Result of validating form values
 */
export interface FormValidationResult {
  readonly valid: boolean
  readonly errors: Record<string, string[]>
}

/**
 * Successful validation result
 */
export interface FormValidationSuccess extends FormValidationResult {
  readonly valid: true
  readonly errors: Record<string, never>
}

/**
 * Failed validation result
 */
export interface FormValidationFailure extends FormValidationResult {
  readonly valid: false
  readonly errors: Record<string, string[]>
}

// ============================================================
// FORM RESULT
// ============================================================

/**
 * Result of form processing
 */
export type FormResult<T = unknown> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: FormError }

/**
 * Form processing error
 */
export interface FormError {
  readonly type: 'validation_failed' | 'processing_failed' | 'network_error' | 'unknown'
  readonly message: string
  readonly validationErrors?: Record<string, string[]>
  readonly cause?: unknown
}

// ============================================================
// FORM PROCESSOR
// ============================================================

/**
 * Form submission handler function
 */
export type FormSubmitHandler<T = unknown> = (values: Record<string, unknown>) => Promise<T> | T

/**
 * Form processor interface
 */
export interface FormProcessor {
  /**
   * Validate form values against field definitions
   */
  validate(values: Record<string, unknown>, fields: readonly FormField[]): FormValidationResult

  /**
   * Validate form values using a Zod schema
   */
  validateWithSchema<T>(values: Record<string, unknown>, schema: ZodType<T>): FormValidationResult

  /**
   * Process a form submission
   */
  process<T>(
    formId: string,
    values: Record<string, unknown>,
    handler: FormSubmitHandler<T>
  ): Promise<FormResult<T>>
}

// ============================================================
// FORM VALIDATOR
// ============================================================

/**
 * Form validator interface
 */
export interface FormValidator {
  /**
   * Validate a single field value
   */
  validateField(value: unknown, field: FormField): string[]

  /**
   * Validate all fields
   */
  validateAll(values: Record<string, unknown>, fields: readonly FormField[]): FormValidationResult
}

// ============================================================
// FORM CONFIGURATION
// ============================================================

/**
 * Form processor configuration
 */
export interface FormProcessorConfig {
  /**
   * Whether to validate on submit
   */
  readonly validateOnSubmit?: boolean

  /**
   * Whether to validate individual fields on blur
   */
  readonly validateOnBlur?: boolean

  /**
   * Whether to validate individual fields on change
   */
  readonly validateOnChange?: boolean

  /**
   * Custom error messages
   */
  readonly messages?: Partial<ValidationMessages>
}

/**
 * Default validation error messages
 */
export interface ValidationMessages {
  readonly required: string
  readonly email: string
  readonly url: string
  readonly minLength: string
  readonly maxLength: string
  readonly min: string
  readonly max: string
  readonly pattern: string
}

/**
 * Default validation messages
 */
export const DEFAULT_VALIDATION_MESSAGES: ValidationMessages = {
  required: 'This field is required',
  email: 'Please enter a valid email address',
  url: 'Please enter a valid URL',
  minLength: 'Must be at least {value} characters',
  maxLength: 'Must be no more than {value} characters',
  min: 'Must be at least {value}',
  max: 'Must be no more than {value}',
  pattern: 'Invalid format',
}
