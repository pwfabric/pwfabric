/**
 * Domain Definition Tests
 *
 * Tests for domain types and boundary checking
 *
 * @module @pwfabric/contracts/fabric/__tests__/domain
 */

import { describe, it, expect } from 'vitest'
import {
  checkDomainBoundary,
  type Domain,
  type DomainDescriptor,
  type DomainMetadata,
  type DomainRegistrationResult,
  type DomainRegistrationError,
  type DomainDependencyValidation,
  type DomainCycle,
  type CapabilityVisibility,
  type CapabilityVisibilityDeclaration,
  type DomainBoundaryCheck,
  type DomainBoundaryViolation,
} from '../../fabric/domain.js'
import type { CapabilityId, DomainId, OwnerId } from '../../core/ids.js'

// Helper to create a mock domain
function createMockDomain(overrides: Partial<Domain> = {}): Domain {
  return {
    id: 'test/domain' as DomainId,
    version: { major: 1, minor: 0, patch: 0 },
    owner: 'owner-1' as OwnerId,
    metadata: { name: 'Test Domain' },
    capabilities: [],
    exports: [],
    dependencies: [],
    contains: (id) => overrides.capabilities?.includes(id) ?? false,
    isExported: (id) => overrides.exports?.includes(id) ?? false,
    isInternal: (id) =>
      (overrides.capabilities?.includes(id) ?? false) &&
      !(overrides.exports?.includes(id) ?? false),
    qualify: (name) => `test/domain/${name}` as CapabilityId,
    ...overrides,
  }
}

describe('checkDomainBoundary', () => {
  it('should allow access within same domain', () => {
    const domain = createMockDomain({
      id: 'auth/core' as DomainId,
      capabilities: ['auth/core/login', 'auth/core/logout'] as CapabilityId[],
    })

    const result = checkDomainBoundary(domain, domain, 'auth/core/login' as CapabilityId)

    expect(result.allowed).toBe(true)
  })

  it('should deny access when dependency is missing', () => {
    const fromDomain = createMockDomain({
      id: 'payments/core' as DomainId,
      dependencies: [], // No dependencies
    })
    const toDomain = createMockDomain({
      id: 'auth/core' as DomainId,
      exports: ['auth/core/validate'] as CapabilityId[],
    })

    const result = checkDomainBoundary(fromDomain, toDomain, 'auth/core/validate' as CapabilityId)

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason.type).toBe('missing_dependency')
      if (result.reason.type === 'missing_dependency') {
        expect(result.reason.from).toBe('payments/core')
        expect(result.reason.to).toBe('auth/core')
      }
    }
  })

  it('should deny access to internal capability', () => {
    const fromDomain = createMockDomain({
      id: 'payments/core' as DomainId,
      dependencies: ['auth/core'] as DomainId[],
    })
    const toDomain = createMockDomain({
      id: 'auth/core' as DomainId,
      capabilities: ['auth/core/internal-helper'] as CapabilityId[],
      exports: [], // Not exported
      isExported: () => false,
    })

    const result = checkDomainBoundary(
      fromDomain,
      toDomain,
      'auth/core/internal-helper' as CapabilityId
    )

    expect(result.allowed).toBe(false)
    if (!result.allowed) {
      expect(result.reason.type).toBe('internal_access')
      if (result.reason.type === 'internal_access') {
        expect(result.reason.from).toBe('payments/core')
        expect(result.reason.to).toBe('auth/core')
        expect(result.reason.capability).toBe('auth/core/internal-helper')
      }
    }
  })

  it('should allow access to exported capability with dependency', () => {
    const fromDomain = createMockDomain({
      id: 'payments/core' as DomainId,
      dependencies: ['auth/core'] as DomainId[],
    })
    const toDomain = createMockDomain({
      id: 'auth/core' as DomainId,
      capabilities: ['auth/core/validate'] as CapabilityId[],
      exports: ['auth/core/validate'] as CapabilityId[],
      isExported: (id) => id === ('auth/core/validate' as CapabilityId),
    })

    const result = checkDomainBoundary(fromDomain, toDomain, 'auth/core/validate' as CapabilityId)

    expect(result.allowed).toBe(true)
  })
})

describe('DomainMetadata', () => {
  it('should accept minimal metadata', () => {
    const metadata: DomainMetadata = {
      name: 'Auth Domain',
    }

    expect(metadata.name).toBe('Auth Domain')
  })

  it('should accept full metadata', () => {
    const metadata: DomainMetadata = {
      name: 'Auth Domain',
      description: 'Authentication and authorization domain',
      tags: ['auth', 'security', 'core'],
    }

    expect(metadata.description).toBe('Authentication and authorization domain')
    expect(metadata.tags).toContain('security')
  })
})

describe('DomainDescriptor', () => {
  it('should accept minimal descriptor', () => {
    const descriptor: DomainDescriptor = {
      id: 'auth/core',
      version: '1.0.0',
      owner: 'team-auth',
      metadata: { name: 'Auth Core' },
    }

    expect(descriptor.id).toBe('auth/core')
    expect(descriptor.owner).toBe('team-auth')
  })

  it('should accept full descriptor', () => {
    const descriptor: DomainDescriptor = {
      id: 'auth/core',
      version: '1.0.0',
      owner: 'team-auth',
      metadata: { name: 'Auth Core' },
      capabilities: ['login', 'logout', 'validate'],
      exports: ['login', 'validate'],
      dependencies: ['db/core', 'cache/core'],
    }

    expect(descriptor.capabilities).toHaveLength(3)
    expect(descriptor.exports).toHaveLength(2)
    expect(descriptor.dependencies).toContain('db/core')
  })
})

