/**
 * RuntimeContractValidator Tests
 *
 * Runtime contract validation.
 *
 * @module @pwfabric/runtime/__tests__/validator
 */

import { describe, it, expect } from 'vitest'
import {
  RuntimeContractValidator,
  createValidator,
  isValidationSuccess,
  isValidationFailure,
  formatValidationErrors,
} from '../validator.js'
import type { Contract } from '@pwfabric/contracts'
import { ok, err, validationError } from '@pwfabric/contracts'
import type { ContractId } from '@pwfabric/contracts'

// ============================================================
// HELPERS
// ============================================================

function makeContract(overrides?: Partial<Contract>): Contract {
  return {
    id: 'test-contract' as ContractId,
    version: '1.0.0',
    metadata: { name: 'Test Contract', state: 'stable' },
    inputSchema: { type: 'object', properties: {} } as never,
    outputSchema: { type: 'object', properties: {} } as never,
    validateInput: (data: unknown) => ok(data as never),
    validateOutput: (data: unknown) => ok(data as never),
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function makeCapability() {
  const contract = makeContract()
  return {
    id: 'cap-test' as never,
    version: '1.0.0',
    contract,
    dependencies: [] as readonly never[],
    metadata: { name: 'Test Cap', state: 'stable' as const },
    execute: async () => ok({}),
  }
}

// ============================================================
// RuntimeContractValidator
// ============================================================

describe('RuntimeContractValidator', () => {
  const validator = new RuntimeContractValidator()

  describe('validateInput()', () => {
    it('returns ok when contract.validateInput succeeds', () => {
      const contract = makeContract({
        validateInput: () => ok({ parsed: true } as never),
      })
      const result = validator.validateInput(contract, { x: 1 })
      expect(result.success).toBe(true)
    })

    it('returns err when contract.validateInput returns error', () => {
      const contract = makeContract({
        validateInput: () => err([validationError(['x'], 'required', 'required')]),
      })
      const result = validator.validateInput(contract, {})
      expect(result.success).toBe(false)
    })

    it('catches thrown errors from validateInput', () => {
      const contract = makeContract({
        validateInput: () => {
          throw new Error('schema exploded')
        },
      })
      const result = validator.validateInput(contract, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error[0]?.message).toContain('schema exploded')
      }
    })

    it('wraps non-Error throws', () => {
      const contract = makeContract({
        validateInput: () => {
          throw new Error('raw string error')
        },
      })
      const result = validator.validateInput(contract, {})
      expect(result.success).toBe(false)
    })
  })

  describe('validateOutput()', () => {
    it('returns ok when contract.validateOutput succeeds', () => {
      const contract = makeContract({
        validateOutput: () => ok({ result: 'good' } as never),
      })
      const result = validator.validateOutput(contract, { result: 'good' })
      expect(result.success).toBe(true)
    })

    it('catches thrown errors from validateOutput', () => {
      const contract = makeContract({
        validateOutput: () => {
          throw new Error('output error')
        },
      })
      const result = validator.validateOutput(contract, {})
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error[0]?.message).toContain('output error')
      }
    })
  })

  describe('validateCapability()', () => {
    it('returns ok for a valid capability', () => {
      const cap = makeCapability()
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(true)
    })

    it('returns error when id is missing', () => {
      const cap = { ...makeCapability(), id: '' as never }
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(false)
    })

    it('returns error when version is missing', () => {
      const cap = { ...makeCapability(), version: '' as never }
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(false)
    })

    it('returns error when contract is missing', () => {
      const cap = { ...makeCapability(), contract: null as never }
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(false)
    })

    it('returns error when execute is missing', () => {
      const cap = { ...makeCapability(), execute: null as never }
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(false)
    })

    it('returns error when contract.validateInput is missing', () => {
      const contract = makeContract({ validateInput: null as never })
      const cap = { ...makeCapability(), contract }
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(false)
    })

    it('returns error when contract.validateOutput is missing', () => {
      const contract = makeContract({ validateOutput: null as never })
      const cap = { ...makeCapability(), contract }
      const result = validator.validateCapability(cap)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================
// createValidator
// ============================================================

describe('createValidator()', () => {
  it('returns a RuntimeContractValidator instance', () => {
    const v = createValidator()
    expect(v).toBeInstanceOf(RuntimeContractValidator)
  })
})

// ============================================================
// Type guards
// ============================================================

describe('isValidationSuccess()', () => {
  it('returns true for ok result', () => {
    expect(isValidationSuccess(ok(42 as never))).toBe(true)
  })

  it('returns false for err result', () => {
    expect(isValidationSuccess(err([]))).toBe(false)
  })
})

describe('isValidationFailure()', () => {
  it('returns true for err result', () => {
    expect(isValidationFailure(err([]))).toBe(true)
  })

  it('returns false for ok result', () => {
    expect(isValidationFailure(ok(42 as never))).toBe(false)
  })
})

// ============================================================
// formatValidationErrors
// ============================================================

describe('formatValidationErrors()', () => {
  it('formats errors with path', () => {
    const errors = [validationError(['user', 'email'], 'is required', 'required')]
    const formatted = formatValidationErrors(errors)
    expect(formatted).toContain('user.email')
    expect(formatted).toContain('is required')
    expect(formatted).toContain('required')
  })

  it('formats errors without path', () => {
    const errors = [validationError([], 'general error', 'invalid')]
    const formatted = formatValidationErrors(errors)
    expect(formatted).toContain('general error')
    expect(formatted).not.toContain(': ')
  })

  it('joins multiple errors with newline', () => {
    const errors = [
      validationError(['a'], 'err1', 'required'),
      validationError(['b'], 'err2', 'required'),
    ]
    const formatted = formatValidationErrors(errors)
    expect(formatted.split('\n')).toHaveLength(2)
  })
})
