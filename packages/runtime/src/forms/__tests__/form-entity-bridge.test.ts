/**
 * Form → Entity Bridge Tests
 *
 * Tests for the declarative form-to-entity bridge,
 * and. Tests for DefaultEntityStore bus injection.
 *
 * @module @pwfabric/runtime/forms/__tests__/form-entity-bridge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { attachFormEntityBridge } from '../form-entity-bridge.js'
import { DefaultEntityStore, createEntityStore } from '../../entity/store.js'
import { InMemoryEntityRegistry } from '../../entity/registry.js'
import { InMemoryConnectorRegistry } from '../../entity/connector.js'
import { StaticConnector } from '../../entity/connectors/static.js'
import { createSurfaceEventBus } from '../../render/surface-event-bus.js'
import type { SurfaceEventBus, SurfaceEventDescriptor } from '@pwfabric/contracts'
import type { EntityTypeId, EntityDefinition, EntityInstanceId } from '../../entity/types.js'

// ============================================================
// TEST HELPERS
// ============================================================

const CONTACT_TYPE = 'contact' as EntityTypeId

const contactSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
})

const contactDefinition: EntityDefinition = {
  id: CONTACT_TYPE,
  name: 'Contact',
  fields: [
    { name: 'name', type: 'string', required: true },
    { name: 'email', type: 'string', required: true },
  ],
  relations: [],
  primaryKey: 'id',
  timestamps: false,
  softDelete: false,
  schema: contactSchema,
}

function createTestSetup(withBus?: SurfaceEventBus): {
  registry: InMemoryEntityRegistry
  connectorRegistry: InMemoryConnectorRegistry
  connector: StaticConnector
  store: DefaultEntityStore
} {
  const registry = new InMemoryEntityRegistry()
  const connectorRegistry = new InMemoryConnectorRegistry()
  const connector = new StaticConnector('test-static')

  registry.register(contactDefinition)
  connectorRegistry.register(connector)
  connectorRegistry.setDefault('test-static')

  const store = new DefaultEntityStore(registry, connectorRegistry, withBus)
  return { registry, connectorRegistry, connector, store }
}

/**
 * The bridge writes through a FormWriter now, not an EntityStore — one
 * declaration serves our store and anyone else's endpoint, and only the host
 * knows which a source id means. For these tests the writer delegates to the
 * store, which is exactly what the host does for a platform-backed source, so
 * what is exercised here is still the bridge's own lifecycle.
 */
function writerFor(store: { create: (t: never, v: Record<string, unknown>) => unknown }): {
  write: (
    sourceId: string,
    values: Record<string, unknown>,
    method: 'POST' | 'PUT' | 'PATCH'
  ) => Promise<never>
} {
  return {
    write: async (sourceId, values) => store.create(sourceId as never, values) as never,
  }
}

function emitFormSubmit(
  bus: SurfaceEventBus,
  blockId: string,
  values: Record<string, unknown>
): void {
  bus.emit({
    type: 'form:submit',
    surfaceId: 'test-surface',
    blockId,
    payload: { values, formId: blockId, timestamp: Date.now() },
    timestamp: Date.now(),
  })
}

// ============================================================
// attachFormEntityBridge TESTS
// ============================================================

describe('attachFormEntityBridge', () => {
  let bus: SurfaceEventBus

  beforeEach(() => {
    bus = createSurfaceEventBus()
  })

  it('listens to form:submit events for the configured formId', async () => {
    const { store } = createTestSetup()
    const onSuccess = vi.fn()

    attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
      onSuccess,
    })

    // Arrange: valid form data
    emitFormSubmit(bus, 'contact-form', { name: 'Alice', email: 'alice@example.com' })

    // Allow async to settle
    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())
  })

  it('calls store.create() with form values', async () => {
    const { store } = createTestSetup()
    const createSpy = vi.spyOn(store, 'create')

    attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
    })

    emitFormSubmit(bus, 'contact-form', { name: 'Bob', email: 'bob@example.com' })

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledOnce())
    expect(createSpy).toHaveBeenCalledWith(CONTACT_TYPE, { name: 'Bob', email: 'bob@example.com' })
  })

  it('applies mapping function when provided', async () => {
    const { store } = createTestSetup()
    const createSpy = vi.spyOn(store, 'create')
    const mapping = (values: Record<string, unknown>): Record<string, unknown> => ({
      name: `${values.firstName} ${values.lastName}`,
      email: values.emailAddress,
    })

    attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
      mapping,
    })

    emitFormSubmit(bus, 'contact-form', {
      firstName: 'Carol',
      lastName: 'Smith',
      emailAddress: 'carol@example.com',
    })

    await vi.waitFor(() => expect(createSpy).toHaveBeenCalledOnce())
    expect(createSpy).toHaveBeenCalledWith(CONTACT_TYPE, {
      name: 'Carol Smith',
      email: 'carol@example.com',
    })
  })

  it('calls onSuccess when entity creation succeeds', async () => {
    const { store } = createTestSetup()
    const onSuccess = vi.fn()

    attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
      onSuccess,
    })

    emitFormSubmit(bus, 'contact-form', { name: 'Dave', email: 'dave@example.com' })

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce())

    const arg = onSuccess.mock.calls[0][0]
    expect(arg.success).toBe(true)
    expect(arg.data.name).toBe('Dave')
    expect(arg.id).toBeTruthy()
  })

  it('calls onError when entity creation fails', async () => {
    const { store } = createTestSetup()
    const onError = vi.fn()

    attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
      onError,
    })

    // Submit invalid data (email missing — fails schema)
    emitFormSubmit(bus, 'contact-form', { name: 'Eve' })

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())

    const error = onError.mock.calls[0][0]
    expect(error.type).toBe('validation')
  })

  it('ignores form:submit events for other form IDs', async () => {
    const { store } = createTestSetup()
    const onSuccess = vi.fn()
    const createSpy = vi.spyOn(store, 'create')

    attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
      onSuccess,
    })

    // Emit for a different form ID
    emitFormSubmit(bus, 'newsletter-form', { name: 'Frank', email: 'frank@example.com' })

    // Give async a chance to run
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(createSpy).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('returns unsubscribe function that stops listening', async () => {
    const { store } = createTestSetup()
    const onSuccess = vi.fn()

    const unsubscribe = attachFormEntityBridge(bus, writerFor(store), {
      formId: 'contact-form',
      sourceId: CONTACT_TYPE,
      onSuccess,
    })

    // Unsubscribe before emitting
    unsubscribe()

    emitFormSubmit(bus, 'contact-form', { name: 'Grace', email: 'grace@example.com' })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(onSuccess).not.toHaveBeenCalled()
  })
})

