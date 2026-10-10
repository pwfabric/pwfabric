/**
 * Surface Events — Namespace Registry & Payload Schema Tests
 *
 * Verifies SURFACE_EVENT_NAMESPACE_REGISTRY (8 namespaces, closed list)
 * and SURFACE_EVENT_PAYLOAD_SCHEMAS (Zod schemas validate correctly).
 *
 * @module @pwfabric/contracts/fabric/__tests__/surface-events
 */

import { describe, it, expect } from 'vitest'
import {
  SURFACE_EVENT_NAMESPACE_REGISTRY,
  SURFACE_EVENT_PAYLOAD_SCHEMAS,
} from '../surface-events.js'
import type { SurfaceEventNamespace, KnownSurfaceEventType } from '../surface-events.js'

// ============================================================
// NAMESPACE REGISTRY
// ============================================================

describe('SURFACE_EVENT_NAMESPACE_REGISTRY', () => {
  it('has exactly 8 namespaces', () => {
    expect(Object.keys(SURFACE_EVENT_NAMESPACE_REGISTRY)).toHaveLength(8)
  })

  it('contains all required namespaces', () => {
    const keys = Object.keys(SURFACE_EVENT_NAMESPACE_REGISTRY) as SurfaceEventNamespace[]
    expect(keys).toContain('surface:')
    expect(keys).toContain('block:')
    expect(keys).toContain('form:')
    expect(keys).toContain('input:')
    expect(keys).toContain('media:')
    expect(keys).toContain('navigation:')
    expect(keys).toContain('entity:')
    expect(keys).toContain('capability:')
  })

  it('all namespace keys end with colon', () => {
    for (const key of Object.keys(SURFACE_EVENT_NAMESPACE_REGISTRY)) {
      expect(key.endsWith(':')).toBe(true)
    }
  })

  it('all values are non-empty strings describing the owner', () => {
    for (const value of Object.values(SURFACE_EVENT_NAMESPACE_REGISTRY)) {
      expect(typeof value).toBe('string')
      expect(value.length).toBeGreaterThan(0)
    }
  })

  it('is importable from the barrel @pwfabric/contracts', async () => {
    const contracts = await import('@pwfabric/contracts')
    expect((contracts as Record<string, unknown>)['SURFACE_EVENT_NAMESPACE_REGISTRY']).toBeDefined()
    expect(
      Object.keys(
        (contracts as Record<string, unknown>)['SURFACE_EVENT_NAMESPACE_REGISTRY'] as object
      )
    ).toHaveLength(8)
  })
})

// ============================================================
// PAYLOAD SCHEMA REGISTRY
// ============================================================

describe('SURFACE_EVENT_PAYLOAD_SCHEMAS', () => {
  it('has schemas for 6 known event types', () => {
    expect(Object.keys(SURFACE_EVENT_PAYLOAD_SCHEMAS)).toHaveLength(6)
  })

  it('contains schemas for all specified event types', () => {
    const keys = Object.keys(SURFACE_EVENT_PAYLOAD_SCHEMAS) as KnownSurfaceEventType[]
    expect(keys).toContain('form:submit')
    expect(keys).toContain('form:change')
    expect(keys).toContain('input:change')
    expect(keys).toContain('entity:created')
    expect(keys).toContain('entity:updated')
    expect(keys).toContain('entity:deleted')
  })

  describe('form:submit schema', () => {
    const schema = SURFACE_EVENT_PAYLOAD_SCHEMAS['form:submit']

    it('accepts a valid form:submit payload', () => {
      const result = schema.safeParse({
        values: { name: 'Alice', age: 30 },
        formId: 'contact-form',
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(true)
    })

    it('rejects payload missing formId', () => {
      const result = schema.safeParse({
        values: {},
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(false)
    })

    it('rejects payload missing timestamp', () => {
      const result = schema.safeParse({
        values: {},
        formId: 'form-1',
      })
      expect(result.success).toBe(false)
    })
  })

  describe('form:change schema', () => {
    const schema = SURFACE_EVENT_PAYLOAD_SCHEMAS['form:change']

    it('accepts a valid form:change payload', () => {
      const result = schema.safeParse({
        field: 'email',
        value: 'alice@example.com',
        formId: 'contact-form',
      })
      expect(result.success).toBe(true)
    })

    it('rejects payload missing field', () => {
      const result = schema.safeParse({ value: 'x', formId: 'f1' })
      expect(result.success).toBe(false)
    })
  })

  describe('input:change schema', () => {
    const schema = SURFACE_EVENT_PAYLOAD_SCHEMAS['input:change']

    it('accepts a valid input:change payload without validationResult', () => {
      const result = schema.safeParse({ value: 'hello', inputId: 'i1' })
      expect(result.success).toBe(true)
    })

    it('accepts a valid input:change payload with validationResult', () => {
      const result = schema.safeParse({
        value: '',
        inputId: 'i1',
        validationResult: { valid: false, errors: ['Required'] },
      })
      expect(result.success).toBe(true)
    })

    it('rejects payload missing inputId', () => {
      const result = schema.safeParse({ value: 'x' })
      expect(result.success).toBe(false)
    })
  })

  describe('entity:created schema', () => {
    const schema = SURFACE_EVENT_PAYLOAD_SCHEMAS['entity:created']

    it('accepts a valid entity:created payload', () => {
      const result = schema.safeParse({
        entityType: 'Post',
        instanceId: 'post-1',
        data: { title: 'Hello' },
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(true)
    })

    it('rejects payload missing instanceId', () => {
      const result = schema.safeParse({
        entityType: 'Post',
        data: {},
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(false)
    })
  })

  describe('entity:updated schema', () => {
    const schema = SURFACE_EVENT_PAYLOAD_SCHEMAS['entity:updated']

    it('accepts a valid entity:updated payload without changeset', () => {
      const result = schema.safeParse({
        entityType: 'Post',
        instanceId: 'post-1',
        data: { title: 'Updated' },
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(true)
    })

    it('accepts a valid entity:updated payload with changeset', () => {
      const result = schema.safeParse({
        entityType: 'Post',
        instanceId: 'post-1',
        data: { title: 'Updated' },
        changeset: { title: 'Updated' },
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(true)
    })
  })

  describe('entity:deleted schema', () => {
    const schema = SURFACE_EVENT_PAYLOAD_SCHEMAS['entity:deleted']

    it('accepts a valid entity:deleted payload', () => {
      const result = schema.safeParse({
        entityType: 'Post',
        instanceId: 'post-1',
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(true)
    })

    it('rejects payload missing entityType', () => {
      const result = schema.safeParse({
        instanceId: 'post-1',
        timestamp: 1700000000000,
      })
      expect(result.success).toBe(false)
    })
  })

  it('is importable from the barrel @pwfabric/contracts', async () => {
    const contracts = await import('@pwfabric/contracts')
    expect((contracts as Record<string, unknown>)['SURFACE_EVENT_PAYLOAD_SCHEMAS']).toBeDefined()
  })
})
