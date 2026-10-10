/**
 * Capability Definition Tests
 *
 * Tests for capability types, references, and resolution types
 *
 * @module @pwfabric/contracts/fabric/__tests__/capability
 */

import { describe, it, expect } from 'vitest'
import {
  capabilityRef,
  type Capability,
  type CapabilityDescriptor,
  type CapabilityRef,
  type CapabilityState,
  type CapabilityMetadata,
  type Resolution,
  type ResolutionFailure,
  type RegistrationResult,
  type RegistrationError,
  type CapabilityInput,
  type CapabilityOutput,
  type CapabilityDeps,
} from '../../fabric/capability.js'
import type { CapabilityId, ContractId, DomainId } from '../../core/ids.js'
import type { SemanticVersion } from '../../core/version.js'

describe('capabilityRef', () => {
  it('should create a capability reference', () => {
    const id = 'auth/login' as CapabilityId
    const version: SemanticVersion = { major: 1, minor: 0, patch: 0 }

    const ref = capabilityRef(id, version)

    expect(ref).toEqual({
      id: 'auth/login',
      version: { major: 1, minor: 0, patch: 0 },
    })
  })

  it('should create reference with prerelease version', () => {
    const id = 'payments/process' as CapabilityId
    const version: SemanticVersion = { major: 2, minor: 0, patch: 0, prerelease: 'beta' }

    const ref = capabilityRef(id, version)

    expect(ref.id).toBe('payments/process')
    expect(ref.version.prerelease).toBe('beta')
  })
})

describe('CapabilityState', () => {
  it('should accept all valid capability states', () => {
    const states: CapabilityState[] = ['draft', 'alpha', 'beta', 'stable', 'deprecated']

    expect(states).toHaveLength(5)
    states.forEach((state) => {
      expect(typeof state).toBe('string')
    })
  })
})

describe('CapabilityMetadata', () => {
  it('should accept minimal metadata', () => {
    const metadata: CapabilityMetadata = {
      name: 'Login',
      state: 'stable',
    }

    expect(metadata.name).toBe('Login')
    expect(metadata.state).toBe('stable')
  })

  it('should accept full metadata', () => {
    const metadata: CapabilityMetadata = {
      name: 'Login',
      description: 'User authentication capability',
      state: 'stable',
      domain: 'auth/core' as DomainId,
      tags: ['auth', 'security'],
      timeout: 5000,
      retryable: true,
      idempotent: false,
    }

    expect(metadata.description).toBe('User authentication capability')
    expect(metadata.tags).toContain('auth')
    expect(metadata.timeout).toBe(5000)
    expect(metadata.retryable).toBe(true)
    expect(metadata.idempotent).toBe(false)
  })

  it('should accept deprecated metadata', () => {
    const metadata: CapabilityMetadata = {
      name: 'OldLogin',
      state: 'deprecated',
      deprecated: {
        since: '2.0.0',
        message: 'Use auth/login-v2 instead',
        replacement: 'auth/login-v2' as CapabilityId,
      },
    }

    expect(metadata.deprecated?.since).toBe('2.0.0')
    expect(metadata.deprecated?.replacement).toBe('auth/login-v2')
  })
})

describe('Resolution types', () => {
  describe('Resolution success', () => {
    it('should represent found capability', () => {
      const resolution: Resolution<unknown> = {
        found: true,
        capability: {} as unknown as Capability<
          CapabilityId,
          unknown,
          unknown,
          readonly CapabilityId[]
        >,
      }

      expect(resolution.found).toBe(true)
    })
  })

  describe('Resolution failure', () => {
    it('should represent not_found failure', () => {
      const failure: ResolutionFailure = {
        type: 'not_found',
        id: 'auth/missing' as CapabilityId,
      }

      expect(failure.type).toBe('not_found')
      expect(failure.id).toBe('auth/missing')
    })

    it('should represent version_mismatch failure', () => {
      const failure: ResolutionFailure = {
        type: 'version_mismatch',
        id: 'auth/login' as CapabilityId,
        required: { major: 2, minor: 0, patch: 0 },
        available: { major: 1, minor: 0, patch: 0 },
      }

      expect(failure.type).toBe('version_mismatch')
      expect(failure.required.major).toBe(2)
      expect(failure.available.major).toBe(1)
    })

    it('should represent dependency_missing failure', () => {
      const failure: ResolutionFailure = {
        type: 'dependency_missing',
        id: 'auth/login' as CapabilityId,
        missing: 'db/connection' as CapabilityId,
      }

      expect(failure.type).toBe('dependency_missing')
      expect(failure.missing).toBe('db/connection')
    })
  })
})