// ============================================================
// DefaultEntityStore — optional bus injection
// ============================================================

describe('DefaultEntityStore with eventBus', () => {
  let bus: SurfaceEventBus
  let emittedEvents: SurfaceEventDescriptor[]

  beforeEach(() => {
    bus = createSurfaceEventBus()
    emittedEvents = []
    bus.on('entity:*', (event) => emittedEvents.push(event))
  })

  it('emits entity:created event on successful create', async () => {
    const { store } = createTestSetup(bus)

    await store.create(CONTACT_TYPE, { name: 'Alice', email: 'alice@example.com' })

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].type).toBe('entity:created')
    expect(emittedEvents[0].payload).toMatchObject({
      entityType: CONTACT_TYPE,
      data: expect.objectContaining({ name: 'Alice' }),
    })
    expect(typeof (emittedEvents[0].payload as Record<string, unknown>)?.instanceId).toBe('string')
  })

  it('emits entity:updated event on successful update', async () => {
    const { store } = createTestSetup(bus)

    const created = await store.create(CONTACT_TYPE, { name: 'Bob', email: 'bob@example.com' })
    expect(created.success).toBe(true)
    if (!created.success) return

    // Clear events from create
    emittedEvents.length = 0

    await store.update(CONTACT_TYPE, created.id, { name: 'Bob Updated' })

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].type).toBe('entity:updated')
    expect(emittedEvents[0].payload).toMatchObject({
      entityType: CONTACT_TYPE,
      instanceId: created.id,
      changeset: { name: 'Bob Updated' },
    })
  })

  it('emits entity:deleted event on successful delete', async () => {
    const { store } = createTestSetup(bus)

    const created = await store.create(CONTACT_TYPE, { name: 'Carol', email: 'carol@example.com' })
    expect(created.success).toBe(true)
    if (!created.success) return

    emittedEvents.length = 0

    await store.delete(CONTACT_TYPE, created.id)

    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].type).toBe('entity:deleted')
    expect(emittedEvents[0].payload).toMatchObject({
      entityType: CONTACT_TYPE,
      instanceId: created.id,
    })
  })

  it('does NOT emit when no eventBus provided (bus is optional)', async () => {
    // Create store WITHOUT bus
    const { store } = createTestSetup()
    const wildcardSpy = vi.fn()
    bus.on('entity:*', wildcardSpy)

    await store.create(CONTACT_TYPE, { name: 'Dave', email: 'dave@example.com' })

    // The bus we attached spy to was never given to the store
    expect(wildcardSpy).not.toHaveBeenCalled()
  })

  it('does NOT emit on failed create operation', async () => {
    const { store } = createTestSetup(bus)

    // Attempt create with invalid data (missing required email)
    await store.create(CONTACT_TYPE, { name: 'Eve' })

    expect(emittedEvents).toHaveLength(0)
  })

  it('does NOT emit on failed update operation', async () => {
    const { store } = createTestSetup(bus)

    const created = await store.create(CONTACT_TYPE, { name: 'Frank', email: 'frank@example.com' })
    expect(created.success).toBe(true)
    if (!created.success) return

    emittedEvents.length = 0

    // Try to update a non-existent entity
    await store.update(CONTACT_TYPE, 'nonexistent-id' as EntityInstanceId, { name: 'Updated' })

    expect(emittedEvents).toHaveLength(0)
  })

  it('does NOT emit on failed delete operation', async () => {
    const { store } = createTestSetup(bus)

    // Try to delete a non-existent entity
    await store.delete(CONTACT_TYPE, 'nonexistent-id' as EntityInstanceId)

    expect(emittedEvents).toHaveLength(0)
  })
})

// ============================================================
// createEntityStore — optional bus parameter
// ============================================================

describe('createEntityStore with optional bus parameter', () => {
  it('creates a store without bus (backward compatible)', () => {
    const registry = new InMemoryEntityRegistry()
    const connectors = new InMemoryConnectorRegistry()

    const store = createEntityStore(registry, connectors)

    expect(store).toBeInstanceOf(DefaultEntityStore)
  })

  it('creates a store with bus injection', () => {
    const registry = new InMemoryEntityRegistry()
    const connectors = new InMemoryConnectorRegistry()
    const bus = createSurfaceEventBus()

    const store = createEntityStore(registry, connectors, bus)

    expect(store).toBeInstanceOf(DefaultEntityStore)
  })
})
