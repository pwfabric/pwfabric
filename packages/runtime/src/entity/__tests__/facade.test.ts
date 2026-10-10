/**
 * EntityFacade Tests
 *
 * Facade combining Registry, Store, ConnectorRegistry, BehaviorEngine.
 *
 * @module @pwfabric/runtime/entity/__tests__/facade
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  DefaultEntityFacade,
  createEntityFacade,
  DefaultEntityCapability,
  createEntityCapability,
} from '../facade.js'
import type { EntityTypeId } from '../types.js'
import { createEntityRegistry } from '../registry.js'
import { createConnectorRegistry } from '../connector.js'
import { createEntityLifecycleEngine, createBehaviorEngine } from '../behavior.js'
import { createEntityStore } from '../store.js'
import { StaticConnector } from '../connectors/static.js'

const USER_TYPE = 'user' as EntityTypeId

const sampleDefinition = {
  id: USER_TYPE,
  name: 'User',
  fields: [
    {
      name: 'id',
      type: 'string' as const,
      required: true,
    },
    {
      name: 'name',
      type: 'string' as const,
      required: true,
    },
  ],
  relations: [],
  primaryKey: 'id',
  timestamps: false,
  softDelete: false,
  schema: z.object({
    id: z.string(),
    name: z.string(),
  }),
}

describe('createEntityFacade()', () => {
  it('creates a facade with default subsystems', () => {
    const facade = createEntityFacade()
    expect(facade).toBeInstanceOf(DefaultEntityFacade)
    expect(facade.registry).toBeDefined()
    expect(facade.store).toBeDefined()
    expect(facade.connectors).toBeDefined()
    expect(facade.entityLifecycle).toBeDefined()
    // backward compat: deprecated .behaviors accessor
    expect(facade.behaviors).toBeDefined()
    expect(facade.behaviors).toBe(facade.entityLifecycle)
  })

  it('accepts custom registry', () => {
    const customRegistry = createEntityRegistry()
    const facade = createEntityFacade({ registry: customRegistry })
    expect(facade.registry).toBe(customRegistry)
  })

  it('accepts custom connectors registry', () => {
    const customConnectors = createConnectorRegistry()
    const facade = createEntityFacade({ connectors: customConnectors })
    expect(facade.connectors).toBe(customConnectors)
  })

  it('accepts custom entityLifecycle engine (primary option)', () => {
    const customLifecycle = createEntityLifecycleEngine()
    const facade = createEntityFacade({ entityLifecycle: customLifecycle })
    expect(facade.entityLifecycle).toBe(customLifecycle)
    expect(facade.behaviors).toBe(customLifecycle)
  })

  it('accepts deprecated behaviors option (backward compat)', () => {
    const customBehaviors = createBehaviorEngine()
    const facade = createEntityFacade({ behaviors: customBehaviors })
    expect(facade.entityLifecycle).toBe(customBehaviors)
    expect(facade.behaviors).toBe(customBehaviors)
  })
})

describe('DefaultEntityFacade', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function createTestFacade() {
    const registry = createEntityRegistry()
    const connectors = createConnectorRegistry()
    const behaviors = createBehaviorEngine()
    const store = createEntityStore(registry, connectors)
    return new DefaultEntityFacade(registry, store, connectors, behaviors)
  }

  it('exposes all subsystems as properties', () => {
    const facade = createTestFacade()
    expect(facade.registry).toBeDefined()
    expect(facade.store).toBeDefined()
    expect(facade.connectors).toBeDefined()
    expect(facade.entityLifecycle).toBeDefined()
    // backward compat: deprecated .behaviors getter returns same instance
    expect(facade.behaviors).toBe(facade.entityLifecycle)
  })

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  function createTestFacadeWithConnector() {
    const connectors = createConnectorRegistry()
    const connector = new StaticConnector('static', {})
    connectors.register(connector)
    const registry = createEntityRegistry()
    const behaviors = createBehaviorEngine()
    const store = createEntityStore(registry, connectors)
    return new DefaultEntityFacade(registry, store, connectors, behaviors)
  }

  describe('registerEntity()', () => {
    it('registers entity definition and binds connector', () => {
      const facade = createTestFacadeWithConnector()
      expect(() => facade.registerEntity(sampleDefinition, 'static')).not.toThrow()
    })

    it('entity appears in registry after registerEntity', () => {
      const facade = createTestFacadeWithConnector()
      facade.registerEntity(sampleDefinition, 'static')
      const found = facade.registry.get(USER_TYPE)
      expect(found).toBeDefined()
      expect(found?.id).toBe(USER_TYPE)
    })
  })

  describe('resolveBinding()', () => {
    it('resolves binding and returns a query result', async () => {
      const facade = createTestFacadeWithConnector()
      facade.registerEntity(sampleDefinition, 'static')

      const result = await facade.resolveBinding(USER_TYPE)
      // Static connector returns empty data by default
      expect(result).toBeDefined()
    })

    it('resolves binding with query parameter', async () => {
      const facade = createTestFacadeWithConnector()
      facade.registerEntity(sampleDefinition, 'static')

      const result = await facade.resolveBinding(USER_TYPE, { filters: [] })
      expect(result).toBeDefined()
    })
  })
})

describe('Deprecation re-exports', () => {
  it('DefaultEntityCapability is an alias for DefaultEntityFacade', () => {
    expect(DefaultEntityCapability).toBe(DefaultEntityFacade)
  })

  it('createEntityCapability is an alias for createEntityFacade', () => {
    expect(createEntityCapability).toBe(createEntityFacade)
  })
})
