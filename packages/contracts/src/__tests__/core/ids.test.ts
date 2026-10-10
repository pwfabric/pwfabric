/**
 * Identity and Addressing Primitives Tests
 *
 * Tests for ID generation, validation, and parsing
 *
 * @module @pwfabric/contracts/core/__tests__/ids
 */

import { describe, it, expect } from 'vitest'
import {
  fabricId,
  capabilityId,
  contractId,
  surfaceId,
  manifestationId,
  domainId,
  ownerId,
  listingId,
  publisherId,
  artifactId,
  isValidId,
  parseId,
  ID_PATTERN,
  type FabricId,
  type CapabilityId,
  type ContractId,
  type SurfaceId,
  type ManifestationId,
  type DomainId,
  type OwnerId,
  type ListingId,
  type PublisherId,
  type ArtifactId,
} from '../../core/ids.js'

describe('ID Constructors', () => {
  describe('fabricId', () => {
    it('should create a FabricId from string', () => {
      const id = fabricId('auth/login')
      expect(id).toBe('auth/login')
    })

    it('should preserve the branded type', () => {
      const id: FabricId = fabricId('test/fabric')
      expect(typeof id).toBe('string')
    })
  })

  describe('capabilityId', () => {
    it('should create a CapabilityId from string', () => {
      const id = capabilityId('payments/process')
      expect(id).toBe('payments/process')
    })

    it('should preserve the branded type', () => {
      const id: CapabilityId = capabilityId('test/capability')
      expect(typeof id).toBe('string')
    })
  })

  describe('contractId', () => {
    it('should create a ContractId from string', () => {
      const id = contractId('api/user-create')
      expect(id).toBe('api/user-create')
    })

    it('should preserve the branded type', () => {
      const id: ContractId = contractId('test/contract')
      expect(typeof id).toBe('string')
    })
  })

  describe('surfaceId', () => {
    it('should create a SurfaceId from string', () => {
      const id = surfaceId('web/dashboard')
      expect(id).toBe('web/dashboard')
    })

    it('should preserve the branded type', () => {
      const id: SurfaceId = surfaceId('test/surface')
      expect(typeof id).toBe('string')
    })
  })

  describe('manifestationId', () => {
    it('should create a ManifestationId from string', () => {
      const id = manifestationId('render/button')
      expect(id).toBe('render/button')
    })

    it('should preserve the branded type', () => {
      const id: ManifestationId = manifestationId('test/manifestation')
      expect(typeof id).toBe('string')
    })
  })

  describe('domainId', () => {
    it('should create a DomainId from string', () => {
      const id = domainId('commerce/orders')
      expect(id).toBe('commerce/orders')
    })

    it('should preserve the branded type', () => {
      const id: DomainId = domainId('test/domain')
      expect(typeof id).toBe('string')
    })
  })

  describe('ownerId', () => {
    it('should create an OwnerId from string', () => {
      const id = ownerId('users/admin')
      expect(id).toBe('users/admin')
    })

    it('should preserve the branded type', () => {
      const id: OwnerId = ownerId('test/owner')
      expect(typeof id).toBe('string')
    })
  })

  describe('listingId', () => {
    it('should create a ListingId from string', () => {
      const id = listingId('marketplace/hero-block')
      expect(id).toBe('marketplace/hero-block')
    })

    it('should preserve the branded type', () => {
      const id: ListingId = listingId('test/listing')
      expect(typeof id).toBe('string')
    })
  })

  describe('publisherId', () => {
    it('should create a PublisherId from string', () => {
      const id = publisherId('publishers/acme')
      expect(id).toBe('publishers/acme')
    })

    it('should preserve the branded type', () => {
      const id: PublisherId = publisherId('test/publisher')
      expect(typeof id).toBe('string')
    })
  })

  describe('artifactId', () => {
    it('should create an ArtifactId from string', () => {
      const id = artifactId('artifacts/hero-block-v1')
      expect(id).toBe('artifacts/hero-block-v1')
    })

    it('should preserve the branded type', () => {
      const id: ArtifactId = artifactId('test/artifact')
      expect(typeof id).toBe('string')
    })
  })
})

