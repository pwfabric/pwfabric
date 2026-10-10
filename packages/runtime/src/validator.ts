/**
 * Contract Validator
 *
 * Runtime validation for contracts
 *
 * @module @pwfabric/runtime/validator
 */

import type { Contract, Capability, ValidationResult, ValidationError } from '@pwfabric/contracts'
import { ok, err, validationError } from '@pwfabric/contracts'

// ============================================================
// VALIDATOR INTERFACE
// ============================================================

/**
 * Contract validator interface
 */
export interface ContractValidator {
  /**
   * Validate input against a contract
   */
  validateInput<T>(contract: Contract<T, unknown>, data: unknown): ValidationResult<T>

  /**
   * Validate output against a contract
   */
  validateOutput<T>(contract: Contract<unknown, T>, data: unknown): ValidationResult<T>

  /**
   * Validate a capability's contract
   */
  validateCapability(capability: Capability): ValidationResult<void>
}

// ============================================================
// RUNTIME VALIDATOR IMPLEMENTATION
// ============================================================

/**
 * Runtime contract validator
 */
export class RuntimeContractValidator implements ContractValidator {
  validateInput<T>(contract: Contract<T, unknown>, data: unknown): ValidationResult<T> {
    try {
      return contract.validateInput(data)
    } catch (error) {
      const errors: ValidationError[] = [
        validationError(
          [],
          error instanceof Error ? error.message : 'Unknown validation error',
          'validation_error'
        ),
      ]
      return err(errors)
    }
  }

  validateOutput<T>(contract: Contract<unknown, T>, data: unknown): ValidationResult<T> {
    try {
      return contract.validateOutput(data)
    } catch (error) {
      const errors: ValidationError[] = [
        validationError(
          [],
          error instanceof Error ? error.message : 'Unknown validation error',
          'validation_error'
        ),
      ]
      return err(errors)
    }
  }

  validateCapability(capability: Capability): ValidationResult<void> {
    const errors: ValidationError[] = []

    // Validate capability has required fields
    if (!capability.id) {
      errors.push(validationError(['id'], 'Capability ID is required', 'required'))
    }

    if (!capability.version) {
      errors.push(validationError(['version'], 'Capability version is required', 'required'))
    }

    if (!capability.contract) {
      errors.push(validationError(['contract'], 'Capability contract is required', 'required'))
    }

    if (!capability.execute) {
      errors.push(
        validationError(['execute'], 'Capability execute function is required', 'required')
      )
    }

    // Validate contract exists and has required methods
    if (capability.contract) {
      if (!capability.contract.validateInput) {
        errors.push(
          validationError(
            ['contract', 'validateInput'],
            'Contract validateInput method is required',
            'required'
          )
        )
      }

      if (!capability.contract.validateOutput) {
        errors.push(
          validationError(
            ['contract', 'validateOutput'],
            'Contract validateOutput method is required',
            'required'
          )
        )
      }
    }

    if (errors.length > 0) {
      return err(errors)
    }

    return ok(undefined)
  }
}

// ============================================================
// VALIDATION UTILITIES
// ============================================================

/**
 * Create a contract validator
 */
export function createValidator(): ContractValidator {
  return new RuntimeContractValidator()
}

/**
 * Validation result type guard
 */
export function isValidationSuccess<T>(
  result: ValidationResult<T>
): result is { success: true; data: T } {
  return result.success === true
}

/**
 * Validation result type guard for errors
 */
export function isValidationFailure<T>(
  result: ValidationResult<T>
): result is { success: false; error: ValidationError[] } {
  return result.success === false
}

/**
 * Format validation errors as a string
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const path = e.path.length > 0 ? `${e.path.join('.')}: ` : ''
      return `${path}${e.message} (${e.code})`
    })
    .join('\n')
}
