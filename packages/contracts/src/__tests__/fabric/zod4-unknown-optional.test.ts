/**
 * zod 3 → zod 4 regression: `z.unknown()` / `z.any()` object members.
 *
 * In zod 3 an object member typed `z.unknown()` or `z.any()` was implicitly
 * optional — a payload with the key missing parsed. zod 4 makes such a member
 * required unless it says `.optional()`. Engine 1.x accepted the payloads
 * below; these tests pin that behaviour so the 2.x schemas keep it.
 *
 * @module @pwfabric/contracts/__tests__/fabric/zod4-unknown-optional
 */

import { describe, it, expect } from 'vitest'
import { surfaceActionSchema, surfaceBehaviorSchema } from '../../fabric/surface-schema.js'
import { SURFACE_EVENT_PAYLOAD_SCHEMAS } from '../../fabric/surface-events.js'

describe('setState action without `value` (1.x accepted it)', () => {
  it('surfaceActionSchema accepts { type: "setState", key } with no value', () => {
    const result = surfaceActionSchema.safeParse({ type: 'setState', key: 'k' })
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data).toEqual({ type: 'setState', key: 'k' })
    expect('value' in result.data).toBe(false)
  })

  it('surfaceBehaviorSchema accepts a behaviour whose setState has no value', () => {
    const result = surfaceBehaviorSchema.safeParse({
      id: 'b1',
      event: 'block:click',
      actions: [{ type: 'setState', key: 'selected' }],
    })
    expect(result.success).toBe(true)
  })

  it('still requires `key`', () => {
    expect(surfaceActionSchema.safeParse({ type: 'setState' }).success).toBe(false)
  })

  it('keeps an explicit value, including falsy ones', () => {
    for (const value of [0, '', false, null, { a: 1 }]) {
      const result = surfaceActionSchema.safeParse({ type: 'setState', key: 'k', value })
      expect(result.success).toBe(true)
      if (result.success && result.data.type === 'setState') expect(result.data.value).toEqual(value)
    }
  })
})

describe('event payloads without `value` (1.x accepted them)', () => {
  const cases = [
    { event: 'form:change', payload: { field: 'email', formId: 'f1' } },
    { event: 'input:change', payload: { inputId: 'i1' } },
  ] as const

  it.each(cases)('$event accepts a payload with no value', ({ event, payload }) => {
    expect(SURFACE_EVENT_PAYLOAD_SCHEMAS[event].safeParse(payload).success).toBe(true)
  })

  it.each(cases)('$event still requires its other members', ({ event }) => {
    expect(SURFACE_EVENT_PAYLOAD_SCHEMAS[event].safeParse({}).success).toBe(false)
  })
})
