/**
 * Forms + State + Validation Integration Tests
 *
 * Integration tests verifying forms, state, and validation work together
 *
 * Test scenarios:
 * - Form values sync with state
 * - Form validation on state-backed data
 * - Form submission updates state
 * - Form reset clears state
 *
 * @module @pwfabric/runtime/__tests__/integration/forms-state
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import type { StateStore } from '../../state/index.js'
import { createStateStore } from '../../state/index.js'
import type {
  DefaultFormProcessor,
  DefaultFormValidator,
  FormField,
  FormState,
  FormResult,
} from '../../forms/index.js'
import {
  createFormProcessor,
  createFormValidator,
  isFormSuccess,
  isFormFailure,
} from '../../forms/index.js'

// ============================================================
// TEST FIXTURES
// ============================================================

interface ContactFormData {
  firstName: string
  lastName: string
  email: string
  phone: string
  message: string
}

interface RegistrationFormData {
  username: string
  email: string
  password: string
  confirmPassword: string
  acceptTerms: boolean
}

// ============================================================
// FORM-STATE INTEGRATION LAYER
// ============================================================

/**
 * Coordinates form state with application state
 * This represents the integration pattern between forms and state modules
 */
class FormStateManager<T extends Record<string, unknown>> {
  private readonly stateStore: StateStore<unknown>
  private readonly formId: string
  private readonly processor: DefaultFormProcessor
  private readonly validator: DefaultFormValidator
  private readonly fields: readonly FormField[]

  constructor(formId: string, fields: readonly FormField[], stateStore: StateStore<unknown>) {
    this.formId = formId
    this.fields = fields
    this.stateStore = stateStore
    this.processor = createFormProcessor() as DefaultFormProcessor
    this.validator = createFormValidator() as DefaultFormValidator

    // Initialize form state
    this.initializeFormState()
  }

  /**
   * Initialize form state in the state store
   */
  private initializeFormState(): void {
    const initialValues: Record<string, unknown> = {}
    for (const field of this.fields) {
      initialValues[field.name] = field.defaultValue ?? ''
    }

    this.stateStore.set(`${this.formId}:values`, initialValues)
    this.stateStore.set(`${this.formId}:errors`, {})
    this.stateStore.set(`${this.formId}:touched`, {})
    this.stateStore.set(`${this.formId}:isValid`, true)
    this.stateStore.set(`${this.formId}:isSubmitting`, false)
    this.stateStore.set(`${this.formId}:isDirty`, false)
    this.stateStore.set(`${this.formId}:submitCount`, 0)
  }

  /**
   * Update a field value
   */
  setFieldValue(fieldName: string, value: unknown): void {
    const values = this.getValues()
    values[fieldName] = value
    this.stateStore.set(`${this.formId}:values`, values)
    this.stateStore.set(`${this.formId}:isDirty`, true)

    // Mark field as touched
    const touched = this.getTouched()
    touched[fieldName] = true
    this.stateStore.set(`${this.formId}:touched`, touched)
  }

  /**
   * Update multiple field values
   */
  setValues(newValues: Partial<T>): void {
    const values = this.getValues()
    Object.assign(values, newValues)
    this.stateStore.set(`${this.formId}:values`, values)
    this.stateStore.set(`${this.formId}:isDirty`, true)
  }

  /**
   * Validate a single field
   */
  validateField(fieldName: string): string[] {
    const field = this.fields.find((f) => f.name === fieldName)
    if (!field) return []

    const values = this.getValues()
    const errors = this.validator.validateField(values[fieldName], field)

    // Update errors in state
    const currentErrors = this.getErrors()
    if (errors.length > 0) {
      currentErrors[fieldName] = errors
      this.stateStore.set(`${this.formId}:errors`, currentErrors)
    } else {
      // Remove the field from errors by creating a new object without it
      const { [fieldName]: _removed, ...remainingErrors } = currentErrors
      this.stateStore.set(`${this.formId}:errors`, remainingErrors)
    }
    this.updateValidity()

    return errors
  }

  /**
   * Validate all fields
   */
  validateAll(): boolean {
    const values = this.getValues()
    const result = this.processor.validate(values, this.fields)

    this.stateStore.set(`${this.formId}:errors`, result.errors)
    this.stateStore.set(`${this.formId}:isValid`, result.valid)

    return result.valid
  }

