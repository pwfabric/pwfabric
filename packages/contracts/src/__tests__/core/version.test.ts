/**
 * Semantic Versioning Tests
 *
 * Tests for version parsing, comparison, and compatibility
 *
 * @module @pwfabric/contracts/core/__tests__/version
 */

import { describe, it, expect } from 'vitest'
import {
  parseVersion,
  versionToString,
  isValidVersion,
  compareVersions,
  isCompatible,
  INITIAL_VERSION,
  STABLE_VERSION,
  type SemanticVersion,
} from '../../core/version.js'

describe('parseVersion', () => {
  it('should parse simple version strings', () => {
    const result = parseVersion('1.2.3')

    expect(result).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
    })
  })

  it('should parse version with leading zeros', () => {
    const result = parseVersion('0.0.0')

    expect(result).toEqual({
      major: 0,
      minor: 0,
      patch: 0,
    })
  })

  it('should parse version with prerelease', () => {
    const result = parseVersion('1.0.0-alpha')

    expect(result).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: 'alpha',
    })
  })

  it('should parse version with prerelease dot notation', () => {
    const result = parseVersion('2.0.0-beta.1')

    expect(result).toEqual({
      major: 2,
      minor: 0,
      patch: 0,
      prerelease: 'beta.1',
    })
  })

  it('should parse version with build metadata', () => {
    const result = parseVersion('1.0.0+build123')

    expect(result).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      build: 'build123',
    })
  })

  it('should parse version with prerelease and build', () => {
    const result = parseVersion('1.0.0-rc.1+build.456')

    expect(result).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: 'rc.1',
      build: 'build.456',
    })
  })

  it('should return null for invalid versions', () => {
    expect(parseVersion('')).toBeNull()
    expect(parseVersion('1')).toBeNull()
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion('a.b.c')).toBeNull()
    expect(parseVersion('1.2.3.4')).toBeNull()
  })

  it('should return null for versions with leading zeros in numbers', () => {
    expect(parseVersion('01.2.3')).toBeNull()
    expect(parseVersion('1.02.3')).toBeNull()
    expect(parseVersion('1.2.03')).toBeNull()
  })
})

describe('versionToString', () => {
  it('should convert simple version to string', () => {
    const version: SemanticVersion = { major: 1, minor: 2, patch: 3 }

    expect(versionToString(version)).toBe('1.2.3')
  })

  it('should convert version with prerelease to string', () => {
    const version: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: 'alpha' }

    expect(versionToString(version)).toBe('1.0.0-alpha')
  })

  it('should convert version with build to string', () => {
    const version: SemanticVersion = { major: 1, minor: 0, patch: 0, build: 'build123' }

    expect(versionToString(version)).toBe('1.0.0+build123')
  })

  it('should convert version with prerelease and build to string', () => {
    const version: SemanticVersion = {
      major: 2,
      minor: 1,
      patch: 0,
      prerelease: 'beta.2',
      build: 'sha.abc123',
    }

    expect(versionToString(version)).toBe('2.1.0-beta.2+sha.abc123')
  })

  it('should handle zero version', () => {
    const version: SemanticVersion = { major: 0, minor: 0, patch: 0 }

    expect(versionToString(version)).toBe('0.0.0')
  })
})

describe('isValidVersion', () => {
  it('should return true for valid versions', () => {
    expect(isValidVersion('1.0.0')).toBe(true)
    expect(isValidVersion('0.1.0')).toBe(true)
    expect(isValidVersion('10.20.30')).toBe(true)
    expect(isValidVersion('1.0.0-alpha')).toBe(true)
    expect(isValidVersion('1.0.0+build')).toBe(true)
  })

  it('should return false for invalid versions', () => {
    expect(isValidVersion('')).toBe(false)
    expect(isValidVersion('v1.0.0')).toBe(false)
    expect(isValidVersion('1.0')).toBe(false)
    expect(isValidVersion('1.0.0.0')).toBe(false)
    expect(isValidVersion('a.b.c')).toBe(false)
  })
})

