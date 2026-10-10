/**
 * Surface Interpreter Tests
 *
 * Additional coverage for interpreter edge cases.
 *
 * @module @pwfabric/runtime/surface/__tests__/interpreter
 */

import { describe, it, expect } from 'vitest'
import {
  interpretSurface,
  parseSurfaceJSON,
  surface,
  createSurfaceContext,
} from '../interpreter.js'
import type { SurfaceJSON } from '../types.js'

// ============================================================
// HELPERS
// ============================================================

function validSurfaceJSON(overrides: Partial<SurfaceJSON> = {}): SurfaceJSON {
  return {
    id: 'test-surface',
    version: '1.0.0',
    environment: 'web',
    layout: { type: 'text', props: { content: 'Hello' } },
    ...overrides,
  }
}

// ============================================================
// interpretSurface
// ============================================================

describe('interpretSurface()', () => {
  it('returns success for valid surface JSON', () => {
    const result = interpretSurface(validSurfaceJSON())
    expect(result.success).toBe(true)
  })

  it('returns error when surface has no id', () => {
    const result = interpretSurface(validSurfaceJSON({ id: '' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('id'))).toBe(true)
    }
  })

  it('returns error when surface has no version', () => {
    const result = interpretSurface(validSurfaceJSON({ version: '' }))
    expect(result.success).toBe(false)
  })

  it('returns error for invalid version format', () => {
    const result = interpretSurface(validSurfaceJSON({ version: 'not-a-semver' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('version'))).toBe(true)
    }
  })

  it('returns error for invalid environment', () => {
    const result = interpretSurface(validSurfaceJSON({ environment: 'invalid-env' as never }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('environment'))).toBe(true)
    }
  })

  it('returns error when bindings is not an array', () => {
    const result = interpretSurface({
      ...validSurfaceJSON(),
      bindings: 'not-an-array' as never,
    })
    expect(result.success).toBe(false)
  })

  it('returns error when binding capability is not a string', () => {
    const result = interpretSurface({
      ...validSurfaceJSON(),
      bindings: [{ capability: 123 as never }],
    })
    expect(result.success).toBe(false)
  })

  it('returns error when metadata is not an object', () => {
    const result = interpretSurface({
      ...validSurfaceJSON(),
      metadata: 'string-metadata' as never,
    })
    expect(result.success).toBe(false)
  })

  it('includes bindings in interpreted surface', () => {
    const result = interpretSurface(
      validSurfaceJSON({
        bindings: [{ capability: 'cap-x', alias: 'myAlias' }],
      })
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.surface.bindings.has('myAlias')).toBe(true)
    }
  })

  it('uses capability name as alias when no alias provided', () => {
    const result = interpretSurface(
      validSurfaceJSON({
        bindings: [{ capability: 'cap-y' }],
      })
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.surface.bindings.has('cap-y')).toBe(true)
    }
  })

  it('includes metadata description when provided', () => {
    const result = interpretSurface(
      validSurfaceJSON({
        metadata: { name: 'My Surface', description: 'A test surface', tags: ['a', 'b'] },
      })
    )
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.surface.metadata.description).toBe('A test surface')
      expect(result.surface.metadata.tags).toEqual(['a', 'b'])
    }
  })

  it('disables validation when options.validation is false', () => {
    const result = interpretSurface(validSurfaceJSON(), { validation: false })
    expect(result.success).toBe(true)
  })
})

// ============================================================
// parseSurfaceJSON
// ============================================================

describe('parseSurfaceJSON()', () => {
  it('parses valid JSON string', () => {
    const json = JSON.stringify(validSurfaceJSON())
    const result = parseSurfaceJSON(json)
    expect(result.success).toBe(true)
  })

  it('returns error for invalid JSON string', () => {
    const result = parseSurfaceJSON('{ not valid json }')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors.some((e) => e.includes('Invalid JSON'))).toBe(true)
    }
  })
})

// ============================================================
// SurfaceBuilder
// ============================================================

describe('SurfaceBuilder (surface())', () => {
  it('builds a surface with all options', () => {
    const result = surface('my-surface')
      .version('2.0.0')
      .environment('web')
      .name('My Surface')
      .description('Test surface')
      .tags('tag1', 'tag2')
      .bind('cap-a', 'myAlias')
      .layout({ type: 'text', props: { content: 'hi' } })
      .build()

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.surface.id).toContain('my-surface')
      expect(result.surface.metadata.description).toBe('Test surface')
    }
  })

  it('returns error when no layout set', () => {
    const result = surface('no-layout-surface').version('1.0.0').environment('web').build()

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.errors).toContain('Surface must have a layout')
    }
  })

  it('supports validation(false) to skip prop validation', () => {
    const result = surface('val-surface')
      .version('1.0.0')
      .environment('web')
      .layout({ type: 'text', props: { content: 'x' } })
      .validation(false)
      .build()

    expect(result.success).toBe(true)
  })

  it('supports bind without alias', () => {
    const result = surface('bind-surface')
      .version('1.0.0')
      .environment('web')
      .bind('cap-no-alias')
      .layout({ type: 'text' })
      .build()

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.surface.bindings.has('cap-no-alias')).toBe(true)
    }
  })
})

// ============================================================
// createSurfaceContext
// ============================================================

describe('createSurfaceContext()', () => {
  it('creates a render context from an interpreted surface', () => {
    const result = surface('ctx-surface')
      .version('1.0.0')
      .environment('web')
      .layout({ type: 'text' })
      .build()

    expect(result.success).toBe(true)
    if (!result.success) return

    const ctx = createSurfaceContext(result.surface, { userId: '42' })
    expect(ctx.surfaceId).toContain('ctx-surface')
    expect(ctx.data.userId).toBe('42')
  })

  it('uses empty data when none provided', () => {
    const result = surface('ctx-surface-2')
      .version('1.0.0')
      .environment('web')
      .layout({ type: 'text' })
      .build()

    expect(result.success).toBe(true)
    if (!result.success) return

    const ctx = createSurfaceContext(result.surface)
    expect(ctx.data).toEqual({})
  })
})