  /**
   * Submit the form
   */
  async submit<R>(handler: (values: T) => Promise<R> | R): Promise<FormResult<R>> {
    const submitCount = (this.stateStore.get(`${this.formId}:submitCount`) as number) + 1
    this.stateStore.set(`${this.formId}:submitCount`, submitCount)
    this.stateStore.set(`${this.formId}:isSubmitting`, true)

    try {
      // Validate first
      const isValid = this.validateAll()
      if (!isValid) {
        return {
          success: false,
          error: {
            type: 'validation_failed',
            message: 'Form validation failed',
            validationErrors: this.getErrors(),
          },
        }
      }

      // Process the form
      const values = this.getValues() as T
      const result = await this.processor.process(this.formId, values, handler)

      return result
    } finally {
      this.stateStore.set(`${this.formId}:isSubmitting`, false)
    }
  }

  /**
   * Reset form to initial state
   */
  reset(): void {
    this.initializeFormState()
  }

  /**
   * Get current form values
   */
  getValues(): Record<string, unknown> {
    return { ...(this.stateStore.get(`${this.formId}:values`) as Record<string, unknown>) }
  }

  /**
   * Get current form errors
   */
  getErrors(): Record<string, string[]> {
    return { ...(this.stateStore.get(`${this.formId}:errors`) as Record<string, string[]>) }
  }

  /**
   * Get touched fields
   */
  getTouched(): Record<string, boolean> {
    return { ...(this.stateStore.get(`${this.formId}:touched`) as Record<string, boolean>) }
  }

  /**
   * Get full form state
   */
  getFormState(): FormState {
    return {
      values: this.getValues(),
      errors: this.getErrors(),
      touched: this.getTouched(),
      isValid: (this.stateStore.get(`${this.formId}:isValid`) as boolean) ?? true,
      isSubmitting: (this.stateStore.get(`${this.formId}:isSubmitting`) as boolean) ?? false,
      isDirty: (this.stateStore.get(`${this.formId}:isDirty`) as boolean) ?? false,
      submitCount: (this.stateStore.get(`${this.formId}:submitCount`) as number) ?? 0,
    }
  }

  /**
   * Subscribe to form state changes
   */
  subscribe(callback: (state: FormState) => void): () => void {
    const keys = [
      `${this.formId}:values`,
      `${this.formId}:errors`,
      `${this.formId}:touched`,
      `${this.formId}:isValid`,
      `${this.formId}:isSubmitting`,
      `${this.formId}:isDirty`,
      `${this.formId}:submitCount`,
    ]

    const unsubscribes = keys.map((key) =>
      this.stateStore.subscribe(key, () => {
        callback(this.getFormState())
      })
    )

    return () => {
      for (const unsub of unsubscribes) {
        unsub()
      }
    }
  }

  private updateValidity(): void {
    const errors = this.getErrors()
    const isValid = Object.keys(errors).length === 0
    this.stateStore.set(`${this.formId}:isValid`, isValid)
  }
}

// ============================================================
// TEST SUITE
// ============================================================

