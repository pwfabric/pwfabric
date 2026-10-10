/**
 * SurfaceRenderGrant Type Tests
 *
 * RED phase — Surface Render Grant
 *
 * These tests assert the shape and export of the SurfaceRenderGrant interface
 * and its companion runtime artifacts. They MUST fail until the interface and
 * runtime exports are defined in surface-render-grant.ts.
 *
 * @module @pwfabric/contracts/fabric/__tests__/surface-render-grant
 */

import { describe, it, expect } from 'vitest'
// Import the type AND a runtime value from the source file.
// Vitest uses esbuild which strips `import type` — a type-only import would
// disappear at runtime and the test would pass even if the file doesn't exist.
// Importing `SURFACE_RENDER_GRANT_KEYS` (a runtime constant listing all fields)
// forces a genuine module-resolution failure when the file is absent. RED confirmed.
import {
  SURFACE_RENDER_GRANT_KEYS,
  isSurfaceRenderGrant,
  type SurfaceRenderGrant,
} from '../surface-render-grant.js'

// ---------------------------------------------------------------------------
// Test 1: Export reachability — SurfaceRenderGrant must be exported from the
// package barrel so that consumers can import it from '@pwfabric/contracts'.
// The runtime constant SURFACE_RENDER_GRANT_KEYS proves the file and its
// named exports are wired into the barrel.
// ---------------------------------------------------------------------------
describe('SurfaceRenderGrant export', () => {
  it('should export SURFACE_RENDER_GRANT_KEYS as a runtime constant', () => {
    // If the source file does not exist, this test fails at import time with
    // "Cannot find module '../surface-render-grant.js'" — genuine RED.
    expect(SURFACE_RENDER_GRANT_KEYS).toBeDefined()
    expect(Array.isArray(SURFACE_RENDER_GRANT_KEYS)).toBe(true)
  })

  it('should export isSurfaceRenderGrant as a runtime type guard function', () => {
    expect(typeof isSurfaceRenderGrant).toBe('function')
  })

  it('should be importable from the package barrel @pwfabric/contracts', async () => {
    const contractsModule = await import('@pwfabric/contracts')
    // The barrel must re-export the runtime constant — not just the type.
    expect((contractsModule as Record<string, unknown>)['SURFACE_RENDER_GRANT_KEYS']).toBeDefined()
    expect(typeof (contractsModule as Record<string, unknown>)['isSurfaceRenderGrant']).toBe(
      'function'
    )
  })
})

// ---------------------------------------------------------------------------
// Test 2: Structural shape — a valid object must satisfy SurfaceRenderGrant.
// The `satisfies` keyword is a compile-time assertion: if any required field
// is missing or has the wrong type, TypeScript will error on this file.
// The runtime assertions document the contract explicitly.
// ---------------------------------------------------------------------------
describe('SurfaceRenderGrant shape', () => {
  it('should accept a valid grant object with all required fields', () => {
    // Arrange — a fully populated grant object
    const grant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=eyJ0eXBlIjoic2cifQ',
      integrity: 'sha256-abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
      expiresAt: 1800000000,
    } satisfies SurfaceRenderGrant

    // Act & Assert — runtime shape verification mirrors the compile-time check
    expect(grant.surfaceId).toBe('surf_abc123')
    expect(grant.blockType).toBe('hero-block')
    expect(grant.artifactName).toBe('@acme/hero-block')
    expect(grant.artifactVersion).toBe('1.2.3')
    expect(grant.moduleUrl).toContain('?sg=')
    expect(grant.integrity).toMatch(/^sha256-/)
    expect(grant.expiresAt).toBe(1800000000)
  })

  it('should have exactly the seven specified fields', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    const keys = Object.keys(grant)
    expect(keys).toHaveLength(7)
    expect(keys).toContain('surfaceId')
    expect(keys).toContain('blockType')
    expect(keys).toContain('artifactName')
    expect(keys).toContain('artifactVersion')
    expect(keys).toContain('moduleUrl')
    expect(keys).toContain('integrity')
    expect(keys).toContain('expiresAt')
  })

  it('should match SURFACE_RENDER_GRANT_KEYS exactly', () => {
    // SURFACE_RENDER_GRANT_KEYS is the canonical runtime list of fields.
    // It must list the same seven fields as the interface — no more, no less.
    const expectedKeys = [
      'surfaceId',
      'blockType',
      'artifactName',
      'artifactVersion',
      'moduleUrl',
      'integrity',
      'expiresAt',
    ]

    expect(SURFACE_RENDER_GRANT_KEYS).toHaveLength(7)
    for (const key of expectedKeys) {
      expect(SURFACE_RENDER_GRANT_KEYS).toContain(key)
    }
  })
})

