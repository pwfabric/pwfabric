/**
 * Form Processing Module
 *
 * Form processing capability for surfaces
 *
 * Exports:
 * - Types: FormField, FormState, ValidationRule, FormResult, etc.
 * - Implementations: DefaultFormValidator, DefaultFormProcessor
 * - Factory functions: createFormValidator, createFormProcessor
 * - Utilities: isFormSuccess, isFormFailure, formatValidationErrors
 *
 * @module @pwfabric/runtime/forms
 */

// Types
export type {
  FormFieldType,
  ValidationRuleType,
  ValidationRule,
  SelectOption,
  FormField,
  FormState,
  FormValidationResult,
  FormValidationSuccess,
  FormValidationFailure,
  FormResult,
  FormError,
  FormSubmitHandler,
  FormProcessor,
  FormValidator,
  FormProcessorConfig,
  ValidationMessages,
} from './types.js'

// Constants
export { INITIAL_FORM_STATE, DEFAULT_VALIDATION_MESSAGES } from './types.js'

// Validator
export {
  DefaultFormValidator,
  createFormValidator,
  validateWithZod,
  FormSchemas,
} from './validator.js'

// Processor
export {
  DefaultFormProcessor,
  createFormProcessor,
  isFormSuccess,
  isFormFailure,
  formatFormErrors,
  getErrorMessages,
} from './processor.js'

// Form → Entity Bridge
export { attachFormEntityBridge } from './form-entity-bridge.js'
export { completeNamedControlValues } from './named-control-values.js'
export type { FormEntityBridgeConfig, FormWriter, Unsubscribe } from './form-entity-bridge.js'

// Which verb / which record a form write addresses, and what a refusal means
export { resolveFormWriteTarget, toFormWriteError } from './form-write-target.js'
export type { FormWriteMethod, FormWriteTarget } from './form-write-target.js'