describe('Forms + State + Validation Integration', () => {
  let stateStore: StateStore<unknown>

  beforeEach(() => {
    stateStore = createStateStore<unknown>()
  })

  describe('Form-State Synchronization', () => {
    it('should initialize form state in state store', () => {
      // Arrange
      const fields: FormField[] = [
        { name: 'firstName', type: 'text', defaultValue: '' },
        { name: 'lastName', type: 'text', defaultValue: '' },
        { name: 'email', type: 'email', defaultValue: '' },
      ]

      // Act
      const formManager = new FormStateManager<ContactFormData>('contact-form', fields, stateStore)

      // Assert
      const formState = formManager.getFormState()
      expect(formState.values).toHaveProperty('firstName', '')
      expect(formState.values).toHaveProperty('lastName', '')
      expect(formState.values).toHaveProperty('email', '')
      expect(formState.isValid).toBe(true)
      expect(formState.isDirty).toBe(false)
    })

    it('should sync field changes to state', () => {
      // Arrange
      const fields: FormField[] = [
        { name: 'email', type: 'email' },
        { name: 'message', type: 'textarea' },
      ]
      const formManager = new FormStateManager<ContactFormData>('contact-form', fields, stateStore)

      // Act
      formManager.setFieldValue('email', 'test@example.com')

      // Assert
      const values = formManager.getValues()
      expect(values.email).toBe('test@example.com')
      expect(formManager.getFormState().isDirty).toBe(true)
    })

    it('should mark fields as touched on change', () => {
      // Arrange
      const fields: FormField[] = [
        { name: 'firstName', type: 'text' },
        { name: 'lastName', type: 'text' },
      ]
      const formManager = new FormStateManager<ContactFormData>('contact-form', fields, stateStore)

      // Act
      formManager.setFieldValue('firstName', 'John')

      // Assert
      const touched = formManager.getTouched()
      expect(touched.firstName).toBe(true)
      expect(touched.lastName).toBeUndefined()
    })

    it('should notify subscribers on state changes', () => {
      // Arrange
      const fields: FormField[] = [{ name: 'username', type: 'text' }]
      const formManager = new FormStateManager<{ username: string }>(
        'user-form',
        fields,
        stateStore
      )

      const stateChanges: FormState[] = []
      formManager.subscribe((state) => {
        stateChanges.push({ ...state })
      })

      // Act
      formManager.setFieldValue('username', 'john_doe')
      formManager.setFieldValue('username', 'jane_doe')

      // Assert - Should receive multiple notifications
      expect(stateChanges.length).toBeGreaterThan(0)
      const lastState = stateChanges[stateChanges.length - 1]
      expect(lastState?.values.username).toBe('jane_doe')
    })
  })

  describe('Form Validation with State', () => {
    it('should validate required fields', () => {
      // Arrange
      const fields: FormField[] = [
        { name: 'email', type: 'email', required: true },
        { name: 'message', type: 'textarea', required: true },
      ]
      const formManager = new FormStateManager<ContactFormData>('contact-form', fields, stateStore)

      // Act
      const isValid = formManager.validateAll()

      // Assert
      expect(isValid).toBe(false)
      const errors = formManager.getErrors()
      expect(errors.email).toBeDefined()
      expect(errors.message).toBeDefined()
    })

    it('should validate email format', () => {
      // Arrange - Note: type 'email' is for display; explicit validation rule is needed
      const fields: FormField[] = [
        {
          name: 'email',
          type: 'email',
          required: true,
          validation: [{ type: 'email', message: 'Please enter a valid email address' }],
        },
      ]
      const formManager = new FormStateManager<{ email: string }>('email-form', fields, stateStore)

      // Act - Invalid email
      formManager.setFieldValue('email', 'not-an-email')
      const errors1 = formManager.validateField('email')

      // Assert
      expect(errors1.length).toBeGreaterThan(0)
      expect(errors1[0]).toContain('email')

      // Act - Valid email
      formManager.setFieldValue('email', 'valid@example.com')
      const errors2 = formManager.validateField('email')

      // Assert
      expect(errors2.length).toBe(0)
    })

    it('should validate with custom rules', () => {
      // Arrange
      const fields: FormField[] = [
        {
          name: 'password',
          type: 'password',
          required: true,
          validation: [
            { type: 'minLength', value: 8, message: 'Password must be at least 8 characters' },
          ],
        },
      ]
      const formManager = new FormStateManager<{ password: string }>(
        'password-form',
        fields,
        stateStore
      )

      // Act - Too short
      formManager.setFieldValue('password', 'short')
      const errors1 = formManager.validateField('password')

      // Assert
      expect(errors1).toContain('Password must be at least 8 characters')

      // Act - Valid length
      formManager.setFieldValue('password', 'longenoughpassword')
      const errors2 = formManager.validateField('password')

      // Assert
      expect(errors2.length).toBe(0)
    })

    it('should update validity state on validation', () => {
      // Arrange
      const fields: FormField[] = [{ name: 'name', type: 'text', required: true }]
      const formManager = new FormStateManager<{ name: string }>('name-form', fields, stateStore)

      // Initial state should be valid (no validation run yet)
      expect(formManager.getFormState().isValid).toBe(true)

      // Act - Validate empty form
      formManager.validateAll()

      // Assert - Should be invalid
      expect(formManager.getFormState().isValid).toBe(false)

      // Act - Set valid value
      formManager.setFieldValue('name', 'John')
      formManager.validateAll()

      // Assert - Should be valid
      expect(formManager.getFormState().isValid).toBe(true)
    })
  })

  describe('Form Submission with State Updates', () => {
    it('should submit valid form and return success', async () => {
      // Arrange
      const fields: FormField[] = [{ name: 'email', type: 'email', required: true }]
      const formManager = new FormStateManager<{ email: string }>('submit-form', fields, stateStore)

      formManager.setFieldValue('email', 'test@example.com')

      // Act
      const result = await formManager.submit(async (values) => {
        return { submitted: true, email: values.email }
      })

      // Assert
      expect(isFormSuccess(result)).toBe(true)
      if (isFormSuccess(result)) {
        expect(result.data.submitted).toBe(true)
        expect(result.data.email).toBe('test@example.com')
      }
    })

    it('should fail submission on validation errors', async () => {
      // Arrange
      const fields: FormField[] = [{ name: 'email', type: 'email', required: true }]
      const formManager = new FormStateManager<{ email: string }>('fail-form', fields, stateStore)

      // Leave email empty

      // Act
      const result = await formManager.submit(async (values) => {
        return values
      })

      // Assert
      expect(isFormFailure(result)).toBe(true)
      if (isFormFailure(result)) {
        expect(result.error.type).toBe('validation_failed')
        expect(result.error.validationErrors).toBeDefined()
      }
    })

    it('should track submit count in state', async () => {
      // Arrange
      const fields: FormField[] = [{ name: 'data', type: 'text' }]
      const formManager = new FormStateManager<{ data: string }>('count-form', fields, stateStore)

      // Act
      await formManager.submit(async () => 'result1')
      await formManager.submit(async () => 'result2')
      await formManager.submit(async () => 'result3')

      // Assert
      expect(formManager.getFormState().submitCount).toBe(3)
    })

    it('should set submitting state during processing', async () => {
      // Arrange
      const fields: FormField[] = [{ name: 'data', type: 'text' }]
      const formManager = new FormStateManager<{ data: string }>(
        'submitting-form',
        fields,
        stateStore
      )

      const submittingStates: boolean[] = []
      formManager.subscribe((state) => {
        submittingStates.push(state.isSubmitting)
      })

      // Act
      await formManager.submit(async () => {
        // During submission
        expect(formManager.getFormState().isSubmitting).toBe(true)
        return 'result'
      })

      // Assert - Should have been true during submission, false after
      expect(formManager.getFormState().isSubmitting).toBe(false)
    })

    it('should update external state after successful submission', async () => {
      // Arrange
      const fields: FormField[] = [{ name: 'newItem', type: 'text', required: true }]
      const formManager = new FormStateManager<{ newItem: string }>(
        'add-item-form',
        fields,
        stateStore
      )

      // Initialize items list in state
      stateStore.set('items', ['item1', 'item2'])

      formManager.setFieldValue('newItem', 'item3')

      // Act - Submit should add item to list
      const result = await formManager.submit(async (values) => {
        const currentItems = (stateStore.get('items') as string[]) ?? []
        stateStore.set('items', [...currentItems, values.newItem as string])
        return { added: values.newItem }
      })

      // Assert
      expect(isFormSuccess(result)).toBe(true)
      const items = stateStore.get('items') as string[]
      expect(items).toEqual(['item1', 'item2', 'item3'])
    })
  })

  describe('Form Reset with State', () => {
    it('should reset form values to defaults', () => {
      // Arrange
      const fields: FormField[] = [
        { name: 'firstName', type: 'text', defaultValue: 'Default' },
        { name: 'lastName', type: 'text', defaultValue: '' },
      ]
      const formManager = new FormStateManager<{ firstName: string; lastName: string }>(
        'reset-form',
        fields,
        stateStore
      )

      // Modify values
      formManager.setFieldValue('firstName', 'Modified')
      formManager.setFieldValue('lastName', 'Value')

      // Act
      formManager.reset()

      // Assert
      const values = formManager.getValues()
      expect(values.firstName).toBe('Default')
      expect(values.lastName).toBe('')
    })

    it('should clear errors on reset', () => {
      // Arrange
      const fields: FormField[] = [{ name: 'email', type: 'email', required: true }]
      const formManager = new FormStateManager<{ email: string }>(
        'error-reset-form',
        fields,
        stateStore
      )

      // Generate errors
      formManager.validateAll()
      expect(Object.keys(formManager.getErrors()).length).toBeGreaterThan(0)

      // Act
      formManager.reset()

      // Assert
      expect(formManager.getErrors()).toEqual({})
    })

    it('should reset dirty and touched state', () => {
      // Arrange
      const fields: FormField[] = [{ name: 'field', type: 'text' }]
      const formManager = new FormStateManager<{ field: string }>(
        'dirty-reset-form',
        fields,
        stateStore
      )

      formManager.setFieldValue('field', 'value')
      expect(formManager.getFormState().isDirty).toBe(true)
      expect(formManager.getTouched().field).toBe(true)

      // Act
      formManager.reset()

      // Assert
      expect(formManager.getFormState().isDirty).toBe(false)
      expect(formManager.getTouched()).toEqual({})
    })

    it('should reset submit count', () => {
      // Arrange
      const fields: FormField[] = [{ name: 'data', type: 'text' }]
      const formManager = new FormStateManager<{ data: string }>(
        'submit-reset-form',
        fields,
        stateStore
      )

      // Submit multiple times
      formManager.submit(async () => 'r1')
      formManager.submit(async () => 'r2')

      // Act
      formManager.reset()

      // Assert
      expect(formManager.getFormState().submitCount).toBe(0)
    })
  })

  describe('Zod Schema Validation Integration', () => {
    it('should validate form with Zod schema', async () => {
      // Arrange - fields define the form structure for documentation
      const _fields: FormField[] = [
        { name: 'username', type: 'text' },
        { name: 'email', type: 'email' },
        { name: 'age', type: 'number' },
      ]

      const schema = z.object({
        username: z.string().min(3, 'Username must be at least 3 characters'),
        email: z.string().email('Invalid email format'),
        age: z.number().min(18, 'Must be 18 or older'),
      })

      const processor = createFormProcessor()

      // Act - Invalid data
      const invalidResult = processor.validateWithSchema(
        { username: 'ab', email: 'invalid', age: 15 },
        schema
      )

      // Assert
      expect(invalidResult.valid).toBe(false)
      expect(invalidResult.errors.username).toBeDefined()
      expect(invalidResult.errors.email).toBeDefined()
      expect(invalidResult.errors.age).toBeDefined()

      // Act - Valid data
      const validResult = processor.validateWithSchema(
        { username: 'john', email: 'john@example.com', age: 25 },
        schema
      )

      // Assert
      expect(validResult.valid).toBe(true)
      expect(Object.keys(validResult.errors)).toHaveLength(0)
    })
  })

  describe('Complex Form Workflows', () => {
    it('should handle multi-step form with shared state', async () => {
      // Arrange - Step 1: Personal Info
      const step1Fields: FormField[] = [
        { name: 'firstName', type: 'text', required: true },
        { name: 'lastName', type: 'text', required: true },
      ]
      const step1Manager = new FormStateManager<{ firstName: string; lastName: string }>(
        'registration-step1',
        step1Fields,
        stateStore
      )

      // Arrange - Step 2: Contact Info
      const step2Fields: FormField[] = [
        { name: 'email', type: 'email', required: true },
        { name: 'phone', type: 'tel' },
      ]
      const step2Manager = new FormStateManager<{ email: string; phone: string }>(
        'registration-step2',
        step2Fields,
        stateStore
      )

      // Act - Fill step 1
      step1Manager.setFieldValue('firstName', 'John')
      step1Manager.setFieldValue('lastName', 'Doe')
      const step1Valid = step1Manager.validateAll()

      // Act - Fill step 2
      step2Manager.setFieldValue('email', 'john.doe@example.com')
      step2Manager.setFieldValue('phone', '555-1234')
      const step2Valid = step2Manager.validateAll()

      // Assert
      expect(step1Valid).toBe(true)
      expect(step2Valid).toBe(true)

      // Combine data from both steps
      const combinedData = {
        ...step1Manager.getValues(),
        ...step2Manager.getValues(),
      }

      expect(combinedData).toEqual({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '555-1234',
      })
    })

    it('should handle dependent field validation', () => {
      // Arrange
      const fields: FormField[] = [
        { name: 'password', type: 'password', required: true },
        { name: 'confirmPassword', type: 'password', required: true },
      ]
      const formManager = new FormStateManager<RegistrationFormData>(
        'password-form',
        fields,
        stateStore
      )

      // Custom validation: confirm password must match password
      const validatePasswordMatch = (): boolean => {
        const values = formManager.getValues()
        if (values.password !== values.confirmPassword) {
          const errors = formManager.getErrors()
          errors.confirmPassword = ['Passwords must match']
          stateStore.set('password-form:errors', errors)
          stateStore.set('password-form:isValid', false)
          return false
        }
        return true
      }

      // Act - Mismatched passwords
      formManager.setFieldValue('password', 'secret123')
      formManager.setFieldValue('confirmPassword', 'different')
      const isValid = validatePasswordMatch()

      // Assert
      expect(isValid).toBe(false)
      expect(formManager.getErrors().confirmPassword).toContain('Passwords must match')

      // Act - Matching passwords
      formManager.setFieldValue('confirmPassword', 'secret123')
      const errors = formManager.getErrors()
      delete errors.confirmPassword
      stateStore.set('password-form:errors', errors)
      const isValidNow = validatePasswordMatch()

      // Assert
      expect(isValidNow).toBe(true)
    })
  })
})
