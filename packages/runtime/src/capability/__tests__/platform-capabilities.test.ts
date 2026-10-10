/**
 * Platform Capabilities Tests
 *
 * Tests for platform capability definitions, type mapping,
 * and surface validation.
 *
 * @module @pwfabric/runtime/capability/__tests__/platform-capabilities
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  persistenceCapability,
  entitiesCapability,
  navigationCapability,
  interactionCapability,
  platformCapabilities,
  registerPlatformCapabilities,
} from '../platform-capabilities.js'
import { DataService } from '../../data/manager.js'
import {
  CAPABILITY_TYPE_TO_ID,
  CAPABILITY_TYPES,
  CAPABILITY_IDS,
  resolveCapabilityId,
  resolveCapabilityType,
  isKnownCapabilityType,
} from '../type-mapping.js'
import { validateSurfaceCapabilities } from '../validation.js'
import type { CapabilityRequirement } from '../validation.js'
import { type InMemoryCapabilityRegistry, createRegistry } from '../../registry.js'

// ============================================================
// PLATFORM CAPABILITIES
// ============================================================

describe('Platform Capabilities', () => {
  describe('individual capability definitions', () => {
    // Canonical 4 platform capabilities (taxonomy + removes auth + removes input)
    const allCapabilities = [
      {
        capability: persistenceCapability,
        expectedId: 'platform/persistence',
        expectedName: 'Data & State Persistence',
      },
      {
        capability: entitiesCapability,
        expectedId: 'platform/entities',
        expectedName: 'Entity System',
      },
      {
        capability: navigationCapability,
        expectedId: 'platform/navigation',
        expectedName: 'Navigation',
      },
      {
        capability: interactionCapability,
        expectedId: 'platform/interaction',
        expectedName: 'Interaction Rules',
      },
    ]

    for (const { capability, expectedId, expectedName } of allCapabilities) {
      describe(expectedId, () => {
        it('should have the correct ID', () => {
          expect(capability.id).toBe(expectedId)
        })

        it('should have the correct name', () => {
          expect(capability.metadata.name).toBe(expectedName)
        })

        it('should be in stable state', () => {
          expect(capability.metadata.state).toBe('stable')
        })

        it('should have version 1.0.0', () => {
          expect(capability.version.major).toBe(1)
          expect(capability.version.minor).toBe(0)
          expect(capability.version.patch).toBe(0)
        })

        it('should have a description', () => {
          expect(capability.metadata.description).toBeDefined()
          expect(capability.metadata.description?.length ?? 0).toBeGreaterThan(0)
        })

        it('should have tags', () => {
          expect(capability.metadata.tags).toBeDefined()
          expect(capability.metadata.tags?.length ?? 0).toBeGreaterThan(0)
        })

        it('should have no dependencies', () => {
          expect(capability.dependencies).toEqual([])
        })
      })
    }

    // Capability-specific executor assertions
    describe('platform/persistence executor (formerly platform/state + platform/data)', () => {
      it('should create a DataService instance', async () => {
        const config = { defaultCacheTtl: 120, maxRetries: 5, timeout: 8000 }
        const result = await persistenceCapability.execute(config, {} as never)
        expect(result).toBeInstanceOf(DataService)
      })

      it('should create DataService with provided config values', async () => {
        const config = { defaultCacheTtl: 60, maxRetries: 2, timeout: 3000 }
        const service = (await persistenceCapability.execute(config, {} as never)) as DataService
        expect(service.config.defaultCacheTtl).toBe(60)
        expect(service.config.maxRetries).toBe(2)
        expect(service.config.timeout).toBe(3000)
      })

      it('should handle empty config gracefully', async () => {
        const result = await persistenceCapability.execute({}, {} as never)
        expect(result).toBeInstanceOf(DataService)
      })
    })

    describe('platform/navigation executor (renamed from platform/routing)', () => {
      it('should resolve root path by default', async () => {
        const result = (await navigationCapability.execute({}, {} as never)) as Record<
          string,
          unknown
        >
        expect(result.resolvedPath).toBe('/')
        expect(result.params).toEqual({})
      })

      it('should resolve a given path', async () => {
        const result = (await navigationCapability.execute(
          { path: '/about' },
          {} as never
        )) as Record<string, unknown>
        expect(result.resolvedPath).toBe('/about')
      })

      it('should apply trailing slash config', async () => {
        const result = (await navigationCapability.execute(
          { path: '/about', config: { trailingSlash: true } },
          {} as never
        )) as Record<string, unknown>
        expect(result.resolvedPath).toBe('/about/')
      })
    })

    // +. platform/analytics, platform/seo, platform/i18n
    // executor tests removed — capabilities deleted from runtime registry

    describe('platform/interaction executor (formerly platform/behaviors)', () => {
      it('should return success true', async () => {
        const result = (await interactionCapability.execute({}, {} as never)) as Record<
          string,
          unknown
        >
        expect(result.success).toBe(true)
      })

      it('should have a configSchema defined', () => {
        expect(interactionCapability.configSchema).toBeDefined()
      })

      it('should have executionMode, maxConcurrent, errorPolicy, debugMode fields', () => {
        const schema = interactionCapability.configSchema
        expect(schema).toBeDefined()
        const fieldKeys = (schema as NonNullable<typeof schema>).fields.map(
          (f: { key: string }) => f.key
        )
        expect(fieldKeys).toContain('executionMode')
        expect(fieldKeys).toContain('maxConcurrent')
        expect(fieldKeys).toContain('errorPolicy')
        expect(fieldKeys).toContain('debugMode')
      })
    })

    describe('platform/entities executor (new)', () => {
      it('should return success true', async () => {
        const result = (await entitiesCapability.execute({}, {} as never)) as Record<
          string,
          unknown
        >
        expect(result.success).toBe(true)
      })

      it('should have a configSchema defined', () => {
        expect(entitiesCapability.configSchema).toBeDefined()
      })

      it('should have enableLifecycleHooks and enableEventBridge fields', () => {
        const schema = entitiesCapability.configSchema
        expect(schema).toBeDefined()
        const fieldKeys = (schema as NonNullable<typeof schema>).fields.map(
          (f: { key: string }) => f.key
        )
        expect(fieldKeys).toContain('enableLifecycleHooks')
        expect(fieldKeys).toContain('enableEventBridge')
      })
    })
  })

  describe('platformCapabilities array', () => {
    it('should contain exactly 4 capabilities (auth and input removed; taxonomy)', () => {
      expect(platformCapabilities).toHaveLength(4)
    })

    it('should contain all 4 canonical capability IDs', () => {
      const ids = platformCapabilities.map((c) => c.id)
      expect(ids).toContain('platform/persistence')
      expect(ids).toContain('platform/entities')
      expect(ids).toContain('platform/navigation')
      expect(ids).toContain('platform/interaction')
    })

    it('should NOT contain removed capability IDs', () => {
      const ids = platformCapabilities.map((c) => c.id)
      // auth removed as phantom capability
      expect(ids).not.toContain('platform/auth')
      // deprecated aliases
      expect(ids).not.toContain('platform/data')
      expect(ids).not.toContain('platform/state')
      expect(ids).not.toContain('platform/forms')
      expect(ids).not.toContain('platform/behaviors')
      // Tier 3 removed
      expect(ids).not.toContain('platform/analytics')
      expect(ids).not.toContain('platform/seo')
      expect(ids).not.toContain('platform/i18n')
      // routing renamed to navigation
      expect(ids).not.toContain('platform/routing')
      // input retired, form writes via platform/entities
      expect(ids).not.toContain('platform/input')
    })
  })

  describe('registerPlatformCapabilities', () => {
    let registry: InMemoryCapabilityRegistry

    beforeEach(() => {
      registry = createRegistry() as InMemoryCapabilityRegistry
    })

    it('should register all 4 capabilities successfully', () => {
      const result = registerPlatformCapabilities(registry)

      expect(result.registered).toHaveLength(4)
      expect(result.errors).toHaveLength(0)
    })

    it('should result in registry having 4 entries', () => {
      registerPlatformCapabilities(registry)

      expect(registry.size()).toBe(4)
    })

    it('should make all capabilities resolvable by ID', () => {
      registerPlatformCapabilities(registry)

      for (const capability of platformCapabilities) {
        expect(registry.has(capability.id)).toBe(true)
      }
    })

    it('should report errors for duplicate registration', () => {
      // Register once
      registerPlatformCapabilities(registry)
      // Register again
      const result = registerPlatformCapabilities(registry)

      expect(result.registered).toHaveLength(0)
      expect(result.errors).toHaveLength(4)
      for (const error of result.errors) {
        expect(error.error).toBe('already_registered')
      }
    })
  })
})

// ============================================================
// TYPE MAPPING
// ============================================================

describe('Type Mapping', () => {
  describe('CAPABILITY_TYPE_TO_ID', () => {
    it('should map all 4 capability types (auth and input removed, Tier 3 deferred excluded)', () => {
      expect(Object.keys(CAPABILITY_TYPE_TO_ID)).toHaveLength(4)
    })

    it('should NOT map auth (removed from type mapping)', () => {
      expect(CAPABILITY_TYPE_TO_ID['auth']).toBeUndefined()
    })

    it('should map persistence to platform/persistence', () => {
      expect(CAPABILITY_TYPE_TO_ID['persistence']).toBe('platform/persistence')
    })

    it('should map entities to platform/entities', () => {
      expect(CAPABILITY_TYPE_TO_ID['entities']).toBe('platform/entities')
    })

    it('should map navigation to platform/navigation (renamed from routing)', () => {
      expect(CAPABILITY_TYPE_TO_ID['navigation']).toBe('platform/navigation')
    })

    it('should NOT map routing (renamed to navigation)', () => {
      expect(CAPABILITY_TYPE_TO_ID['routing']).toBeUndefined()
    })

    // seo mapping removed

    it('should NOT map input (platform/input retired, form writes via platform/entities)', () => {
      expect(CAPABILITY_TYPE_TO_ID['input']).toBeUndefined()
    })

    it('should map interaction to platform/interaction', () => {
      expect(CAPABILITY_TYPE_TO_ID['interaction']).toBe('platform/interaction')
    })

    it('should NOT contain Tier 3 deferred types (analytics, i18n)', () => {
      expect(CAPABILITY_TYPE_TO_ID['analytics']).toBeUndefined()
      expect(CAPABILITY_TYPE_TO_ID['i18n']).toBeUndefined()
    })
  })

  describe('CAPABILITY_TYPES', () => {
    it('should contain all 4 type strings (auth + seo + input removed, routing renamed to navigation, Tier 3 deferred excluded)', () => {
      expect(CAPABILITY_TYPES).toHaveLength(4)
      expect(CAPABILITY_TYPES).not.toContain('auth')
      expect(CAPABILITY_TYPES).toContain('persistence')
      expect(CAPABILITY_TYPES).toContain('entities')
      expect(CAPABILITY_TYPES).toContain('navigation')
      // 'routing' renamed to 'navigation'
      expect(CAPABILITY_TYPES).not.toContain('routing')
      // 'seo' removed
      // 'input' retired
      expect(CAPABILITY_TYPES).not.toContain('input')
      expect(CAPABILITY_TYPES).toContain('interaction')
    })

    it('should NOT contain Tier 3 deferred types', () => {
      expect(CAPABILITY_TYPES).not.toContain('analytics')
      expect(CAPABILITY_TYPES).not.toContain('i18n')
    })
  })

  describe('CAPABILITY_IDS', () => {
    it('should contain all 4 capability IDs (auth removed, seo removed, routing→navigation, input removed, Tier 3 deferred)', () => {
      expect(CAPABILITY_IDS).toHaveLength(4)
      expect(CAPABILITY_IDS).not.toContain('platform/auth')
      expect(CAPABILITY_IDS).toContain('platform/persistence')
      expect(CAPABILITY_IDS).toContain('platform/entities')
      expect(CAPABILITY_IDS).toContain('platform/navigation')
      expect(CAPABILITY_IDS).not.toContain('platform/routing')
      expect(CAPABILITY_IDS).not.toContain('platform/input')
      expect(CAPABILITY_IDS).toContain('platform/interaction')
    })

    it('should NOT contain Tier 3 deferred IDs', () => {
      expect(CAPABILITY_IDS).not.toContain('platform/analytics')
      expect(CAPABILITY_IDS).not.toContain('platform/i18n')
    })
  })

  describe('resolveCapabilityId', () => {
    it('should resolve known types to CapabilityId', () => {
      const id = resolveCapabilityId('persistence')
      expect(id).toBe('platform/persistence')
    })

    it('should return null for unknown types', () => {
      const id = resolveCapabilityId('unknown')
      expect(id).toBeNull()
    })

    it('should return null for removed auth type', () => {
      const id = resolveCapabilityId('auth')
      expect(id).toBeNull()
    })

    it('should resolve all 4 types (Tier 1, auth + input removed)', () => {
      for (const type of CAPABILITY_TYPES) {
        const id = resolveCapabilityId(type)
        expect(id).not.toBeNull()
        expect(id).toBe(`platform/${type}`)
      }
    })
  })

  describe('resolveCapabilityType', () => {
    it('should resolve known IDs back to type strings', () => {
      expect(resolveCapabilityType('platform/persistence')).toBe('persistence')
    })

    it('should return null for unknown IDs', () => {
      expect(resolveCapabilityType('platform/unknown')).toBeNull()
    })

    it('should return null for removed auth ID', () => {
      expect(resolveCapabilityType('platform/auth')).toBeNull()
    })

    it('should return null for retired input ID', () => {
      expect(resolveCapabilityType('platform/input')).toBeNull()
    })

    it('should resolve all 4 IDs (Tier 1, auth + input removed)', () => {
      for (const id of CAPABILITY_IDS) {
        const type = resolveCapabilityType(id)
        expect(type).not.toBeNull()
      }
    })
  })

  describe('isKnownCapabilityType', () => {
    it('should return true for known types', () => {
      expect(isKnownCapabilityType('persistence')).toBe(true)
      expect(isKnownCapabilityType('entities')).toBe(true)
    })

    it('should return false for retired input type', () => {
      expect(isKnownCapabilityType('input')).toBe(false)
    })

    it('should return false for removed auth type', () => {
      expect(isKnownCapabilityType('auth')).toBe(false)
    })

    it('should return false for unknown types', () => {
      expect(isKnownCapabilityType('unknown')).toBe(false)
      expect(isKnownCapabilityType('platform/persistence')).toBe(false)
    })
  })
})

// ============================================================
// SURFACE VALIDATION
// ============================================================

describe('Surface Validation', () => {
  let registry: InMemoryCapabilityRegistry

  beforeEach(() => {
    registry = createRegistry() as InMemoryCapabilityRegistry
    registerPlatformCapabilities(registry)
  })

  describe('validateSurfaceCapabilities', () => {
    it('should return valid when all required capabilities are satisfied', () => {
      const requirements: CapabilityRequirement[] = [
        { capability: 'persistence', required: true },
        { capability: 'platform/entities', required: true },
      ]

      const result = validateSurfaceCapabilities(requirements, registry)

      expect(result.valid).toBe(true)
      expect(result.satisfied).toEqual(['persistence', 'platform/entities'])
      expect(result.missing).toEqual([])
      expect(result.optional).toEqual([])
    })

    it('should return valid when all 4 active capabilities are required (auth and input removed, routing renamed)', () => {
      const requirements: CapabilityRequirement[] = [
        { capability: 'platform/persistence', required: true },
        { capability: 'platform/entities', required: true },
        { capability: 'navigation', required: true },
        { capability: 'interaction', required: true },
      ]

      const result = validateSurfaceCapabilities(requirements, registry)

      expect(result.valid).toBe(true)
      expect(result.satisfied).toHaveLength(4)
      expect(result.missing).toHaveLength(0)
    })

    it('should return invalid when required capabilities are missing', () => {
      // Use a fresh empty registry
      const emptyRegistry = createRegistry() as InMemoryCapabilityRegistry

      const requirements: CapabilityRequirement[] = [
        { capability: 'persistence', required: true },
        { capability: 'platform/entities', required: true },
      ]

      const result = validateSurfaceCapabilities(requirements, emptyRegistry)

      expect(result.valid).toBe(false)
      expect(result.satisfied).toEqual([])
      expect(result.missing).toEqual(['persistence', 'platform/entities'])
    })

    it('should not count optional missing capabilities as invalid', () => {
      // Use a fresh empty registry
      const emptyRegistry = createRegistry() as InMemoryCapabilityRegistry

      const requirements: CapabilityRequirement[] = [
        { capability: 'analytics', required: false },
        { capability: 'i18n', required: false },
      ]

      const result = validateSurfaceCapabilities(requirements, emptyRegistry)

      expect(result.valid).toBe(true)
      expect(result.satisfied).toEqual([])
      expect(result.missing).toEqual([])
      expect(result.optional).toEqual(['analytics', 'i18n'])
    })

    it('should handle mixed required and optional capabilities', () => {
      // Register only persistence
      const partialRegistry = createRegistry() as InMemoryCapabilityRegistry
      partialRegistry.register(persistenceCapability)

      const requirements: CapabilityRequirement[] = [
        { capability: 'persistence', required: true },
        { capability: 'platform/entities', required: true },
        { capability: 'analytics', required: false },
      ]

      const result = validateSurfaceCapabilities(requirements, partialRegistry)

      expect(result.valid).toBe(false)
      expect(result.satisfied).toEqual(['persistence'])
      expect(result.missing).toEqual(['platform/entities'])
      expect(result.optional).toEqual(['analytics'])
    })

    it('should handle empty requirements list', () => {
      const result = validateSurfaceCapabilities([], registry)

      expect(result.valid).toBe(true)
      expect(result.satisfied).toEqual([])
      expect(result.missing).toEqual([])
      expect(result.optional).toEqual([])
    })

    it('should handle requirements with config', () => {
      const requirements: CapabilityRequirement[] = [
        {
          capability: 'persistence',
          required: true,
          config: { defaultCacheTtl: 300, maxRetries: 3 },
        },
      ]

      const result = validateSurfaceCapabilities(requirements, registry)

      expect(result.valid).toBe(true)
      expect(result.satisfied).toEqual(['persistence'])
    })

    it('should work with full capability IDs as well as short types', () => {
      const requirements: CapabilityRequirement[] = [{ capability: 'persistence', required: true }]

      const result = validateSurfaceCapabilities(requirements, registry)

      expect(result.valid).toBe(true)
      expect(result.satisfied).toContain('persistence')
    })
  })
})
