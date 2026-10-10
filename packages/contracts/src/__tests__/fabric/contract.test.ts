/**
 * Contract Definition Tests
 *
 * Tests for contract types and helper functions
 *
 * @module @pwfabric/contracts/fabric/__tests__/contract
 */

import { describe, it, expect } from 'vitest'
import {
  contractRef,
  type Contract,
  type ContractDescriptor,
  type ContractRef,
  type ContractState,
  type ContractMetadata,
  type ContractError,
  type SerializedContract,
  type ContractInput,
  type ContractOutput,
  type ContractErrors,
} from '../../fabric/contract.js'
import type { ContractId } from '../../core/ids.js'
import type { SemanticVersion } from '../../core/version.js'

describe('contractRef', () => {
  it('should create a contract reference', () => {
    const id = 'auth/login-contract' as ContractId
    const version: SemanticVersion = { major: 1, minor: 0, patch: 0 }

    const ref = contractRef(id, version)

    expect(ref).toEqual({
      id: 'auth/login-contract',
      version: { major: 1, minor: 0, patch: 0 },
    })
  })

  it('should create reference with prerelease version', () => {
    const id = 'payments/process-contract' as ContractId
    const version: SemanticVersion = { major: 2, minor: 1, patch: 0, prerelease: 'beta.1' }

    const ref = contractRef(id, version)

    expect(ref.id).toBe('payments/process-contract')
    expect(ref.version.major).toBe(2)
    expect(ref.version.minor).toBe(1)
    expect(ref.version.prerelease).toBe('beta.1')
  })

  it('should create reference with build metadata', () => {
    const id = 'api/v2-contract' as ContractId
    const version: SemanticVersion = { major: 3, minor: 0, patch: 0, build: '20240115' }

    const ref = contractRef(id, version)

    expect(ref.id).toBe('api/v2-contract')
    expect(ref.version.build).toBe('20240115')
  })
})

describe('ContractState', () => {
  it('should accept all valid contract states', () => {
    const states: ContractState[] = ['draft', 'alpha', 'beta', 'rc', 'stable', 'deprecated']

    expect(states).toHaveLength(6)
    states.forEach((state) => {
      expect(typeof state).toBe('string')
    })
  })
})

describe('ContractMetadata', () => {
  it('should accept minimal metadata', () => {
    const metadata: ContractMetadata = {
      name: 'Login Contract',
      state: 'stable',
    }

    expect(metadata.name).toBe('Login Contract')
    expect(metadata.state).toBe('stable')
  })

  it('should accept full metadata', () => {
    const metadata: ContractMetadata = {
      name: 'Login Contract',
      description: 'Contract for user authentication',
      state: 'stable',
      tags: ['auth', 'security', 'core'],
    }

    expect(metadata.description).toBe('Contract for user authentication')
    expect(metadata.tags).toContain('auth')
    expect(metadata.tags).toHaveLength(3)
  })

  it('should accept deprecated metadata', () => {
    const metadata: ContractMetadata = {
      name: 'OldLogin Contract',
      state: 'deprecated',
      deprecated: {
        since: '2.0.0',
        message: 'Use auth/login-v2-contract instead',
        replacement: 'auth/login-v2-contract' as ContractId,
      },
    }

    expect(metadata.state).toBe('deprecated')
    expect(metadata.deprecated?.since).toBe('2.0.0')
    expect(metadata.deprecated?.replacement).toBe('auth/login-v2-contract')
  })
})

describe('ContractError', () => {
  it('should accept minimal error', () => {
    const error: ContractError = {
      code: 'INVALID_INPUT',
      message: 'Invalid input provided',
    }

    expect(error.code).toBe('INVALID_INPUT')
    expect(error.message).toBe('Invalid input provided')
  })

  it('should accept error with details', () => {
    const error: ContractError = {
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: {
        field: 'email',
        reason: 'Invalid format',
        provided: 'not-an-email',
      },
    }

    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details?.field).toBe('email')
  })
})

describe('ContractDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: ContractDescriptor = {
      id: 'auth/login-contract',
      version: '1.0.0',
      metadata: {
        name: 'Login Contract',
        state: 'stable',
      },
      inputSchema: {} as never,
      outputSchema: {} as never,
    }

    expect(descriptor.id).toBe('auth/login-contract')
    expect(descriptor.version).toBe('1.0.0')
  })

  it('should accept descriptor with error schemas', () => {
    const descriptor: ContractDescriptor = {
      id: 'payments/process-contract',
      version: '2.0.0',
      metadata: {
        name: 'Process Payment Contract',
        state: 'stable',
      },
      inputSchema: {} as never,
      outputSchema: {} as never,
      errorSchemas: [{} as never, {} as never],
    }

    expect(descriptor.errorSchemas).toHaveLength(2)
  })
})

describe('ContractRef', () => {
  it('should have correct structure', () => {
    const ref: ContractRef = {
      id: 'auth/login-contract' as ContractId,
      version: { major: 1, minor: 2, patch: 3 },
    }

    expect(ref.id).toBe('auth/login-contract')
    expect(ref.version.major).toBe(1)
    expect(ref.version.minor).toBe(2)
    expect(ref.version.patch).toBe(3)
  })
})

describe('SerializedContract', () => {
  it('should accept serialized contract structure', () => {
    const serialized: SerializedContract = {
      id: 'auth/login-contract',
      version: '1.0.0',
      metadata: {
        name: 'Login Contract',
        state: 'stable',
      },
      input: { type: 'object', properties: {} },
      output: { type: 'object', properties: {} },
      errors: [],
    }

    expect(serialized.id).toBe('auth/login-contract')
    expect(serialized.version).toBe('1.0.0')
  })
})

describe('Type utilities', () => {
  it('should have ContractInput type utility', () => {
    type TestContract = Contract<{ email: string }, { token: string }>
    type TestInput = ContractInput<TestContract>
    const input: TestInput = { email: 'test@example.com' }
    expect(input.email).toBe('test@example.com')
  })

  it('should have ContractOutput type utility', () => {
    type TestContract = Contract<{ email: string }, { token: string }>
    type TestOutput = ContractOutput<TestContract>
    const output: TestOutput = { token: 'abc123' }
    expect(output.token).toBe('abc123')
  })

  it('should have ContractErrors type utility', () => {
    type TestContract = Contract<unknown, unknown, ContractError>
    type TestErrors = ContractErrors<TestContract>
    const error: TestErrors = { code: 'ERROR', message: 'Test error' }
    expect(error.code).toBe('ERROR')
  })
})