describe('Registration types', () => {
  describe('RegistrationResult success', () => {
    it('should represent successful registration', () => {
      const result: RegistrationResult<unknown> = {
        success: true,
        capability: {} as unknown as Capability<
          CapabilityId,
          unknown,
          unknown,
          readonly CapabilityId[]
        >,
      }

      expect(result.success).toBe(true)
    })
  })

  describe('RegistrationError types', () => {
    it('should represent already_registered error', () => {
      const error: RegistrationError = {
        type: 'already_registered',
        id: 'auth/login' as CapabilityId,
      }

      expect(error.type).toBe('already_registered')
    })

    it('should represent invalid_contract error', () => {
      const error: RegistrationError = {
        type: 'invalid_contract',
        id: 'auth/login' as CapabilityId,
        message: 'Contract schema is invalid',
      }

      expect(error.type).toBe('invalid_contract')
      expect(error.message).toBe('Contract schema is invalid')
    })

    it('should represent missing_dependency error', () => {
      const error: RegistrationError = {
        type: 'missing_dependency',
        id: 'auth/login' as CapabilityId,
        missing: 'db/connection' as CapabilityId,
      }

      expect(error.type).toBe('missing_dependency')
      expect(error.missing).toBe('db/connection')
    })

    it('should represent circular_dependency error', () => {
      const error: RegistrationError = {
        type: 'circular_dependency',
        cycle: ['a/b', 'b/c', 'c/a'] as CapabilityId[],
      }

      expect(error.type).toBe('circular_dependency')
      expect(error.cycle).toHaveLength(3)
    })

    it('should represent version_conflict error', () => {
      const error: RegistrationError = {
        type: 'version_conflict',
        id: 'auth/login' as CapabilityId,
        existing: { major: 1, minor: 0, patch: 0 },
        new: { major: 1, minor: 0, patch: 1 },
      }

      expect(error.type).toBe('version_conflict')
      expect(error.existing.patch).toBe(0)
      expect(error.new.patch).toBe(1)
    })
  })
})

describe('CapabilityDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: CapabilityDescriptor<{ email: string }, { token: string }> = {
      id: 'auth/login',
      version: '1.0.0',
      contractRef: {
        id: 'auth/login-contract' as ContractId,
        version: { major: 1, minor: 0, patch: 0 },
      },
      metadata: {
        name: 'Login',
        state: 'stable',
      },
      execute: async () => ({ token: 'abc' }),
    }

    expect(descriptor.id).toBe('auth/login')
    expect(descriptor.version).toBe('1.0.0')
  })

  it('should accept descriptor with dependencies', () => {
    const descriptor: CapabilityDescriptor = {
      id: 'payments/process',
      version: '2.0.0',
      contractRef: {
        id: 'payments/process-contract' as ContractId,
        version: { major: 2, minor: 0, patch: 0 },
      },
      dependencies: ['auth/validate', 'db/transaction'],
      metadata: {
        name: 'Process Payment',
        state: 'stable',
      },
      execute: async () => ({}),
    }

    expect(descriptor.dependencies).toContain('auth/validate')
    expect(descriptor.dependencies).toContain('db/transaction')
  })
})

describe('CapabilityRef', () => {
  it('should have correct structure', () => {
    const ref: CapabilityRef = {
      id: 'auth/login' as CapabilityId,
      version: { major: 1, minor: 2, patch: 3 },
    }

    expect(ref.id).toBe('auth/login')
    expect(ref.version.major).toBe(1)
    expect(ref.version.minor).toBe(2)
    expect(ref.version.patch).toBe(3)
  })
})

describe('Type utilities', () => {
  // These tests verify the type utilities compile correctly
  // The actual type extraction is compile-time only

  it('should have CapabilityInput type utility', () => {
    // Type-level test: this should compile
    type TestInput = CapabilityInput<Capability<CapabilityId, { name: string }, unknown, []>>
    const input: TestInput = { name: 'test' }
    expect(input.name).toBe('test')
  })

  it('should have CapabilityOutput type utility', () => {
    // Type-level test: this should compile
    type TestOutput = CapabilityOutput<Capability<CapabilityId, unknown, { result: boolean }, []>>
    const output: TestOutput = { result: true }
    expect(output.result).toBe(true)
  })

  it('should have CapabilityDeps type utility', () => {
    // Type-level test: this should compile
    type TestDeps = CapabilityDeps<
      Capability<CapabilityId, unknown, unknown, readonly [CapabilityId, CapabilityId]>
    >
    const deps: TestDeps = ['a/b', 'c/d'] as const as TestDeps
    expect(deps).toHaveLength(2)
  })
})
