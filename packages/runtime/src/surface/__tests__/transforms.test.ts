/**
 * Typed Transform Wrapper Tests
 *
 * Tests for transform config validators, factories, and type guard
 */

import { describe, it, expect } from 'vitest'
import type { TransformDescriptor } from '@pwfabric/contracts'
import {
  validateTransformConfig,
  narrowTransformDescriptor,
  createMapTransform,
  createFilterTransform,
  createPickTransform,
  createOmitTransform,
  createCustomTransform,
} from '../transforms.js'

describe('validateTransformConfig', () => {
  describe('map transform', () => {
    it('should validate a valid map config', () => {
      const result = validateTransformConfig('map', {
        field: 'name',
        mapper: 'toUpperCase',
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject map config missing field', () => {
      const result = validateTransformConfig('map', {
        mapper: 'toUpperCase',
      })

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('should reject map config with empty field', () => {
      const result = validateTransformConfig('map', {
        field: '',
        mapper: 'toUpperCase',
      })

      expect(result.valid).toBe(false)
    })
  })

  describe('filter transform', () => {
    it('should validate a valid filter config', () => {
      const result = validateTransformConfig('filter', {
        field: 'active',
        predicate: 'isTrue',
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject filter config missing predicate', () => {
      const result = validateTransformConfig('filter', {
        field: 'active',
      })

      expect(result.valid).toBe(false)
    })
  })

  describe('pick transform', () => {
    it('should validate a valid pick config', () => {
      const result = validateTransformConfig('pick', {
        fields: ['name', 'email'],
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject pick config with empty fields array', () => {
      const result = validateTransformConfig('pick', {
        fields: [],
      })

      expect(result.valid).toBe(false)
    })

    it('should reject pick config missing fields', () => {
      const result = validateTransformConfig('pick', {})

      expect(result.valid).toBe(false)
    })
  })

  describe('omit transform', () => {
    it('should validate a valid omit config', () => {
      const result = validateTransformConfig('omit', {
        fields: ['password', 'secret'],
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject omit config with empty fields', () => {
      const result = validateTransformConfig('omit', {
        fields: [],
      })

      expect(result.valid).toBe(false)
    })
  })

  describe('custom transform', () => {
    it('should validate a valid custom config', () => {
      const result = validateTransformConfig('custom', {
        handler: 'myCustomHandler',
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should validate custom config with params', () => {
      const result = validateTransformConfig('custom', {
        handler: 'myHandler',
        params: { threshold: 42, mode: 'strict' },
      })

      expect(result.valid).toBe(true)
    })

    it('should reject custom config missing handler', () => {
      const result = validateTransformConfig('custom', {
        params: { key: 'value' },
      })

      expect(result.valid).toBe(false)
    })
  })
})

describe('narrowTransformDescriptor', () => {
  it('should narrow a valid map descriptor', () => {
    const descriptor: TransformDescriptor = {
      type: 'map',
      config: { field: 'name', mapper: 'toUpperCase' },
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('map')
    if (result?.type === 'map') {
      expect(result.config.field).toBe('name')
      expect(result.config.mapper).toBe('toUpperCase')
    }
  })

  it('should narrow a valid filter descriptor', () => {
    const descriptor: TransformDescriptor = {
      type: 'filter',
      config: { field: 'active', predicate: 'isTrue' },
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('filter')
  })

  it('should narrow a valid pick descriptor', () => {
    const descriptor: TransformDescriptor = {
      type: 'pick',
      config: { fields: ['name', 'email'] },
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('pick')
  })

  it('should narrow a valid omit descriptor', () => {
    const descriptor: TransformDescriptor = {
      type: 'omit',
      config: { fields: ['password'] },
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('omit')
  })

  it('should narrow a valid custom descriptor', () => {
    const descriptor: TransformDescriptor = {
      type: 'custom',
      config: { handler: 'myHandler', params: { x: 1 } },
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).not.toBeNull()
    expect(result?.type).toBe('custom')
  })

  it('should return null for descriptor without config', () => {
    const descriptor: TransformDescriptor = {
      type: 'map',
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).toBeNull()
  })

  it('should return null for invalid config shape', () => {
    const descriptor: TransformDescriptor = {
      type: 'map',
      config: { wrong: 'shape' },
    }

    const result = narrowTransformDescriptor(descriptor)

    expect(result).toBeNull()
  })
})

describe('factory functions', () => {
  describe('createMapTransform', () => {
    it('should create a valid map transform descriptor', () => {
      const descriptor = createMapTransform({
        field: 'name',
        mapper: 'toUpperCase',
      })

      expect(descriptor.type).toBe('map')
      expect(descriptor.config).toEqual({
        field: 'name',
        mapper: 'toUpperCase',
      })
    })

    it('should throw on invalid config', () => {
      expect(() => createMapTransform({ field: '', mapper: 'test' })).toThrow()
    })
  })

  describe('createFilterTransform', () => {
    it('should create a valid filter transform descriptor', () => {
      const descriptor = createFilterTransform({
        field: 'active',
        predicate: 'isTrue',
      })

      expect(descriptor.type).toBe('filter')
      expect(descriptor.config).toEqual({
        field: 'active',
        predicate: 'isTrue',
      })
    })

    it('should throw on invalid config', () => {
      expect(() => createFilterTransform({ field: '', predicate: 'test' })).toThrow()
    })
  })

  describe('createPickTransform', () => {
    it('should create a valid pick transform descriptor', () => {
      const descriptor = createPickTransform({
        fields: ['name', 'email'],
      })

      expect(descriptor.type).toBe('pick')
      expect(descriptor.config).toEqual({
        fields: ['name', 'email'],
      })
    })

    it('should throw on empty fields', () => {
      expect(() => createPickTransform({ fields: [] })).toThrow()
    })
  })

  describe('createOmitTransform', () => {
    it('should create a valid omit transform descriptor', () => {
      const descriptor = createOmitTransform({
        fields: ['password'],
      })

      expect(descriptor.type).toBe('omit')
      expect(descriptor.config).toEqual({
        fields: ['password'],
      })
    })

    it('should throw on empty fields', () => {
      expect(() => createOmitTransform({ fields: [] })).toThrow()
    })
  })

  describe('createCustomTransform', () => {
    it('should create a valid custom transform descriptor', () => {
      const descriptor = createCustomTransform({
        handler: 'myHandler',
        params: { limit: 10 },
      })

      expect(descriptor.type).toBe('custom')
      expect(descriptor.config).toEqual({
        handler: 'myHandler',
        params: { limit: 10 },
      })
    })

    it('should create custom transform without params', () => {
      const descriptor = createCustomTransform({
        handler: 'simpleHandler',
      })

      expect(descriptor.type).toBe('custom')
      expect(descriptor.config).toEqual({
        handler: 'simpleHandler',
      })
    })

    it('should throw on missing handler', () => {
      expect(() => createCustomTransform({ handler: '' })).toThrow()
    })
  })

  describe('round-trip: factory -> narrowTransformDescriptor', () => {
    it('should narrow a factory-created map descriptor', () => {
      const descriptor = createMapTransform({ field: 'a', mapper: 'b' })
      const narrowed = narrowTransformDescriptor(descriptor)

      expect(narrowed).not.toBeNull()
      expect(narrowed?.type).toBe('map')
    })

    it('should narrow a factory-created filter descriptor', () => {
      const descriptor = createFilterTransform({ field: 'a', predicate: 'b' })
      const narrowed = narrowTransformDescriptor(descriptor)

      expect(narrowed).not.toBeNull()
      expect(narrowed?.type).toBe('filter')
    })

    it('should narrow a factory-created pick descriptor', () => {
      const descriptor = createPickTransform({ fields: ['a', 'b'] })
      const narrowed = narrowTransformDescriptor(descriptor)

      expect(narrowed).not.toBeNull()
      expect(narrowed?.type).toBe('pick')
    })

    it('should narrow a factory-created omit descriptor', () => {
      const descriptor = createOmitTransform({ fields: ['x'] })
      const narrowed = narrowTransformDescriptor(descriptor)

      expect(narrowed).not.toBeNull()
      expect(narrowed?.type).toBe('omit')
    })

    it('should narrow a factory-created custom descriptor', () => {
      const descriptor = createCustomTransform({ handler: 'h' })
      const narrowed = narrowTransformDescriptor(descriptor)

      expect(narrowed).not.toBeNull()
      expect(narrowed?.type).toBe('custom')
    })
  })
})