describe('ID_PATTERN', () => {
  it('should match simple namespace/name format', () => {
    expect(ID_PATTERN.test('auth/login')).toBe(true)
    expect(ID_PATTERN.test('payments/process')).toBe(true)
    expect(ID_PATTERN.test('core/validate')).toBe(true)
  })

  it('should match IDs with version suffix', () => {
    expect(ID_PATTERN.test('auth/login@1.0.0')).toBe(true)
    expect(ID_PATTERN.test('payments/process@2.3.4')).toBe(true)
    expect(ID_PATTERN.test('core/validate@0.1.0')).toBe(true)
  })

  it('should match IDs with prerelease version', () => {
    expect(ID_PATTERN.test('auth/login@1.0.0-alpha')).toBe(true)
    expect(ID_PATTERN.test('payments/process@2.0.0-beta.1')).toBe(true)
    expect(ID_PATTERN.test('core/validate@1.0.0-rc.2')).toBe(true)
  })

  it('should match IDs with hyphens in namespace/name', () => {
    expect(ID_PATTERN.test('my-auth/user-login')).toBe(true)
    expect(ID_PATTERN.test('payment-gateway/process-payment')).toBe(true)
  })

  it('should match IDs with numbers', () => {
    expect(ID_PATTERN.test('auth2/login3')).toBe(true)
    expect(ID_PATTERN.test('v1/endpoint')).toBe(true)
  })

  it('should reject invalid formats', () => {
    expect(ID_PATTERN.test('')).toBe(false)
    expect(ID_PATTERN.test('noslash')).toBe(false)
    expect(ID_PATTERN.test('/leading-slash')).toBe(false)
    expect(ID_PATTERN.test('trailing-slash/')).toBe(false)
    expect(ID_PATTERN.test('too/many/slashes')).toBe(false)
  })

  it('should reject IDs starting with numbers', () => {
    expect(ID_PATTERN.test('1auth/login')).toBe(false)
    expect(ID_PATTERN.test('auth/1login')).toBe(false)
  })

  it('should reject IDs with invalid characters', () => {
    expect(ID_PATTERN.test('auth_ns/login')).toBe(false)
    expect(ID_PATTERN.test('auth/login_name')).toBe(false)
    expect(ID_PATTERN.test('auth/login name')).toBe(false)
  })
})

describe('isValidId', () => {
  it('should return true for valid IDs', () => {
    expect(isValidId('auth/login')).toBe(true)
    expect(isValidId('payments/process@1.0.0')).toBe(true)
    expect(isValidId('core/validate@1.0.0-beta')).toBe(true)
  })

  it('should return false for invalid IDs', () => {
    expect(isValidId('')).toBe(false)
    expect(isValidId('invalid')).toBe(false)
    expect(isValidId('1invalid/id')).toBe(false)
  })
})

describe('parseId', () => {
  it('should parse simple namespace/name IDs', () => {
    const result = parseId('auth/login')

    expect(result).toEqual({
      namespace: 'auth',
      name: 'login',
    })
  })

  it('should parse IDs with version', () => {
    const result = parseId('payments/process@1.2.3')

    expect(result).toEqual({
      namespace: 'payments',
      name: 'process',
      version: '1.2.3',
    })
  })

  it('should parse IDs with prerelease version', () => {
    const result = parseId('core/validate@2.0.0-alpha.1')

    expect(result).toEqual({
      namespace: 'core',
      name: 'validate',
      version: '2.0.0-alpha.1',
    })
  })

  it('should parse IDs with hyphens', () => {
    const result = parseId('my-namespace/my-capability')

    expect(result).toEqual({
      namespace: 'my-namespace',
      name: 'my-capability',
    })
  })

  it('should return null for invalid IDs', () => {
    expect(parseId('')).toBeNull()
    expect(parseId('invalid')).toBeNull()
    expect(parseId('no/slash/here/too-many')).toBeNull()
  })

  it('should return null for IDs starting with numbers', () => {
    expect(parseId('1auth/login')).toBeNull()
    expect(parseId('auth/1login')).toBeNull()
  })

  it('should handle edge cases', () => {
    expect(parseId('a/b')).toEqual({ namespace: 'a', name: 'b' })
    expect(parseId('a/b@0.0.1')).toEqual({ namespace: 'a', name: 'b', version: '0.0.1' })
  })
})