describe('DomainRegistrationResult', () => {
  it('should represent successful registration', () => {
    const result: DomainRegistrationResult = {
      success: true,
      domain: createMockDomain(),
    }

    expect(result.success).toBe(true)
  })

  it('should represent failed registration', () => {
    const result: DomainRegistrationResult = {
      success: false,
      error: {
        type: 'already_registered',
        id: 'auth/core' as DomainId,
      },
    }

    expect(result.success).toBe(false)
  })
})

describe('DomainRegistrationError', () => {
  it('should represent already_registered error', () => {
    const error: DomainRegistrationError = {
      type: 'already_registered',
      id: 'auth/core' as DomainId,
    }

    expect(error.type).toBe('already_registered')
  })

  it('should represent invalid_owner error', () => {
    const error: DomainRegistrationError = {
      type: 'invalid_owner',
      id: 'auth/core' as DomainId,
      owner: 'invalid-owner' as OwnerId,
    }

    expect(error.type).toBe('invalid_owner')
  })

  it('should represent missing_dependency error', () => {
    const error: DomainRegistrationError = {
      type: 'missing_dependency',
      id: 'payments/core' as DomainId,
      missing: 'auth/core' as DomainId,
    }

    expect(error.type).toBe('missing_dependency')
    expect(error.missing).toBe('auth/core')
  })

  it('should represent circular_dependency error', () => {
    const error: DomainRegistrationError = {
      type: 'circular_dependency',
      cycle: ['a/domain', 'b/domain', 'c/domain', 'a/domain'] as DomainId[],
    }

    expect(error.type).toBe('circular_dependency')
    expect(error.cycle).toHaveLength(4)
  })
})

describe('DomainDependencyValidation', () => {
  it('should represent valid dependencies', () => {
    const validation: DomainDependencyValidation = { valid: true }

    expect(validation.valid).toBe(true)
  })

  it('should represent invalid dependencies with cycles', () => {
    const validation: DomainDependencyValidation = {
      valid: false,
      cycles: [{ domains: ['a/d', 'b/d', 'a/d'] as DomainId[] }],
    }

    expect(validation.valid).toBe(false)
    if (!validation.valid) {
      expect(validation.cycles).toHaveLength(1)
    }
  })
})

describe('DomainCycle', () => {
  it('should represent a dependency cycle', () => {
    const cycle: DomainCycle = {
      domains: ['auth/core', 'payments/core', 'users/core', 'auth/core'] as DomainId[],
    }

    expect(cycle.domains).toHaveLength(4)
    expect(cycle.domains[0]).toBe(cycle.domains[3]) // Cycle back to start
  })
})

describe('CapabilityVisibility', () => {
  it('should accept valid visibility values', () => {
    const visibilities: CapabilityVisibility[] = ['public', 'internal']

    expect(visibilities).toHaveLength(2)
  })
})

describe('CapabilityVisibilityDeclaration', () => {
  it('should declare public visibility', () => {
    const declaration: CapabilityVisibilityDeclaration = {
      capabilityId: 'auth/core/login' as CapabilityId,
      visibility: 'public',
    }

    expect(declaration.visibility).toBe('public')
  })

  it('should declare internal visibility', () => {
    const declaration: CapabilityVisibilityDeclaration = {
      capabilityId: 'auth/core/internal-validate' as CapabilityId,
      visibility: 'internal',
    }

    expect(declaration.visibility).toBe('internal')
  })
})

describe('DomainBoundaryCheck', () => {
  it('should represent allowed access', () => {
    const check: DomainBoundaryCheck = { allowed: true }

    expect(check.allowed).toBe(true)
  })

  it('should represent denied access with reason', () => {
    const check: DomainBoundaryCheck = {
      allowed: false,
      reason: {
        type: 'internal_access',
        from: 'payments/core' as DomainId,
        to: 'auth/core' as DomainId,
        capability: 'auth/core/internal' as CapabilityId,
      },
    }

    expect(check.allowed).toBe(false)
  })
})

describe('DomainBoundaryViolation', () => {
  it('should represent internal_access violation', () => {
    const violation: DomainBoundaryViolation = {
      type: 'internal_access',
      from: 'payments/core' as DomainId,
      to: 'auth/core' as DomainId,
      capability: 'auth/core/internal' as CapabilityId,
    }

    expect(violation.type).toBe('internal_access')
  })

  it('should represent missing_dependency violation', () => {
    const violation: DomainBoundaryViolation = {
      type: 'missing_dependency',
      from: 'payments/core' as DomainId,
      to: 'auth/core' as DomainId,
    }

    expect(violation.type).toBe('missing_dependency')
  })

  it('should represent circular_dependency violation', () => {
    const violation: DomainBoundaryViolation = {
      type: 'circular_dependency',
      from: 'a/domain' as DomainId,
      to: 'b/domain' as DomainId,
    }

    expect(violation.type).toBe('circular_dependency')
  })
})