// ---------------------------------------------------------------------------
// Test 3: Negative shape — SurfaceRenderGrant must NOT have the fields that
// belong exclusively to DynamicBlockDescriptor. This is both a type-level
// guard (compile-time) and a runtime assertion via isSurfaceRenderGrant.
// ---------------------------------------------------------------------------
describe('SurfaceRenderGrant vs DynamicBlockDescriptor distinction', () => {
  it('should not have a publisher field', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    // 'publisher' is a DynamicBlockDescriptor field — must not exist on SurfaceRenderGrant
    expect('publisher' in grant).toBe(false)
    expect(SURFACE_RENDER_GRANT_KEYS).not.toContain('publisher')
  })

  it('should not have a publisherVerified field', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect('publisherVerified' in grant).toBe(false)
    expect(SURFACE_RENDER_GRANT_KEYS).not.toContain('publisherVerified')
  })

  it('should not have a definition field', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect('definition' in grant).toBe(false)
    expect(SURFACE_RENDER_GRANT_KEYS).not.toContain('definition')
  })

  it('should return false from isSurfaceRenderGrant when given a DynamicBlockDescriptor-shaped object', () => {
    // An object that looks like DynamicBlockDescriptor but lacks the
    // SurfaceRenderGrant-specific fields should not pass the type guard.
    const descriptorShaped = {
      blockType: 'hero-block',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs',
      integrity: 'sha256-deadbeef',
      publisher: 'acme',
      publisherVerified: true,
      definition: { name: 'Hero Block' },
      // Missing: surfaceId, artifactName, artifactVersion, expiresAt
    }

    expect(isSurfaceRenderGrant(descriptorShaped)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 4: expiresAt type — must be a number (unix timestamp), not a string or
// Date object. The compile-time `satisfies` check enforces this statically,
// and isSurfaceRenderGrant enforces it at runtime.
// ---------------------------------------------------------------------------
describe('SurfaceRenderGrant.expiresAt', () => {
  it('should be a number', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect(typeof grant.expiresAt).toBe('number')
  })

  it('should not be a string representation of a timestamp', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect(typeof grant.expiresAt).not.toBe('string')
    expect(grant.expiresAt instanceof Date).toBe(false)
  })

  it('should return false from isSurfaceRenderGrant when expiresAt is a string', () => {
    const invalidGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: '2026-01-01T00:00:00.000Z', // wrong type: string instead of number
    }

    expect(isSurfaceRenderGrant(invalidGrant)).toBe(false)
  })

  it('should represent a unix timestamp in seconds (value > year-2000 epoch)', () => {
    const year2000UnixSeconds = 946684800 // 2000-01-01T00:00:00Z
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect(grant.expiresAt).toBeGreaterThan(year2000UnixSeconds)
  })
})

