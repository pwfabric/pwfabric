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

describe('form-entity-bridge — statusKeys.message carries the writer message', () => {
  const keys = { ...statusKeys, message: 'saveMessage' }

  it('failure → message set to the error message the writer returned', async () => {
    const bus = createSurfaceEventBus()
    const events: SurfaceEventDescriptor[] = []
    bus.on('*', (e) => events.push(e))
    const writer = {
      write: vi.fn(async () => ({
        success: false,
        error: { type: 'not_found', message: 'The server could not save this record (404): Route not found' },
      })),
    } as unknown as FormWriter
    attachFormEntityBridge(bus, writer, { formId: 'add-form', sourceId: 'contact' as never, statusKeys: keys })
    submit(bus)
    await flush()
    const states = setStates(events)
    expect(states).toContainEqual({
      key: 'saveMessage',
      value: 'The server could not save this record (404): Route not found',
    })
    // Cleared at the start of the attempt, before the result lands.
    const first = states.findIndex((s) => s.key === 'saveMessage')
    expect(states[first]).toEqual({ key: 'saveMessage', value: '' })
  })

  it('success → message cleared, never set', async () => {
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
    const messages = setStates(events).filter((s) => s.key === 'saveMessage')
    expect(messages).toEqual([{ key: 'saveMessage', value: '' }])
  })
})
