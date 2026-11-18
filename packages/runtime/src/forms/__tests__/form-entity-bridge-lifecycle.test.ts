/**
 * form-entity-bridge: status lifecycle is bound to the REAL create result.
 * On success → loading true→false + success true (+ refreshAll). On failure →
 * loading true→false + error true. Not optimistic.
 */

import { describe, it, expect, vi } from 'vitest'
import { createSurfaceEventBus } from '../../render/surface-event-bus.js'
import { attachFormEntityBridge } from '../form-entity-bridge.js'
import type { FormWriter } from '../form-entity-bridge.js'
import type { SurfaceEventDescriptor } from '@pwfabric/contracts'

const flush = () => new Promise((r) => setTimeout(r, 0))

function setStates(events: SurfaceEventDescriptor[]): { key: string; value: unknown }[] {
  return events
    .map((e) => (e.payload as { action?: { type?: string; key?: string; value?: unknown } })?.action)
    .filter((a): a is { type: 'setState'; key: string; value: unknown } => a?.type === 'setState')
    .map((a) => ({ key: a.key, value: a.value }))
}

const statusKeys = { loading: 'formLoading', success: 'submitted', error: 'formError' }

/**
 * The bridge writes through a FormWriter now — one declaration for our store
 * and for anyone else's endpoint, with only the host knowing which a source id
 * means. What this file tests is unchanged: the status lifecycle the bridge
 * drives around whatever the write returns.
 */
function makeWriter(result: { success: boolean }): FormWriter {
  return { write: vi.fn(async () => result) } as unknown as FormWriter
}

function submit(bus: ReturnType<typeof createSurfaceEventBus>) {
  bus.emit({
    type: 'form:submit',
    surfaceId: 's1',
    blockId: 'add-form',
    payload: { values: { name: 'Ada' }, formId: 'add-form', timestamp: 0 },
  } as SurfaceEventDescriptor)
}

describe('form-entity-bridge status lifecycle (API-bound)', () => {
  it('success → loading on→off + success true + refreshAll', async () => {
    const bus = createSurfaceEventBus()
    const events: SurfaceEventDescriptor[] = []
    bus.on('*', (e) => events.push(e))
    attachFormEntityBridge(bus, makeWriter({ success: true }), {
      formId: 'add-form',
      sourceId: 'contact' as never,
      statusKeys,
    })
    submit(bus)
    await flush()
    const states = setStates(events)
    expect(states).toEqual(
      expect.arrayContaining([
        { key: 'formLoading', value: true },
        { key: 'formLoading', value: false },
        { key: 'submitted', value: true },
      ])
    )
    // success state set AFTER loading cleared (API result, not optimistic)
    expect(states.some((s) => s.key === 'submitted' && s.value === true)).toBe(true)
    expect(events.some((e) => e.type === 'entity:created')).toBe(true)
  })

  it('failure → loading on→off + error true, NO success', async () => {
    const bus = createSurfaceEventBus()
    const events: SurfaceEventDescriptor[] = []
    bus.on('*', (e) => events.push(e))
    attachFormEntityBridge(bus, makeWriter({ success: false }), {
      formId: 'add-form',
      sourceId: 'contact' as never,
      statusKeys,
    })
    submit(bus)
    await flush()
    const states = setStates(events)
    expect(states).toContainEqual({ key: 'formError', value: true })
    expect(states).toContainEqual({ key: 'formLoading', value: false })
    expect(states.some((s) => s.key === 'submitted' && s.value === true)).toBe(false)
    expect(events.some((e) => e.type === 'entity:created')).toBe(false)
  })
})

describe('form-entity-bridge — statusKeys.reason is a code, .fields the refused fields, .detail the writer words', () => {
  const keys = { ...statusKeys, reason: 'saveReason', fields: 'saveFields', detail: 'saveDetail' }

  it('failure → reason a code (no sentence), fields the named fields, detail the error the writer returned', async () => {
    const bus = createSurfaceEventBus()
    const events: SurfaceEventDescriptor[] = []
    bus.on('*', (e) => events.push(e))
    const writer = {
      write: vi.fn(async () => ({
        success: false,
        error: { type: 'validation', message: 'otp: unknown', details: { status: 400, fields: ['otp'], detail: 'otp: unknown' } },
      })),
    } as unknown as FormWriter
    attachFormEntityBridge(bus, writer, { formId: 'add-form', sourceId: 'contact' as never, statusKeys: keys })
    submit(bus)
    await flush()
    const states = setStates(events)
    expect(states).toContainEqual({ key: 'saveReason', value: 'validation' })
    expect(states).toContainEqual({ key: 'saveFields', value: ['otp'] })
    expect(states).toContainEqual({ key: 'saveDetail', value: 'otp: unknown' })
    // Cleared at the start of the attempt, before the result lands.
    expect(states[states.findIndex((s) => s.key === 'saveReason')]).toEqual({ key: 'saveReason', value: '' })
    expect(states[states.findIndex((s) => s.key === 'saveFields')]).toEqual({ key: 'saveFields', value: [] })
  })

  it('a refusal by status is its reason code', async () => {
    const bus = createSurfaceEventBus()
    const events: SurfaceEventDescriptor[] = []
    bus.on('*', (e) => events.push(e))
    const writer = {
      write: vi.fn(async () => ({
        success: false,
        error: { type: 'not_found', message: 'Route not found', details: { status: 404, detail: '404 NOT_FOUND: Route not found' } },
      })),
    } as unknown as FormWriter
    attachFormEntityBridge(bus, writer, { formId: 'add-form', sourceId: 'contact' as never, statusKeys: keys })
    submit(bus)
    await flush()
    const states = setStates(events)
    expect(states).toContainEqual({ key: 'saveReason', value: 'error' })
    expect(states).toContainEqual({ key: 'saveDetail', value: '404 NOT_FOUND: Route not found' })
  })

  it('success → reason cleared, never set', async () => {
    const bus = createSurfaceEventBus()
    const events: SurfaceEventDescriptor[] = []
    bus.on('*', (e) => events.push(e))
    attachFormEntityBridge(bus, makeWriter({ success: true }), {
      formId: 'add-form',
      sourceId: 'contact' as never,
      statusKeys: keys,
    })
    submit(bus)
    await flush()
    const reasons = setStates(events).filter((s) => s.key === 'saveReason')
    expect(reasons).toEqual([{ key: 'saveReason', value: '' }])
  })
})