// ---------------------------------------------------------------------------
// Test 5: moduleUrl accepts the ?sg= token URL pattern.
// The grant URL carries a signed token in the query string — this is the
// security mechanism. isSurfaceRenderGrant must accept any string
// value for moduleUrl (it does not validate the URL structure itself).
// ---------------------------------------------------------------------------
describe('SurfaceRenderGrant.moduleUrl', () => {
  it('should be a string', () => {
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=eyJ0eXBlIjoic2cifQ',
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect(typeof grant.moduleUrl).toBe('string')
  })

  it('should accept a URL containing the ?sg= query parameter', () => {
    const sgToken = 'eyJ0eXBlIjoic2cifQ'
    const grant: SurfaceRenderGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      moduleUrl: `https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=${sgToken}`,
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect(grant.moduleUrl).toContain('?sg=')
    expect(grant.moduleUrl).toContain(sgToken)
    expect(isSurfaceRenderGrant(grant)).toBe(true)
  })

  it('should accept URLs from different CDN origins', () => {
    // The type is `string`, not a branded URL type — any string value is valid
    const variants: string[] = [
      'https://cdn.example.com/blocks/hero@1.0.0/index.mjs?sg=token1',
      'https://private-cdn.acme.com/pwfabric/hero@1.0.0/esm/index.js?sg=token2',
    ]

    for (const moduleUrl of variants) {
      const grant: SurfaceRenderGrant = {
        surfaceId: 'surf_abc123',
        blockType: 'hero-block',
        artifactName: '@acme/hero-block',
        artifactVersion: '1.0.0',
        moduleUrl,
        integrity: 'sha256-deadbeef',
        expiresAt: 1800000000,
      }

      expect(typeof grant.moduleUrl).toBe('string')
      expect(isSurfaceRenderGrant(grant)).toBe(true)
    }
  })

  it('should return false from isSurfaceRenderGrant when moduleUrl is missing', () => {
    const invalidGrant = {
      surfaceId: 'surf_abc123',
      blockType: 'hero-block',
      artifactName: '@acme/hero-block',
      artifactVersion: '1.2.3',
      // moduleUrl intentionally omitted
      integrity: 'sha256-deadbeef',
      expiresAt: 1800000000,
    }

    expect(isSurfaceRenderGrant(invalidGrant)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 6: Non-object and null inputs — the guard's first check must return
// false for null, primitives, and other non-object values.
// These cover the early-exit branch at lines 71-73 in surface-render-grant.ts.
// ---------------------------------------------------------------------------
describe('isSurfaceRenderGrant early-exit for non-objects', () => {
  it('should return false for null', () => {
    expect(isSurfaceRenderGrant(null)).toBe(false)
  })

  it('should return false for undefined', () => {
    expect(isSurfaceRenderGrant(undefined)).toBe(false)
  })

  it('should return false for a string', () => {
    expect(isSurfaceRenderGrant('surf_abc123')).toBe(false)
  })

  it('should return false for a number', () => {
    expect(isSurfaceRenderGrant(42)).toBe(false)
  })

  it('should return false for a boolean', () => {
    expect(isSurfaceRenderGrant(true)).toBe(false)
  })

  it('should return false for an array', () => {
    expect(isSurfaceRenderGrant([])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Test 7: Each required field check — covers the individual guard lines
// for blockType, artifactName, artifactVersion, integrity.
// A grant missing each field in turn must return false.
// ---------------------------------------------------------------------------
describe('isSurfaceRenderGrant individual field guards', () => {
  const base = {
    surfaceId: 'surf_abc123',
    blockType: 'hero-block',
    artifactName: '@acme/hero-block',
    artifactVersion: '1.2.3',
    moduleUrl: 'https://cdn.example.com/blocks/hero-block@1.2.3/index.mjs?sg=token',
    integrity: 'sha256-deadbeef',
    expiresAt: 1800000000,
  }

  it('should return false when blockType is missing', () => {
    const { blockType: _removed, ...rest } = base
    expect(isSurfaceRenderGrant(rest)).toBe(false)
  })

  it('should return false when artifactName is missing', () => {
    const { artifactName: _removed, ...rest } = base
    expect(isSurfaceRenderGrant(rest)).toBe(false)
  })

  it('should return false when artifactVersion is missing', () => {
    const { artifactVersion: _removed, ...rest } = base
    expect(isSurfaceRenderGrant(rest)).toBe(false)
  })

  it('should return false when integrity is missing', () => {
    const { integrity: _removed, ...rest } = base
    expect(isSurfaceRenderGrant(rest)).toBe(false)
  })

  it('should return false when publisher field is present', () => {
    expect(isSurfaceRenderGrant({ ...base, publisher: 'acme' })).toBe(false)
  })

  it('should return false when publisherVerified field is present', () => {
    expect(isSurfaceRenderGrant({ ...base, publisherVerified: false })).toBe(false)
  })

  it('should return false when definition field is present', () => {
    expect(isSurfaceRenderGrant({ ...base, definition: { name: 'Hero' } })).toBe(false)
  })
})
