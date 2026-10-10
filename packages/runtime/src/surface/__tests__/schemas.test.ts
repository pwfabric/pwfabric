/**
 * Surface JSON Zod Schema Tests
 *
 * Tests for Zod validation schemas
 */

import { describe, it, expect } from 'vitest'
import {
  surfaceJsonSchema,
  layoutJsonSchema,
  bindingJsonSchema,
  isSurfaceJSON,
  isLayoutJSON,
  isBindingJSON,
} from '../schemas.js'
import { interpretSurface } from '../interpreter.js'
import type { SurfaceJSON, LayoutJSON, BindingJSON } from '../types.js'

// ============================================================
// TEST DATA
// ============================================================

const validLayout: LayoutJSON = {
  type: 'container',
  props: { direction: 'column' },
  children: [{ type: 'text', props: { content: 'Hello World' } }],
}

const validSurface: SurfaceJSON = {
  id: 'test-surface',
  version: '1.0.0',
  environment: 'web',
  metadata: {
    name: 'Test Surface',
    description: 'A test surface',
    tags: ['test'],
  },
  bindings: [{ capability: 'user.profile', alias: 'profile' }],
  layout: validLayout,
}

// ============================================================
// SURFACE JSON SCHEMA TESTS
// ============================================================

describe('surfaceJsonSchema', () => {
  it('should validate a complete valid SurfaceJSON', () => {
    const result = surfaceJsonSchema.safeParse(validSurface)
    expect(result.success).toBe(true)
  })

  it('should validate a minimal valid SurfaceJSON', () => {
    const minimal: SurfaceJSON = {
      id: 'minimal',
      version: '1.0.0',
      environment: 'web',
      layout: { type: 'text' },
    }
    const result = surfaceJsonSchema.safeParse(minimal)
    expect(result.success).toBe(true)
  })

  it('should fail when id is missing', () => {
    const invalid = { ...validSurface, id: undefined }
    const result = surfaceJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when id is empty string', () => {
    const invalid = { ...validSurface, id: '' }
    const result = surfaceJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when version is missing', () => {
    const invalid = { ...validSurface, version: undefined }
    const result = surfaceJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when environment is invalid', () => {
    const invalid = { ...validSurface, environment: 'invalid-env' }
    const result = surfaceJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when environment is missing', () => {
    const invalid = { ...validSurface, environment: undefined }
    const result = surfaceJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when layout is missing', () => {
    const invalid = { ...validSurface, layout: undefined }
    const result = surfaceJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should validate all valid environment types', () => {
    const environments = ['web', 'api', 'cli', 'worker', 'edge', 'node', 'native', 'test']
    for (const env of environments) {
      const surface = { ...validSurface, environment: env }
      const result = surfaceJsonSchema.safeParse(surface)
      expect(result.success, 'Expected environment ' + env + ' to be valid').toBe(true)
    }
  })

  it('should accept optional $schema field', () => {
    const withSchema = { ...validSurface, $schema: 'https://example.com/schemas/surface.json' }
    const result = surfaceJsonSchema.safeParse(withSchema)
    expect(result.success).toBe(true)
  })

  it('should accept surface without metadata', () => {
    const { metadata: _metadata, ...withoutMetadata } = validSurface
    const result = surfaceJsonSchema.safeParse(withoutMetadata)
    expect(result.success).toBe(true)
  })

  it('should accept surface without bindings', () => {
    const { bindings: _bindings, ...withoutBindings } = validSurface
    const result = surfaceJsonSchema.safeParse(withoutBindings)
    expect(result.success).toBe(true)
  })
})

// ============================================================
// BINDING JSON SCHEMA TESTS
// ============================================================