describe('compareVersions', () => {
  it('should return 0 for equal versions', () => {
    const a: SemanticVersion = { major: 1, minor: 0, patch: 0 }
    const b: SemanticVersion = { major: 1, minor: 0, patch: 0 }

    expect(compareVersions(a, b)).toBe(0)
  })

  it('should compare by major version', () => {
    const a: SemanticVersion = { major: 2, minor: 0, patch: 0 }
    const b: SemanticVersion = { major: 1, minor: 0, patch: 0 }

    expect(compareVersions(a, b)).toBe(1)
    expect(compareVersions(b, a)).toBe(-1)
  })

  it('should compare by minor version when major is equal', () => {
    const a: SemanticVersion = { major: 1, minor: 2, patch: 0 }
    const b: SemanticVersion = { major: 1, minor: 1, patch: 0 }

    expect(compareVersions(a, b)).toBe(1)
    expect(compareVersions(b, a)).toBe(-1)
  })

  it('should compare by patch version when major and minor are equal', () => {
    const a: SemanticVersion = { major: 1, minor: 0, patch: 2 }
    const b: SemanticVersion = { major: 1, minor: 0, patch: 1 }

    expect(compareVersions(a, b)).toBe(1)
    expect(compareVersions(b, a)).toBe(-1)
  })

  it('should treat prerelease as lower precedence than release', () => {
    const release: SemanticVersion = { major: 1, minor: 0, patch: 0 }
    const prerelease: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: 'alpha' }

    expect(compareVersions(prerelease, release)).toBe(-1)
    expect(compareVersions(release, prerelease)).toBe(1)
  })

  it('should compare prereleases lexicographically', () => {
    const alpha: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: 'alpha' }
    const beta: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: 'beta' }

    expect(compareVersions(alpha, beta)).toBe(-1)
    expect(compareVersions(beta, alpha)).toBe(1)
  })

  it('should return 0 for equal prereleases', () => {
    const a: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: 'alpha.1' }
    const b: SemanticVersion = { major: 1, minor: 0, patch: 0, prerelease: 'alpha.1' }

    expect(compareVersions(a, b)).toBe(0)
  })
})

describe('isCompatible', () => {
  describe('post-1.0 versions', () => {
    it('should return true for same major with higher minor', () => {
      const installed: SemanticVersion = { major: 1, minor: 2, patch: 0 }
      const required: SemanticVersion = { major: 1, minor: 1, patch: 0 }

      expect(isCompatible(installed, required)).toBe(true)
    })

    it('should return true for same major and minor with higher patch', () => {
      const installed: SemanticVersion = { major: 1, minor: 1, patch: 5 }
      const required: SemanticVersion = { major: 1, minor: 1, patch: 2 }

      expect(isCompatible(installed, required)).toBe(true)
    })

    it('should return true for exact match', () => {
      const installed: SemanticVersion = { major: 1, minor: 2, patch: 3 }
      const required: SemanticVersion = { major: 1, minor: 2, patch: 3 }

      expect(isCompatible(installed, required)).toBe(true)
    })

    it('should return false for different major', () => {
      const installed: SemanticVersion = { major: 2, minor: 0, patch: 0 }
      const required: SemanticVersion = { major: 1, minor: 5, patch: 0 }

      expect(isCompatible(installed, required)).toBe(false)
    })

    it('should return false for lower minor', () => {
      const installed: SemanticVersion = { major: 1, minor: 0, patch: 5 }
      const required: SemanticVersion = { major: 1, minor: 1, patch: 0 }

      expect(isCompatible(installed, required)).toBe(false)
    })

    it('should return false for lower patch with same minor', () => {
      const installed: SemanticVersion = { major: 1, minor: 1, patch: 0 }
      const required: SemanticVersion = { major: 1, minor: 1, patch: 2 }

      expect(isCompatible(installed, required)).toBe(false)
    })
  })

  describe('pre-1.0 versions', () => {
    it('should require same minor version', () => {
      const installed: SemanticVersion = { major: 0, minor: 2, patch: 5 }
      const required: SemanticVersion = { major: 0, minor: 2, patch: 3 }

      expect(isCompatible(installed, required)).toBe(true)
    })

    it('should return false for different minor in pre-1.0', () => {
      const installed: SemanticVersion = { major: 0, minor: 2, patch: 0 }
      const required: SemanticVersion = { major: 0, minor: 1, patch: 0 }

      expect(isCompatible(installed, required)).toBe(false)
    })

    it('should return false for lower patch in pre-1.0', () => {
      const installed: SemanticVersion = { major: 0, minor: 1, patch: 0 }
      const required: SemanticVersion = { major: 0, minor: 1, patch: 2 }

      expect(isCompatible(installed, required)).toBe(false)
    })
  })
})

describe('Version Constants', () => {
  describe('INITIAL_VERSION', () => {
    it('should be 0.1.0', () => {
      expect(INITIAL_VERSION).toEqual({
        major: 0,
        minor: 1,
        patch: 0,
      })
    })
  })

  describe('STABLE_VERSION', () => {
    it('should be 1.0.0', () => {
      expect(STABLE_VERSION).toEqual({
        major: 1,
        minor: 0,
        patch: 0,
      })
    })
  })
})
