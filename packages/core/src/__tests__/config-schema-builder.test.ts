/**
 * ConfigSchema Builder Tests
 *
 * Tests for defineConfigSchema() builder
 *
 * @module @pwfabric/core/__tests__/config-schema-builder
 */

import { describe, it, expect } from 'vitest'
import { defineConfigSchema, SimpleConfigSchema } from '../config-schema-builder.js'

describe('defineConfigSchema', () => {
  it('should build a schema with string, number, and boolean fields', () => {
    const schema = defineConfigSchema()
      .field('name', (f) => f.string().required().label('Name'))
      .field('timeout', (f) => f.number().default(5000).label('Timeout'))
      .field('enabled', (f) => f.boolean().default(true).label('Enabled'))
      .build()

    expect(schema).toBeInstanceOf(SimpleConfigSchema)
    expect(schema.fields).toHaveLength(3)

    const [f0, f1, f2] = schema.fields
    expect(f0).toBeDefined()
    expect(f0?.key).toBe('name')
    expect(f0?.type).toBe('string')
    expect(f0?.required).toBe(true)
    expect(f1?.type).toBe('number')
    expect(f1?.defaultValue).toBe(5000)
    expect(f2?.type).toBe('boolean')
    expect(f2?.defaultValue).toBe(true)
  })

  it('should build select and multi-select fields with options', () => {
    const schema = defineConfigSchema()
      .field('locale', (f) => f.select(['en', 'tr', 'de']).required().label('Locale'))
      .field('providers', (f) =>
        f
          .multiSelect([
            { value: 'email', label: 'Email' },
            { value: 'google', label: 'Google' },
          ])
          .label('Providers')
      )
      .build()

    const [localeField, providerField] = schema.fields
    expect(localeField?.type).toBe('select')
    expect(localeField?.options).toHaveLength(3)
    expect(localeField?.options?.at(0)?.value).toBe('en')
    expect(providerField?.type).toBe('multi-select')
    expect(providerField?.options).toHaveLength(2)
    expect(providerField?.options?.at(0)?.label).toBe('Email')
  })

  it('should support url, email, and json field types', () => {
    const schema = defineConfigSchema()
      .field('website', (f) => f.url().label('Website'))
      .field('contact', (f) => f.email().label('Contact'))
      .field('extra', (f) => f.json().label('Extra Config'))
      .build()

    const [f0, f1, f2] = schema.fields
    expect(f0?.type).toBe('url')
    expect(f1?.type).toBe('email')
    expect(f2?.type).toBe('json')
  })

  it('should support sensitive fields', () => {
    const schema = defineConfigSchema()
      .field('apiKey', (f) => f.string().sensitive().label('API Key'))
      .build()

    expect(schema.fields.at(0)?.sensitive).toBe(true)
  })

  it('should support constraints', () => {
    const schema = defineConfigSchema()
      .field('port', (f) => f.number().min(1).max(65535).label('Port'))
      .field('slug', (f) =>
        f.string().pattern('^[a-z-]+$', 'Lowercase with dashes only').label('Slug')
      )
      .build()

    const [portField, slugField] = schema.fields
    expect(portField?.constraints?.min).toBe(1)
    expect(portField?.constraints?.max).toBe(65535)
    expect(slugField?.constraints?.pattern).toBe('^[a-z-]+$')
    expect(slugField?.constraints?.patternMessage).toBe('Lowercase with dashes only')
  })

  it('should support groups', () => {
    const schema = defineConfigSchema()
      .field('name', (f) => f.string().label('Name'))
      .group('Advanced', (g) => {
        g.field('timeout', (f) => f.number().label('Timeout'))
        g.field('debug', (f) => f.boolean().label('Debug'))
      })
      .build()

    expect(schema.fields).toHaveLength(3)
    const [f0, f1, f2] = schema.fields
    expect(f0?.group).toBeUndefined()
    expect(f1?.group).toBe('Advanced')
    expect(f2?.group).toBe('Advanced')
  })
})

describe('SimpleConfigSchema.validate', () => {
  const schema = defineConfigSchema()
    .field('name', (f) => f.string().required().label('Name'))
    .field('count', (f) => f.number().default(10).label('Count').min(1).max(100))
    .field('locale', (f) => f.select(['en', 'tr']).required().label('Locale'))
    .field('tags', (f) => f.multiSelect(['a', 'b', 'c']).label('Tags'))
    .field('enabled', (f) => f.boolean().label('Enabled'))
    .build()

  it('should pass valid data', () => {
    const result = schema.validate({
      name: 'test',
      count: 5,
      locale: 'en',
      tags: ['a'],
      enabled: true,
    })
    expect(result.success).toBe(true)
  })

  it('should fail when required field is missing', () => {
    const result = schema.validate({ count: 5, locale: 'en' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.some((e) => e.path[0] === 'name')).toBe(true)
    }
  })

  it('should fail on type mismatch', () => {
    const result = schema.validate({ name: 'test', count: 'not-a-number', locale: 'en' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.some((e) => e.path[0] === 'count' && e.code === 'type')).toBe(true)
    }
  })

  it('should fail when number is below min', () => {
    const result = schema.validate({ name: 'test', count: 0, locale: 'en' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.some((e) => e.path[0] === 'count' && e.code === 'constraint')).toBe(true)
    }
  })

  it('should fail when number exceeds max', () => {
    const result = schema.validate({ name: 'test', count: 200, locale: 'en' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.some((e) => e.path[0] === 'count')).toBe(true)
    }
  })

  it('should fail when select value is not in options', () => {
    const result = schema.validate({ name: 'test', locale: 'ja' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.some((e) => e.path[0] === 'locale')).toBe(true)
    }
  })

  it('should fail when multi-select contains invalid option', () => {
    const result = schema.validate({ name: 'test', locale: 'en', tags: ['a', 'z'] })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.some((e) => e.path[0] === 'tags')).toBe(true)
    }
  })

  it('should fail on pattern constraint', () => {
    const s = defineConfigSchema()
      .field('slug', (f) => f.string().required().pattern('^[a-z]+$').label('Slug'))
      .build()
    const result = s.validate({ slug: 'UPPER' })
    expect(result.success).toBe(false)
  })

  it('should accept non-object data gracefully', () => {
    const result = schema.validate(null)
    expect(result.success).toBe(false)
  })
})

describe('SimpleConfigSchema.applyDefaults', () => {
  it('should fill missing fields with defaults', () => {
    const schema = defineConfigSchema<{ name: string; timeout: number; enabled: boolean }>()
      .field('name', (f) => f.string().required().label('Name'))
      .field('timeout', (f) => f.number().default(5000).label('Timeout'))
      .field('enabled', (f) => f.boolean().default(true).label('Enabled'))
      .build()

    const result = schema.applyDefaults({ name: 'test' })
    expect(result.name).toBe('test')
    expect(result.timeout).toBe(5000)
    expect(result.enabled).toBe(true)
  })

  it('should not overwrite provided values', () => {
    const schema = defineConfigSchema<{ timeout: number }>()
      .field('timeout', (f) => f.number().default(5000).label('Timeout'))
      .build()

    const result = schema.applyDefaults({ timeout: 3000 })
    expect(result.timeout).toBe(3000)
  })
})