describe('bindingJsonSchema', () => {
  it('should validate a valid binding with capability only', () => {
    const binding: BindingJSON = { capability: 'user.profile' }
    const result = bindingJsonSchema.safeParse(binding)
    expect(result.success).toBe(true)
  })

  it('should validate a binding with alias', () => {
    const binding: BindingJSON = { capability: 'user.profile', alias: 'profile' }
    const result = bindingJsonSchema.safeParse(binding)
    expect(result.success).toBe(true)
  })

  it('should validate a binding with transform', () => {
    const binding: BindingJSON = {
      capability: 'user.profile',
      transform: {
        input: { userId: 'current' },
        output: { name: 'displayName' },
      },
    }
    const result = bindingJsonSchema.safeParse(binding)
    expect(result.success).toBe(true)
  })

  it('should fail when capability is missing', () => {
    const invalid = { alias: 'profile' }
    const result = bindingJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when capability is empty string', () => {
    const invalid = { capability: '' }
    const result = bindingJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})

// ============================================================
// LAYOUT JSON SCHEMA TESTS
// ============================================================

describe('layoutJsonSchema', () => {
  it('should validate a simple layout', () => {
    const layout: LayoutJSON = { type: 'text', props: { content: 'Hello' } }
    const result = layoutJsonSchema.safeParse(layout)
    expect(result.success).toBe(true)
  })

  it('should validate a layout with children', () => {
    const result = layoutJsonSchema.safeParse(validLayout)
    expect(result.success).toBe(true)
  })

  it('should validate recursive children correctly', () => {
    const deepLayout: LayoutJSON = {
      type: 'container',
      children: [
        {
          type: 'container',
          children: [
            {
              type: 'container',
              children: [{ type: 'text', props: { content: 'Deep' } }],
            },
          ],
        },
      ],
    }
    const result = layoutJsonSchema.safeParse(deepLayout)
    expect(result.success).toBe(true)
  })

  it('should validate layout with slot', () => {
    const layout: LayoutJSON = { type: 'container', slot: 'main' }
    const result = layoutJsonSchema.safeParse(layout)
    expect(result.success).toBe(true)
  })

  it('should validate layout with if condition', () => {
    const layout: LayoutJSON = { type: 'text', if: 'user.isAdmin', props: { content: 'Admin' } }
    const result = layoutJsonSchema.safeParse(layout)
    expect(result.success).toBe(true)
  })

  it('should validate layout with each loop', () => {
    const layout: LayoutJSON = {
      type: 'container',
      each: { items: 'users', as: 'user', key: 'user.id' },
      children: [{ type: 'text', props: { content: '{{user.name}}' } }],
    }
    const result = layoutJsonSchema.safeParse(layout)
    expect(result.success).toBe(true)
  })

  it('should fail when type is missing', () => {
    const invalid = { props: { content: 'Hello' } }
    const result = layoutJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when type is empty string', () => {
    const invalid = { type: '' }
    const result = layoutJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when each.items is missing', () => {
    const invalid = { type: 'container', each: { as: 'item' } }
    const result = layoutJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })

  it('should fail when each.as is missing', () => {
    const invalid = { type: 'container', each: { items: 'list' } }
    const result = layoutJsonSchema.safeParse(invalid)
    expect(result.success).toBe(false)
  })
})

// ============================================================
// TYPE GUARD TESTS
// ============================================================

describe('isSurfaceJSON', () => {
  it('should return true for valid SurfaceJSON', () => {
    expect(isSurfaceJSON(validSurface)).toBe(true)
  })

  it('should return false for invalid data', () => {
    expect(isSurfaceJSON({})).toBe(false)
    expect(isSurfaceJSON(null)).toBe(false)
    expect(isSurfaceJSON(undefined)).toBe(false)
    expect(isSurfaceJSON('string')).toBe(false)
    expect(isSurfaceJSON(42)).toBe(false)
  })

  it('should return false for partial SurfaceJSON', () => {
    expect(isSurfaceJSON({ id: 'test' })).toBe(false)
  })
})

describe('isLayoutJSON', () => {
  it('should return true for valid LayoutJSON', () => {
    expect(isLayoutJSON(validLayout)).toBe(true)
  })

  it('should return false for invalid data', () => {
    expect(isLayoutJSON({})).toBe(false)
    expect(isLayoutJSON(null)).toBe(false)
    expect(isLayoutJSON({ type: '' })).toBe(false)
  })
})

describe('isBindingJSON', () => {
  it('should return true for valid BindingJSON', () => {
    expect(isBindingJSON({ capability: 'test.cap' })).toBe(true)
  })

  it('should return false for invalid data', () => {
    expect(isBindingJSON({})).toBe(false)
    expect(isBindingJSON(null)).toBe(false)
    expect(isBindingJSON({ capability: '' })).toBe(false)
  })
})

// ============================================================
// BACKWARD COMPATIBILITY WITH interpretSurface
// ============================================================

describe('backward compatibility with interpretSurface', () => {
  it('should successfully interpret a valid surface through interpretSurface', () => {
    const result = interpretSurface(validSurface)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.surface.id).toBe('test-surface')
    expect(result.surface.version).toBe('1.0.0')
    expect(result.surface.environment).toBe('web')
    expect(result.surface.metadata.name).toBe('Test Surface')
  })

  it('should fail interpretSurface with missing id', () => {
    const invalid = { ...validSurface, id: '' } as SurfaceJSON
    const result = interpretSurface(invalid)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should fail interpretSurface with invalid environment', () => {
    const invalid = { ...validSurface, environment: 'invalid' } as SurfaceJSON
    const result = interpretSurface(invalid)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should fail interpretSurface with missing layout', () => {
    const invalid = { ...validSurface, layout: undefined } as unknown as SurfaceJSON
    const result = interpretSurface(invalid)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('should preserve bindings through interpretSurface', () => {
    const result = interpretSurface(validSurface)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.surface.bindings.get('profile')).toBe('user.profile')
  })
})
